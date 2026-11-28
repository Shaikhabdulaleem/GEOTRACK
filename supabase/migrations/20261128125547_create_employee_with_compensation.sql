-- Create the employee profile and its initial salary history atomically.
create or replace function public.create_employee_with_compensation(
  p_organization_id uuid,
  p_employee_code text,
  p_iqama_number text,
  p_full_name text,
  p_mobile_number text,
  p_branch_id uuid,
  p_department_id uuid,
  p_job_title text,
  p_manager_user_id uuid,
  p_joining_date date,
  p_employment_status public.employment_status,
  p_status_effective_date date,
  p_monthly_base_salary numeric
)
returns public.employee_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employee_profiles;
  v_compensation_id uuid;
  v_currency_code text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.has_org_role(p_organization_id, array['administrator']) then
    raise exception 'Administrator role required' using errcode = '42501';
  end if;
  if p_joining_date is null then
    raise exception 'Joining date is required' using errcode = '22023';
  end if;
  if p_monthly_base_salary is null or p_monthly_base_salary <= 0 then
    raise exception 'Monthly base salary must be greater than zero' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.departments d
    join public.branches b
      on b.id = d.branch_id
     and b.organization_id = d.organization_id
    where d.id = p_department_id
      and d.organization_id = p_organization_id
      and d.branch_id = p_branch_id
      and b.id = p_branch_id
  ) then
    raise exception 'Site and department must belong to the organization' using errcode = '42501';
  end if;
  if p_manager_user_id is not null and not exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = p_manager_user_id
      and m.role_code in ('administrator', 'manager')
      and m.status = 'active'
  ) then
    raise exception 'Manager must be an active manager in the organization' using errcode = '42501';
  end if;

  insert into public.employee_profiles (
    organization_id, employee_code, iqama_number, full_name, mobile_number,
    branch_id, department_id, job_title, manager_user_id, joining_date,
    employment_status, status_effective_date
  ) values (
    p_organization_id, upper(btrim(p_employee_code)), btrim(p_iqama_number), btrim(p_full_name),
    nullif(btrim(p_mobile_number), ''), p_branch_id, p_department_id,
    nullif(btrim(p_job_title), ''), p_manager_user_id, p_joining_date,
    coalesce(p_employment_status, 'active'), coalesce(p_status_effective_date, p_joining_date)
  )
  returning * into v_employee;

  select coalesce(ps.currency_code, 'SAR')
  into v_currency_code
  from public.organizations o
  left join public.payroll_settings ps on ps.organization_id = o.id
  where o.id = p_organization_id;

  insert into public.employee_compensations (
    organization_id, employee_id, monthly_base_salary, currency_code,
    effective_from, notes, created_by
  ) values (
    p_organization_id, v_employee.id, round(p_monthly_base_salary, 2), v_currency_code,
    p_joining_date, 'Initial salary from employee onboarding', (select auth.uid())
  )
  returning id into v_compensation_id;

  insert into public.audit_logs (
    organization_id, actor_user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, (select auth.uid()), 'employee_created_with_compensation',
    'employee_profiles', v_employee.id,
    jsonb_build_object('compensation_id', v_compensation_id)
  );

  return v_employee;
end;
$$;

revoke all on function public.create_employee_with_compensation(
  uuid, text, text, text, text, uuid, uuid, text, uuid, date,
  public.employment_status, date, numeric
) from public, anon;

grant execute on function public.create_employee_with_compensation(
  uuid, text, text, text, text, uuid, uuid, text, uuid, date,
  public.employment_status, date, numeric
) to authenticated;
