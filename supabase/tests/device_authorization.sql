-- Transactional security tests for employee device enrollment and replacement.
begin;

do $test$
declare
  v_admin uuid := gen_random_uuid();
  v_manager uuid := gen_random_uuid();
  v_employee uuid := gen_random_uuid();
  v_other_admin uuid := gen_random_uuid();
  v_org uuid;
  v_other_org uuid;
  v_branch uuid;
  v_department uuid;
  v_shift uuid;
  v_assignment uuid;
  v_device_id uuid;
  v_result record;
begin
  insert into auth.users (id, email) values
    (v_admin, 'device-admin@example.invalid'),
    (v_manager, 'device-manager@example.invalid'),
    (v_employee, 'device-employee@example.invalid'),
    (v_other_admin, 'device-other-admin@example.invalid');
  insert into public.organizations (name, slug, timezone)
  values ('Device Test', 'device-test', 'UTC') returning id into v_org;
  insert into public.organizations (name, slug, timezone)
  values ('Other Device Test', 'device-test-other', 'UTC') returning id into v_other_org;
  insert into public.organization_memberships (organization_id, user_id, role_code, status)
  values (v_org, v_admin, 'administrator', 'active'),
         (v_org, v_manager, 'manager', 'active'),
         (v_org, v_employee, 'employee', 'active'),
         (v_other_org, v_other_admin, 'administrator', 'active');
  insert into public.branches (organization_id, code, name)
  values (v_org, 'BR', 'Branch') returning id into v_branch;
  insert into public.departments (organization_id, branch_id, code, name)
  values (v_org, v_branch, 'DP', 'Department') returning id into v_department;
  insert into public.manager_profiles (organization_id, user_id, manager_code, full_name, status, must_change_password)
  values (v_org, v_manager, 'MGR-DEV', 'Device Manager', 'active', false);
  insert into public.manager_scopes (organization_id, manager_user_id, department_id, branch_id)
  values (v_org, v_manager, v_department, v_branch);
  insert into public.employee_profiles (
    id, organization_id, user_id, employee_code, iqama_number, full_name,
    branch_id, department_id, manager_user_id
  ) values (
    v_employee, v_org, v_employee, 'DEVICE-1', '9999999902', 'Device Employee',
    v_branch, v_department, v_manager
  );
  insert into public.shifts (
    organization_id, code, name, start_time, end_time
  ) values (
    v_org, 'DAY', 'Day', time '08:00', time '16:00'
  ) returning id into v_shift;
  insert into public.shift_assignments (
    organization_id, employee_id, shift_id, work_date
  ) values (
    v_org, v_employee, v_shift, current_date
  ) returning id into v_assignment;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', format('{"sub":"%s"}', v_employee), true);

  if has_table_privilege('authenticated', 'public.employee_devices', 'INSERT')
     or has_table_privilege('authenticated', 'public.employee_devices', 'UPDATE')
     or has_table_privilege('authenticated', 'public.employee_devices', 'DELETE') then
    raise exception 'Authenticated users retain direct device mutation privileges';
  end if;

  select * into v_result
  from public.process_attendance_event(
    v_employee, null, 'check_in', false, 0, 0, 5, false,
    'unknown-device-attempt', '{}'::jsonb, repeat('a', 64)
  );
  if v_result.status <> 'device_blocked'
     or v_result.validation_status <> 'device_pending_approval' then
    raise exception 'Unknown device was automatically trusted';
  end if;
  select id into v_device_id
  from public.employee_devices
  where employee_id = v_employee and device_identifier_hash = repeat('a', 64);
  if (select integrity_status from public.employee_devices where id = v_device_id) <> 'suspected' then
    raise exception 'Enrollment request must remain pending';
  end if;

  -- Employees and managers cannot approve a trust transition.
  begin
    perform public.review_employee_device_enrollment(v_device_id, 'approve', 'self approval');
    raise exception 'Employee self-approved a device';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', format('{"sub":"%s"}', v_manager), true);
  begin
    perform public.review_employee_device_enrollment(v_device_id, 'approve', 'manager approval');
    raise exception 'Manager approved a device';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', format('{"sub":"%s"}', v_other_admin), true);
  begin
    perform public.review_employee_device_enrollment(v_device_id, 'approve', 'cross tenant');
    raise exception 'Cross-organization administrator approved a device';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims', format('{"sub":"%s"}', v_admin), true);
  perform public.review_employee_device_enrollment(v_device_id, 'approve', 'verified replacement');
  if not exists (
    select 1 from public.employee_devices
    where id = v_device_id and integrity_status = 'valid' and revoked_at is null
  ) then
    raise exception 'Administrator approval did not activate the device';
  end if;

  -- Approved device telemetry is scoped to the exact employee/shift and keeps
  -- availability distinct from measured zero.
  perform set_config('request.jwt.claims', format('{"sub":"%s"}', v_employee), true);
  perform public.upsert_phone_usage_summary(
    v_org, v_employee, repeat('a', 64), current_date, v_assignment,
    30, 20, 480, 4.17, 'android_usage_stats_permission_granted',
    'usage_access_v1', clock_timestamp()
  );
  if not exists (
    select 1 from public.phone_usage_records
    where employee_id = v_employee and work_date = current_date
      and data_status = 'available' and within_shift_minutes = 20
  ) then
    raise exception 'Approved phone telemetry was not stored accurately';
  end if;
  begin
    perform public.upsert_phone_usage_summary(
      v_org, v_employee, repeat('a', 64), current_date, v_assignment,
      1, 1, 480, 1, 'android_usage_stats_permission_not_granted',
      'usage_access_v1', clock_timestamp()
    );
    raise exception 'Unavailable telemetry was accepted as measured data';
  exception when invalid_parameter_value then null;
  end;

  -- Legacy offline clients remain callable during rollout, but an event with
  -- no device proof must be retained as a permanent review item, never synced.
  perform set_config('request.jwt.claims', format('{"sub":"%s"}', v_employee), true);
  if (public.sync_offline_attendance_event(
    gen_random_uuid(), v_org, v_employee, 'check_in', gen_random_uuid(),
    clock_timestamp(), clock_timestamp(), 0, 0, 5::real, false, 'valid'
  )->>'failure_class') <> 'permanent' then
    raise exception 'Legacy offline replay was falsely acknowledged';
  end if;

  perform set_config('request.jwt.claims', format('{"sub":"%s"}', v_admin), true);
  perform public.reset_employee_device(v_employee);
  if not exists (
    select 1 from public.employee_devices
    where id = v_device_id and integrity_status = 'blocked' and revoked_at is not null
  ) then
    raise exception 'Administrator reset did not revoke the device';
  end if;

  -- The revoked identifier can report another attempt, but never reactivates itself.
  perform set_config('request.jwt.claims', format('{"sub":"%s"}', v_employee), true);
  select * into v_result
  from public.process_attendance_event(
    v_employee, null, 'check_in', false, 0, 0, 5, false,
    'revoked-device-attempt', '{}'::jsonb, repeat('a', 64)
  );
  if v_result.status <> 'device_blocked'
     or v_result.validation_status <> 'device_revoked' then
    raise exception 'Revoked device reactivated itself';
  end if;
  perform set_config('request.jwt.claims', format('{"sub":"%s"}', v_admin), true);
  if (select count(*) from public.employee_device_audit_log where device_id = v_device_id) < 3 then
    raise exception 'Enrollment, approval, and reset decisions were not audited';
  end if;
end
$test$;

reset role;
rollback;
