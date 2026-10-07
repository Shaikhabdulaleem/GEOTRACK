-- Geofence check-in: accept a point that lies just outside the polygon but
-- within the GPS error radius (plus a small margin) of its boundary.
--
-- Strict point-in-polygon rejected employees standing a few metres outside a
-- small geofence even with a good GPS fix (e.g. a ~30 m office polygon and a
-- fix 20 m out at 12 m accuracy). Consumer GPS is only accurate to ~10-30 m, so
-- a tolerance equal to the reported accuracy plus a 15 m margin (floored at
-- 25 m, capped at 75 m) keeps genuine on-site check-ins working without opening
-- the fence so wide that off-site check-ins pass. Low-accuracy fixes are still
-- rejected earlier by required_accuracy_meters, and mock locations still fail.

-- Minimum distance in metres from a point to a MultiPolygon's outer boundary,
-- using a local equirectangular projection centred on the point (accurate at the
-- tens-of-metres scale this buffer operates on). Returns 0-ish when on the edge;
-- callers combine it with point_in_multipolygon for the inside test.
create or replace function private.distance_to_multipolygon_m(
  p_lng double precision,
  p_lat double precision,
  p_geometry jsonb
)
returns double precision
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_polygon jsonb;
  v_ring jsonb;
  v_pt jsonb;
  v_min double precision := 1e18;
  v_mx double precision := cos(radians(p_lat)) * 111320.0;
  v_my double precision := 110540.0;
  v_ax double precision;
  v_ay double precision;
  v_bx double precision;
  v_by double precision;
  v_dx double precision;
  v_dy double precision;
  v_t double precision;
  v_px double precision;
  v_py double precision;
  v_seglen2 double precision;
  v_d double precision;
  v_have_prev boolean;
  i integer;
begin
  if p_geometry ->> 'type' <> 'MultiPolygon' then return v_min; end if;
  for v_polygon in select value from jsonb_array_elements(p_geometry -> 'coordinates') loop
    if jsonb_array_length(v_polygon) = 0 then continue; end if;
    v_ring := v_polygon -> 0;
    v_have_prev := false;
    for i in 0 .. jsonb_array_length(v_ring) - 1 loop
      v_pt := v_ring -> i;
      v_bx := ((v_pt ->> 0)::double precision - p_lng) * v_mx;
      v_by := ((v_pt ->> 1)::double precision - p_lat) * v_my;
      if v_have_prev then
        v_dx := v_bx - v_ax;
        v_dy := v_by - v_ay;
        v_seglen2 := v_dx * v_dx + v_dy * v_dy;
        if v_seglen2 = 0 then
          v_d := sqrt(v_ax * v_ax + v_ay * v_ay);
        else
          v_t := greatest(0, least(1, -(v_ax * v_dx + v_ay * v_dy) / v_seglen2));
          v_px := v_ax + v_t * v_dx;
          v_py := v_ay + v_t * v_dy;
          v_d := sqrt(v_px * v_px + v_py * v_py);
        end if;
        if v_d < v_min then v_min := v_d; end if;
      end if;
      v_ax := v_bx;
      v_ay := v_by;
      v_have_prev := true;
    end loop;
  end loop;
  return v_min;
end;
$$;

revoke all on function private.distance_to_multipolygon_m(double precision, double precision, jsonb) from public, anon, authenticated;

-- Patch only the geofence-validation branch of the attendance engine to allow
-- the accuracy buffer. The rest of the function body is unchanged.
create or replace function public.process_attendance_event_legacy(p_employee_id uuid, p_geofence_id uuid, p_action_type text, p_is_auto boolean, p_latitude double precision, p_longitude double precision, p_accuracy_meters double precision, p_is_mock_location boolean, p_idempotency_key text, p_device_info jsonb)
 RETURNS TABLE(attendance_record_id uuid, event_id uuid, status text, inside_geofence boolean, validation_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := (select auth.uid());
  v_employee public.employee_profiles%rowtype;
  v_assignment public.shift_assignments%rowtype;
  v_shift public.shifts%rowtype;
  v_record public.attendance_records%rowtype;
  v_existing_event public.attendance_events%rowtype;
  v_now timestamptz := clock_timestamp();
  v_timezone text;
  v_local_now timestamp;
  v_today date;
  v_work_date date;
  v_polygon_id uuid;
  v_polygon jsonb;
  v_required_accuracy double precision;
  v_inside boolean := false;
  v_validation text := 'unknown';
  v_event_id uuid;
  v_event_type text;
  v_source text;
  v_shift_start timestamptz;
  v_shift_end timestamptz;
  v_scheduled integer := 0;
  v_presence integer := 0;
  v_overlap integer := 0;
  v_regular integer := 0;
  v_worked integer := 0;
  v_overtime integer := 0;
  v_late integer := 0;
  v_early integer := 0;
  v_missing integer := 0;
  v_buffer_m double precision;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_action_type not in ('check_in', 'check_out') then
    raise exception 'Invalid attendance action' using errcode = '22023';
  end if;
  if p_latitude is null or p_latitude < -90 or p_latitude > 90
    or p_longitude is null or p_longitude < -180 or p_longitude > 180 then
    raise exception 'Invalid coordinates' using errcode = '22023';
  end if;
  if p_accuracy_meters is null or p_accuracy_meters < 0 then
    raise exception 'A GPS accuracy reading is required' using errcode = '22023';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null or length(p_idempotency_key) > 200 then
    raise exception 'Invalid idempotency key' using errcode = '22023';
  end if;

  select * into v_employee
  from public.employee_profiles e
  where e.id = p_employee_id and e.employment_status::text = 'active';
  if not found then raise exception 'Active employee not found' using errcode = 'P0002'; end if;
  -- Attendance mutations are self-service only. Manager/admin visibility does
  -- not grant impersonation rights; automatic capture must use a separate
  -- trusted server integration rather than this browser-callable RPC.
  if not private.is_employee_owner(p_employee_id) then
    raise exception 'Attendance can only be submitted by the employee owner' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text, 0));

  select * into v_existing_event
  from public.attendance_events ae
  where ae.employee_id = p_employee_id and ae.idempotency_key = p_idempotency_key;
  if found then
    select ar.* into v_record
    from public.attendance_records ar
    where ar.check_in_event_id = v_existing_event.id or ar.check_out_event_id = v_existing_event.id
    limit 1;
    return query select
      v_record.id,
      v_existing_event.id,
      coalesce(v_record.status::text, 'recorded'),
      coalesce(v_existing_event.inside_geofence, false),
      v_existing_event.geofence_validation::text;
    return;
  end if;

  select coalesce(nullif(b.timezone, ''), nullif(o.timezone, ''), 'UTC') into v_timezone
  from public.organizations o
  left join public.branches b on b.id = v_employee.branch_id and b.organization_id = o.id
  where o.id = v_employee.organization_id;
  v_timezone := coalesce(v_timezone, 'UTC');
  v_local_now := v_now at time zone v_timezone;
  v_today := v_local_now::date;
  v_work_date := v_today;

  if p_action_type = 'check_out' then
    select * into v_record
    from public.attendance_records ar
    where ar.employee_id = p_employee_id
      and ar.check_out_at is null
      and ar.attendance_date between v_today - 1 and v_today
    order by ar.attendance_date desc, ar.session_number desc
    limit 1
    for update;
    if not found or v_record.check_in_at is null then
      raise exception 'Cannot check out without an open check-in' using errcode = '22023';
    end if;
    v_work_date := v_record.attendance_date;
    if v_record.shift_assignment_id is not null then
      select * into v_assignment from public.shift_assignments where id = v_record.shift_assignment_id;
    end if;
  else
    select sa.* into v_assignment
    from public.shift_assignments sa
    join public.shifts s on s.id = sa.shift_id
    where sa.employee_id = p_employee_id
      and sa.status::text = 'scheduled'
      and (
        sa.work_date = v_today
        or (
          sa.work_date = v_today - 1
          and s.crosses_midnight
          and v_local_now::time <= s.end_time
        )
      )
    order by
      case when sa.work_date = v_today - 1 then 0 else 1 end,
      sa.work_date desc
    limit 1;
    if found then v_work_date := v_assignment.work_date; end if;

    select * into v_record
    from public.attendance_records ar
    where ar.employee_id = p_employee_id
      and ar.attendance_date = v_work_date
      and ar.session_number = 1
    for update;
  end if;

  if v_assignment.id is null then
    select * into v_assignment
    from public.shift_assignments sa
    where sa.employee_id = p_employee_id
      and sa.work_date = v_work_date
      and sa.status::text = 'scheduled'
    limit 1;
  end if;
  if v_assignment.shift_id is not null then
    select * into v_shift from public.shifts where id = v_assignment.shift_id;
  end if;

  select gp.id, gp.polygon::jsonb, gf.required_accuracy_meters
    into v_polygon_id, v_polygon, v_required_accuracy
  from public.geofence_assignments ga
  join public.geofences gf on gf.id = ga.geofence_id
  join public.geofence_polygons gp on gp.geofence_id = gf.id and gp.is_active
  where ga.employee_id = p_employee_id
    and ga.organization_id = v_employee.organization_id
    and ga.geofence_id = p_geofence_id
    and ga.effective_from <= v_work_date
    and (ga.effective_to is null or ga.effective_to >= v_work_date)
    and gf.status::text = 'active'
  order by ga.effective_from desc
  limit 1;

  if p_is_mock_location then
    v_validation := 'mock_location';
  elsif v_polygon_id is null then
    v_validation := 'invalid';
  elsif p_accuracy_meters > v_required_accuracy then
    v_validation := 'low_accuracy';
  else
    -- Accept inside the polygon, or within the GPS error radius (plus a 15 m
    -- margin, floored at 25 m and capped at 75 m) of its boundary.
    v_buffer_m := least(greatest(coalesce(p_accuracy_meters, 0) + 15, 25), 75);
    v_inside := private.point_in_multipolygon(p_longitude, p_latitude, v_polygon)
      or private.distance_to_multipolygon_m(p_longitude, p_latitude, v_polygon) <= v_buffer_m;
    v_validation := case when v_inside then 'valid' else 'invalid' end;
  end if;

  v_event_type := case
    when p_action_type = 'check_in' and p_is_auto then 'gps_enter'
    when p_action_type = 'check_in' then 'manual_check_in'
    when p_is_auto then 'gps_exit'
    else 'manual_check_out'
  end;
  v_source := case when p_is_auto then 'automatic_geofence' else 'manual_employee' end;

  insert into public.attendance_events (
    organization_id, employee_id, event_type, source, event_at, received_at,
    location_point, accuracy_meters, geofence_id, geofence_polygon_id,
    geofence_validation, inside_geofence, approval_status, device_info,
    metadata, idempotency_key, created_by
  ) values (
    v_employee.organization_id, p_employee_id,
    v_event_type::public.attendance_event_type,
    v_source::public.attendance_source,
    v_now, v_now,
    jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(p_longitude, p_latitude)),
    p_accuracy_meters, p_geofence_id, v_polygon_id,
    v_validation::public.geofence_validation_status, v_inside,
    'not_required'::public.approval_status, coalesce(p_device_info, '{}'::jsonb),
    '{}'::jsonb, p_idempotency_key, v_user_id
  ) returning id into v_event_id;

  if not v_inside then
    insert into public.notifications (
      organization_id, recipient_user_id, notification_type, severity, title, body,
      entity_type, entity_id
    )
    select v_employee.organization_id, m.user_id, 'geofence', 'warning',
      'Geofence validation failed',
      'An attendance attempt was rejected outside the assigned geofence.',
      'employee', p_employee_id
    from public.organization_memberships m
    where m.organization_id = v_employee.organization_id
      and m.status::text = 'active'
      and m.role_code::text in ('manager', 'administrator');

    return query select null::uuid, v_event_id, 'outside_geofence', false, v_validation;
    return;
  end if;

  if v_shift.id is not null then
    v_shift_start := (v_work_date + v_shift.start_time) at time zone v_timezone;
    v_shift_end := (
      v_work_date + v_shift.end_time
      + case when v_shift.crosses_midnight or v_shift.end_time <= v_shift.start_time
        then interval '1 day' else interval '0 day' end
    ) at time zone v_timezone;
    v_scheduled := greatest(0,
      floor(extract(epoch from (v_shift_end - v_shift_start)) / 60)::integer
      - greatest(0, v_shift.break_minutes)
    );
  end if;

  if p_action_type = 'check_in' then
    if v_record.id is not null and v_record.check_in_at is not null then
      return query select v_record.id, v_event_id, v_record.status::text, true, v_validation;
      return;
    end if;
    if v_shift_start is not null then
      v_late := greatest(0, floor(extract(epoch from (v_now - v_shift_start)) / 60)::integer);
    end if;

    if v_record.id is null then
      insert into public.attendance_records (
        organization_id, employee_id, shift_assignment_id, attendance_date,
        session_number, check_in_event_id, check_in_at, source, status,
        late_minutes, early_leaving_minutes, worked_minutes, missing_minutes,
        overtime_minutes, geofence_validated, approval_status
      ) values (
        v_employee.organization_id, p_employee_id, v_assignment.id, v_work_date,
        1, v_event_id, v_now, v_source::public.attendance_source,
        (case when v_late > 0 then 'late' else 'present' end)::public.attendance_status,
        v_late, 0, 0, v_scheduled, 0, true, 'not_required'::public.approval_status
      ) returning * into v_record;
    else
      update public.attendance_records ar set
        shift_assignment_id = coalesce(ar.shift_assignment_id, v_assignment.id),
        check_in_event_id = v_event_id,
        check_in_at = v_now,
        source = v_source::public.attendance_source,
        status = (case when v_late > 0 then 'late' else 'present' end)::public.attendance_status,
        late_minutes = v_late,
        missing_minutes = v_scheduled,
        geofence_validated = true
      where ar.id = v_record.id
      returning ar.* into v_record;
    end if;
  else
    v_presence := greatest(0, floor(extract(epoch from (v_now - v_record.check_in_at)) / 60)::integer);
    v_worked := greatest(0, v_presence - least(coalesce(v_shift.break_minutes, 0), v_presence));

    if v_shift_start is not null then
      v_overlap := greatest(0, floor(extract(epoch from (
        least(v_now, v_shift_end) - greatest(v_record.check_in_at, v_shift_start)
      )) / 60)::integer);
      v_regular := greatest(0, v_overlap - least(coalesce(v_shift.break_minutes, 0), v_overlap));
      v_regular := least(v_regular, v_scheduled);
      v_overtime := greatest(0, v_worked - v_regular);
      v_late := greatest(0, floor(extract(epoch from (v_record.check_in_at - v_shift_start)) / 60)::integer);
      v_early := greatest(0, floor(extract(epoch from (v_shift_end - v_now)) / 60)::integer);
      v_missing := greatest(0, v_scheduled - v_regular);
    else
      v_overtime := v_worked;
    end if;

    update public.attendance_records ar set
      check_out_event_id = v_event_id,
      check_out_at = v_now,
      worked_minutes = v_worked,
      overtime_minutes = v_overtime,
      late_minutes = v_late,
      early_leaving_minutes = v_early,
      missing_minutes = v_missing,
      geofence_validated = ar.geofence_validated and v_inside
    where ar.id = v_record.id
    returning ar.* into v_record;

    if v_overtime > 0 then
      insert into public.overtime_records (
        organization_id, employee_id, attendance_record_id, requested_minutes,
        approved_minutes, status, reason, requested_by, requested_at
      ) values (
        v_employee.organization_id, p_employee_id, v_record.id, v_overtime,
        null, 'pending'::public.approval_status, 'System calculated overtime',
        v_user_id, v_now
      )
      on conflict (attendance_record_id) do update
        set requested_minutes = excluded.requested_minutes,
            updated_at = clock_timestamp()
        where public.overtime_records.status::text = 'pending';
    end if;
  end if;

  return query select v_record.id, v_event_id, v_record.status::text, true, v_validation;
end;
$function$;
