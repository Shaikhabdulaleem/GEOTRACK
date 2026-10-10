-- Automatic check-out that doesn't depend on a geofence EXIT broadcast.
--
-- Auto check-in has two triggers (the one-shot geofence ENTER *and* the periodic
-- AutoAttendanceWorker safety net), but auto check-out only ever had the geofence
-- EXIT broadcast. Those are exactly the events dropped under Doze / OEM battery
-- killers, and none fire at all when the employee is still inside at shift end or
-- the phone is offline/dead. So sessions silently stayed open.
--
-- This closes them server-side, using data the breach detector already collects
-- (employee_location_pings: inside/outside + coordinates + timestamp). It runs on
-- the same pg_cron cadence and needs no new mobile code and no schema change.
--
-- Two cases, matching the product requirement:
--   * Still inside at shift end  -> close AT the scheduled end (no phantom OT).
--   * Left the fence early (a sustained outside streak past the org breach
--     threshold, or simply outside once the shift has ended) -> close, BACK-DATED
--     to the moment they were first seen outside, flagged outside-geofence, with
--     the distance from the fence recorded on the check-out event.
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
  v_tz text;
  v_shift_start timestamptz;
  v_shift_end timestamptz;
  v_scheduled integer;
  v_boundary timestamptz;
  v_exit_at timestamptz;
  v_has_left boolean;
  v_minutes_outside integer;
  v_shift_ended boolean;
  v_checkout_at timestamptz;
  v_inside boolean;
  v_polygon jsonb;
  v_last_out jsonb;
  v_distance_m double precision;
  v_presence integer;
  v_worked integer;
  v_overlap integer;
  v_regular integer;
  v_overtime integer;
  v_late integer;
  v_early integer;
  v_missing integer;
  v_event_id uuid;
  v_idem text;
begin
  for r in
    select ar.id as record_id, ar.organization_id, ar.employee_id, ar.check_in_at,
           ar.attendance_date, ar.geofence_validated,
           coalesce(nullif(o.timezone, ''), 'UTC') as org_tz,
           coalesce(o.geofence_breach_threshold_minutes, 30) as threshold,
           s.start_time, s.end_time, s.crosses_midnight,
           coalesce(s.break_minutes, 0) as break_minutes
    from public.attendance_records ar
    join public.organizations o on o.id = ar.organization_id and o.status::text = 'active'
    left join public.shift_assignments sa on sa.id = ar.shift_assignment_id
    left join public.shifts s on s.id = sa.shift_id
    where ar.check_in_at is not null
      and ar.check_out_at is null
      and ar.attendance_date >= (v_now at time zone coalesce(nullif(o.timezone, ''), 'UTC'))::date - 1
  loop
    -- Without a resolved shift there is no "checkout time" to auto-close against;
    -- leave it for a manual check-out.
    if r.start_time is null or r.end_time is null then continue; end if;

    v_tz := r.org_tz;
    v_shift_start := (r.attendance_date + r.start_time) at time zone v_tz;
    v_shift_end := (
      r.attendance_date + r.end_time
      + case when r.crosses_midnight or r.end_time <= r.start_time
             then interval '1 day' else interval '0 day' end
    ) at time zone v_tz;
    v_scheduled := greatest(0,
      floor(extract(epoch from (v_shift_end - v_shift_start)) / 60)::integer - r.break_minutes);

    -- Boundary = last moment the employee was known inside (or unclassified),
    -- never earlier than check-in. Any outside ping after it means the most
    -- recent known position is outside the fence. (Same notion as the detector.)
    select max(event_at) into v_boundary
    from public.employee_location_pings
    where attendance_record_id = r.record_id
      and event_at >= r.check_in_at
      and inside_geofence is distinct from false;
    v_boundary := greatest(coalesce(v_boundary, r.check_in_at), r.check_in_at);

    select min(event_at) into v_exit_at
    from public.employee_location_pings
    where attendance_record_id = r.record_id
      and event_at > v_boundary
      and inside_geofence is false;

    v_has_left := v_exit_at is not null;
    v_minutes_outside := case when v_has_left
      then floor(extract(epoch from (v_now - v_exit_at)) / 60)::integer else 0 end;
    v_shift_ended := v_now >= v_shift_end;

    if v_shift_ended and v_has_left then
      v_checkout_at := v_exit_at; v_inside := false;      -- left early, shift now over
    elsif v_shift_ended then
      v_checkout_at := v_shift_end; v_inside := true;     -- still inside at end -> clock out at end
    elsif v_has_left and v_minutes_outside >= r.threshold then
      v_checkout_at := v_exit_at; v_inside := false;      -- sustained early departure
    else
      continue;                                           -- on shift and present / brief step-out
    end if;

    -- The attendance_records CHECK requires check_out_at > check_in_at.
    if v_checkout_at <= r.check_in_at then continue; end if;

    v_idem := 'auto-close:' || r.record_id;
    if exists (
      select 1 from public.attendance_events
      where employee_id = r.employee_id and idempotency_key = v_idem
    ) then continue; end if;

    -- Distance from the fence at the last outside sample (0 when still inside).
    v_distance_m := null;
    if not v_inside then
      select gp.polygon::jsonb into v_polygon
      from public.geofence_assignments ga
      join public.geofences gf on gf.id = ga.geofence_id
      join public.geofence_polygons gp on gp.geofence_id = gf.id and gp.is_active
      where ga.employee_id = r.employee_id
        and ga.organization_id = r.organization_id
        and ga.effective_from <= r.attendance_date
        and (ga.effective_to is null or ga.effective_to >= r.attendance_date)
        and gf.status::text = 'active'
      order by ga.effective_from desc
      limit 1;

      select location_point into v_last_out
      from public.employee_location_pings
      where attendance_record_id = r.record_id
        and event_at > v_boundary
        and inside_geofence is false
      order by event_at desc
      limit 1;

      if v_polygon is not null and v_last_out is not null then
        v_distance_m := private.distance_to_multipolygon_m(
          (v_last_out->'coordinates'->>0)::double precision,
          (v_last_out->'coordinates'->>1)::double precision,
          v_polygon);
      end if;
    end if;

    -- Payroll math, same shape as the attendance engine's check-out branch.
    v_presence := greatest(0, floor(extract(epoch from (v_checkout_at - r.check_in_at)) / 60)::integer);
    v_worked := greatest(0, v_presence - least(r.break_minutes, v_presence));
    v_overlap := greatest(0, floor(extract(epoch from (
      least(v_checkout_at, v_shift_end) - greatest(r.check_in_at, v_shift_start)
    )) / 60)::integer);
    v_regular := least(greatest(0, v_overlap - least(r.break_minutes, v_overlap)), v_scheduled);
    v_overtime := greatest(0, v_worked - v_regular);
    v_late := greatest(0, floor(extract(epoch from (r.check_in_at - v_shift_start)) / 60)::integer);
    v_early := greatest(0, floor(extract(epoch from (v_shift_end - v_checkout_at)) / 60)::integer);
    v_missing := greatest(0, v_scheduled - v_regular);

    insert into public.attendance_events (
      organization_id, employee_id, event_type, source, event_at, received_at,
      location_point, accuracy_meters, geofence_validation, inside_geofence,
      approval_status, metadata, idempotency_key
    ) values (
      r.organization_id, r.employee_id,
      'gps_exit'::public.attendance_event_type,
      'automatic_geofence'::public.attendance_source,
      v_checkout_at, v_now,
      case when v_inside then null else v_last_out end,
      null,
      (case when v_inside then 'valid' else 'invalid' end)::public.geofence_validation_status,
      v_inside, 'not_required'::public.approval_status,
      jsonb_build_object(
        'auto_closed', true,
        'reason', case when v_inside then 'shift_end' else 'early_exit' end,
        'exit_at', v_exit_at,
        'exit_distance_m', round(v_distance_m::numeric, 1)),
      v_idem
    ) returning id into v_event_id;

    update public.attendance_records ar set
      check_out_event_id = v_event_id,
      check_out_at = v_checkout_at,
      worked_minutes = v_worked,
      overtime_minutes = v_overtime,
      late_minutes = v_late,
      early_leaving_minutes = v_early,
      missing_minutes = v_missing,
      geofence_validated = ar.geofence_validated and v_inside,
      updated_at = v_now
    where ar.id = r.record_id and ar.check_out_at is null;

    if found then
      v_closed := v_closed + 1;
      -- Session is closed; clear any open breach pointing at it.
      update public.geofence_breaches
        set status = 'resolved', resolved_at = v_now, updated_at = v_now
        where employee_id = r.employee_id and status = 'open';
    end if;
  end loop;

  return v_closed;
end;
$$;

revoke all on function private.auto_close_attendance_sessions() from public, anon, authenticated;
grant execute on function private.auto_close_attendance_sessions() to service_role;

-- Schedule alongside the breach detector (best-effort; no-op without pg_cron).
DO $cron$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule(
    'geotrack-auto-close-attendance',
    '*/5 * * * *',
    $job$ SELECT private.auto_close_attendance_sessions(); $job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not scheduled (%): schedule private.auto_close_attendance_sessions() every few minutes manually.', SQLERRM;
END;
$cron$;
