BEGIN;

DO $test$
DECLARE
  v_admin uuid := gen_random_uuid();
  v_manager uuid := gen_random_uuid();
  v_empA uuid := gen_random_uuid();
  v_empB uuid := gen_random_uuid();
  v_empC uuid := gen_random_uuid();
  v_empD uuid := gen_random_uuid();
  v_org uuid;
  v_branch uuid;
  v_dept uuid;
  v_day_shift uuid;
  v_night_shift uuid;
  v_geofence uuid;
  v_record public.attendance_records%rowtype;
  v_out record;
BEGIN
  RAISE NOTICE 'Starting E2E workflow test...';

  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES 
    (v_admin, 'admin@test.local', '{"name":"Admin"}'),
    (v_manager, 'manager@test.local', '{"name":"Manager"}'),
    (v_empA, 'empA@test.local', '{"name":"Emp A"}'),
    (v_empB, 'empB@test.local', '{"name":"Emp B"}'),
    (v_empC, 'empC@test.local', '{"name":"Emp C"}'),
    (v_empD, 'empD@test.local', '{"name":"Emp D"}');

  INSERT INTO public.organizations (name, slug, timezone)
  VALUES ('Test Org', 'test-org-e2e', 'UTC')
  RETURNING id INTO v_org;

  INSERT INTO public.organization_memberships (organization_id, user_id, role_code, status)
  VALUES 
    (v_org, v_admin, 'administrator', 'active'),
    (v_org, v_manager, 'manager', 'active'),
    (v_org, v_empA, 'employee', 'active'),
    (v_org, v_empB, 'employee', 'active'),
    (v_org, v_empC, 'employee', 'active'),
    (v_org, v_empD, 'employee', 'active');

  INSERT INTO public.branches (organization_id, code, name, timezone)
  VALUES (v_org, 'B1', 'Test Branch', 'UTC')
  RETURNING id INTO v_branch;

  INSERT INTO public.departments (organization_id, branch_id, code, name)
  VALUES (v_org, v_branch, 'D1', 'Test Dept')
  RETURNING id INTO v_dept;

  INSERT INTO public.employee_profiles (
    id, user_id, organization_id, branch_id, department_id, employee_code,
    iqama_number, full_name, manager_user_id
  )
  VALUES 
    (v_empA, v_empA, v_org, v_branch, v_dept, 'E01', '9000000001', 'Emp A', v_manager),
    (v_empB, v_empB, v_org, v_branch, v_dept, 'E02', '9000000002', 'Emp B', v_manager),
    (v_empC, v_empC, v_org, v_branch, v_dept, 'E03', '9000000003', 'Emp C', v_manager),
    (v_empD, v_empD, v_org, v_branch, v_dept, 'E04', '9000000004', 'Emp D', v_manager);

  INSERT INTO public.manager_scopes (organization_id, manager_user_id, department_id)
  VALUES (v_org, v_manager, v_dept);

  INSERT INTO public.shifts (organization_id, code, name, start_time, end_time, crosses_midnight)
  VALUES 
    (v_org, 'DAY', 'Day Shift', '09:00:00', '17:00:00', false)
  RETURNING id INTO v_day_shift;

  INSERT INTO public.shifts (organization_id, code, name, start_time, end_time, crosses_midnight)
  VALUES 
    (v_org, 'NIGHT', 'Night Shift', '21:00:00', '05:00:00', true)
  RETURNING id INTO v_night_shift;

  INSERT INTO public.shift_assignments (organization_id, employee_id, shift_id, work_date, status)
  VALUES 
    (v_org, v_empA, v_day_shift, current_date, 'scheduled'),
    (v_org, v_empB, v_night_shift, current_date, 'scheduled');

  -- isodow returns 1 (Mon) to 7 (Sun). PostgreSQL extract dow returns 0 (Sun) to 6 (Sat).
  -- Let's just use extract(dow from current_date) which gives 0-6 as required by weekday check constraint
  INSERT INTO public.weekly_offs (organization_id, employee_id, weekday, effective_from)
  VALUES (v_org, v_empC, extract(dow from current_date)::integer, current_date - interval '1 day');

  INSERT INTO public.leave_requests (
    organization_id, employee_id, leave_type, from_date, to_date, days,
    reason, status, requested_by, reviewed_by, reviewed_at
  )
  VALUES (
    v_org, v_empD, 'annual', current_date, current_date, 1,
    'E2E fixture', 'approved', v_empD, v_manager, clock_timestamp()
  );

  INSERT INTO public.geofences (
    organization_id, branch_id, name, required_accuracy_meters, status, created_by
  )
  VALUES (v_org, v_branch, 'Test Geofence', 100, 'active', v_admin)
  RETURNING id INTO v_geofence;

  INSERT INTO public.geofence_polygons (geofence_id, version_number, polygon, is_active)
  VALUES (v_geofence, 1, '{"type": "MultiPolygon", "coordinates": [[[[ -10, -10 ], [ 10, -10 ], [ 10, 10 ], [ -10, 10 ], [ -10, -10 ]]]]}', true);

  INSERT INTO public.geofence_assignments (
    organization_id, geofence_id, employee_id, effective_from
  )
  VALUES 
    (v_org, v_geofence, v_empA, current_date),
    (v_org, v_geofence, v_empB, current_date),
    (v_org, v_geofence, v_empC, current_date);

  ---------------------------------------------------------
  -- Emp A: Day Shift Test (09:00 - 17:00)
  ---------------------------------------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', format('{"sub": "%s"}', v_empA), true);
  
  SELECT * INTO v_out FROM public.process_attendance_event(
    v_empA, v_geofence, 'check_in', false, 0, 0, 10, false, 'empA-in', '{}'
  );
  if v_out.status = 'outside_geofence' then
    RAISE EXCEPTION 'Emp A check in failed: outside geofence';
  end if;

  SELECT * INTO v_out FROM public.process_attendance_event(
    v_empA, v_geofence, 'check_out', false, 0, 0, 10, false, 'empA-out', '{}'
  );

  SELECT * INTO v_record FROM public.attendance_records WHERE employee_id = v_empA;
  RAISE NOTICE 'Emp A Day Shift Record: worked=%, overtime=%', coalesce(v_record.worked_minutes, 0), coalesce(v_record.overtime_minutes, 0);

  ---------------------------------------------------------
  -- Emp C: OFF Day Test — check-in must be rejected
  -- process_attendance_event resolves the schedule and refuses a check-in when
  -- no working shift applies (an employee cannot clock in on their weekly off),
  -- raising errcode 22023. Assert that rejection rather than expecting phantom
  -- off-day overtime, which the attendance model does not support.
  ---------------------------------------------------------
  perform set_config('request.jwt.claims', format('{"sub": "%s"}', v_empC), true);
  begin
    PERFORM public.process_attendance_event(
      v_empC, v_geofence, 'check_in', false, 0, 0, 10, false, 'empC-in', '{}'
    );
    RAISE EXCEPTION 'Emp C off-day check-in should have been rejected';
  exception
    when sqlstate '22023' then
      RAISE NOTICE 'Emp C off-day check-in correctly rejected.';
  end;

  ---------------------------------------------------------
  -- Manager Review Test
  ---------------------------------------------------------
  perform set_config('request.jwt.claims', format('{"sub": "%s"}', v_manager), true);
  if not exists (SELECT 1 FROM public.attendance_records WHERE employee_id = v_empA) then
    RAISE EXCEPTION 'Manager cannot read Emp A records! RLS failed!';
  end if;

  RAISE NOTICE 'E2E workflow assertions completed successfully.';
END;
$test$;

RESET ROLE;
ROLLBACK;
