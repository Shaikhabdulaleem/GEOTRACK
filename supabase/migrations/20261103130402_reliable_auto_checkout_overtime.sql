-- Reliable automatic checkout and overtime.
-- Production ledger version: 20261103130402.
--
-- One location engine now owns automatic EXIT processing for geofence
-- broadcasts, the precision monitor, periodic heartbeats, offline replay and
-- the cron safety net. Manual attendance remains backward compatible.

alter table public.organizations
  add column if not exists auto_checkout_grace_minutes integer not null default 15
    check (auto_checkout_grace_minutes between 0 and 120);

comment on column public.organizations.auto_checkout_grace_minutes is
  'Minutes before scheduled shift end when a verified geofence exit is an immediate, penalty-free automatic checkout.';

create index if not exists attendance_records_open_session_idx
  on public.attendance_records (employee_id, attendance_date desc)
  where check_in_at is not null and check_out_at is null;

create index if not exists employee_location_pings_attendance_stream_idx
  on public.employee_location_pings (attendance_record_id, event_at desc)
  where attendance_record_id is not null;

alter table public.employee_location_pings
  add column if not exists idempotency_key text;

create unique index if not exists employee_location_pings_idempotency_idx
  on public.employee_location_pings (employee_id, idempotency_key)
  where idempotency_key is not null;

alter table public.offline_attendance_events
  drop constraint if exists offline_attendance_events_action_type_check;
alter table public.offline_attendance_events
  add constraint offline_attendance_events_action_type_check
  check (action_type in ('check_in', 'check_out', 'geofence_exit'));

create table if not exists private.attendance_repair_audit (
  id uuid primary key default gen_random_uuid(),
  repair_run_id uuid not null,
  attendance_record_id uuid references public.attendance_records(id) on delete set null,
  action text not null check (action in ('checkout_repair', 'overtime_backfill', 'manual_review')),
  status text not null check (status in ('applied', 'manual_review', 'skipped')),
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default clock_timestamp()
);

revoke all on table private.attendance_repair_audit from public, anon, authenticated;
grant all on table private.attendance_repair_audit to service_role;

create or replace function private.finalize_attendance_checkout(
  p_record_id uuid,
  p_checkout_at timestamptz,
  p_inside_geofence boolean,
  p_reason text,
  p_location_point jsonb,
  p_accuracy_meters double precision,
  p_geofence_id uuid,
  p_idempotency_key text,
  p_received_at timestamptz default clock_timestamp(),
  p_grace_exit boolean default false,
  p_repair_run_id uuid default null
)
returns table(attendance_record_id uuid, event_id uuid, overtime_minutes integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  r record;
  v_shift_start timestamptz;
  v_shift_end timestamptz;
  v_scheduled integer;
  v_presence integer;
  v_worked integer;
  v_overlap integer;
  v_regular integer;
  v_overtime integer;
  v_late integer;
  v_early integer;
  v_missing integer;
  v_event_id uuid;
  v_event_key text;
  v_before jsonb;
  v_after jsonb;
  v_exit_distance_m double precision;
  v_effective_geofence_id uuid := p_geofence_id;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_record_id::text, 0));

  select ar.*, coalesce(nullif(b.timezone, ''), nullif(o.timezone, ''), 'UTC') as org_tz,
         s.start_time, s.end_time, s.crosses_midnight,
         coalesce(s.break_minutes, 0) as break_minutes,
         ep.user_id as employee_user_id
    into r
  from public.attendance_records ar
  join public.organizations o on o.id = ar.organization_id
  join public.employee_profiles ep on ep.id = ar.employee_id
  left join public.branches b on b.id = ep.branch_id and b.organization_id = ar.organization_id
  left join public.shift_assignments sa on sa.id = ar.shift_assignment_id
  left join public.shifts s on s.id = sa.shift_id
  where ar.id = p_record_id
  for update of ar;

  if not found or r.check_in_at is null then
    return;
  end if;
  if r.check_out_at is not null then
    return query select r.id, r.check_out_event_id, r.overtime_minutes;
    return;
  end if;
  if r.start_time is null or r.end_time is null or p_checkout_at <= r.check_in_at then
    return;
  end if;

  v_shift_start := (r.attendance_date + r.start_time) at time zone r.org_tz;
  v_shift_end := (
    r.attendance_date + r.end_time
    + case when r.crosses_midnight or r.end_time <= r.start_time
           then interval '1 day' else interval '0 day' end
  ) at time zone r.org_tz;
  v_scheduled := greatest(0,
    floor(extract(epoch from (v_shift_end - v_shift_start)) / 60)::integer - r.break_minutes);

  v_presence := greatest(0, floor(extract(epoch from (p_checkout_at - r.check_in_at)) / 60)::integer);
  v_worked := greatest(0, v_presence - least(r.break_minutes, v_presence));
  v_overlap := greatest(0, floor(extract(epoch from (
    least(p_checkout_at, v_shift_end) - greatest(r.check_in_at, v_shift_start)
  )) / 60)::integer);
  v_regular := least(greatest(0, v_overlap - least(r.break_minutes, v_overlap)), v_scheduled);
  v_overtime := greatest(0, v_worked - v_regular);
  v_late := greatest(0, floor(extract(epoch from (r.check_in_at - v_shift_start)) / 60)::integer);
  v_early := greatest(0, floor(extract(epoch from (v_shift_end - p_checkout_at)) / 60)::integer);
  v_missing := greatest(0, v_scheduled - v_regular);

  if p_grace_exit then
    v_early := 0;
    v_missing := 0;
  end if;

  if v_effective_geofence_id is null then
    select ga.geofence_id into v_effective_geofence_id
    from public.geofence_assignments ga
    where ga.employee_id = r.employee_id
      and ga.organization_id = r.organization_id
      and ga.effective_from <= r.attendance_date
      and (ga.effective_to is null or ga.effective_to >= r.attendance_date)
    order by ga.effective_from desc
    limit 1;
  end if;

  if p_location_point is not null and v_effective_geofence_id is not null then
    select private.distance_to_multipolygon_m(
      (p_location_point->'coordinates'->>0)::double precision,
      (p_location_point->'coordinates'->>1)::double precision,
      gp.polygon::jsonb
    ) into v_exit_distance_m
    from public.geofence_polygons gp
    where gp.geofence_id = v_effective_geofence_id and gp.is_active
    order by gp.version_number desc
    limit 1;
  end if;

  v_event_key := coalesce(nullif(btrim(p_idempotency_key), ''), 'auto-checkout:' || r.id::text);
  select ae.id into v_event_id
  from public.attendance_events ae
  where ae.employee_id = r.employee_id and ae.idempotency_key = v_event_key;

  if v_event_id is null then
    insert into public.attendance_events (
      organization_id, employee_id, event_type, source, event_at, received_at,
      location_point, accuracy_meters, geofence_id, geofence_validation,
      inside_geofence, approval_status, metadata, idempotency_key, created_by
    ) values (
      r.organization_id, r.employee_id, 'gps_exit'::public.attendance_event_type,
      'automatic_geofence'::public.attendance_source, p_checkout_at,
      coalesce(p_received_at, clock_timestamp()), p_location_point, p_accuracy_meters,
      v_effective_geofence_id,
      (case when p_reason = 'early_exit' then 'invalid' else 'valid' end)::public.geofence_validation_status,
      p_inside_geofence, 'not_required'::public.approval_status,
      jsonb_build_object(
        'auto_closed', true,
        'reason', p_reason,
        'expected_outside', not coalesce(p_inside_geofence, false),
        'grace_exit', p_grace_exit,
        'exit_distance_m', v_exit_distance_m,
        'repair_run_id', p_repair_run_id
      ),
      v_event_key, r.employee_user_id
    ) returning id into v_event_id;
  end if;

  if p_repair_run_id is not null then
    v_before := to_jsonb(r);
  end if;

  update public.attendance_records ar set
    check_out_event_id = v_event_id,
    check_out_at = p_checkout_at,
    worked_minutes = v_worked,
    overtime_minutes = v_overtime,
    late_minutes = v_late,
    early_leaving_minutes = v_early,
    missing_minutes = v_missing,
    geofence_validated = case when p_reason = 'early_exit' then false else ar.geofence_validated end,
    updated_at = coalesce(p_received_at, clock_timestamp())
  where ar.id = r.id and ar.check_out_at is null;

  if not found then
    return;
  end if;

  if v_overtime > 0 and r.employee_user_id is not null then
    insert into public.overtime_records (
      organization_id, employee_id, attendance_record_id, requested_minutes,
      approved_minutes, status, reason, requested_by, requested_at
    ) values (
      r.organization_id, r.employee_id, r.id, v_overtime,
      null, 'pending'::public.approval_status, 'System calculated overtime',
      r.employee_user_id, coalesce(p_received_at, clock_timestamp())
    )
    on conflict (attendance_record_id) do update
      set requested_minutes = excluded.requested_minutes,
          updated_at = clock_timestamp()
      where public.overtime_records.status::text = 'pending';
  end if;

  update public.geofence_breaches
    set status = 'resolved', resolved_at = coalesce(p_received_at, clock_timestamp()),
        updated_at = coalesce(p_received_at, clock_timestamp())
  where employee_id = r.employee_id and status = 'open';

  if p_repair_run_id is not null then
    select to_jsonb(ar) into v_after from public.attendance_records ar where ar.id = r.id;
    insert into private.attendance_repair_audit (
      repair_run_id, attendance_record_id, action, status, reason,
      evidence, before_state, after_state
    ) values (
      p_repair_run_id, r.id, 'checkout_repair', 'applied', p_reason,
      jsonb_build_object('checkout_at', p_checkout_at, 'location', p_location_point),
      v_before, v_after
    );
  end if;

  return query select r.id, v_event_id, v_overtime;
end;
$$;

revoke all on function private.finalize_attendance_checkout(
  uuid, timestamptz, boolean, text, jsonb, double precision, uuid, text,
  timestamptz, boolean, uuid
) from public, anon, authenticated;
grant execute on function private.finalize_attendance_checkout(
  uuid, timestamptz, boolean, text, jsonb, double precision, uuid, text,
  timestamptz, boolean, uuid
) to service_role;

create or replace function public.record_attendance_location(
  p_employee_id uuid,
  p_geofence_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision,
  p_is_mock boolean,
  p_observed_at timestamptz,
  p_idempotency_key text,
  p_device_hash text,
  p_sample_source text
)
returns table(
  location_event_id uuid,
  attendance_record_id uuid,
  inside_geofence boolean,
  classified_position text,
  outcome text,
  checkout_at timestamptz,
  overtime_minutes integer,
  reason text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user_id uuid := (select auth.uid());
  v_employee public.employee_profiles%rowtype;
  v_record public.attendance_records%rowtype;
  v_now timestamptz := clock_timestamp();
  v_observed_at timestamptz;
  v_polygon jsonb;
  v_required_accuracy double precision;
  v_effective_geofence uuid;
  v_inside boolean := null;
  v_buffer_m double precision;
  v_ping_id uuid;
  v_shift record;
  v_shift_end timestamptz;
  v_grace interval;
  v_threshold integer;
  v_boundary timestamptz;
  v_exit_at timestamptz;
  v_minutes_outside integer;
  v_checkout_reason text;
  v_graced boolean := false;
  v_checkout record;
  v_valid_devices integer;
  v_matched_device uuid;
  v_location jsonb;
  v_existing_record_id uuid;
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
  v_grace := make_interval(mins => v_shift.grace_minutes);
  v_threshold := v_shift.threshold;

  select max(event_at) into v_boundary
  from public.employee_location_pings
  where attendance_record_id = v_record.id
    and event_at >= v_record.check_in_at
    and inside_geofence is distinct from false;
  v_boundary := greatest(coalesce(v_boundary, v_record.check_in_at), v_record.check_in_at);

  select min(event_at) into v_exit_at
  from public.employee_location_pings
  where attendance_record_id = v_record.id and event_at > v_boundary and inside_geofence is false;
  v_minutes_outside := greatest(0, floor(extract(epoch from (v_observed_at - v_exit_at)) / 60)::integer);

  if v_exit_at >= v_shift_end then
    v_checkout_reason := 'shift_exit';
  elsif v_exit_at >= v_shift_end - v_grace then
    v_checkout_reason := 'grace_exit';
    v_graced := true;
  elsif v_minutes_outside >= v_threshold then
    v_checkout_reason := 'early_exit';
  end if;

  if v_checkout_reason is null then
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

-- Backward-compatible wrapper used by already-installed APKs.
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
  v_result record;
begin
  select * into v_result
  from public.record_attendance_location(
    p_employee_id, null, p_latitude, p_longitude, p_accuracy_meters, p_is_mock,
    clock_timestamp(), gen_random_uuid()::text, null, 'legacy_heartbeat'
  );
  return query select v_result.location_event_id, v_result.inside_geofence,
    v_result.outcome <> 'ignored_no_open_session';
end;
$$;

revoke all on function public.record_location_ping(uuid, double precision, double precision, double precision, boolean)
  from public, anon;
grant execute on function public.record_location_ping(uuid, double precision, double precision, double precision, boolean)
  to authenticated;

create or replace function private.auto_close_attendance_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_closed integer := 0;
  r record;
  v_shift_end timestamptz;
  v_boundary timestamptz;
  v_exit_at timestamptz;
  v_minutes_outside integer;
  v_minutes_stale integer;
  v_reason text;
  v_graced boolean;
  v_checkout_at timestamptz;
  v_location jsonb;
  v_accuracy double precision;
  v_geofence_id uuid;
  v_result record;
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

    select max(event_at) into v_boundary
    from public.employee_location_pings
    where attendance_record_id = r.id and event_at >= r.check_in_at
      and inside_geofence is distinct from false;
    v_boundary := greatest(coalesce(v_boundary, r.check_in_at), r.check_in_at);

    select event_at, location_point, accuracy_meters, geofence_id
      into v_exit_at, v_location, v_accuracy, v_geofence_id
    from public.employee_location_pings
    where attendance_record_id = r.id and event_at > v_boundary and inside_geofence is false
    order by event_at asc limit 1;

    v_reason := null;
    v_graced := false;
    v_checkout_at := null;
    v_minutes_outside := case when v_exit_at is null then 0
      else greatest(0, floor(extract(epoch from (v_now - v_exit_at)) / 60)::integer) end;
    v_minutes_stale := floor(extract(epoch from (v_now - greatest(v_boundary, v_shift_end))) / 60)::integer;

    if v_exit_at is not null and v_exit_at >= v_shift_end then
      v_reason := 'shift_exit'; v_checkout_at := v_exit_at;
    elsif v_exit_at is not null and v_exit_at >= v_shift_end - make_interval(mins => r.grace_minutes) then
      v_reason := 'grace_exit'; v_checkout_at := v_exit_at; v_graced := true;
    elsif v_exit_at is not null and v_minutes_outside >= r.threshold then
      v_reason := 'early_exit'; v_checkout_at := v_exit_at;
    elsif v_now >= v_shift_end and v_minutes_stale >= r.threshold then
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

create or replace function public.update_attendance_policy(
  p_organization_id uuid,
  p_auto_checkout_grace_minutes integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_org_role(p_organization_id, array['administrator']) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_auto_checkout_grace_minutes is null or p_auto_checkout_grace_minutes < 0
     or p_auto_checkout_grace_minutes > 120 then
    raise exception 'Auto-checkout grace must be between 0 and 120 minutes' using errcode = '22023';
  end if;
  update public.organizations
    set auto_checkout_grace_minutes = p_auto_checkout_grace_minutes,
        updated_at = clock_timestamp()
  where id = p_organization_id;
  if not found then raise exception 'Organization not found' using errcode = 'P0002'; end if;
  return p_auto_checkout_grace_minutes;
end;
$$;

revoke all on function public.update_attendance_policy(uuid, integer) from public, anon;
grant execute on function public.update_attendance_policy(uuid, integer) to authenticated;

create or replace function public.sync_offline_attendance_event(
  p_local_event_id uuid,
  p_organization_id uuid,
  p_employee_id uuid,
  p_action_type text,
  p_geofence_id uuid,
  p_device_timestamp timestamptz,
  p_original_event_time timestamptz,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters real,
  p_is_mock_location boolean,
  p_geofence_validation text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.offline_attendance_events%rowtype;
  response jsonb;
begin
  if not private.is_employee_owner(p_employee_id)
     or not private.employee_belongs_to_org(p_employee_id, p_organization_id) then
    raise exception 'Not authorized to sync offline attendance' using errcode = '42501';
  end if;
  if p_geofence_id is null then
    raise exception 'A geofence assignment is required to sync attendance' using errcode = '22023';
  end if;
  if p_action_type not in ('check_in', 'check_out', 'geofence_exit') then
    raise exception 'Invalid attendance action' using errcode = '22023';
  end if;

  select * into existing from public.offline_attendance_events where local_event_id = p_local_event_id;
  if found then
    return coalesce(existing.server_response,
      jsonb_build_object('status', existing.sync_status, 'event_id', existing.server_event_id));
  end if;

  insert into public.offline_attendance_events (
    local_event_id, organization_id, employee_id, action_type, device_timestamp,
    original_event_time, latitude, longitude, accuracy_meters, is_mock_location,
    geofence_validation
  ) values (
    p_local_event_id, p_organization_id, p_employee_id, p_action_type, p_device_timestamp,
    p_original_event_time, p_latitude, p_longitude, p_accuracy_meters, p_is_mock_location,
    p_geofence_validation
  );

  begin
    if p_action_type = 'geofence_exit' then
      select to_jsonb(processed) into response
      from public.record_attendance_location(
        p_employee_id, p_geofence_id, p_latitude, p_longitude, p_accuracy_meters,
        p_is_mock_location, p_original_event_time, p_local_event_id::text, null, 'offline_geofence_exit'
      ) processed limit 1;
    else
      select to_jsonb(processed) into response
      from public.process_attendance_event(
        p_employee_id => p_employee_id,
        p_geofence_id => p_geofence_id,
        p_action_type => p_action_type,
        p_is_auto => false,
        p_latitude => p_latitude,
        p_longitude => p_longitude,
        p_accuracy_meters => p_accuracy_meters,
        p_is_mock_location => p_is_mock_location,
        p_idempotency_key => p_local_event_id::text,
        p_device_info => jsonb_build_object(
          'platform', 'android', 'offline_local_event_id', p_local_event_id,
          'original_event_time', p_original_event_time, 'device_timestamp', p_device_timestamp
        )
      ) processed limit 1;
    end if;

    update public.offline_attendance_events set
      sync_status = case when coalesce(response->>'outcome', response->>'status', '')
        in ('rejected', 'error', 'failed', 'device_blocked') then 'SYNC_FAILED' else 'SYNCED' end,
      server_event_id = coalesce(
        nullif(response->>'location_event_id', '')::uuid,
        nullif(response->>'event_id', '')::uuid
      ),
      server_response = response,
      geofence_validation = coalesce(response->>'reason', response->>'validation_status', geofence_validation),
      updated_at = clock_timestamp()
    where local_event_id = p_local_event_id;
    return coalesce(response, jsonb_build_object('status', 'SYNC_FAILED', 'error', 'No server response'));
  exception when others then
    update public.offline_attendance_events
      set sync_status = 'SYNC_FAILED', last_error = sqlstate || ': attendance sync failed',
          updated_at = clock_timestamp()
    where local_event_id = p_local_event_id;
    return jsonb_build_object('status', 'SYNC_FAILED', 'error', 'Attendance sync failed');
  end;
end;
$$;

revoke all on function public.sync_offline_attendance_event(
  uuid, uuid, uuid, text, uuid, timestamptz, timestamptz,
  double precision, double precision, real, boolean, text
) from public, anon;
grant execute on function public.sync_offline_attendance_event(
  uuid, uuid, uuid, text, uuid, timestamptz, timestamptz,
  double precision, double precision, real, boolean, text
) to authenticated;

-- Historical repair: quarantine ambiguous stale records, repair evidence-backed
-- exits, and backfill the OT approval rows omitted by the former auto-close.
do $repair$
declare
  v_run_id uuid := gen_random_uuid();
  r record;
  v_boundary timestamptz;
  v_exit_at timestamptz;
  v_location jsonb;
  v_accuracy double precision;
  v_geofence_id uuid;
  v_shift_end timestamptz;
  v_reason text;
  v_graced boolean;
  v_before jsonb;
  v_overtime_id uuid;
begin
  for r in
    select ar.*, coalesce(nullif(b.timezone, ''), nullif(o.timezone, ''), 'UTC') as org_tz,
           coalesce(o.auto_checkout_grace_minutes, 15) as grace_minutes,
           s.start_time, s.end_time, s.crosses_midnight, ep.user_id as employee_user_id
    from public.attendance_records ar
    join public.organizations o on o.id = ar.organization_id
    join public.employee_profiles ep on ep.id = ar.employee_id
    left join public.branches b on b.id = ep.branch_id and b.organization_id = ar.organization_id
    left join public.shift_assignments sa on sa.id = ar.shift_assignment_id
    left join public.shifts s on s.id = sa.shift_id
    where ar.check_in_at is not null and ar.check_out_at is null
      and ar.attendance_date < (clock_timestamp() at time zone coalesce(nullif(o.timezone, ''), 'UTC'))::date - 1
  loop
    select max(event_at) into v_boundary from public.employee_location_pings
    where attendance_record_id = r.id and event_at >= r.check_in_at
      and inside_geofence is distinct from false;
    v_boundary := greatest(coalesce(v_boundary, r.check_in_at), r.check_in_at);
    select event_at, location_point, accuracy_meters, geofence_id
      into v_exit_at, v_location, v_accuracy, v_geofence_id
    from public.employee_location_pings
    where attendance_record_id = r.id and event_at > v_boundary and inside_geofence is false
    order by event_at asc limit 1;

    if v_exit_at is null or r.end_time is null then
      insert into private.attendance_repair_audit (
        repair_run_id, attendance_record_id, action, status, reason, evidence, before_state
      ) values (
        v_run_id, r.id, 'manual_review', 'manual_review',
        case when r.end_time is null then 'No resolved shift' else 'No trustworthy outside event' end,
        jsonb_build_object('last_known_inside_at', v_boundary), to_jsonb(r)
      ) on conflict do nothing;
      continue;
    end if;

    v_shift_end := (
      r.attendance_date + r.end_time
      + case when r.crosses_midnight or r.end_time <= r.start_time
             then interval '1 day' else interval '0 day' end
    ) at time zone r.org_tz;
    if v_exit_at >= v_shift_end then
      v_reason := 'shift_exit'; v_graced := false;
    elsif v_exit_at >= v_shift_end - make_interval(mins => r.grace_minutes) then
      v_reason := 'grace_exit'; v_graced := true;
    else
      v_reason := 'early_exit'; v_graced := false;
    end if;
    perform private.finalize_attendance_checkout(
      r.id, v_exit_at, false, v_reason, v_location, v_accuracy, v_geofence_id,
      'repair-checkout:' || r.id::text, clock_timestamp(), v_graced, v_run_id
    );
  end loop;

  for r in
    select ar.*, ep.user_id as employee_user_id
    from public.attendance_records ar
    join public.employee_profiles ep on ep.id = ar.employee_id
    left join public.overtime_records ot on ot.attendance_record_id = ar.id
    where ar.overtime_minutes > 0 and ot.id is null and ep.user_id is not null
  loop
    v_before := to_jsonb(r);
    insert into public.overtime_records (
      organization_id, employee_id, attendance_record_id, requested_minutes,
      approved_minutes, status, reason, requested_by, requested_at
    ) values (
      r.organization_id, r.employee_id, r.id, r.overtime_minutes,
      null, 'pending'::public.approval_status, 'System calculated overtime',
      r.employee_user_id, coalesce(r.check_out_at, clock_timestamp())
    ) returning id into v_overtime_id;
    insert into private.attendance_repair_audit (
      repair_run_id, attendance_record_id, action, status, reason, evidence, before_state, after_state
    ) values (
      v_run_id, r.id, 'overtime_backfill', 'applied', 'Missing overtime approval row',
      jsonb_build_object('overtime_record_id', v_overtime_id, 'minutes', r.overtime_minutes),
      v_before, jsonb_build_object('overtime_record_id', v_overtime_id)
    );
  end loop;
end;
$repair$;

-- Re-assert the five-minute fallback schedule without touching cron.job directly.
select cron.schedule(
  'geotrack-auto-close-attendance',
  '*/5 * * * *',
  $job$ select private.auto_close_attendance_sessions(); $job$
);
