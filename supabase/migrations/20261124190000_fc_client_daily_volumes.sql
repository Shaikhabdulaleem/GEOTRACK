-- Client-wise daily FC operational volume breakdown (aggregate-only, no PII).

create table if not exists public.fc_daily_client_volumes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  department_id uuid not null,
  work_date date not null,
  client_name text not null,
  inbound_quantity bigint not null default 0 check (inbound_quantity >= 0),
  outbound_b2c_quantity bigint not null default 0 check (outbound_b2c_quantity >= 0),
  outbound_b2b_quantity bigint not null default 0 check (outbound_b2b_quantity >= 0),
  returns_quantity bigint not null default 0 check (returns_quantity >= 0),
  vas_quantity bigint not null default 0 check (vas_quantity >= 0),
  b2c_orders bigint not null default 0 check (b2c_orders >= 0),
  b2b_orders bigint not null default 0 check (b2b_orders >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, department_id, work_date, client_name),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id),
  foreign key (organization_id, department_id) references public.departments(organization_id, id)
);

create index if not exists fc_daily_client_volumes_org_date_idx
  on public.fc_daily_client_volumes (organization_id, department_id, work_date desc);

create trigger set_updated_at before update on public.fc_daily_client_volumes
  for each row execute function private.set_updated_at();

alter table public.fc_daily_client_volumes enable row level security;
revoke all on table public.fc_daily_client_volumes from public, anon, authenticated;
grant select on table public.fc_daily_client_volumes to authenticated;

create policy fc_daily_client_volumes_select on public.fc_daily_client_volumes
  for select to authenticated
  using ((select private.can_access_fc(organization_id, branch_id, department_id, false)));

create or replace function public.save_fc_client_daily_volumes(
  p_organization_id uuid,
  p_sources jsonb,
  p_from_date date,
  p_to_date date,
  p_rows jsonb
)
returns integer language plpgsql security definer set search_path=''
as $$
declare
  v_branch_id uuid;
  v_department_id uuid;
  v_row jsonb;
  v_work_date date;
  v_count integer := 0;
  v_has_orders boolean;
  v_has_vas boolean;
  v_has_grn boolean;
begin
  select d.branch_id, d.id into v_branch_id, v_department_id from public.departments d
  where d.organization_id=p_organization_id and d.status::text='active'
    and (upper(btrim(d.name))='FC' or upper(btrim(d.code))='FC') order by d.created_at limit 1;
  if v_department_id is null or not private.can_access_fc(p_organization_id, v_branch_id, v_department_id, false) then
    raise exception 'FC department access is required' using errcode='42501';
  end if;
  if jsonb_typeof(p_sources) <> 'array' or jsonb_array_length(p_sources) = 0 or exists (
    select 1 from jsonb_array_elements_text(p_sources) source
    where source not in ('orders', 'vas', 'grn_returns')
  ) then
    raise exception 'Valid FC operational sources are required' using errcode='22023';
  end if;
  if p_from_date is null or p_to_date is null or p_to_date < p_from_date or p_to_date - p_from_date > 365 then
    raise exception 'FC client volume period must contain between 1 and 366 days' using errcode='22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Client daily volumes payload must be an array of up to 5000 rows' using errcode='22023';
  end if;

  v_has_orders := p_sources ? 'orders';
  v_has_vas := p_sources ? 'vas';
  v_has_grn := p_sources ? 'grn_returns';

  -- Replace only the submitted source metrics for the complete selected period.
  -- This removes clients/dates that disappeared from a corrected export while
  -- preserving metrics belonging to source files that were not uploaded.
  update public.fc_daily_client_volumes set
    outbound_b2c_quantity = case when v_has_orders then 0 else outbound_b2c_quantity end,
    outbound_b2b_quantity = case when v_has_orders then 0 else outbound_b2b_quantity end,
    b2c_orders = case when v_has_orders then 0 else b2c_orders end,
    b2b_orders = case when v_has_orders then 0 else b2b_orders end,
    vas_quantity = case when v_has_vas then 0 else vas_quantity end,
    inbound_quantity = case when v_has_grn then 0 else inbound_quantity end,
    returns_quantity = case when v_has_grn then 0 else returns_quantity end
  where organization_id = p_organization_id
    and department_id = v_department_id
    and work_date between p_from_date and p_to_date;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_work_date := nullif(v_row->>'work_date', '')::date;
    if v_work_date is null or v_work_date < p_from_date or v_work_date > p_to_date then
      raise exception 'Each FC client volume row requires a work_date inside the selected period' using errcode='22023';
    end if;
    if coalesce((v_row->>'inbound_quantity')::numeric, 0) < 0
      or coalesce((v_row->>'outbound_b2c_quantity')::numeric, 0) < 0
      or coalesce((v_row->>'outbound_b2b_quantity')::numeric, 0) < 0
      or coalesce((v_row->>'returns_quantity')::numeric, 0) < 0
      or coalesce((v_row->>'vas_quantity')::numeric, 0) < 0
      or coalesce((v_row->>'b2c_orders')::numeric, 0) < 0
      or coalesce((v_row->>'b2b_orders')::numeric, 0) < 0 then
      raise exception 'FC client volume quantities cannot be negative' using errcode='22023';
    end if;
    insert into public.fc_daily_client_volumes(
      organization_id, branch_id, department_id, work_date, client_name,
      inbound_quantity, outbound_b2c_quantity, outbound_b2b_quantity, returns_quantity, vas_quantity, b2c_orders, b2b_orders
    ) values (
      p_organization_id, v_branch_id, v_department_id,
      v_work_date,
      coalesce(nullif(left(btrim(v_row->>'client_name'), 120), ''), 'Unspecified'),
      coalesce((v_row->>'inbound_quantity')::bigint, 0),
      coalesce((v_row->>'outbound_b2c_quantity')::bigint, 0),
      coalesce((v_row->>'outbound_b2b_quantity')::bigint, 0),
      coalesce((v_row->>'returns_quantity')::bigint, 0),
      coalesce((v_row->>'vas_quantity')::bigint, 0),
      coalesce((v_row->>'b2c_orders')::bigint, 0),
      coalesce((v_row->>'b2b_orders')::bigint, 0)
    ) on conflict (organization_id, department_id, work_date, client_name) do update set
      inbound_quantity = case when v_has_grn then excluded.inbound_quantity else public.fc_daily_client_volumes.inbound_quantity end,
      returns_quantity = case when v_has_grn then excluded.returns_quantity else public.fc_daily_client_volumes.returns_quantity end,
      outbound_b2c_quantity = case when v_has_orders then excluded.outbound_b2c_quantity else public.fc_daily_client_volumes.outbound_b2c_quantity end,
      outbound_b2b_quantity = case when v_has_orders then excluded.outbound_b2b_quantity else public.fc_daily_client_volumes.outbound_b2b_quantity end,
      b2c_orders = case when v_has_orders then excluded.b2c_orders else public.fc_daily_client_volumes.b2c_orders end,
      b2b_orders = case when v_has_orders then excluded.b2b_orders else public.fc_daily_client_volumes.b2b_orders end,
      vas_quantity = case when v_has_vas then excluded.vas_quantity else public.fc_daily_client_volumes.vas_quantity end;
    v_count := v_count + 1;
  end loop;

  delete from public.fc_daily_client_volumes
  where organization_id = p_organization_id
    and department_id = v_department_id
    and work_date between p_from_date and p_to_date
    and inbound_quantity = 0
    and outbound_b2c_quantity = 0
    and outbound_b2b_quantity = 0
    and returns_quantity = 0
    and vas_quantity = 0
    and b2c_orders = 0
    and b2b_orders = 0;

  return v_count;
end; $$;

create or replace function public.import_fc_operational_workspace(
  p_organization_id uuid,
  p_source_file_names text,
  p_sources jsonb,
  p_from_date date,
  p_to_date date,
  p_rows jsonb,
  p_client_rows jsonb
) returns integer language plpgsql security definer set search_path=''
as $$
declare
  v_count integer;
  v_branch_id uuid;
  v_department_id uuid;
  v_has_orders boolean;
  v_has_vas boolean;
  v_has_grn boolean;
begin
  select d.branch_id, d.id into v_branch_id, v_department_id from public.departments d
  where d.organization_id=p_organization_id and d.status::text='active'
    and (upper(btrim(d.name))='FC' or upper(btrim(d.code))='FC') order by d.created_at limit 1;
  if v_department_id is null or not private.can_access_fc(p_organization_id, v_branch_id, v_department_id, false) then
    raise exception 'FC department access is required' using errcode='42501';
  end if;
  if p_from_date is null or p_to_date is null or p_to_date < p_from_date or p_to_date - p_from_date > 365 then
    raise exception 'FC operational period must contain between 1 and 366 days' using errcode='22023';
  end if;
  v_has_orders := p_sources ? 'orders';
  v_has_vas := p_sources ? 'vas';
  v_has_grn := p_sources ? 'grn_returns';

  update public.fc_daily_manpower_productivity set
    outbound_b2c_quantity = case when v_has_orders then 0 else outbound_b2c_quantity end,
    outbound_b2b_quantity = case when v_has_orders then 0 else outbound_b2b_quantity end,
    other_activity_quantity = case when v_has_orders then 0 else other_activity_quantity end,
    b2c_orders = case when v_has_orders then 0 else b2c_orders end,
    b2b_orders = case when v_has_orders then 0 else b2b_orders end,
    vas_quantity = case when v_has_vas then 0 else vas_quantity end,
    gift_wrap_quantity = case when v_has_vas then 0 else gift_wrap_quantity end,
    inbound_quantity = case when v_has_grn then 0 else inbound_quantity end,
    return_rto_quantity = case when v_has_grn then 0 else return_rto_quantity end,
    return_cir_quantity = case when v_has_grn then 0 else return_cir_quantity end
  where organization_id = p_organization_id
    and department_id = v_department_id
    and work_date between p_from_date and p_to_date;

  -- Both aggregate layers are replaced in the same transaction.
  v_count := public.import_fc_operational_metrics(
    p_organization_id,
    p_source_file_names,
    p_sources,
    p_rows
  );
  perform public.save_fc_client_daily_volumes(
    p_organization_id,
    p_sources,
    p_from_date,
    p_to_date,
    p_client_rows
  );
  return v_count;
end; $$;

revoke all on function public.save_fc_client_daily_volumes(uuid, jsonb, date, date, jsonb) from public, anon;
grant execute on function public.save_fc_client_daily_volumes(uuid, jsonb, date, date, jsonb) to authenticated;
revoke all on function public.import_fc_operational_workspace(uuid, text, jsonb, date, date, jsonb, jsonb) from public, anon;
grant execute on function public.import_fc_operational_workspace(uuid, text, jsonb, date, date, jsonb, jsonb) to authenticated;
