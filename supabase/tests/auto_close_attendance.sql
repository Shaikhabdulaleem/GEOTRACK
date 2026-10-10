-- Self-check for private.auto_close_attendance_sessions().
-- Covers the two product cases: still-inside-at-shift-end and early departure.
BEGIN;

DO $test$
DECLARE
  v_admin uuid := gen_random_uuid();
  v_empA uuid := gen_random_uuid();  -- still inside, shift already ended today
  v_empB uuid := gen_random_uuid();  -- left the fence early, shift still running
  v_org uuid;
  v_branch uuid;
  v_dept uuid;
  v_past_shift uuid;
  v_open_shift uuid;
  v_geofence uuid;
  v_recA uuid;
  v_recB uuid;
  v_rec public.attendance_records%rowtype;
  v_evt public.attendance_events%rowtype;
  v_closed integer;
  v_exit_at timestamptz := clock_timestamp() - interval '40 minutes';
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_admin, 'admin@autoclose.local'),
    (v_empA, 'empA@autoclose.local'),
    (v_empB, 'empB@autoclose.local');

  INSERT INTO public.organizations (name, slug, timezone)
  VALUES ('AutoClose Org', 'autoclose-org', 'UTC') RETURNING id INTO v_org;

  INSERT INTO public.organization_memberships (organization_id, user_id, role_code, status)
  VALUES (v_org, v_admin, 'administrator', 'active'),
         (v_org, v_empA, 'employee', 'active'),
         (v_org, v_empB, 'employee', 'active');

  INSERT INTO public.branches (organization_id, code, name, timezone)
  VALUES (v_org, 'B1', 'Branch', 'UTC') RETURNING id INTO v_branch;
  INSERT INTO public.departments (organization_id, branch_id, code, name)
  VALUES (v_org, v_branch, 'D1', 'Dept') RETURNING id INTO v_dept;

  INSERT INTO public.employee_profiles (id, user_id, organization_id, branch_id, department_id, employee_code, iqama_number, full_name)
  VALUES (v_empA, v_empA, v_org, v_branch, v_dept, 'E01', '9100000001', 'Emp A'),
         (v_empB, v_empB, v_org, v_branch, v_dept, 'E02', '9100000002', 'Emp B');

  -- A shift that already ended earlier today, and one that runs all day.
  INSERT INTO public.shifts (organization_id, code, name, start_time, end_time, crosses_midnight)
  VALUES (v_org, 'PAST', 'Past Shift', '00:00:00', '00:01:00', false) RETURNING id INTO v_past_shift;
  INSERT INTO public.shifts (organization_id, code, name, start_time, end_time, crosses_midnight)
  VALUES (v_org, 'OPEN', 'Open Shift', '00:00:00', '23:59:00', false) RETURNING id INTO v_open_shift;

  INSERT INTO public.shift_assignments (organization_id, employee_id, shift_id, work_date, status)
  VALUES (v_org, v_empA, v_past_shift, current_date, 'scheduled'),
         (v_org, v_empB, v_open_shift, current_date, 'scheduled');

  INSERT INTO public.geofences (organization_id, branch_id, name, required_accuracy_meters, status, created_by)
  VALUES (v_org, v_branch, 'GF', 100, 'active', v_admin) RETURNING id INTO v_geofence;
  INSERT INTO public.geofence_polygons (geofence_id, version_number, polygon, is_active)
  VALUES (v_geofence, 1, '{"type":"MultiPolygon","coordinates":[[[[-10,-10],[10,-10],[10,10],[-10,10],[-10,-10]]]]}', true);
  INSERT INTO public.geofence_assignments (organization_id, geofence_id, employee_id, effective_from)
  VALUES (v_org, v_geofence, v_empA, current_date), (v_org, v_geofence, v_empB, current_date);

  -- Emp A: checked in at shift start, still inside (no outside pings).
  INSERT INTO public.attendance_records (
    organization_id, employee_id, shift_assignment_id, attendance_date, session_number,
    check_in_at, source, status, geofence_validated)
  SELECT v_org, v_empA, sa.id, current_date, 1,
         (current_date + time '00:00')::timestamp at time zone 'UTC',
         'automatic_geofence', 'present', true
  FROM public.shift_assignments sa WHERE sa.employee_id = v_empA
  RETURNING id INTO v_recA;

  -- Emp B: checked in 2h ago, then a run of outside pings starting 40 min ago.
  INSERT INTO public.attendance_records (
    organization_id, employee_id, shift_assignment_id, attendance_date, session_number,
    check_in_at, source, status, geofence_validated)
  SELECT v_org, v_empB, sa.id, current_date, 1,
         clock_timestamp() - interval '2 hours', 'automatic_geofence', 'present', true
  FROM public.shift_assignments sa WHERE sa.employee_id = v_empB
  RETURNING id INTO v_recB;

  INSERT INTO public.employee_location_pings (organization_id, employee_id, attendance_record_id, event_at, location_point, inside_geofence)
  VALUES
    (v_org, v_empB, v_recB, clock_timestamp() - interval '90 minutes',
       '{"type":"Point","coordinates":[0,0]}', true),
    (v_org, v_empB, v_recB, v_exit_at,
       '{"type":"Point","coordinates":[50,50]}', false),
    (v_org, v_empB, v_recB, clock_timestamp() - interval '10 minutes',
       '{"type":"Point","coordinates":[50,50]}', false);

  ---------------------------------------------------------
  v_closed := private.auto_close_attendance_sessions();
  IF v_closed <> 2 THEN
    RAISE EXCEPTION 'Expected 2 sessions auto-closed, got %', v_closed;
  END IF;

  -- Emp A: closed at scheduled end, still inside, no early leaving.
  SELECT * INTO v_rec FROM public.attendance_records WHERE id = v_recA;
  IF v_rec.check_out_at IS NULL THEN RAISE EXCEPTION 'Emp A not closed'; END IF;
  IF v_rec.geofence_validated IS NOT TRUE THEN RAISE EXCEPTION 'Emp A should be inside/validated'; END IF;
  IF v_rec.early_leaving_minutes <> 0 THEN RAISE EXCEPTION 'Emp A early_leaving should be 0, got %', v_rec.early_leaving_minutes; END IF;

  -- Emp B: closed back-dated to the exit, flagged outside, distance recorded, left early.
  SELECT * INTO v_rec FROM public.attendance_records WHERE id = v_recB;
  IF v_rec.check_out_at IS NULL THEN RAISE EXCEPTION 'Emp B not closed'; END IF;
  IF abs(extract(epoch from (v_rec.check_out_at - v_exit_at))) > 1 THEN
    RAISE EXCEPTION 'Emp B check-out should be back-dated to exit time'; END IF;
  IF v_rec.geofence_validated IS NOT FALSE THEN RAISE EXCEPTION 'Emp B should be flagged outside'; END IF;
  IF v_rec.early_leaving_minutes <= 0 THEN RAISE EXCEPTION 'Emp B early_leaving should be > 0'; END IF;

  SELECT * INTO v_evt FROM public.attendance_events WHERE id = v_rec.check_out_event_id;
  IF (v_evt.metadata->>'reason') <> 'early_exit' THEN RAISE EXCEPTION 'Emp B reason should be early_exit'; END IF;
  IF (v_evt.metadata->>'exit_distance_m') IS NULL OR (v_evt.metadata->>'exit_distance_m')::numeric <= 0 THEN
    RAISE EXCEPTION 'Emp B exit distance should be recorded and > 0'; END IF;

  -- Idempotent: a second run closes nothing more.
  v_closed := private.auto_close_attendance_sessions();
  IF v_closed <> 0 THEN RAISE EXCEPTION 'Second run should close 0, got %', v_closed; END IF;

  RAISE NOTICE 'auto_close_attendance_sessions assertions passed.';
END;
$test$;

ROLLBACK;
