-- Migration: 20261121184100_fix_false_auto_checkout_inside_geofence.sql
--
-- PROBLEM
-- Employees physically still inside the geofence are being auto-checked out.
-- Confirmed affected: P Sarker Md Ripon, Likhon, Md Ariful Islam (2026-11-21).
--
-- ROOT CAUSE
-- Both record_attendance_location() and auto_close_attendance_sessions() start
-- the exit clock as soon as ONE outside=false ping is recorded, then fire the
-- checkout once the breach threshold elapses.  A single bad GPS reading (Android
-- coordinate drift near the fence boundary, a momentary accuracy spike, or the
-- GPS fix jumping while the phone screen is off) produces exactly one rogue
-- outside ping.  If the phone then enters Doze mode and stops reporting, the
-- threshold window elapses with no contradicting inside evidence and the session
-- is closed -- even though the employee never left.
--
-- FIX
-- Require a minimum of 2 outside pings after the last confirmed inside boundary
-- before triggering shift_exit, grace_exit, or early_exit.  A single isolated
-- outside reading is treated as a GPS artefact and does not start the checkout
-- process.  The shift_end staleness branch (cron-only, fires when the phone has
-- been completely silent past shift end) is intentionally unchanged -- that
-- branch already requires the full threshold duration of silence, which correctly
-- handles dead-phone / crashed-service scenarios.
--
-- WHAT CHANGES
--   record_attendance_location()         -- adds v_outside_count, guards all 3 exit paths
--   private.auto_close_attendance_sessions() -- adds v_outside_count, guards all 3 exit paths
--
-- SIDE EFFECTS
-- Sessions that currently have only 1 outside ping and are open will stay open
-- until either (a) a second outside ping confirms the departure, or (b) the
-- shift_end staleness branch closes them.  Already-closed incorrect sessions
-- (e.g. the three affected employees) must be reopened via the Admin Attendance
-- Corrections UI -- direct SQL update would bypass the audit trail.
--
-- DIAGNOSTIC QUERY (run in Supabase SQL editor to find today's false checkouts):
--   select ar.id, ep.full_name, ar.attendance_date, ar.check_in_at, ar.check_out_at,
--          ae.metadata->>'reason' as checkout_reason, ae.source,
--          (select count(*) from public.employee_location_pings lp
--           where lp.attendance_record_id = ar.id and lp.inside_geofence = false) as outside_pings
--   from public.attendance_records ar
--   join public.employee_profiles ep on ep.id = ar.employee_id
--   join public.attendance_events ae on ae.id = ar.check_out_event_id
--   where ar.attendance_date = current_date
--     and ae.source = 'automatic_geofence'
--     and ae.metadata->>'auto_closed' = 'true'
--   order by ar.check_out_at desc;

-- ─── 1. record_attendance_location ─────────────────────────────────────────────
-- Full replacement with one new variable (v_outside_count) and three guarded
-- exit conditions.  Everything else is identical to 20261103130402.

create or replace function public.record_attendance_location(
  p_employee_id      uuid,
  p_geofence_id      uuid,
  p_latitude         double precision,
  p_longitude        double precision,
  p_accuracy_meters  double precision,
  p_is_mock          boolean,
  p_observed_at      timestamptz,
  p_idempotency_key  text,
  p_device_hash      text,
  p_sample_source    text
)
returns table(
  location_event_id    uuid,
  attendance_record_id uuid,
  inside_geofence      boolean,
  classified_position  text,
  outcome              text,
  checkout_at          timestamptz,
  overtime_minutes     integer,
  reason               text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user_id            uuid := (select auth.uid());
  v_employee           public.employee_profiles%rowtype;
  v_record             public.attendance_records%rowtype;
  v_now                timestamptz := clock_timestamp();
  v_observed_at        timestamptz;
  v_polygon            jsonb;
  v_required_accuracy  double precision;
  v_effective_geofence uuid;
  v_inside             boolean := null;
  v_buffer_m           double precision;
  v_ping_id            uuid;
  v_shift              record;
  v_shift_end          timestamptz;
  v_grace              interval;
  v_threshold          integer;
  v_boundary           timestamptz;
  v_exit_at            timestamptz;
  v_minutes_outside    integer;
  v_checkout_reason    text;
  v_graced             boolean := false;
  v_checkout           record;
  v_valid_devices      integer;
  v_matched_device     uuid;
  v_location           jsonb;
  v_existing_record_id uuid;
  -- NEW: count of outside pings after the inside boundary.
  -- Must be >= 2 before any exit-based checkout fires, to guard against a
  -- single GPS coordinate glitch triggering a false departure.
  v_outside_count      integer := 0;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if nullif(btrim(p_idempotency_key), '') is null or length(p_idempotency_key) > 200 then
    raise exception 'Invalid idempotency key' using errcode = '22023';
  end if;
  if p_latitude is null or p_latitude < -90 or p_latitude > 90
     or p_longitude is null or p_longitude < -180 or p_longitude > 180 then
    raise exception 'Invalid coordinates' using errcode = '22023';
  end if;
  if p_accuracy_meters is null or p_accuracy_meters < 0 then
    raise exception 'A GPS accuracy reading is required' using errcode = '22023';
  end if;

  select * into v_employee
  from public.employee_profiles ep
  where ep.id = p_employee_id and ep.employment_status::text = 'active';
  if not found then raise exception 'Active employee not found' using errcode = 'P0002'; end if;
  if not private.is_employee_owner(p_employee_id) then
    raise exception 'Location can only be reported by the employee owner' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_device_hash, '')), '') is not null then
    select count(*) into v_valid_devices
    from public.employee_devices
    where employee_id = p_employee_id and integrity_status = 'valid' and revoked_at is null;

    if v_valid_devices = 0 then
      insert into public.employee_devices (
        organization_id, employee_id, device_identifier_hash, platform, integrity_status, last_seen_at
      ) values (
        v_employee.organization_id, p_employee_id, p_device_hash, 'android', 'valid', v_now
      ) on conflict (employee_id, device_identifier_hash)
        do update set integrity_status = 'valid', revoked_at = null, last_seen_at = excluded.last_seen_at;
    else
      select id into v_matched_device from public.employee_devices
      where employee_id = p_employee_id and device_identifier_hash = p_device_hash
        and integrity_status = 'valid' and revoked_at is null;
      if v_matched_device is null then
        return query select null::uuid, null::uuid, null::boolean, 'rejected'::text,
          'device_blocked'::text, null::timestamptz, 0, 'device_blocked'::text;
        return;
      end if;
      update public.employee_devices set last_seen_at = v_now where id = v_matched_device;
    end if;
  end if;

  select lp.id, lp.attendance_record_id, lp.inside_geofence
    into v_ping_id, v_existing_record_id, v_inside
  from public.employee_location_pings lp
  where lp.employee_id = p_employee_id and lp.idempotency_key = p_idempotency_key;
  if found then
    select * into v_record from public.attendance_records ar where ar.id = v_existing_record_id;
    return query select v_ping_id, v_existing_record_id, v_inside,
      case when v_inside then 'inside' when v_inside is false then 'outside' else 'unknown' end,
      case when v_record.check_out_at is null then 'duplicate' else 'checkout_completed' end,
      v_record.check_out_at, coalesce(v_record.overtime_minutes, 0), 'duplicate'::text;
    return;
  end if;

  select * into v_record
  from public.attendance_records ar
  where ar.employee_id = p_employee_id and ar.check_in_at is not null and ar.check_out_at is null
  order by ar.attendance_date desc, ar.session_number desc
  limit 1;
  if not found then
    return query select null::uuid, null::uuid, null::boolean, 'unknown'::text,
      'ignored_no_open_session'::text, null::timestamptz, 0, 'no_open_session'::text;
    return;
  end if;

  v_observed_at := coalesce(p_observed_at, v_now);
  if v_observed_at > v_now + interval '5 minutes' then
    raise exception 'Observed time is in the future' using errcode = '22023';
  end if;
  if v_observed_at < v_record.check_in_at then
    raise exception 'Observed time precedes check-in' using errcode = '22023';
  end if;

  select gp.polygon::jsonb, gf.required_accuracy_meters, gf.id
    into v_polygon, v_required_accuracy, v_effective_geofence
  from public.geofence_assignments ga
  join public.geofences gf on gf.id = ga.geofence_id
  join public.geofence_polygons gp on gp.geofence_id = gf.id and gp.is_active
  where ga.employee_id = p_employee_id
    and ga.organization_id = v_employee.organization_id
    and ga.effective_from <= v_record.attendance_date
    and (ga.effective_to is null or ga.effective_to >= v_record.attendance_date)
    and (p_geofence_id is null or gf.id = p_geofence_id)
    and gf.status::text = 'active'
  order by ga.effective_from desc
  limit 1;

  if v_polygon is null then
    raise exception 'No active work location is assigned for this attendance session' using errcode = '22023';
  end if;

  if coalesce(p_is_mock, false) then
    v_inside := null;
  elsif p_accuracy_meters > v_required_accuracy then
    v_inside := null;
  else
    v_buffer_m := least(greatest(p_accuracy_meters + 15, 25), 75);
    v_inside := private.point_in_multipolygon(p_longitude, p_latitude, v_polygon)
      or private.distance_to_multipolygon_m(p_longitude, p_latitude, v_polygon) <= v_buffer_m;
  end if;

  v_location := jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(p_longitude, p_latitude));
  insert into public.employee_location_pings (
    organization_id, employee_id, attendance_record_id, event_at, location_point,
    accuracy_meters, geofence_id, inside_geofence, is_mock, idempotency_key
  ) values (
    v_employee.organization_id, p_employee_id, v_record.id, v_observed_at, v_location,
    p_accuracy_meters, v_effective_geofence, v_inside, coalesce(p_is_mock, false), p_idempotency_key
  ) returning id into v_ping_id;

  if v_inside is null then
    return query select v_ping_id, v_record.id, null::boolean, 'rejected'::text,
      'rejected'::text, null::timestamptz, 0,
      case when p_is_mock then 'mock_location' else 'low_accuracy' end;
    return;
  end if;

  if v_inside then
    return query select v_ping_id, v_record.id, true, 'inside'::text, 'recorded_inside'::text,
      null::timestamptz, 0, 'inside'::text;
    return;
  end if;

  -- The current ping is outside. Load shift / org policy.
  select s.start_time, s.end_time, s.crosses_midnight, coalesce(s.break_minutes, 0) as break_minutes,
         coalesce(nullif(b.timezone, ''), nullif(o.timezone, ''), 'UTC') as org_tz,
         coalesce(o.auto_checkout_grace_minutes, 15) as grace_minutes,
         coalesce(o.geofence_breach_threshold_minutes, 30) as threshold
    into v_shift
  from public.organizations o
  left join public.branches b on b.id = v_employee.branch_id and b.organization_id = o.id
  left join public.shift_assignments sa on sa.id = v_record.shift_assignment_id
  left join public.shifts s on s.id = sa.shift_id
  where o.id = v_employee.organization_id;

  if v_shift.end_time is null then
    return query select v_ping_id, v_record.id, false, 'outside'::text, 'recorded_outside'::text,
      null::timestamptz, 0, 'no_resolved_shift'::text;
    return;
  end if;

  v_shift_end := (
    v_record.attendance_date + v_shift.end_time
    + case when v_shift.crosses_midnight or v_shift.end_time <= v_shift.start_time
           then interval '1 day' else interval '0 day' end
  ) at time zone v_shift.org_tz;
  v_grace     := make_interval(mins => v_shift.grace_minutes);
  v_threshold := v_shift.threshold;

  -- Last confirmed inside (or unclassified) moment.
  select max(event_at) into v_boundary
  from public.employee_location_pings
  where attendance_record_id = v_record.id
    and event_at >= v_record.check_in_at
    and inside_geofence is distinct from false;
  v_boundary := greatest(coalesce(v_boundary, v_record.check_in_at), v_record.check_in_at);

  -- Count ALL outside pings after the boundary (including the one just inserted).
  -- FIX: require >= 2 to guard against a single GPS coordinate glitch triggering
  -- a false checkout.  One isolated outside reading is recorded as evidence but
  -- does not close the session.
  select min(event_at), count(*) into v_exit_at, v_outside_count
  from public.employee_location_pings
  where attendance_record_id = v_record.id
    and event_at > v_boundary
    and inside_geofence is false;

  v_minutes_outside := greatest(0,
    floor(extract(epoch from (v_observed_at - v_exit_at)) / 60)::integer);

  if v_exit_at is not null and v_exit_at >= v_shift_end and v_outside_count >= 2 then
    v_checkout_reason := 'shift_exit';
  elsif v_exit_at is not null and v_exit_at >= v_shift_end - v_grace and v_outside_count >= 2 then
    v_checkout_reason := 'grace_exit';
    v_graced := true;
  elsif v_outside_count >= 2 and v_minutes_outside >= v_threshold then
    v_checkout_reason := 'early_exit';
  end if;

  if v_checkout_reason is null then
    -- Outside but not yet confirmed: record evidence, leave session open.
    return query select v_ping_id, v_record.id, false, 'outside'::text, 'recorded_outside'::text,
      null::timestamptz, 0, 'outside_before_checkout_window'::text;
    return;
  end if;

  select * into v_checkout
  from private.finalize_attendance_checkout(
    v_record.id, v_exit_at, false, v_checkout_reason, v_location,
    p_accuracy_meters, v_effective_geofence,
    'location-checkout:' || p_idempotency_key, v_now, v_graced, null
  );

  return query select v_ping_id, v_record.id, false, 'outside'::text, 'checkout_completed'::text,
    v_exit_at, coalesce(v_checkout.overtime_minutes, 0), v_checkout_reason;
end;
$$;

revoke all on function public.record_attendance_location(
  uuid, uuid, double precision, double precision, double precision, boolean,
  timestamptz, text, text, text
) from public, anon;
grant execute on function public.record_attendance_location(
  uuid, uuid, double precision, double precision, double precision, boolean,
  timestamptz, text, text, text
) to authenticated;


-- ─── 2. private.auto_close_attendance_sessions ─────────────────────────────────
-- Full replacement with v_outside_count guard on the same three exit paths.
-- The shift_end staleness branch is unchanged.

create or replace function private.auto_close_attendance_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now           timestamptz := clock_timestamp();
  v_closed        integer := 0;
  r               record;
  v_shift_end     timestamptz;
  v_boundary      timestamptz;
  v_exit_at       timestamptz;
  v_minutes_outside integer;
  v_minutes_stale integer;
  v_reason        text;
  v_graced        boolean;
  v_checkout_at   timestamptz;
  v_location      jsonb;
  v_accuracy      double precision;
  v_geofence_id   uuid;
  v_result        record;
  -- NEW: same guard as record_attendance_location -- require >= 2 outside pings.
  v_outside_count integer := 0;
begin
  for r in
    select ar.id, ar.organization_id, ar.employee_id, ar.check_in_at, ar.attendance_date,
           coalesce(nullif(b.timezone, ''), nullif(o.timezone, ''), 'UTC') as org_tz,
           coalesce(o.geofence_breach_threshold_minutes, 30) as threshold,
           coalesce(o.auto_checkout_grace_minutes, 15) as grace_minutes,
           s.start_time, s.end_time, s.crosses_midnight
    from public.attendance_records ar
    join public.organizations o on o.id = ar.organization_id and o.status::text = 'active'
    join public.employee_profiles ep on ep.id = ar.employee_id
    left join public.branches b on b.id = ep.branch_id and b.organization_id = ar.organization_id
    left join public.shift_assignments sa on sa.id = ar.shift_assignment_id
    left join public.shifts s on s.id = sa.shift_id
    where ar.check_in_at is not null and ar.check_out_at is null
      and not exists (
        select 1 from private.attendance_repair_audit a
        where a.attendance_record_id = ar.id and a.status = 'manual_review'
      )
  loop
    if r.start_time is null or r.end_time is null then continue; end if;

    v_shift_end := (
      r.attendance_date + r.end_time
      + case when r.crosses_midnight or r.end_time <= r.start_time
             then interval '1 day' else interval '0 day' end
    ) at time zone r.org_tz;

    -- Last moment the employee was confirmed inside (or GPS was unclassified).
    select max(event_at) into v_boundary
    from public.employee_location_pings
    where attendance_record_id = r.id
      and event_at >= r.check_in_at
      and inside_geofence is distinct from false;
    v_boundary := greatest(coalesce(v_boundary, r.check_in_at), r.check_in_at);

    -- FIX: count ALL outside pings after the boundary in one pass.
    -- v_exit_at     = earliest departure signal (used as checkout timestamp).
    -- v_outside_count = total; must be >= 2 before any exit-based branch fires.
    select min(event_at), count(*)
      into v_exit_at, v_outside_count
    from public.employee_location_pings
    where attendance_record_id = r.id
      and event_at > v_boundary
      and inside_geofence is false;
    v_outside_count := coalesce(v_outside_count, 0);

    -- Fetch location evidence for the first outside ping (checkout evidence).
    if v_exit_at is not null then
      select location_point, accuracy_meters, geofence_id
        into v_location, v_accuracy, v_geofence_id
      from public.employee_location_pings
      where attendance_record_id = r.id
        and event_at = v_exit_at
        and inside_geofence is false
      limit 1;
    else
      v_location := null; v_accuracy := null; v_geofence_id := null;
    end if;

    v_reason        := null;
    v_graced        := false;
    v_checkout_at   := null;
    v_minutes_outside := case when v_exit_at is null then 0
      else greatest(0, floor(extract(epoch from (v_now - v_exit_at)) / 60)::integer) end;
    v_minutes_stale := floor(
      extract(epoch from (v_now - greatest(v_boundary, v_shift_end))) / 60)::integer;

    if v_exit_at is not null and v_exit_at >= v_shift_end and v_outside_count >= 2 then
      -- Left at or after shift end, confirmed by >= 2 outside pings.
      v_reason := 'shift_exit'; v_checkout_at := v_exit_at;

    elsif v_exit_at is not null
          and v_exit_at >= v_shift_end - make_interval(mins => r.grace_minutes)
          and v_outside_count >= 2 then
      -- Left in the grace window before shift end, confirmed by >= 2 outside pings.
      v_reason := 'grace_exit'; v_checkout_at := v_exit_at; v_graced := true;

    elsif v_exit_at is not null and v_outside_count >= 2 and v_minutes_outside >= r.threshold then
      -- Sustained early departure, confirmed by >= 2 outside pings over threshold duration.
      v_reason := 'early_exit'; v_checkout_at := v_exit_at;

    elsif v_now >= v_shift_end and v_minutes_stale >= r.threshold then
      -- Phone completely silent past shift end: close back-dated to last-known position.
      -- No outside-ping guard here -- this branch fires only when the phone has been
      -- wholly quiet (no inside OR outside pings) for >= threshold minutes past shift end.
      v_reason := 'shift_end'; v_checkout_at := greatest(v_boundary, v_shift_end);
      v_location := null; v_accuracy := null; v_geofence_id := null;
    end if;

    if v_reason is null then continue; end if;

    select * into v_result
    from private.finalize_attendance_checkout(
      r.id, v_checkout_at, v_reason = 'shift_end', v_reason,
      v_location, v_accuracy, v_geofence_id, 'auto-close:' || r.id::text,
      v_now, v_graced, null
    );
    if v_result.attendance_record_id is not null then v_closed := v_closed + 1; end if;
  end loop;
  return v_closed;
end;
$$;

revoke all on function private.auto_close_attendance_sessions() from public, anon, authenticated;
grant execute on function private.auto_close_attendance_sessions() to service_role;
