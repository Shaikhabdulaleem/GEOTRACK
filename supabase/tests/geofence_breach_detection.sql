-- Transactional regression coverage for deterministic, idempotent breach detection.
begin;

do $test$
declare
  v_admin uuid := gen_random_uuid();
  v_manager uuid := gen_random_uuid();
  v_employee uuid := gen_random_uuid();
  v_org uuid;
  v_branch uuid;
  v_department uuid;
  v_record uuid;
  v_geofence_old uuid := gen_random_uuid();
  v_geofence_current uuid := gen_random_uuid();
  v_result record;
  v_claim record;
  v_retry_claim record;
  v_claimed integer := 0;
  v_monitor_count integer;
  v_breach public.geofence_breaches%rowtype;
begin
  insert into auth.users (id, email) values
    (v_admin, 'breach-admin@example.invalid'),
    (v_manager, 'breach-manager@example.invalid'),
    (v_employee, 'breach-employee@example.invalid');

  insert into public.organizations (
    name, slug, timezone, geofence_breach_threshold_minutes
  ) values ('Breach Test', 'breach-test', 'UTC', 5)
  returning id into v_org;
  insert into public.organization_memberships (organization_id, user_id, role_code, status)
  values (v_org, v_admin, 'administrator', 'active'),
         (v_org, v_manager, 'manager', 'active'),
         (v_org, v_employee, 'employee', 'active');
  insert into public.branches (organization_id, code, name)
  values (v_org, 'BR', 'Branch') returning id into v_branch;
  insert into public.departments (organization_id, branch_id, code, name)
  values (v_org, v_branch, 'DP', 'Department') returning id into v_department;
  insert into public.manager_profiles (organization_id, user_id, manager_code, full_name, status, must_change_password)
  values (v_org, v_manager, 'MGR-BREACH', 'Breach Manager', 'active', false);
  insert into public.manager_scopes (organization_id, manager_user_id, department_id, branch_id)
  values (v_org, v_manager, v_department, v_branch);
  insert into public.employee_profiles (
    id, organization_id, user_id, employee_code, iqama_number, full_name,
    branch_id, department_id, manager_user_id
  ) values (
    v_employee, v_org, v_employee, 'BREACH-1', '9999999901', 'Breach Employee',
    v_branch, v_department, v_manager
  );
  insert into public.attendance_records (
    organization_id, employee_id, attendance_date, session_number,
    check_in_at, source, status, geofence_validated
  ) values (
    v_org, v_employee, current_date - 1, 1,
    (current_date - 1 + time '22:00') at time zone 'UTC',
    'automatic_geofence', 'present', true
  ) returning id into v_record;

  -- An open overnight session without reliable samples is unknown, not a
  -- violation. Scheduler execution must leave it untouched.
  select * into v_result from private.detect_geofence_breaches();
  if v_result.breaches_opened <> 0 or v_result.breaches_updated <> 0
     or v_result.breaches_resolved <> 0 then
    raise exception 'Missing GPS samples incorrectly changed breach state';
  end if;

  -- The attendance record belongs to the prior date (overnight shift). Inside
  -- boundary, then two reliable outside points span six minutes after midnight.
  -- The latest outside point identifies the current geofence deterministically.
  insert into public.employee_location_pings (
    organization_id, employee_id, attendance_record_id, event_at,
    location_point, accuracy_meters, geofence_id, inside_geofence
  ) values
    (v_org, v_employee, v_record, clock_timestamp() - interval '20 minutes',
     '{"type":"Point","coordinates":[0,0]}', 5, v_geofence_old, true),
    (v_org, v_employee, v_record, clock_timestamp() - interval '10 minutes',
     '{"type":"Point","coordinates":[1,1]}', 5, v_geofence_old, false),
    (v_org, v_employee, v_record, clock_timestamp() - interval '4 minutes',
     '{"type":"Point","coordinates":[1,1]}', 5, v_geofence_current, false),
    -- Low-accuracy/unclassified evidence must not resolve or extend the breach.
    (v_org, v_employee, v_record, clock_timestamp() - interval '2 minutes',
     '{"type":"Point","coordinates":[1,1]}', 500, v_geofence_current, null);

  select * into v_result from private.detect_geofence_breaches();
  if v_result.breaches_opened <> 1 then
    raise exception 'Expected one breach to open, got %', v_result.breaches_opened;
  end if;
  select * into v_breach from public.geofence_breaches where employee_id = v_employee;
  if v_breach.geofence_id <> v_geofence_current then
    raise exception 'Detector did not select the geofence from the latest outside sample';
  end if;
  if v_breach.minutes_outside <> 6 then
    raise exception 'Expected six evidence-backed minutes, got %', v_breach.minutes_outside;
  end if;
  if (select count(*) from public.geofence_breach_alerts where breach_id = v_breach.id) <> 2 then
    raise exception 'Expected scoped manager and administrator alerts';
  end if;

  -- Repeated scheduler execution updates the same incident and never duplicates alerts.
  select * into v_result from private.detect_geofence_breaches();
  if v_result.breaches_opened <> 0 or v_result.breaches_updated <> 1 then
    raise exception 'Repeated execution was not idempotent';
  end if;
  if (select count(*) from public.geofence_breach_alerts where breach_id = v_breach.id) <> 2 then
    raise exception 'Repeated execution duplicated alerts';
  end if;

  -- Queue claims must not mark delivery before downstream acknowledgement.
  for v_claim in select * from public.claim_breach_push_batch(10) loop
    v_claimed := v_claimed + 1;
    if (select pushed_at from public.geofence_breach_alerts where id = v_claim.alert_id) is not null then
      raise exception 'Claim incorrectly marked an alert delivered';
    end if;
    if v_claimed = 1 then
      if not public.complete_breach_push_attempt(
        v_claim.alert_id, v_claim.claim_token, 1, 0, null, false
      ) then
        raise exception 'Could not acknowledge successful push delivery';
      end if;
      if (select delivery_status from public.geofence_breach_alerts where id = v_claim.alert_id) <> 'delivered' then
        raise exception 'Successful push acknowledgement was not persisted';
      end if;
    else
      if not public.complete_breach_push_attempt(
        v_claim.alert_id, v_claim.claim_token, 0, 1, 'temporary test failure', false
      ) then
        raise exception 'Could not acknowledge failed push delivery';
      end if;
      if (select delivery_status from public.geofence_breach_alerts where id = v_claim.alert_id) <> 'pending' then
        raise exception 'Transient push failure was not returned to the retry queue';
      end if;
    end if;
  end loop;
  if v_claimed <> 2 then
    raise exception 'Expected to claim two alerts, got %', v_claimed;
  end if;

  -- A terminal downstream delivery failure is escalated once to an
  -- administrator; repeated monitor runs must not duplicate that alert.
  update public.geofence_breach_alerts
     set next_attempt_at = clock_timestamp()
   where breach_id = v_breach.id and delivery_status = 'pending';
  select * into v_retry_claim from public.claim_breach_push_batch(10);
  if v_retry_claim.alert_id is null or not public.complete_breach_push_attempt(
    v_retry_claim.alert_id, v_retry_claim.claim_token, 0, 1,
    'permanent test failure', true
  ) then
    raise exception 'Could not record a permanent push failure';
  end if;
  v_monitor_count := private.monitor_geotrack_cron_failures();
  if v_monitor_count <> 1 or (
    select count(*) from public.notifications
    where organization_id = v_org
      and title = 'Critical notification delivery failure'
  ) <> 1 then
    raise exception 'Permanent push failure was not escalated exactly once';
  end if;
  if private.monitor_geotrack_cron_failures() <> 0 then
    raise exception 'Repeated failure monitoring duplicated an escalation';
  end if;

  -- Positive inside evidence resolves the incident.
  insert into public.employee_location_pings (
    organization_id, employee_id, attendance_record_id, event_at,
    location_point, accuracy_meters, geofence_id, inside_geofence
  ) values (
    v_org, v_employee, v_record, clock_timestamp(),
    '{"type":"Point","coordinates":[0,0]}', 5, v_geofence_current, true
  );
  select * into v_result from private.detect_geofence_breaches();
  if v_result.breaches_resolved <> 1 then
    raise exception 'Return-inside transition did not resolve the breach';
  end if;
  if (select status from public.geofence_breaches where id = v_breach.id) <> 'resolved' then
    raise exception 'Breach row was not resolved';
  end if;
end
$test$;

rollback;
