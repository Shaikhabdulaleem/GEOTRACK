-- Scope the productivity module to the existing Mailroom department.
create or replace function private.can_access_mailroom(
  p_organization_id uuid,
  p_branch_id uuid,
  p_admin_only boolean default false
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.branches b
    join public.departments d
      on d.branch_id = b.id
     and d.organization_id = b.organization_id
    where b.id = p_branch_id
      and b.organization_id = p_organization_id
      and b.status::text = 'active'
      and d.name ilike 'Mailroom'
      and d.status::text = 'active'
  ) and case
    when p_admin_only then private.has_org_role(p_organization_id, array['administrator'])
    else private.can_manage_branch(p_organization_id, p_branch_id)
  end;
$$;

create or replace function public.initialize_mailroom_productivity(p_organization_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_branch_id uuid;
  v_department_id uuid;
  v_clients integer;
  v_activities integer;
begin
  select b.id, d.id into v_branch_id, v_department_id
  from public.branches b
  join public.departments d
    on d.branch_id = b.id
   and d.organization_id = b.organization_id
  where b.organization_id = p_organization_id
    and b.status::text = 'active'
    and d.name ilike 'Mailroom'
    and d.status::text = 'active'
  limit 1;

  if v_branch_id is null or not private.can_access_mailroom(p_organization_id, v_branch_id, true) then
    raise exception 'An active Mailroom department and administrator access are required' using errcode = '42501';
  end if;

  insert into public.mailroom_productivity_settings (organization_id, branch_id)
  values (p_organization_id, v_branch_id)
  on conflict (organization_id) do nothing;

  insert into public.mailroom_clients (organization_id, branch_id, code, name, processing_mode, sort_order)
  values
    (p_organization_id, v_branch_id, 'BARQ', 'Barq', 'immediate', 10),
    (p_organization_id, v_branch_id, 'NEOLEAP', 'Neoleap', 'validation_gated', 20),
    (p_organization_id, v_branch_id, 'URPAY', 'Urpay', 'validation_gated', 30),
    (p_organization_id, v_branch_id, 'AL_MAWARID', 'Al Mawarid', 'validation_gated', 40),
    (p_organization_id, v_branch_id, 'ELM', 'ELM', 'validation_gated', 50)
  on conflict (organization_id, code) do nothing;

  insert into public.mailroom_activities (organization_id, branch_id, code, name, units_per_labor_hour, sort_order)
  values
    (p_organization_id, v_branch_id, 'CUT_VALIDATE', 'Barq + NB AWB Cutting & Validation', 600, 10),
    (p_organization_id, v_branch_id, 'RECEIVE_SCAN', 'Barq + NB Receiving & Bulk AWB Scan', 2000, 20),
    (p_organization_id, v_branch_id, 'PUTAWAY', 'Receiving & Putaway', 2000, 30),
    (p_organization_id, v_branch_id, 'BANK_PICK', 'Al Mawarid + Neoleap + Urpay Picking', 400, 40),
    (p_organization_id, v_branch_id, 'PROCESS', 'Process', 400, 50),
    (p_organization_id, v_branch_id, 'ROUTE_SORT', 'Route Wise Sorting', 300, 60),
    (p_organization_id, v_branch_id, 'PACK', 'Packing for Banking Shipments', 300, 70),
    (p_organization_id, v_branch_id, 'HANDOVER', 'Handover Scanning Process', 2200, 80),
    (p_organization_id, v_branch_id, 'DSP_CREATE', 'Scanning Process & DSP Creation', 2200, 90),
    (p_organization_id, v_branch_id, 'DSP_AWB', 'DSP AWB Pasting', 1000, 100),
    (p_organization_id, v_branch_id, 'DSP_PREALERT', 'DSP Pre Alert Scanning', 2200, 110),
    (p_organization_id, v_branch_id, 'TICKET_DISPATCH', 'Ticket Shipments Picking & Dispatch', 15, 120),
    (p_organization_id, v_branch_id, 'RETURNS', 'Return Segregation, Receiving & Putaway', 300, 130),
    (p_organization_id, v_branch_id, 'LH_SEGREGATION', 'LH Segregation', 700, 140),
    (p_organization_id, v_branch_id, 'ELM_RELABEL', 'ELM Relabeling', 250, 150)
  on conflict (organization_id, code) do nothing;

  insert into public.mailroom_client_activities (organization_id, branch_id, client_id, activity_id, volume_driver)
  select p_organization_id, v_branch_id, c.id, a.id, m.driver
  from (values
    ('BARQ','CUT_VALIDATE','received'), ('BARQ','RECEIVE_SCAN','received'),
    ('BARQ','PACK','processed'), ('BARQ','HANDOVER','processed'),
    ('BARQ','DSP_CREATE','processed'), ('BARQ','DSP_AWB','processed'), ('BARQ','DSP_PREALERT','processed'),
    ('NEOLEAP','PUTAWAY','received'), ('NEOLEAP','BANK_PICK','processed'), ('NEOLEAP','PROCESS','processed'), ('NEOLEAP','ROUTE_SORT','processed'), ('NEOLEAP','PACK','processed'), ('NEOLEAP','HANDOVER','processed'),
    ('URPAY','PUTAWAY','received'), ('URPAY','BANK_PICK','processed'), ('URPAY','PROCESS','processed'), ('URPAY','ROUTE_SORT','processed'), ('URPAY','PACK','processed'), ('URPAY','HANDOVER','processed'),
    ('AL_MAWARID','PUTAWAY','received'), ('AL_MAWARID','BANK_PICK','processed'), ('AL_MAWARID','PROCESS','processed'), ('AL_MAWARID','ROUTE_SORT','processed'), ('AL_MAWARID','PACK','processed'), ('AL_MAWARID','HANDOVER','processed'),
    ('ELM','PUTAWAY','received'), ('ELM','PACK','processed'), ('ELM','HANDOVER','processed'), ('ELM','ELM_RELABEL','processed')
  ) as m(client_code, activity_code, driver)
  join public.mailroom_clients c on c.organization_id = p_organization_id and c.code = m.client_code
  join public.mailroom_activities a on a.organization_id = p_organization_id and a.code = m.activity_code
  on conflict (client_id, activity_id) do nothing;

  get diagnostics v_activities = row_count;

  insert into public.mailroom_employee_settings (
    organization_id, branch_id, employee_id, labor_class, employment_source, overtime_eligible
  )
  select p_organization_id, v_branch_id, e.id,
    case when coalesce(e.job_title, '') ~* 'labou?r|worker|operation assistant' then 'dlp' else 'non_dlp' end,
    case when coalesce(e.employee_code, '') ~* '^3PL' then '3pl' else 'own' end,
    coalesce(e.job_title, '') ~* 'labou?r|worker|operation assistant'
  from public.employee_profiles e
  where e.organization_id = p_organization_id
    and e.branch_id = v_branch_id
    and e.department_id = v_department_id
    and e.employment_status::text = 'active'
  on conflict (employee_id) do nothing;

  select count(*) into v_clients from public.mailroom_clients where organization_id = p_organization_id;
  return jsonb_build_object('branch_id', v_branch_id, 'department_id', v_department_id, 'clients', v_clients, 'mappings_added', v_activities);
end;
$$;

revoke all on function public.initialize_mailroom_productivity(uuid) from public, anon;
grant execute on function public.initialize_mailroom_productivity(uuid) to authenticated;
