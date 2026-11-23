-- ============================================================================
-- Integration tests: Department Manager Access, Scoping, Revocation & Security
-- Tests: Administrator, Manager A, Manager B, Suspended Manager, and Employee
-- ============================================================================
begin;

-- 1. Create Auth Users
insert into auth.users (id, email, raw_user_meta_data) values
  ('80000000-0000-0000-0000-000000000001', 'admin1@org1.test', '{"display_name":"Admin 1"}'::jsonb),
  ('80000000-0000-0000-0000-000000000002', 'mgrA@org1.test', '{"display_name":"Manager A"}'::jsonb),
  ('80000000-0000-0000-0000-000000000003', 'mgrB@org1.test', '{"display_name":"Manager B"}'::jsonb),
  ('80000000-0000-0000-0000-000000000004', 'mgrS@org1.test', '{"display_name":"Manager Suspended"}'::jsonb),
  ('80000000-0000-0000-0000-000000000005', 'empA@org1.test', '{"display_name":"Emp A1"}'::jsonb),
  ('80000000-0000-0000-0000-000000000006', 'empB@org1.test', '{"display_name":"Emp B1"}'::jsonb),
  ('90000000-0000-0000-0000-000000000001', 'admin2@org2.test', '{"display_name":"Admin 2"}'::jsonb),
  ('90000000-0000-0000-0000-000000000002', 'mgr2@org2.test', '{"display_name":"Manager Org2"}'::jsonb),
  ('90000000-0000-0000-0000-000000000003', 'emp2@org2.test', '{"display_name":"Emp Org2"}'::jsonb);

-- 2. Create Organizations
insert into public.organizations (id, name, slug, timezone) values
  ('81000000-0000-0000-0000-000000000001', 'Tenant Org One', 'tenant-one', 'UTC'),
  ('91000000-0000-0000-0000-000000000001', 'Tenant Org Two', 'tenant-two', 'UTC');

-- 3. Create Organization Memberships
insert into public.organization_memberships (organization_id, user_id, role_code, status) values
  ('81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', 'administrator', 'active'),
  ('81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000002', 'manager', 'active'),
  ('81000000-0000-0000-0000-000000000003', '80000000-0000-0000-0000-000000000003', 'manager', 'active'),
  ('81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000004', 'manager', 'suspended'),
  ('81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000005', 'employee', 'active'),
  ('81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000006', 'employee', 'active'),
  ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'administrator', 'active'),
  ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 'manager', 'active'),
  ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003', 'employee', 'active');

-- 4. Create Manager Profiles
insert into public.manager_profiles (organization_id, user_id, manager_code, full_name, status, must_change_password) values
  ('81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000002', 'MGR-A', 'Manager A', 'active', false),
  ('81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000003', 'MGR-B', 'Manager B', 'active', false),
  ('81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000004', 'MGR-S', 'Manager S', 'suspended', false),
  ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 'MGR-A', 'Org2 Manager', 'active', false);

-- 5. Create Sites and Departments
insert into public.branches (id, organization_id, code, name, timezone) values
  ('82000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 'BR1', 'Branch One', 'UTC'),
  ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'BR2', 'Branch Two', 'UTC');

insert into public.departments (id, organization_id, branch_id, code, name, manager_user_id) values
  ('83000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001', 'DEP-A', 'Dept A', '80000000-0000-0000-0000-000000000002'),
  ('83000000-0000-0000-0000-000000000002', '81000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001', 'DEP-B', 'Dept B', '80000000-0000-0000-0000-000000000003'),
  ('93000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', 'DEP-2', 'Dept 2', '90000000-0000-0000-0000-000000000002');

-- 6. Manager Scopes
insert into public.manager_scopes (organization_id, manager_user_id, department_id, branch_id) values
  ('81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000002', '83000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001'),
  ('81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000003', '83000000-0000-0000-0000-000000000002', '82000000-0000-0000-0000-000000000001'),
  ('81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000004', '83000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001'),
  ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001');

-- 7. Employee Profiles
insert into public.employee_profiles (id, organization_id, user_id, employee_code, iqama_number, full_name, branch_id, department_id) values
  ('84000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000005', 'EMP-A1', '8888000001', 'Employee A1', '82000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001'),
  ('84000000-0000-0000-0000-000000000002', '81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000006', 'EMP-B1', '8888000002', 'Employee B1', '82000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000002'),
  ('94000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003', 'EMP-2', '9999000001', 'Employee Org2', '92000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001');

-- ----------------------------------------------------------------------------
-- TEST SUITE
-- ----------------------------------------------------------------------------

-- A. Invariant: anon has NO table grants on public tables
do $$ begin
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'
  ) then
    raise exception 'TEST FAILED: anon holds unexpected public table privileges';
  end if;
end $$;

-- B. Administrator Identity Tests
set local role authenticated;
select set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000001', true);

do $$
declare
  v_site public.branches%rowtype;
  v_shift public.shifts%rowtype;
  v_emp_count integer;
begin
  -- Admin sees all 2 employees in Org 1
  select count(*) into v_emp_count from public.employee_profiles;
  if v_emp_count <> 2 then
    raise exception 'TEST FAILED: Admin expected 2 employees, found %', v_emp_count;
  end if;

  -- Admin can execute create_site with geofence
  v_site := public.create_site(
    '81000000-0000-0000-0000-000000000001', 'Admin New Site', 'SITE-ADM',
    'UTC', '123 Admin Way', 24.7136, 46.6753, true, 40
  );
  if v_site.id is null then
    raise exception 'TEST FAILED: Admin create_site failed';
  end if;

  -- Admin can execute save_shift_template
  v_shift := public.save_shift_template(
    null, '81000000-0000-0000-0000-000000000001', 'ADM-SH', 'Admin Shift',
    time '08:00', time '16:00', 30, '#3b82f6', current_date
  );
  if v_shift.id is null then
    raise exception 'TEST FAILED: Admin save_shift_template failed';
  end if;
end $$;

-- C. Manager A: Scoped strictly to Department A
select set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000002', true);

do $$
declare
  v_emp_count integer;
  v_dept_count integer;
begin
  -- 1. Manager A can ONLY see employees in Dept A
  select count(*) into v_emp_count from public.employee_profiles;
  if v_emp_count <> 1 then
    raise exception 'TEST FAILED: Manager A should see exactly 1 employee, saw %', v_emp_count;
  end if;

  if not exists (select 1 from public.employee_profiles where id = '84000000-0000-0000-0000-000000000001') then
    raise exception 'TEST FAILED: Manager A must see Employee A1';
  end if;

  -- 2. Manager A CANNOT see Employee B1
  if exists (select 1 from public.employee_profiles where id = '84000000-0000-0000-0000-000000000002') then
    raise exception 'TEST FAILED: Manager A must NOT see Employee B1 from Dept B';
  end if;

  -- 3. Manager A CANNOT see Employee Org2
  if exists (select 1 from public.employee_profiles where id = '94000000-0000-0000-0000-000000000001') then
    raise exception 'TEST FAILED: Manager A must NOT see cross-tenant employee';
  end if;

  -- 4. Manager A only sees Department A
  select count(*) into v_dept_count from public.departments;
  if v_dept_count <> 1 then
    raise exception 'TEST FAILED: Manager A should see exactly 1 department, saw %', v_dept_count;
  end if;

  -- 5. Manager A CANNOT call create_site
  begin
    perform public.create_site('81000000-0000-0000-0000-000000000001', 'Hacked', 'HACK', 'UTC');
    raise exception 'TEST FAILED: Manager A must NOT be allowed to execute create_site';
  exception
    when insufficient_privilege then null;
  end;

  -- 6. Manager A CANNOT call save_shift_template
  begin
    perform public.save_shift_template(null, '81000000-0000-0000-0000-000000000001', 'HACK', 'Hack', time '08:00', time '16:00', 0);
    raise exception 'TEST FAILED: Manager A must NOT be allowed to execute save_shift_template';
  exception
    when insufficient_privilege then null;
  end;

  -- 7. Manager A CANNOT self-assign departments
  begin
    perform public.admin_assign_manager_departments(
      '81000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000002',
      array['83000000-0000-0000-0000-000000000002']::uuid[]
    );
    raise exception 'TEST FAILED: Manager A must NOT be allowed to call admin_assign_manager_departments';
  exception
    when insufficient_privilege then null;
  end;
end $$;

-- D. Suspended Manager: ZERO Access
select set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000004', true);

do $$
declare
  v_emp_count integer;
  v_dept_count integer;
begin
  select count(*) into v_emp_count from public.employee_profiles;
  if v_emp_count <> 0 then
    raise exception 'TEST FAILED: Suspended manager must see 0 employees, saw %', v_emp_count;
  end if;

  select count(*) into v_dept_count from public.departments;
  if v_dept_count <> 0 then
    raise exception 'TEST FAILED: Suspended manager must see 0 departments, saw %', v_dept_count;
  end if;
end $$;

-- E. Reassignment & Revocation Testing
-- Switch back to Admin 1 to reassign Manager A from Dept A to Dept B
select set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000001', true);

do $$ begin
  perform public.admin_assign_manager_departments(
    '81000000-0000-0000-0000-000000000001',
    '80000000-0000-0000-0000-000000000002',
    array['83000000-0000-0000-0000-000000000002']::uuid[],
    '83000000-0000-0000-0000-000000000002'
  );

  -- Verify Dept A manager_user_id was cleared
  if (select manager_user_id from public.departments where id = '83000000-0000-0000-0000-000000000001') is not null then
    raise exception 'TEST FAILED: Dept A primary manager should be cleared after reassignment';
  end if;
end $$;

-- Switch to Manager A: must now see ONLY Employee B1 and Dept B
select set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000002', true);

do $$
declare
  v_emp_count integer;
begin
  select count(*) into v_emp_count from public.employee_profiles;
  if v_emp_count <> 1 then
    raise exception 'TEST FAILED: Reassigned Manager A expected 1 employee, saw %', v_emp_count;
  end if;

  if not exists (select 1 from public.employee_profiles where id = '84000000-0000-0000-0000-000000000002') then
    raise exception 'TEST FAILED: Manager A should now see Employee B1';
  end if;

  if exists (select 1 from public.employee_profiles where id = '84000000-0000-0000-0000-000000000001') then
    raise exception 'TEST FAILED: Manager A must NO LONGER see Employee A1 (revocation failed)';
  end if;
end $$;

-- F. Multi-Department Assignment Preserving Existing Scopes
select set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000001', true);

do $$ begin
  -- Add Dept A as primary manager for Manager A via admin_set_department_primary_manager
  perform public.admin_set_department_primary_manager(
    '81000000-0000-0000-0000-000000000001',
    '83000000-0000-0000-0000-000000000001',
    '80000000-0000-0000-0000-000000000002'
  );
end $$;

-- Switch to Manager A: should now see BOTH Employee A1 and Employee B1!
select set_config('request.jwt.claim.sub', '80000000-0000-0000-0000-000000000002', true);

do $$
declare
  v_emp_count integer;
begin
  select count(*) into v_emp_count from public.employee_profiles;
  if v_emp_count <> 2 then
    raise exception 'TEST FAILED: Multi-department Manager A expected 2 employees, saw %', v_emp_count;
  end if;
end $$;

-- G. Cross-Organization Tenant Isolation
select set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000001', true);

do $$
declare
  v_emp_count integer;
begin
  -- Admin 2 only sees Org 2 employee
  select count(*) into v_emp_count from public.employee_profiles;
  if v_emp_count <> 1 then
    raise exception 'TEST FAILED: Admin 2 saw % employees across tenants', v_emp_count;
  end if;

  -- Admin 2 cannot assign Org 1 manager
  begin
    perform public.admin_assign_manager_departments(
      '91000000-0000-0000-0000-000000000001',
      '80000000-0000-0000-0000-000000000002',
      array['93000000-0000-0000-0000-000000000001']::uuid[]
    );
    raise exception 'TEST FAILED: Admin 2 must NOT be allowed to assign Org 1 manager';
  exception
    when not_found or insufficient_privilege or query_canceled then null;
  end;
end $$;

rollback;
