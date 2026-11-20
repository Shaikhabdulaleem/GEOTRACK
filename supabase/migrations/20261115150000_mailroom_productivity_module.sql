-- Mailroom shipment productivity planning.
-- This module is deliberately bound to the active Mailroom department.

create table public.mailroom_productivity_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  standard_hours_per_day numeric(4,2) not null default 8 check (standard_hours_per_day > 0 and standard_hours_per_day <= 24),
  planned_absence_percent numeric(5,2) not null default 5 check (planned_absence_percent between 0 and 100),
  max_overtime_hours_per_day numeric(4,2) not null default 2 check (max_overtime_hours_per_day >= 0 and max_overtime_hours_per_day <= 12),
  week_starts_on smallint not null default 0 check (week_starts_on = 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id),
  unique (organization_id, branch_id),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id)
);

create table public.mailroom_clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  code text not null,
  name text not null,
  processing_mode text not null check (processing_mode in ('immediate', 'validation_gated')),
  opening_awaiting_validation bigint not null default 0 check (opening_awaiting_validation >= 0),
  opening_ready_to_process bigint not null default 0 check (opening_ready_to_process >= 0),
  status public.record_status not null default 'active',
  sort_order integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, code),
  unique (organization_id, id),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id)
);

create table public.mailroom_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  code text not null,
  name text not null,
  units_per_labor_hour numeric(14,2) not null check (units_per_labor_hour > 0),
  status public.record_status not null default 'active',
  sort_order integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, code),
  unique (organization_id, id),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id)
);

create table public.mailroom_client_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  client_id uuid not null,
  activity_id uuid not null,
  volume_driver text not null check (volume_driver in ('received', 'validated', 'processed')),
  workload_multiplier numeric(7,4) not null default 1 check (workload_multiplier >= 0 and workload_multiplier <= 100),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (client_id, activity_id),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id),
  foreign key (organization_id, client_id) references public.mailroom_clients(organization_id, id) on delete cascade,
  foreign key (organization_id, activity_id) references public.mailroom_activities(organization_id, id) on delete cascade
);

create table public.mailroom_daily_shipments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  client_id uuid not null,
  work_date date not null,
  received_units bigint not null default 0 check (received_units >= 0),
  validated_units bigint not null default 0 check (validated_units >= 0),
  processed_units bigint not null default 0 check (processed_units >= 0),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (client_id, work_date),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id),
  foreign key (organization_id, client_id) references public.mailroom_clients(organization_id, id) on delete cascade
);

create table public.mailroom_employee_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  employee_id uuid not null,
  labor_class text not null default 'dlp' check (labor_class in ('dlp', 'non_dlp')),
  employment_source text not null default '3pl' check (employment_source in ('own', '3pl')),
  overtime_eligible boolean not null default true,
  max_overtime_hours_override numeric(4,2) check (max_overtime_hours_override is null or max_overtime_hours_override between 0 and 12),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (employee_id),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id),
  foreign key (organization_id, employee_id) references public.employee_profiles(organization_id, id) on delete cascade
);

create index mailroom_clients_org_branch_status_idx on public.mailroom_clients (organization_id, branch_id, status);
create index mailroom_activities_org_branch_status_idx on public.mailroom_activities (organization_id, branch_id, status);
create index mailroom_client_activities_org_client_idx on public.mailroom_client_activities (organization_id, client_id);
create index mailroom_client_activities_activity_idx on public.mailroom_client_activities (activity_id);
create index mailroom_client_activities_org_activity_idx on public.mailroom_client_activities (organization_id, activity_id);
create index mailroom_client_activities_org_branch_idx on public.mailroom_client_activities (organization_id, branch_id);
create index mailroom_daily_shipments_org_branch_date_idx on public.mailroom_daily_shipments (organization_id, branch_id, work_date);
create index mailroom_daily_shipments_client_date_idx on public.mailroom_daily_shipments (client_id, work_date);
create index mailroom_daily_shipments_org_client_idx on public.mailroom_daily_shipments (organization_id, client_id);
create index mailroom_daily_shipments_created_by_idx on public.mailroom_daily_shipments (created_by);
create index mailroom_daily_shipments_updated_by_idx on public.mailroom_daily_shipments (updated_by);
create index mailroom_employee_settings_org_branch_idx on public.mailroom_employee_settings (organization_id, branch_id);
create index mailroom_employee_settings_org_employee_idx on public.mailroom_employee_settings (organization_id, employee_id);

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'mailroom_productivity_settings', 'mailroom_clients', 'mailroom_activities',
    'mailroom_client_activities', 'mailroom_daily_shipments', 'mailroom_employee_settings'
  ] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()', v_table);
  end loop;
end $$;

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

revoke all on function private.can_access_mailroom(uuid, uuid, boolean) from public, anon;
grant execute on function private.can_access_mailroom(uuid, uuid, boolean) to authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'mailroom_productivity_settings', 'mailroom_clients', 'mailroom_activities',
    'mailroom_client_activities', 'mailroom_daily_shipments', 'mailroom_employee_settings'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute format('grant select on table public.%I to authenticated', v_table);
    execute format('create policy %I on public.%I for select to authenticated using ((select private.can_access_mailroom(organization_id, branch_id, false)))', v_table || '_select', v_table);
  end loop;
end $$;

grant insert, update, delete on table
  public.mailroom_productivity_settings, public.mailroom_clients,
  public.mailroom_activities, public.mailroom_client_activities,
  public.mailroom_employee_settings to authenticated;

create policy mailroom_settings_admin_insert on public.mailroom_productivity_settings for insert to authenticated
  with check ((select private.can_access_mailroom(organization_id, branch_id, true)));
create policy mailroom_settings_admin_update on public.mailroom_productivity_settings for update to authenticated
  using ((select private.can_access_mailroom(organization_id, branch_id, true)))
  with check ((select private.can_access_mailroom(organization_id, branch_id, true)));
create policy mailroom_settings_admin_delete on public.mailroom_productivity_settings for delete to authenticated
  using ((select private.can_access_mailroom(organization_id, branch_id, true)));

do $$
declare
  v_table text;
begin
  foreach v_table in array array['mailroom_clients', 'mailroom_activities', 'mailroom_client_activities', 'mailroom_employee_settings'] loop
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.can_access_mailroom(organization_id, branch_id, true)))', v_table || '_admin_insert', v_table);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.can_access_mailroom(organization_id, branch_id, true))) with check ((select private.can_access_mailroom(organization_id, branch_id, true)))', v_table || '_admin_update', v_table);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.can_access_mailroom(organization_id, branch_id, true)))', v_table || '_admin_delete', v_table);
  end loop;
end $$;

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
    raise exception 'An active Mailroom branch and administrator access are required' using errcode = '42501';
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
  return jsonb_build_object('branch_id', v_branch_id, 'clients', v_clients, 'mappings_added', v_activities);
end;
$$;

create or replace function public.save_mailroom_productivity_week(
  p_organization_id uuid,
  p_week_start date,
  p_rows jsonb
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch_id uuid;
  v_saved integer := 0;
begin
  if extract(dow from p_week_start) <> 0 then
    raise exception 'Week start must be Sunday' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'Rows must be an array containing at most 500 entries' using errcode = '22023';
  end if;

  select s.branch_id into v_branch_id from public.mailroom_productivity_settings s where s.organization_id = p_organization_id;
  if v_branch_id is null or not private.can_access_mailroom(p_organization_id, v_branch_id, false) then
    raise exception 'Mailroom access is required' using errcode = '42501';
  end if;

  with incoming as (
    select x.client_id, x.work_date, x.received_units, x.validated_units, x.processed_units, nullif(btrim(x.notes), '') as notes
    from jsonb_to_recordset(p_rows) as x(client_id uuid, work_date date, received_units bigint, validated_units bigint, processed_units bigint, notes text)
  ), checked as (
    select i.*, c.processing_mode
    from incoming i
    join public.mailroom_clients c on c.id = i.client_id and c.organization_id = p_organization_id and c.branch_id = v_branch_id and c.status::text = 'active'
    where i.work_date between p_week_start and p_week_start + 6
      and i.received_units >= 0 and i.validated_units >= 0 and i.processed_units >= 0
  ), upserted as (
    insert into public.mailroom_daily_shipments (
      organization_id, branch_id, client_id, work_date, received_units, validated_units, processed_units,
      notes, created_by, updated_by
    )
    select p_organization_id, v_branch_id, client_id, work_date, received_units,
      case when processing_mode = 'immediate' then received_units else validated_units end,
      processed_units, notes, (select auth.uid()), (select auth.uid())
    from checked
    on conflict (client_id, work_date) do update set
      received_units = excluded.received_units,
      validated_units = excluded.validated_units,
      processed_units = excluded.processed_units,
      notes = excluded.notes,
      updated_by = excluded.updated_by
    returning 1
  ) select count(*) into v_saved from upserted;

  if v_saved <> jsonb_array_length(p_rows) then
    raise exception 'One or more rows are invalid, outside the selected week, or not part of Mailroom' using errcode = '22023';
  end if;

  if exists (
    with balances as (
      select c.id,
        c.opening_awaiting_validation + sum(d.received_units - d.validated_units) over (partition by c.id order by d.work_date, d.id) as awaiting,
        c.opening_ready_to_process + sum(d.validated_units - d.processed_units) over (partition by c.id order by d.work_date, d.id) as ready
      from public.mailroom_clients c
      join public.mailroom_daily_shipments d on d.client_id = c.id
      where c.organization_id = p_organization_id
    ) select 1 from balances where awaiting < 0 or ready < 0
  ) then
    raise exception 'The entry would make a client backlog negative' using errcode = '23514';
  end if;

  return v_saved;
end;
$$;

revoke all on function public.initialize_mailroom_productivity(uuid) from public, anon;
revoke all on function public.save_mailroom_productivity_week(uuid, date, jsonb) from public, anon;
grant execute on function public.initialize_mailroom_productivity(uuid) to authenticated;
grant execute on function public.save_mailroom_productivity_week(uuid, date, jsonb) to authenticated;

comment on table public.mailroom_daily_shipments is 'Daily Mailroom client receipts, validations, and processed/handover quantities.';
comment on function public.save_mailroom_productivity_week(uuid, date, jsonb) is 'Atomically saves one Sunday-Saturday Mailroom grid and rejects negative cumulative backlog.';
