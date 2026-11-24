-- FC Productivity parity: planning policy settings, employee labor classification & OT rates,
-- FC client/seller onboarding & rate overrides, and daily draft/finalized status.

alter table public.fc_daily_manpower_productivity
  add column if not exists status text not null default 'finalized'
  check (status in ('draft', 'finalized'));

create table if not exists public.fc_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  department_id uuid not null,
  standard_hours_per_day numeric(5,2) not null default 8 check (standard_hours_per_day > 0 and standard_hours_per_day <= 24),
  planned_absence_percent numeric(5,2) not null default 5 check (planned_absence_percent >= 0 and planned_absence_percent < 100),
  max_overtime_hours_per_day numeric(5,2) not null default 3 check (max_overtime_hours_per_day >= 0 and max_overtime_hours_per_day <= 12),
  overtime_hourly_cost_own numeric(10,2) not null default 0 check (overtime_hourly_cost_own >= 0),
  overtime_hourly_cost_3pl numeric(10,2) not null default 0 check (overtime_hourly_cost_3pl >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, department_id),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id),
  foreign key (organization_id, department_id) references public.departments(organization_id, id)
);

create table if not exists public.fc_employee_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  department_id uuid not null,
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  labor_class text not null default 'dlp' check (labor_class in ('dlp', 'non_dlp')),
  employment_source text not null default 'own' check (employment_source in ('own', '3pl')),
  overtime_eligible boolean not null default true,
  overtime_hourly_cost numeric(10,2) check (overtime_hourly_cost is null or overtime_hourly_cost >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, department_id, employee_id),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id),
  foreign key (organization_id, department_id) references public.departments(organization_id, id)
);

create table if not exists public.fc_clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  department_id uuid not null,
  code text not null,
  name text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  inbound_rate_override numeric(12,4) check (inbound_rate_override is null or inbound_rate_override > 0),
  outbound_b2c_rate_override numeric(12,4) check (outbound_b2c_rate_override is null or outbound_b2c_rate_override > 0),
  outbound_b2b_rate_override numeric(12,4) check (outbound_b2b_rate_override is null or outbound_b2b_rate_override > 0),
  returns_rate_override numeric(12,4) check (returns_rate_override is null or returns_rate_override > 0),
  vas_rate_override numeric(12,4) check (vas_rate_override is null or vas_rate_override > 0),
  notes text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, department_id, code),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id),
  foreign key (organization_id, department_id) references public.departments(organization_id, id)
);

create trigger set_updated_at before update on public.fc_settings for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.fc_employee_settings for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.fc_clients for each row execute function private.set_updated_at();

do $$
declare v_table text;
begin
  foreach v_table in array array['fc_settings', 'fc_employee_settings', 'fc_clients'] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute format('grant select on table public.%I to authenticated', v_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.can_access_fc(organization_id, branch_id, department_id, false)))',
      v_table || '_select', v_table
    );
  end loop;
end $$;

create or replace function public.save_fc_manpower_day(p_organization_id uuid, p_work_date date, p_data jsonb)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_branch_id uuid; v_department_id uuid; v_id uuid; v_status text;
begin
  select d.branch_id, d.id into v_branch_id, v_department_id from public.departments d
  where d.organization_id=p_organization_id and d.status::text='active'
    and (upper(btrim(d.name))='FC' or upper(btrim(d.code))='FC') order by d.created_at limit 1;
  if v_department_id is null or not private.can_access_fc(p_organization_id, v_branch_id, v_department_id, false) then
    raise exception 'FC department access is required' using errcode='42501';
  end if;
  v_status := coalesce(nullif(btrim(p_data->>'status'), ''), 'finalized');
  if v_status not in ('draft', 'finalized') then
    raise exception 'Invalid FC daily entry status' using errcode='22023';
  end if;
  insert into public.fc_daily_manpower_productivity(
    organization_id,branch_id,department_id,work_date,status,available_hours,inbound_quantity,return_rto_quantity,return_cir_quantity,
    outbound_b2c_quantity,outbound_b2b_quantity,vas_quantity,gift_wrap_quantity,other_activity_name,other_activity_quantity,
    b2c_orders,b2b_orders,closing_storage_quantity,actual_own_dlp,actual_contract_dlp,cycle_count_staff,supervisor_staff,
    assistant_manager_staff,manager_staff,security_staff,security_supervisor_staff,housekeeping_staff,other_staff,notes,source_file_name,entered_by
  ) values (
    p_organization_id,v_branch_id,v_department_id,p_work_date,v_status,coalesce((p_data->>'available_hours')::numeric,8),
    coalesce((p_data->>'inbound_quantity')::bigint,0),coalesce((p_data->>'return_rto_quantity')::bigint,0),coalesce((p_data->>'return_cir_quantity')::bigint,0),
    coalesce((p_data->>'outbound_b2c_quantity')::bigint,0),coalesce((p_data->>'outbound_b2b_quantity')::bigint,0),coalesce((p_data->>'vas_quantity')::bigint,0),
    coalesce((p_data->>'gift_wrap_quantity')::bigint,0),nullif(left(btrim(p_data->>'other_activity_name'),200),''),coalesce((p_data->>'other_activity_quantity')::bigint,0),
    coalesce((p_data->>'b2c_orders')::bigint,0),coalesce((p_data->>'b2b_orders')::bigint,0),coalesce((p_data->>'closing_storage_quantity')::bigint,0),
    coalesce((p_data->>'actual_own_dlp')::numeric,0),coalesce((p_data->>'actual_contract_dlp')::numeric,0),coalesce((p_data->>'cycle_count_staff')::numeric,0),
    coalesce((p_data->>'supervisor_staff')::numeric,0),coalesce((p_data->>'assistant_manager_staff')::numeric,0),coalesce((p_data->>'manager_staff')::numeric,0),
    coalesce((p_data->>'security_staff')::numeric,0),coalesce((p_data->>'security_supervisor_staff')::numeric,0),coalesce((p_data->>'housekeeping_staff')::numeric,0),
    coalesce((p_data->>'other_staff')::numeric,0),nullif(left(p_data->>'notes',2000),''),nullif(left(p_data->>'source_file_name',255),''),(select auth.uid())
  ) on conflict(organization_id,department_id,work_date) do update set
    status=excluded.status,available_hours=excluded.available_hours,inbound_quantity=excluded.inbound_quantity,return_rto_quantity=excluded.return_rto_quantity,
    return_cir_quantity=excluded.return_cir_quantity,outbound_b2c_quantity=excluded.outbound_b2c_quantity,outbound_b2b_quantity=excluded.outbound_b2b_quantity,
    vas_quantity=excluded.vas_quantity,gift_wrap_quantity=excluded.gift_wrap_quantity,other_activity_name=excluded.other_activity_name,
    other_activity_quantity=excluded.other_activity_quantity,b2c_orders=excluded.b2c_orders,b2b_orders=excluded.b2b_orders,
    closing_storage_quantity=excluded.closing_storage_quantity,actual_own_dlp=excluded.actual_own_dlp,actual_contract_dlp=excluded.actual_contract_dlp,
    cycle_count_staff=excluded.cycle_count_staff,supervisor_staff=excluded.supervisor_staff,assistant_manager_staff=excluded.assistant_manager_staff,
    manager_staff=excluded.manager_staff,security_staff=excluded.security_staff,security_supervisor_staff=excluded.security_supervisor_staff,
    housekeeping_staff=excluded.housekeeping_staff,other_staff=excluded.other_staff,notes=excluded.notes,source_file_name=excluded.source_file_name,entered_by=excluded.entered_by
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.initialize_fc_workspace_settings(p_organization_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v_branch_id uuid; v_department_id uuid;
begin
  select d.branch_id, d.id into v_branch_id, v_department_id from public.departments d
  where d.organization_id=p_organization_id and d.status::text='active'
    and (upper(btrim(d.name))='FC' or upper(btrim(d.code))='FC') order by d.created_at limit 1;
  if v_department_id is null or not private.can_access_fc(p_organization_id, v_branch_id, v_department_id, false) then
    raise exception 'FC department access is required' using errcode='42501';
  end if;

  insert into public.fc_settings(organization_id, branch_id, department_id)
  values (p_organization_id, v_branch_id, v_department_id)
  on conflict (organization_id, department_id) do nothing;

  insert into public.fc_employee_settings(organization_id, branch_id, department_id, employee_id, labor_class, employment_source, overtime_eligible)
  select
    p_organization_id,
    v_branch_id,
    v_department_id,
    e.id,
    case
      when coalesce(e.job_title, '') ~* 'manager|supervisor|security|housekeep|administrat|coordinator|team lead' then 'non_dlp'
      else 'dlp'
    end,
    case
      when e.employee_code ~* '^3PL[-_ ]?' or coalesce(e.job_title, '') ~* '3PL|contract' then '3pl'
      else 'own'
    end,
    not (coalesce(e.job_title, '') ~* 'manager|supervisor|security|housekeep|administrat|coordinator|team lead')
  from public.employee_profiles e
  where e.organization_id = p_organization_id
    and e.department_id = v_department_id
    and e.employment_status = 'active'
  on conflict (organization_id, department_id, employee_id) do nothing;
end; $$;

create or replace function public.save_fc_settings(p_organization_id uuid, p_updates jsonb)
returns void language plpgsql security definer set search_path=''
as $$
declare v_branch_id uuid; v_department_id uuid;
begin
  select d.branch_id, d.id into v_branch_id, v_department_id from public.departments d
  where d.organization_id=p_organization_id and d.status::text='active'
    and (upper(btrim(d.name))='FC' or upper(btrim(d.code))='FC') order by d.created_at limit 1;
  if v_department_id is null or not private.can_access_fc(p_organization_id, v_branch_id, v_department_id, true) then
    raise exception 'Administrator access to FC is required' using errcode='42501';
  end if;

  insert into public.fc_settings(organization_id, branch_id, department_id)
  values (p_organization_id, v_branch_id, v_department_id)
  on conflict (organization_id, department_id) do nothing;

  update public.fc_settings set
    standard_hours_per_day = coalesce((p_updates->>'standard_hours_per_day')::numeric, standard_hours_per_day),
    planned_absence_percent = coalesce((p_updates->>'planned_absence_percent')::numeric, planned_absence_percent),
    max_overtime_hours_per_day = coalesce((p_updates->>'max_overtime_hours_per_day')::numeric, max_overtime_hours_per_day),
    overtime_hourly_cost_own = coalesce((p_updates->>'overtime_hourly_cost_own')::numeric, overtime_hourly_cost_own),
    overtime_hourly_cost_3pl = coalesce((p_updates->>'overtime_hourly_cost_3pl')::numeric, overtime_hourly_cost_3pl)
  where organization_id = p_organization_id and department_id = v_department_id;
end; $$;

create or replace function public.save_fc_employee_setting(p_organization_id uuid, p_employee_id uuid, p_updates jsonb)
returns void language plpgsql security definer set search_path=''
as $$
declare v_branch_id uuid; v_department_id uuid;
begin
  select d.branch_id, d.id into v_branch_id, v_department_id from public.departments d
  where d.organization_id=p_organization_id and d.status::text='active'
    and (upper(btrim(d.name))='FC' or upper(btrim(d.code))='FC') order by d.created_at limit 1;
  if v_department_id is null or not private.can_access_fc(p_organization_id, v_branch_id, v_department_id, true) then
    raise exception 'Administrator access to FC is required' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.employee_profiles e
    where e.id = p_employee_id
      and e.organization_id = p_organization_id
      and e.department_id = v_department_id
      and e.employment_status = 'active'
  ) then
    raise exception 'Employee must be active in the same FC department' using errcode='22023';
  end if;

  insert into public.fc_employee_settings(organization_id, branch_id, department_id, employee_id)
  values (p_organization_id, v_branch_id, v_department_id, p_employee_id)
  on conflict (organization_id, department_id, employee_id) do nothing;

  update public.fc_employee_settings set
    labor_class = coalesce(nullif(p_updates->>'labor_class', ''), labor_class),
    employment_source = coalesce(nullif(p_updates->>'employment_source', ''), employment_source),
    overtime_eligible = coalesce((p_updates->>'overtime_eligible')::boolean, overtime_eligible),
    overtime_hourly_cost = case
      when p_updates ? 'overtime_hourly_cost' then (p_updates->>'overtime_hourly_cost')::numeric
      else overtime_hourly_cost
    end
  where organization_id = p_organization_id and department_id = v_department_id and employee_id = p_employee_id;
end; $$;

create or replace function public.create_fc_client(
  p_organization_id uuid,
  p_code text,
  p_name text,
  p_template_client_id uuid default null,
  p_overrides jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path=''
as $$
declare
  v_branch_id uuid; v_department_id uuid; v_id uuid;
  v_tpl public.fc_clients%rowtype;
begin
  select d.branch_id, d.id into v_branch_id, v_department_id from public.departments d
  where d.organization_id=p_organization_id and d.status::text='active'
    and (upper(btrim(d.name))='FC' or upper(btrim(d.code))='FC') order by d.created_at limit 1;
  if v_department_id is null or not private.can_access_fc(p_organization_id, v_branch_id, v_department_id, true) then
    raise exception 'Administrator access to FC is required' using errcode='42501';
  end if;
  if btrim(coalesce(p_code, '')) = '' or btrim(coalesce(p_name, '')) = '' then
    raise exception 'Client name and code are required' using errcode='22023';
  end if;
  if p_template_client_id is not null then
    select * into v_tpl from public.fc_clients
    where id = p_template_client_id
      and organization_id = p_organization_id
      and department_id = v_department_id;
    if v_tpl.id is null then
      raise exception 'FC client template must belong to the same department' using errcode='22023';
    end if;
  end if;
  insert into public.fc_clients(
    organization_id, branch_id, department_id, code, name,
    inbound_rate_override, outbound_b2c_rate_override, outbound_b2b_rate_override, returns_rate_override, vas_rate_override, notes
  ) values (
    p_organization_id, v_branch_id, v_department_id, upper(btrim(p_code)), btrim(p_name),
    coalesce((p_overrides->>'inbound_rate_override')::numeric, v_tpl.inbound_rate_override),
    coalesce((p_overrides->>'outbound_b2c_rate_override')::numeric, v_tpl.outbound_b2c_rate_override),
    coalesce((p_overrides->>'outbound_b2b_rate_override')::numeric, v_tpl.outbound_b2b_rate_override),
    coalesce((p_overrides->>'returns_rate_override')::numeric, v_tpl.returns_rate_override),
    coalesce((p_overrides->>'vas_rate_override')::numeric, v_tpl.vas_rate_override),
    nullif(btrim(p_overrides->>'notes'), '')
  ) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.update_fc_client(p_organization_id uuid, p_client_id uuid, p_updates jsonb)
returns void language plpgsql security definer set search_path=''
as $$
declare v_row public.fc_clients%rowtype;
begin
  select * into v_row from public.fc_clients where id = p_client_id and organization_id = p_organization_id;
  if v_row.id is null or not private.can_access_fc(p_organization_id, v_row.branch_id, v_row.department_id, true) then
    raise exception 'Administrator access to FC is required' using errcode='42501';
  end if;
  update public.fc_clients set
    name = coalesce(nullif(btrim(p_updates->>'name'), ''), name),
    status = coalesce(nullif(btrim(p_updates->>'status'), ''), status),
    inbound_rate_override = case when p_updates ? 'inbound_rate_override' then (p_updates->>'inbound_rate_override')::numeric else inbound_rate_override end,
    outbound_b2c_rate_override = case when p_updates ? 'outbound_b2c_rate_override' then (p_updates->>'outbound_b2c_rate_override')::numeric else outbound_b2c_rate_override end,
    outbound_b2b_rate_override = case when p_updates ? 'outbound_b2b_rate_override' then (p_updates->>'outbound_b2b_rate_override')::numeric else outbound_b2b_rate_override end,
    returns_rate_override = case when p_updates ? 'returns_rate_override' then (p_updates->>'returns_rate_override')::numeric else returns_rate_override end,
    vas_rate_override = case when p_updates ? 'vas_rate_override' then (p_updates->>'vas_rate_override')::numeric else vas_rate_override end,
    notes = case when p_updates ? 'notes' then nullif(btrim(p_updates->>'notes'), '') else notes end
  where id = p_client_id;
end; $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.initialize_fc_workspace_settings(uuid)',
    'public.save_fc_settings(uuid,jsonb)',
    'public.save_fc_employee_setting(uuid,uuid,jsonb)',
    'public.create_fc_client(uuid,text,text,uuid,jsonb)',
    'public.update_fc_client(uuid,uuid,jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;
