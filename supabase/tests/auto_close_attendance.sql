-- Self-check for private.auto_close_attendance_sessions().
--   Emp A: shift ended, phone has gone quiet (no fresh presence) -> auto-closed
--          at shift end so no timestamp is missed.
--   Emp B: left the fence early, outside past the breach grace -> auto-closed
--          back-dated to the exit.
--   Emp C: shift ended but STILL pinging inside (live phone, overtime) -> left
--          OPEN so the manual check-out / overtime is preserved.
--   Emp D: left the fence inside the 15-min grace window before shift end ->
--          auto-closed at the exit with NO early-leaving/missing penalty.
--   Emp E: left after shift end -> auto-closed at the observed exit with OT and
--          exactly one pending overtime approval row.
BEGIN;

DO $test$
DECLARE
  v_admin uuid := gen_random_uuid();
  v_empA uuid := gen_random_uuid();  -- shift ended, presence stale
  v_empB uuid := gen_random_uuid();  -- left the fence early, shift still running
  v_empC uuid := gen_random_uuid();  -- shift ended, still pinging inside (overtime)
  v_empD uuid := gen_random_uuid();  -- left within the grace window before shift end
  v_empE uuid := gen_random_uuid();  -- left after shift end with overtime
  v_org uuid;
  v_branch uuid;
  v_dept uuid;
  v_past_shift uuid;
  v_open_shift uuid;
  v_grace_shift uuid;
  v_geofence uuid;
  v_recA uuid;
  v_recB uuid;
  v_recC uuid;
  v_recD uuid;
  v_recE uuid;
  v_rec public.attendance_records%rowtype;
  v_evt public.attendance_events%rowtype;
  v_location_result record;
  v_closed integer;
  v_exit_at timestamptz := clock_timestamp() - interval '40 minutes';
  -- Yesterday's past-shift end, in the org timezone; always well over the grace.
  v_shiftA_end timestamptz := ((current_date - 1) + time '00:01')::timestamp at time zone 'UTC';
  -- Emp D: a shift ending 5 min from now, with an exit 2 min ago -> inside the
  -- 15-min grace window and before shift end.
  v_graceD_end timestamptz := clock_timestamp() + interval '5 minutes';
  v_graceD_exit timestamptz := clock_timestamp() - interval '2 minutes';
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_admin, 'admin@autoclose.local'),
    (v_empA, 'empA@autoclose.local'),
    (v_empB, 'empB@autoclose.local'),
    (v_empC, 'empC@autoclose.local'),
    (v_empD, 'empD@autoclose.local'),
    (v_empE, 'empE@autoclose.local');

  INSERT INTO public.organizations (name, slug, timezone)
  VALUES ('AutoClose Org', 'autoclose-org', 'UTC') RETURNING id INTO v_org;

  INSERT INTO public.organization_memberships (organization_id, user_id, role_code, status)
  VALUES (v_org, v_admin, 'administrator', 'active'),
         (v_org, v_empA, 'employee', 'active'),
         (v_org, v_empB, 'employee', 'active'),
         (v_org, v_empC, 'employee', 'active'),
         (v_org, v_empD, 'employee', 'active'),
         (v_org, v_empE, 'employee', 'active');

  INSERT INTO public.branches (organization_id, code, name, timezone)
  VALUES (v_org, 'B1', 'Branch', 'UTC') RETURNING id INTO v_branch;
  INSERT INTO public.departments (organization_id, branch_id, code, name)
  VALUES (v_org, v_branch, 'D1', 'Dept') RETURNING id INTO v_dept;

  INSERT INTO public.employee_profiles (id, user_id, organization_id, branch_id, department_id, employee_code, iqama_number, full_name)
  VALUES (v_empA, v_empA, v_org, v_branch, v_dept, 'E01', '9100000001', 'Emp A'),
         (v_empB, v_empB, v_org, v_branch, v_dept, 'E02', '9100000002', 'Emp B'),
         (v_empC, v_empC, v_org, v_branch, v_dept, 'E03', '9100000003', 'Emp C'),
         (v_empD, v_empD, v_org, v_branch, v_dept, 'E04', '9100000004', 'Emp D'),
         (v_empE, v_empE, v_org, v_branch, v_dept, 'E05', '9100000005', 'Emp E');

  -- A one-minute shift (used dated to yesterday so it is reliably past the
  -- grace regardless of the wall-clock time the test runs), and one that runs
  -- all of today.
  -- effective_from dated to yesterday so the pin-version trigger resolves a
  -- shift version for the back-dated (overnight-style) assignments below.
  INSERT INTO public.shifts (organization_id, code, name, start_time, end_time, crosses_midnight, effective_from)
  VALUES (v_org, 'PAST', 'Past Shift', '00:00:00', '00:01:00', false, current_date - 1) RETURNING id INTO v_past_shift;
  INSERT INTO public.shifts (organization_id, code, name, start_time, end_time, crosses_midnight, effective_from)
  VALUES (v_org, 'OPEN', 'Open Shift', '00:00:00', '23:59:00', false, current_date - 1) RETURNING id INTO v_open_shift;
  -- A shift that ends 5 minutes from now (grace window = the final 15 min).
  INSERT INTO public.shifts (organization_id, code, name, start_time, end_time, crosses_midnight, effective_from)
  VALUES (v_org, 'GRACE', 'Grace Shift', '00:00:00', v_graceD_end::time, false, current_date - 1) RETURNING id INTO v_grace_shift;

  INSERT INTO public.shift_assignments (organization_id, employee_id, shift_id, work_date, status)
  VALUES (v_org, v_empA, v_past_shift, current_date - 1, 'scheduled'),
         (v_org, v_empB, v_open_shift, current_date, 'scheduled'),
         (v_org, v_empC, v_past_shift, current_date - 1, 'scheduled'),
         (v_org, v_empD, v_grace_shift, v_graceD_end::date, 'scheduled'),
         (v_org, v_empE, v_past_shift, current_date - 1, 'scheduled');

  INSERT INTO public.geofences (organization_id, branch_id, name, required_accuracy_meters, status, created_by)
  VALUES (v_org, v_branch, 'GF', 100, 'active', v_admin) RETURNING id INTO v_geofence;
  INSERT INTO public.geofence_polygons (geofence_id, version_number, polygon, is_active)
  VALUES (v_geofence, 1, '{"type":"MultiPolygon","coordinates":[[[[-10,-10],[10,-10],[10,10],[-10,10],[-10,-10]]]]}', true);
  INSERT INTO public.geofence_assignments (organization_id, geofence_id, employee_id, effective_from)
  VALUES (v_org, v_geofence, v_empA, current_date - 1),
         (v_org, v_geofence, v_empB, current_date - 1),
         (v_org, v_geofence, v_empC, current_date - 1),
         (v_org, v_geofence, v_empD, current_date - 1),
         (v_org, v_geofence, v_empE, current_date - 1);

  -- Emp A: checked in at shift start yesterday, no pings since (phone quiet).
  INSERT INTO public.attendance_records (
    organization_id, employee_id, shift_assignment_id, attendance_date, session_number,
    check_in_at, source, status, geofence_validated)
  SELECT v_org, v_empA, sa.id, current_date - 1, 1,
         ((current_date - 1) + time '00:00')::timestamp at time zone 'UTC',
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

  -- Emp C: yesterday's shift ended, but a fresh inside ping 5 min ago proves the
  -- phone is still reporting presence (working overtime).
  INSERT INTO public.attendance_records (
    organization_id, employee_id, shift_assignment_id, attendance_date, session_number,
    check_in_at, source, status, geofence_validated)
  SELECT v_org, v_empC, sa.id, current_date - 1, 1,
         ((current_date - 1) + time '00:00')::timestamp at time zone 'UTC',
         'automatic_geofence', 'present', true
  FROM public.shift_assignments sa WHERE sa.employee_id = v_empC
  RETURNING id INTO v_recC;

  INSERT INTO public.employee_location_pings (organization_id, employee_id, attendance_record_id, event_at, location_point, inside_geofence)
  VALUES (v_org, v_empC, v_recC, clock_timestamp() - interval '5 minutes',
       '{"type":"Point","coordinates":[0,0]}', true);

  -- Emp D: checked in 2h ago, left the fence 2 min ago — inside the 15-min grace
  -- window and before the shift ends 5 min from now.
  INSERT INTO public.attendance_records (
    organization_id, employee_id, shift_assignment_id, attendance_date, session_number,
    check_in_at, source, status, geofence_validated)
  SELECT v_org, v_empD, sa.id, v_graceD_end::date, 1,
         clock_timestamp() - interval '2 hours', 'automatic_geofence', 'present', true
  FROM public.shift_assignments sa WHERE sa.employee_id = v_empD
  RETURNING id INTO v_recD;

  -- Exercise the public location engine: bad samples are retained as rejected
  -- evidence, then an accurate grace-window point closes immediately.
  PERFORM set_config('request.jwt.claims', format('{"sub": "%s"}', v_empD), true);
  SELECT * INTO v_location_result FROM public.record_attendance_location(
    v_empD, v_geofence, 50, 50, 1000, false,
    v_graceD_exit - interval '4 minutes', 'emp-d-low-accuracy', 'device-emp-d', 'test'
  );
  IF v_location_result.outcome <> 'rejected' OR v_location_result.reason <> 'low_accuracy' THEN
    RAISE EXCEPTION 'Low-accuracy point should be rejected'; END IF;

  SELECT * INTO v_location_result FROM public.record_attendance_location(
    v_empD, v_geofence, 50, 50, 5, true,
    v_graceD_exit - interval '3 minutes', 'emp-d-mock', 'device-emp-d', 'test'
  );
  IF v_location_result.outcome <> 'rejected' OR v_location_result.reason <> 'mock_location' THEN
    RAISE EXCEPTION 'Mock point should be rejected'; END IF;

  SELECT * INTO v_location_result FROM public.record_attendance_location(
    v_empD, v_geofence, 50, 50, 5, false,
    v_graceD_exit, 'emp-d-valid-exit', 'device-emp-d', 'test'
  );
  IF v_location_result.outcome <> 'checkout_completed' OR v_location_result.classified_position <> 'outside' THEN
    RAISE EXCEPTION 'Accurate grace-window exit should close immediately'; END IF;

  SELECT * INTO v_location_result FROM public.record_attendance_location(
    v_empD, v_geofence, 50, 50, 5, false,
    v_graceD_exit, 'emp-d-valid-exit', 'device-emp-d', 'test'
  );
  IF v_location_result.outcome <> 'checkout_completed' OR v_location_result.reason <> 'duplicate' THEN
    RAISE EXCEPTION 'Duplicate location event should return the existing checkout'; END IF;

  -- Emp E: observed outside 30 minutes after the one-minute shift ended.
  INSERT INTO public.attendance_records (
    organization_id, employee_id, shift_assignment_id, attendance_date, session_number,
    check_in_at, source, status, geofence_validated)
  SELECT v_org, v_empE, sa.id, current_date - 1, 1,
         ((current_date - 1) + time '00:00')::timestamp at time zone 'UTC',
         'automatic_geofence', 'present', true
  FROM public.shift_assignments sa WHERE sa.employee_id = v_empE
  RETURNING id INTO v_recE;

  INSERT INTO public.employee_location_pings (organization_id, employee_id, attendance_record_id, event_at, location_point, inside_geofence)
  VALUES (v_org, v_empE, v_recE, v_shiftA_end + interval '30 minutes',
       '{"type":"Point","coordinates":[50,50]}', false);

  ---------------------------------------------------------
  v_closed := private.auto_close_attendance_sessions();
  IF v_closed <> 3 THEN
    RAISE EXCEPTION 'Expected 3 remaining sessions auto-closed, got %', v_closed;
  END IF;

  -- Emp A: shift ended + presence stale -> closed at shift end, inside/valid.
  SELECT * INTO v_rec FROM public.attendance_records WHERE id = v_recA;
  IF v_rec.check_out_at IS NULL THEN RAISE EXCEPTION 'Emp A (stale) should be auto-closed'; END IF;
  IF abs(extract(epoch from (v_rec.check_out_at - v_shiftA_end))) > 1 THEN
    RAISE EXCEPTION 'Emp A check-out should be back-dated to shift end'; END IF;
  IF v_rec.geofence_validated IS NOT TRUE THEN RAISE EXCEPTION 'Emp A should stay geofence-valid (last known inside)'; END IF;
  SELECT * INTO v_evt FROM public.attendance_events WHERE id = v_rec.check_out_event_id;
  IF (v_evt.metadata->>'reason') <> 'shift_end' THEN RAISE EXCEPTION 'Emp A reason should be shift_end'; END IF;
  IF v_evt.inside_geofence IS NOT TRUE THEN RAISE EXCEPTION 'Emp A event should be inside_geofence'; END IF;

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

  -- Emp C: still pinging inside past shift end -> left OPEN for overtime.
  SELECT * INTO v_rec FROM public.attendance_records WHERE id = v_recC;
  IF v_rec.check_out_at IS NOT NULL THEN RAISE EXCEPTION 'Emp C (fresh inside ping) should stay open'; END IF;

  -- Emp D: left within the grace window -> closed at exit, no penalty, grace reason.
  SELECT * INTO v_rec FROM public.attendance_records WHERE id = v_recD;
  IF v_rec.check_out_at IS NULL THEN RAISE EXCEPTION 'Emp D (grace) should be auto-closed'; END IF;
  IF abs(extract(epoch from (v_rec.check_out_at - v_graceD_exit))) > 1 THEN
    RAISE EXCEPTION 'Emp D check-out should be back-dated to exit time'; END IF;
  IF v_rec.early_leaving_minutes <> 0 THEN RAISE EXCEPTION 'Emp D within grace should have no early-leaving penalty'; END IF;
  IF v_rec.missing_minutes <> 0 THEN RAISE EXCEPTION 'Emp D within grace should have no missing minutes'; END IF;
  SELECT * INTO v_evt FROM public.attendance_events WHERE id = v_rec.check_out_event_id;
  IF (v_evt.metadata->>'reason') <> 'grace_exit' THEN RAISE EXCEPTION 'Emp D reason should be grace_exit'; END IF;

  -- Emp E: late exit keeps the observed timestamp and creates pending OT once.
  SELECT * INTO v_rec FROM public.attendance_records WHERE id = v_recE;
  IF abs(extract(epoch from (v_rec.check_out_at - (v_shiftA_end + interval '30 minutes')))) > 1 THEN
    RAISE EXCEPTION 'Emp E check-out should use the observed late exit'; END IF;
  IF v_rec.overtime_minutes <= 0 THEN RAISE EXCEPTION 'Emp E should have calculated overtime'; END IF;
  IF (SELECT count(*) FROM public.overtime_records WHERE attendance_record_id = v_recE AND status = 'pending') <> 1 THEN
    RAISE EXCEPTION 'Emp E should have exactly one pending overtime row'; END IF;
  SELECT * INTO v_evt FROM public.attendance_events WHERE id = v_rec.check_out_event_id;
  IF (v_evt.metadata->>'reason') <> 'shift_exit' THEN RAISE EXCEPTION 'Emp E reason should be shift_exit'; END IF;
  IF v_evt.inside_geofence IS NOT FALSE OR v_evt.geofence_validation <> 'valid' THEN
    RAISE EXCEPTION 'Expected late exit must be factual outside evidence and remain valid'; END IF;

  -- Idempotent: a second run closes nothing more.
  v_closed := private.auto_close_attendance_sessions();
  IF v_closed <> 0 THEN RAISE EXCEPTION 'Second run should close 0, got %', v_closed; END IF;

  RAISE NOTICE 'auto_close_attendance_sessions assertions passed.';
END;
$test$;

ROLLBACK;
