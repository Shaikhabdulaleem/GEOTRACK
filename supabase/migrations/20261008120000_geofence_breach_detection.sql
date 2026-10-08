-- Sustained out-of-geofence detection during working hours.
--
-- The attendance engine only wrote location at discrete moments (check-in,
-- check-out, geofence enter/exit). An employee who physically leaves the
-- geofence mid-shift was invisible: either the OS geofence EXIT auto-checked
-- them out (looks like an early departure, no alert) or the EXIT was never
-- delivered and they stayed "checked in" with a stale check-in position. There
-- was no notion of "checked in but continuously outside the fence for N minutes
-- during the shift", and nothing on the dashboard to surface it.
--
-- This migration adds that notion in three pieces:
--   1. employee_location_pings - a lightweight presence track the mobile app
--      posts every few minutes WHILE an attendance session is open, each sample
--      classified inside/outside against the assigned polygon (same buffer the
--      attendance engine uses).
--   2. detect_geofence_breaches() - a scheduler-run function that, per
--      checked-in employee, measures the current continuous-outside streak and,
--      once it crosses the org threshold, opens a geofence_breaches row and
--      notifies managers. It resolves the breach when the employee returns.
--   3. get_active_geofence_breaches() - a manager-scoped read for the dashboard.
--
-- Location is the most sensitive data here, so pings are only recorded while a
-- session is open and are locked to SECURITY DEFINER writes; the data-retention
-- job purges them with the other location data.

-- ---------------------------------------------------------------------------
-- 0. Per-organization breach threshold (minutes continuously outside).
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column if not exists geofence_breach_threshold_minutes integer not null default 30
    check (geofence_breach_threshold_minutes between 5 and 480);

comment on column public.organizations.geofence_breach_threshold_minutes is
  'Minutes an on-shift employee may be continuously outside their geofence before a breach is raised.';

-- ---------------------------------------------------------------------------
-- 1. Presence track: periodic location samples while a session is open.
-- ---------------------------------------------------------------------------
create table if not exists public.employee_location_pings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  attendance_record_id uuid references public.attendance_records(id) on delete set null,
  event_at timestamptz not null default clock_timestamp(),
  location_point jsonb not null check (location_point->>'type' = 'Point'),
  accuracy_meters double precision check (accuracy_meters is null or accuracy_meters >= 0),
  geofence_id uuid,
  -- true inside (incl. accuracy buffer), false outside, null when position
  -- could not be classified (no active polygon / no assignment) - null is
  -- treated as "not a breach" so missing geometry never fabricates an alert.
  inside_geofence boolean,
  is_mock boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, employee_id)
    references public.employee_profiles(organization_id, id) on delete cascade
);

create index if not exists employee_location_pings_stream_idx
  on public.employee_location_pings (organization_id, employee_id, event_at desc);

alter table public.employee_location_pings enable row level security;
-- No authenticated policies: pings are written only by record_location_ping
-- (SECURITY DEFINER) and read only by the detector / service role. Clients
-- never read raw presence coordinates.
revoke all on table public.employee_location_pings from anon, authenticated;
grant all on table public.employee_location_pings to service_role;

comment on table public.employee_location_pings is
  'Periodic in-shift location samples used to detect sustained geofence breaches. Precise coordinates; redacted by the data-retention job.';

-- ---------------------------------------------------------------------------
-- 2. Breach records (one open row per employee) + manager alert queue.
-- ---------------------------------------------------------------------------
create table if not exists public.geofence_breaches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  attendance_record_id uuid references public.attendance_records(id) on delete set null,
  geofence_id uuid,
  status text not null default 'open' check (status in ('open', 'resolved')),
  -- Start of the continuous-outside streak that triggered the breach.
  started_at timestamptz not null,
  -- When the streak first crossed the threshold (and managers were notified).
  detected_at timestamptz not null default clock_timestamp(),
  last_seen_outside_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  minutes_outside integer not null default 0 check (minutes_outside >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, employee_id)
    references public.employee_profiles(organization_id, id) on delete cascade
);

-- At most one open breach per employee.
create unique index if not exists geofence_breaches_one_open_idx
  on public.geofence_breaches (employee_id) where status = 'open';
create index if not exists geofence_breaches_org_status_idx
  on public.geofence_breaches (organization_id, status, detected_at desc);

alter table public.geofence_breaches enable row level security;
-- Managers/admins may read breaches in their scope (also powers realtime on the
-- dashboard). Writes are SECURITY DEFINER only.
drop policy if exists manager_scoped_breach_select on public.geofence_breaches;
create policy manager_scoped_breach_select on public.geofence_breaches
  for select to authenticated
  using (private.manager_can_access_employee(employee_id));
revoke all on table public.geofence_breaches from anon, authenticated;
grant select on table public.geofence_breaches to authenticated;
grant all on table public.geofence_breaches to service_role;

-- Per-recipient push queue for breach alerts. The SQL detector enqueues one row
-- per notified manager; the dispatch edge function drains it (service role) and
-- sends FCM. Kept separate from the generic notifications table so draining is
-- idempotent without adding push bookkeeping to every notification.
create table if not exists public.geofence_breach_alerts (
  id uuid primary key default gen_random_uuid(),
  breach_id uuid not null references public.geofence_breaches(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  notification_id uuid references public.notifications(id) on delete set null,
  pushed_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists geofence_breach_alerts_pending_idx
  on public.geofence_breach_alerts (created_at) where pushed_at is null;

alter table public.geofence_breach_alerts enable row level security;
revoke all on table public.geofence_breach_alerts from anon, authenticated;
grant all on table public.geofence_breach_alerts to service_role;

-- ---------------------------------------------------------------------------
-- 3. record_location_ping - employee posts an in-shift presence sample.
-- ---------------------------------------------------------------------------
-- Mirrors the authorization and geofence-buffer logic of the attendance engine.
-- A sample is stored only while the employee has an open attendance session
-- today (or a cross-midnight session opened yesterday); otherwise it no-ops so
-- off-shift location is never tracked.
create or replace function public.record_location_ping(
  p_employee_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision,
  p_is_mock boolean
)
returns table(ping_id uuid, inside_geofence boolean, recorded boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_employee public.employee_profiles%rowtype;
  v_record public.attendance_records%rowtype;
  v_now timestamptz := clock_timestamp();
  v_timezone text;
  v_today date;
  v_polygon jsonb;
  v_required_accuracy double precision;
  v_geofence_id uuid;
  v_inside boolean := null;
  v_buffer_m double precision;
  v_ping_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_latitude is null or p_latitude < -90 or p_latitude > 90
    or p_longitude is null or p_longitude < -180 or p_longitude > 180 then
    raise exception 'Invalid coordinates' using errcode = '22023';
  end if;

  select * into v_employee
  from public.employee_profiles e
  where e.id = p_employee_id and e.employment_status::text = 'active';
  if not found then raise exception 'Active employee not found' using errcode = 'P0002'; end if;
  if not private.is_employee_owner(p_employee_id) then
    raise exception 'Location can only be reported by the employee owner' using errcode = '42501';
  end if;

  select coalesce(nullif(b.timezone, ''), nullif(o.timezone, ''), 'UTC') into v_timezone
  from public.organizations o
  left join public.branches b on b.id = v_employee.branch_id and b.organization_id = o.id
  where o.id = v_employee.organization_id;
  v_timezone := coalesce(v_timezone, 'UTC');
  v_today := (v_now at time zone v_timezone)::date;

  -- Only track while a session is open (checked in, not yet checked out).
  select * into v_record
  from public.attendance_records ar
  where ar.employee_id = p_employee_id
    and ar.check_in_at is not null
    and ar.check_out_at is null
    and ar.attendance_date between v_today - 1 and v_today
  order by ar.attendance_date desc, ar.session_number desc
  limit 1;
  if not found then
    return query select null::uuid, null::boolean, false;
    return;
  end if;

  -- Classify against the active assigned polygon, using the same accuracy
  -- buffer the attendance engine applies (floor 25 m, cap 75 m).
  select gp.polygon::jsonb, gf.required_accuracy_meters, gf.id
    into v_polygon, v_required_accuracy, v_geofence_id
  from public.geofence_assignments ga
  join public.geofences gf on gf.id = ga.geofence_id
  join public.geofence_polygons gp on gp.geofence_id = gf.id and gp.is_active
  where ga.employee_id = p_employee_id
    and ga.organization_id = v_employee.organization_id
    and ga.effective_from <= v_today
    and (ga.effective_to is null or ga.effective_to >= v_today)
    and gf.status::text = 'active'
  order by ga.effective_from desc
  limit 1;

  if v_polygon is not null then
    if coalesce(p_is_mock, false) then
      -- A spoofed location cannot be trusted as "inside"; treat as unknown so it
      -- neither clears nor fabricates a breach. Mock handling for attendance is
      -- unchanged and still happens in the engine.
      v_inside := null;
    elsif p_accuracy_meters is not null and p_accuracy_meters > v_required_accuracy then
      v_inside := null; -- too imprecise to classify
    else
      v_buffer_m := least(greatest(coalesce(p_accuracy_meters, 0) + 15, 25), 75);
      v_inside := private.point_in_multipolygon(p_longitude, p_latitude, v_polygon)
        or private.distance_to_multipolygon_m(p_longitude, p_latitude, v_polygon) <= v_buffer_m;
    end if;
  end if;

  insert into public.employee_location_pings (
    organization_id, employee_id, attendance_record_id, event_at, location_point,
    accuracy_meters, geofence_id, inside_geofence, is_mock
  ) values (
    v_employee.organization_id, p_employee_id, v_record.id, v_now,
    jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(p_longitude, p_latitude)),
    p_accuracy_meters, v_geofence_id, v_inside, coalesce(p_is_mock, false)
  ) returning id into v_ping_id;

  return query select v_ping_id, v_inside, true;
end;
$$;

revoke all on function public.record_location_ping(uuid, double precision, double precision, double precision, boolean) from public, anon;
grant execute on function public.record_location_ping(uuid, double precision, double precision, double precision, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. detect_geofence_breaches - open/resolve breaches, notify managers.
-- ---------------------------------------------------------------------------
-- Run by the scheduler (pg_cron) every few minutes, or manually. For each
-- employee with an open session, it computes the start of the current
-- continuous-outside streak from the ping stream and compares its duration to
-- the org threshold.
create or replace function private.detect_geofence_breaches()
returns table(breaches_opened integer, breaches_resolved integer, breaches_updated integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opened integer := 0;
  v_resolved integer := 0;
  v_updated integer := 0;
  v_now timestamptz := clock_timestamp();
  r record;
  v_threshold integer;
  v_boundary timestamptz;
  v_streak_start timestamptz;
  v_last_outside timestamptz;
  v_minutes integer;
  v_breach public.geofence_breaches%rowtype;
  v_geofence_id uuid;
  v_notification_id uuid;
  m record;
begin
  for r in
    select ar.id as record_id, ar.organization_id, ar.employee_id,
           ar.check_in_at, o.geofence_breach_threshold_minutes as threshold,
           coalesce(nullif(o.name, ''), 'your organization') as org_name,
           ep.full_name
    from public.attendance_records ar
    join public.organizations o on o.id = ar.organization_id and o.status::text = 'active'
    join public.employee_profiles ep on ep.id = ar.employee_id
    where ar.check_in_at is not null
      and ar.check_out_at is null
      and ar.attendance_date >= (v_now at time zone coalesce(nullif(o.timezone, ''), 'UTC'))::date - 1
  loop
    v_threshold := coalesce(r.threshold, 30);

    -- Boundary = the most recent moment the employee was known to be inside
    -- (or unclassified), never earlier than check-in. The current outside
    -- streak is the run of outside pings strictly after the boundary.
    select max(event_at) into v_boundary
    from public.employee_location_pings
    where employee_id = r.employee_id
      and event_at >= r.check_in_at
      and inside_geofence is distinct from false; -- true or null (unclassified)
    v_boundary := greatest(coalesce(v_boundary, r.check_in_at), r.check_in_at);

    select min(event_at), max(event_at), max(geofence_id)
      into v_streak_start, v_last_outside, v_geofence_id
    from public.employee_location_pings
    where employee_id = r.employee_id
      and event_at > v_boundary
      and inside_geofence is false;

    select * into v_breach
    from public.geofence_breaches
    where employee_id = r.employee_id and status = 'open'
    limit 1;

    if v_streak_start is null then
      -- Back inside (or no outside evidence) -> resolve any open breach.
      if v_breach.id is not null then
        update public.geofence_breaches
          set status = 'resolved', resolved_at = v_now, updated_at = v_now
          where id = v_breach.id;
        v_resolved := v_resolved + 1;
      end if;
      continue;
    end if;

    v_minutes := floor(extract(epoch from (v_now - v_streak_start)) / 60)::integer;

    if v_breach.id is not null then
      -- Existing breach still ongoing: refresh its live figures.
      update public.geofence_breaches
        set minutes_outside = v_minutes,
            last_seen_outside_at = v_last_outside,
            started_at = v_streak_start,
            updated_at = v_now
        where id = v_breach.id;
      v_updated := v_updated + 1;
      continue;
    end if;

    if v_minutes < v_threshold then
      continue; -- outside, but not long enough yet
    end if;

    -- New breach: open it and notify every manager/admin in the org.
    insert into public.geofence_breaches (
      organization_id, employee_id, attendance_record_id, geofence_id, status,
      started_at, detected_at, last_seen_outside_at, minutes_outside
    ) values (
      r.organization_id, r.employee_id, r.record_id, v_geofence_id, 'open',
      v_streak_start, v_now, v_last_outside, v_minutes
    ) returning * into v_breach;
    v_opened := v_opened + 1;

    for m in
      select mem.user_id
      from public.organization_memberships mem
      where mem.organization_id = r.organization_id
        and mem.status::text = 'active'
        and mem.role_code::text in ('manager', 'administrator')
    loop
      insert into public.notifications (
        organization_id, recipient_user_id, notification_type, severity, title, body,
        entity_type, entity_id
      ) values (
        r.organization_id, m.user_id, 'geofence_breach', 'warning',
        'Employee outside geofence',
        coalesce(r.full_name, 'An employee') || ' has been outside their geofence for '
          || v_minutes || ' minutes during their shift.',
        'employee', r.employee_id
      ) returning id into v_notification_id;

      insert into public.geofence_breach_alerts (
        breach_id, organization_id, recipient_user_id, notification_id
      ) values (v_breach.id, r.organization_id, m.user_id, v_notification_id);
    end loop;
  end loop;

  return query select v_opened, v_resolved, v_updated;
end;
$$;

revoke all on function private.detect_geofence_breaches() from public, anon, authenticated;
grant execute on function private.detect_geofence_breaches() to service_role;

-- ---------------------------------------------------------------------------
-- 5. get_active_geofence_breaches - manager-scoped dashboard read.
-- ---------------------------------------------------------------------------
create or replace function public.get_active_geofence_breaches(p_organization_id uuid)
returns table(
  breach_id uuid,
  employee_id uuid,
  employee_name text,
  geofence_id uuid,
  geofence_name text,
  started_at timestamptz,
  detected_at timestamptz,
  last_seen_outside_at timestamptz,
  minutes_outside integer
)
language sql
security definer
set search_path = ''
as $$
  select
    b.id,
    b.employee_id,
    ep.full_name,
    b.geofence_id,
    gf.name,
    b.started_at,
    b.detected_at,
    b.last_seen_outside_at,
    -- Live figure so the dashboard keeps counting up between detector runs.
    greatest(b.minutes_outside, floor(extract(epoch from (clock_timestamp() - b.started_at)) / 60)::integer)
  from public.geofence_breaches b
  join public.employee_profiles ep on ep.id = b.employee_id
  left join public.geofences gf on gf.id = b.geofence_id
  where b.organization_id = p_organization_id
    and b.status = 'open'
    and private.is_org_member(p_organization_id)
    and private.manager_can_access_employee(b.employee_id)
  order by b.detected_at desc;
$$;

revoke all on function public.get_active_geofence_breaches(uuid) from public, anon;
grant execute on function public.get_active_geofence_breaches(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. claim_breach_push_batch - dispatch edge function drains the push queue.
-- ---------------------------------------------------------------------------
create or replace function public.claim_breach_push_batch(p_limit integer default 100)
returns table(alert_id uuid, notification_id uuid, recipient_user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with claimed as (
    select a.id
    from public.geofence_breach_alerts a
    where a.pushed_at is null
    order by a.created_at
    limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update skip locked
  )
  update public.geofence_breach_alerts a
    set pushed_at = clock_timestamp()
    from claimed
    where a.id = claimed.id
    returning a.id, a.notification_id, a.recipient_user_id;
end;
$$;

revoke all on function public.claim_breach_push_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_breach_push_batch(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Schedule the detector (best-effort; no-op where pg_cron is unavailable).
-- ---------------------------------------------------------------------------
DO $cron$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule(
    'geotrack-geofence-breach-detection',
    '*/3 * * * *',
    $job$ SELECT private.detect_geofence_breaches(); $job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not scheduled (%): enable pg_cron and schedule private.detect_geofence_breaches() every few minutes manually.', SQLERRM;
END;
$cron$;

-- ---------------------------------------------------------------------------
-- 7b. Realtime for geofence_breaches so the dashboard panel updates live.
-- ---------------------------------------------------------------------------
-- Delivery still respects RLS (manager_scoped_breach_select), so a subscriber
-- only receives breach rows it is already allowed to SELECT.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'geofence_breaches'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.geofence_breaches;
  END IF;
END $$;

-- REPLICA IDENTITY FULL so UPDATE/DELETE events carry organization_id for
-- client-side channel filtering.
ALTER TABLE public.geofence_breaches REPLICA IDENTITY FULL;

-- ---------------------------------------------------------------------------
-- 8. Fold presence pings into the retention job (PDPL data minimization).
-- ---------------------------------------------------------------------------
-- Pings are short-lived operational data (not the payroll audit trail), so they
-- are deleted outright on a short window, and resolved breaches age out with the
-- other operational records. The 3-arg version is dropped first because adding a
-- parameter creates a new overload that would make the no-arg cron call
-- ambiguous.
DROP FUNCTION IF EXISTS private.enforce_data_retention(integer, integer, integer);

CREATE OR REPLACE FUNCTION private.enforce_data_retention(
  p_location_redaction_days integer DEFAULT 180,
  p_notification_days integer DEFAULT 365,
  p_phone_usage_days integer DEFAULT 365,
  p_location_ping_days integer DEFAULT 30
)
RETURNS TABLE (
  locations_redacted bigint,
  notifications_purged bigint,
  phone_usage_purged bigint,
  location_pings_purged bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_locations bigint := 0;
  v_notifications bigint := 0;
  v_phone bigint := 0;
  v_pings bigint := 0;
BEGIN
  IF p_location_redaction_days < 1 OR p_notification_days < 1
     OR p_phone_usage_days < 1 OR p_location_ping_days < 1 THEN
    RAISE EXCEPTION 'Retention windows must be positive day counts' USING errcode = '22023';
  END IF;

  UPDATE public.attendance_events
     SET location_point = NULL,
         accuracy_meters = NULL,
         device_info = '{}'::jsonb,
         device_id = NULL
   WHERE received_at < now() - make_interval(days => p_location_redaction_days)
     AND (location_point IS NOT NULL OR device_id IS NOT NULL OR device_info <> '{}'::jsonb);
  GET DIAGNOSTICS v_locations = ROW_COUNT;

  DELETE FROM public.notifications
   WHERE created_at < now() - make_interval(days => p_notification_days);
  GET DIAGNOSTICS v_notifications = ROW_COUNT;

  DELETE FROM public.phone_usage_records
   WHERE created_at < now() - make_interval(days => p_phone_usage_days);
  GET DIAGNOSTICS v_phone = ROW_COUNT;

  DELETE FROM public.employee_location_pings
   WHERE event_at < now() - make_interval(days => p_location_ping_days);
  GET DIAGNOSTICS v_pings = ROW_COUNT;

  -- Resolved breaches are lightweight history; drop them with the ping window.
  DELETE FROM public.geofence_breaches
   WHERE status = 'resolved'
     AND coalesce(resolved_at, updated_at) < now() - make_interval(days => p_location_ping_days);

  RETURN QUERY SELECT v_locations, v_notifications, v_phone, v_pings;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_data_retention(integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.enforce_data_retention(integer, integer, integer, integer) TO service_role;
