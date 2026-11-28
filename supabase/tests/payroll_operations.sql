-- ============================================================================
-- SQL Security, Scope, Immutability & Workflow Tests for Payroll Operations
-- Run inside a rolled-back transaction so test fixtures leave no trace.
-- ============================================================================
begin;

-- 1. Verify function execute privileges (anon denied, authenticated granted)
do $$
declare
  v_sig regprocedure;
begin
  foreach v_sig in array array[
    'public.create_employee_with_compensation(uuid,text,text,text,text,uuid,uuid,text,uuid,date,public.employment_status,date,numeric)'::regprocedure,
    'public.get_payroll_settings(uuid)'::regprocedure,
    'public.upsert_payroll_settings(uuid,text,integer,numeric,numeric,text,numeric)'::regprocedure,
    'public.list_employee_compensations(uuid,uuid)'::regprocedure,
    'public.upsert_employee_compensation(uuid,uuid,numeric,text,date,date,text,uuid)'::regprocedure,
    'public.delete_employee_compensation(uuid,uuid)'::regprocedure,
    'public.list_employee_payroll_components(uuid,uuid)'::regprocedure,
    'public.upsert_employee_payroll_component(uuid,uuid,public.payroll_component_kind,text,text,numeric,date,date,boolean,text,uuid)'::regprocedure,
    'public.delete_employee_payroll_component(uuid,uuid)'::regprocedure,
    'public.generate_payroll_run(uuid,date)'::regprocedure,
    'public.list_payroll_runs(uuid)'::regprocedure,
    'public.list_payroll_entries(uuid,uuid,text,uuid,uuid,public.payroll_review_status)'::regprocedure,
    'public.get_payroll_entry_detail(uuid,uuid)'::regprocedure,
    'public.add_payroll_manual_adjustment(uuid,uuid,text,text,text,numeric,text)'::regprocedure,
    'public.delete_payroll_manual_adjustment(uuid,uuid)'::regprocedure,
    'public.waive_payroll_exception(uuid,uuid,text)'::regprocedure,
    'public.review_payroll_entry(uuid,uuid,public.payroll_review_status,text)'::regprocedure,
    'public.submit_payroll_run_for_review(uuid,uuid)'::regprocedure,
    'public.finalize_payroll_run(uuid,uuid)'::regprocedure,
    'public.reopen_payroll_run(uuid,uuid,text)'::regprocedure,
    'public.export_payroll_run_rows(uuid,uuid)'::regprocedure
  ] loop
    if has_function_privilege('anon', v_sig, 'execute') then
      raise exception 'anon must not execute %', v_sig;
    end if;
    if not has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception 'authenticated must execute %', v_sig;
    end if;
  end loop;
end
$$;

-- 2. Seed isolated fixtures for Org A & Org B, Admin, Scoped Manager, Employee
do $$
declare
  v_org_a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_org_b uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  v_branch_a uuid := 'aaaaaaaa-0000-0000-0000-000000000011';
  v_branch_b uuid := 'bbbbbbbb-0000-0000-0000-000000000012';
  v_dept_ops uuid := 'aaaaaaaa-0000-0000-0000-000000000021';
  v_dept_hr uuid := 'aaaaaaaa-0000-0000-0000-000000000022';
  v_dept_b uuid := 'bbbbbbbb-0000-0000-0000-000000000023';
  v_admin_uid uuid := '11111111-0000-0000-0000-000000000001';
  v_mgr_uid uuid := '22222222-0000-0000-0000-000000000002';
  v_emp_uid uuid := '33333333-0000-0000-0000-000000000003';
  v_emp_ops uuid := 'eeeeeeee-0000-0000-0000-000000000001';
  v_emp_hr uuid := 'eeeeeeee-0000-0000-0000-000000000002';
  v_emp_b uuid := 'eeeeeeee-0000-0000-0000-000000000003';
  v_created_employee public.employee_profiles;
  v_settings record;
  v_run public.payroll_runs;
  v_entry_ops_id uuid;
  v_entry_hr_id uuid;
  v_count integer;
begin
  insert into auth.users (id, email)
  values
    (v_admin_uid, 'payroll-admin@test.local'),
    (v_mgr_uid, 'payroll-mgr@test.local'),
    (v_emp_uid, 'payroll-emp@test.local')
  on conflict (id) do nothing;

  insert into public.organizations (id, name, slug, timezone)
  values
    (v_org_a, 'Org A', 'payroll-org-a', 'Asia/Riyadh'),
    (v_org_b, 'Org B', 'payroll-org-b', 'UTC')
  on conflict (id) do nothing;

  insert into public.organization_memberships (organization_id, user_id, role_code, status)
  values
    (v_org_a, v_admin_uid, 'administrator', 'active'),
    (v_org_a, v_mgr_uid, 'manager', 'active'),
    (v_org_a, v_emp_uid, 'employee', 'active')
  on conflict (organization_id, user_id, role_code) do nothing;

  insert into public.manager_profiles (organization_id, user_id, manager_code, full_name, status)
  values (v_org_a, v_mgr_uid, 'MGR-PAY-1', 'Scoped Manager', 'active')
  on conflict do nothing;

  insert into public.branches (id, organization_id, code, name, timezone)
  values
    (v_branch_a, v_org_a, 'BR-A', 'Riyadh HQ', 'Asia/Riyadh'),
    (v_branch_b, v_org_b, 'BR-B', 'Branch B', 'UTC')
  on conflict (id) do nothing;

  insert into public.departments (id, organization_id, branch_id, code, name, manager_user_id)
  values
    (v_dept_ops, v_org_a, v_branch_a, 'OPS', 'Operations', v_mgr_uid),
    (v_dept_hr, v_org_a, v_branch_a, 'HR', 'Human Resources', null),
    (v_dept_b, v_org_b, v_branch_b, 'OPS-B', 'Ops B', null)
  on conflict (id) do nothing;

  insert into public.employee_profiles (
    id, organization_id, user_id, employee_code, iqama_number, full_name,
    branch_id, department_id, joining_date, employment_status
  ) values
    (v_emp_ops, v_org_a, v_emp_uid, 'EMP-OPS-1', '2000000001', 'Ops Employee', v_branch_a, v_dept_ops, '2026-01-01', 'active'),
    (v_emp_hr, v_org_a, null, 'EMP-HR-1', '2000000002', 'HR Employee', v_branch_a, v_dept_hr, '2026-01-01', 'active'),
    (v_emp_b, v_org_b, null, 'EMP-B-1', '2000000003', 'Org B Employee', v_branch_b, v_dept_b, '2026-01-01', 'active')
  on conflict (id) do nothing;

  -- Act as Administrator of Org A
  perform set_config('request.jwt.claim.sub', v_admin_uid::text, true);
  set local role authenticated;

  -- Fixed hourly overtime settings must round-trip and snapshot into generated runs.
  perform public.upsert_payroll_settings(v_org_a, 'SAR', 30, 8, 1.5, 'fixed_hourly', 12);
  select * into v_settings from public.get_payroll_settings(v_org_a);
  if v_settings.overtime_rate_mode <> 'fixed_hourly' or v_settings.overtime_hourly_rate <> 12 then
    raise exception 'Expected fixed hourly overtime settings to round-trip at 12 SAR/hr';
  end if;

  -- Employee onboarding must create exactly one salary record linked to Payroll.
  v_created_employee := public.create_employee_with_compensation(
    v_org_a, 'EMP-NEW-1', '2000000004', 'New Employee', null,
    v_branch_a, v_dept_ops, 'Coordinator', v_mgr_uid, '2026-11-01',
    'active', '2026-11-01', 7200
  );
  select count(*) into v_count
  from public.employee_compensations
  where organization_id = v_org_a
    and employee_id = v_created_employee.id
    and monthly_base_salary = 7200
    and currency_code = 'SAR'
    and effective_from = '2026-11-01';
  if v_count <> 1 then
    raise exception 'Employee onboarding must create one linked initial salary, got %', v_count;
  end if;

  -- Overlapping compensation rejection
  perform public.upsert_employee_compensation(v_org_a, v_emp_ops, 6000, 'SAR', '2026-10-01', '2026-10-15', 'Initial', null);
  begin
    perform public.upsert_employee_compensation(v_org_a, v_emp_ops, 6500, 'SAR', '2026-10-10', null, 'Overlap', null);
    raise exception 'Overlapping compensation period should have been rejected';
  exception when exclusion_violation then null;
  end;

  perform public.upsert_employee_compensation(v_org_a, v_emp_ops, 6500, 'SAR', '2026-10-16', null, 'Raise', null);
  perform public.upsert_employee_compensation(v_org_a, v_emp_hr, 8000, 'SAR', '2026-10-01', null, 'HR Salary', null);

  -- Cross-organization protection
  begin
    perform public.generate_payroll_run(v_org_b, '2026-10-01');
    raise exception 'Cross-organization payroll generation should have been denied';
  exception when insufficient_privilege then null;
  end;

  -- Generate run for Oct 2026
  v_run := public.generate_payroll_run(v_org_a, '2026-10-01');
  if v_run.overtime_rate_mode <> 'fixed_hourly' or v_run.overtime_hourly_rate <> 12 then
    raise exception 'Payroll run must snapshot fixed overtime at 12 SAR/hr';
  end if;
  if v_run.employee_count <> 2 then
    raise exception 'Expected 2 employees in Org A run, got %', v_run.employee_count;
  end if;

  select id into v_entry_ops_id from public.payroll_entries where payroll_run_id = v_run.id and employee_id = v_emp_ops;
  select id into v_entry_hr_id from public.payroll_entries where payroll_run_id = v_run.id and employee_id = v_emp_hr;

  -- Act as Scoped Manager (OPS department only)
  perform set_config('request.jwt.claim.sub', v_mgr_uid::text, true);

  select count(*) into v_count from public.list_payroll_entries(v_org_a, v_run.id, null, null, null, null);
  if v_count <> 1 then
    raise exception 'Manager should see exactly 1 scoped employee entry, saw %', v_count;
  end if;

  -- Manager cannot access HR employee detail
  begin
    perform public.get_payroll_entry_detail(v_org_a, v_entry_hr_id);
    raise exception 'Manager should not access out-of-scope employee detail';
  exception when insufficient_privilege then null;
  end;

  -- Manager cannot finalize or change compensation
  begin
    perform public.finalize_payroll_run(v_org_a, v_run.id);
    raise exception 'Manager must not be allowed to finalize payroll';
  exception when insufficient_privilege then null;
  end;

  -- Manager can review scoped OPS employee
  perform public.review_payroll_entry(v_org_a, v_entry_ops_id, 'reviewed', 'Verified by OPS manager');

  -- Act as Employee (must be denied everywhere)
  perform set_config('request.jwt.claim.sub', v_emp_uid::text, true);
  begin
    perform * from public.list_payroll_runs(v_org_a);
    raise exception 'Employee must be denied payroll access';
  exception when insufficient_privilege then null;
  end;

  -- Act as Administrator to review HR, finalize, verify immutability, and reopen with audit
  perform set_config('request.jwt.claim.sub', v_admin_uid::text, true);
  perform public.review_payroll_entry(v_org_a, v_entry_hr_id, 'reviewed', 'Admin reviewed');
  v_run := public.finalize_payroll_run(v_org_a, v_run.id);
  if v_run.status <> 'finalized' then
    raise exception 'Run should be finalized';
  end if;

  -- Immutability check on finalized run
  begin
    update public.payroll_entries set net_pay = 99999 where id = v_entry_ops_id;
    raise exception 'Finalized payroll entry must be immutable';
  exception when insufficient_privilege then null;
  end;

  -- Reopen requires non-empty reason
  begin
    perform public.reopen_payroll_run(v_org_a, v_run.id, '   ');
    raise exception 'Reopening without reason must fail';
  exception when invalid_parameter_value then null;
  end;

  v_run := public.reopen_payroll_run(v_org_a, v_run.id, 'Correcting October allowance');
  if v_run.status <> 'under_review' then
    raise exception 'Reopened run should be under_review';
  end if;

  select count(*) into v_count
  from public.audit_logs
  where organization_id = v_org_a
    and action = 'payroll_run_reopened'
    and entity_id = v_run.id;
  if v_count <> 1 then
    raise exception 'Expected 1 audit log for payroll_run_reopened, got %', v_count;
  end if;
end
$$;

reset role;
rollback;
