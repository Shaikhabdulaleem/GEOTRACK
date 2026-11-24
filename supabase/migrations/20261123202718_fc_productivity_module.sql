-- FC weekly productivity. Raw order/customer records are intentionally never stored.

create table public.fc_productivity_weeks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  department_id uuid not null,
  week_start date not null check (extract(dow from week_start) = 0),
  status text not null default 'draft' check (status in ('draft', 'finalized')),
  revision integer not null default 1 check (revision > 0),
  source_file_name text not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  source_rows integer not null default 0 check (source_rows >= 0),
  valid_rows integer not null check (valid_rows > 0 and valid_rows <= 50000),
  ignored_rows integer not null default 0 check (ignored_rows >= 0),
  duplicate_rows integer not null default 0 check (duplicate_rows >= 0),
  blank_packer_rows integer not null default 0 check (blank_packer_rows >= 0),
  seller_supplements_reviewed boolean not null default false,
  capacity_reviewed boolean not null default false,
  adhoc_reviewed boolean not null default false,
  imported_by uuid references auth.users(id) on delete set null,
  imported_at timestamptz not null default clock_timestamp(),
  finalized_by uuid references auth.users(id) on delete set null,
  finalized_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, department_id, week_start),
  unique (organization_id, id),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id),
  foreign key (organization_id, department_id) references public.departments(organization_id, id)
);

create table public.fc_daily_packer_metrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  department_id uuid not null,
  week_id uuid not null,
  work_date date not null,
  packer_label text not null,
  normalized_packer_label text not null,
  packed_orders integer not null check (packed_orders > 0),
  packed_quantity bigint not null check (packed_quantity >= packed_orders),
  created_at timestamptz not null default clock_timestamp(),
  unique (week_id, work_date, normalized_packer_label),
  foreign key (organization_id, week_id) references public.fc_productivity_weeks(organization_id, id) on delete cascade
);

create table public.fc_daily_seller_metrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  department_id uuid not null,
  week_id uuid not null,
  work_date date not null,
  seller_name text not null,
  order_type text not null check (order_type in ('B2B', 'B2C', 'Other')),
  packed_orders integer not null check (packed_orders > 0),
  packed_quantity bigint not null check (packed_quantity >= packed_orders),
  a2p_minutes numeric(16,2) not null default 0 check (a2p_minutes >= 0),
  a2p_samples integer not null default 0 check (a2p_samples >= 0),
  p2p_minutes numeric(16,2) not null default 0 check (p2p_minutes >= 0),
  p2p_samples integer not null default 0 check (p2p_samples >= 0),
  o2p_minutes numeric(16,2) not null default 0 check (o2p_minutes >= 0),
  o2p_samples integer not null default 0 check (o2p_samples >= 0),
  p2s_minutes numeric(16,2) not null default 0 check (p2s_minutes >= 0),
  p2s_samples integer not null default 0 check (p2s_samples >= 0),
  o2s_minutes numeric(16,2) not null default 0 check (o2s_minutes >= 0),
  o2s_samples integer not null default 0 check (o2s_samples >= 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (week_id, work_date, seller_name, order_type),
  foreign key (organization_id, week_id) references public.fc_productivity_weeks(organization_id, id) on delete cascade
);

create table public.fc_packer_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  department_id uuid not null,
  packer_label text not null,
  normalized_packer_label text not null,
  employee_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, department_id, normalized_packer_label),
  foreign key (organization_id, employee_id) references public.employee_profiles(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id) references public.departments(organization_id, id),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id)
);

create table public.fc_weekly_seller_supplements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  department_id uuid not null,
  week_id uuid not null,
  seller_name text not null,
  purchase_order_units bigint not null default 0 check (purchase_order_units >= 0),
  return_order_units bigint not null default 0 check (return_order_units >= 0),
  return_orders bigint not null default 0 check (return_orders >= 0),
  unique (week_id, seller_name),
  foreign key (organization_id, week_id) references public.fc_productivity_weeks(organization_id, id) on delete cascade
);

create table public.fc_weekly_capacity_metrics (
  week_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  department_id uuid not null,
  capacity_bins bigint not null default 0 check (capacity_bins >= 0),
  utilized_bins bigint not null default 0 check (utilized_bins >= 0),
  capacity_pallets bigint not null default 0 check (capacity_pallets >= 0),
  utilized_pallets bigint not null default 0 check (utilized_pallets >= 0),
  capacity_units bigint not null default 0 check (capacity_units >= 0),
  utilized_units bigint not null default 0 check (utilized_units >= 0),
  capacity_cbm numeric(16,2) not null default 0 check (capacity_cbm >= 0),
  utilized_cbm numeric(16,2) not null default 0 check (utilized_cbm >= 0),
  foreign key (organization_id, week_id) references public.fc_productivity_weeks(organization_id, id) on delete cascade
);

create table public.fc_weekly_adhoc_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  department_id uuid not null,
  week_id uuid not null,
  seller_name text not null,
  task_name text not null,
  usage numeric(16,2) not null default 0 check (usage >= 0),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, week_id) references public.fc_productivity_weeks(organization_id, id) on delete cascade
);

create index fc_weeks_org_dept_date_idx on public.fc_productivity_weeks (organization_id, department_id, week_start desc);
create index fc_packer_metrics_week_idx on public.fc_daily_packer_metrics (week_id, work_date);
create index fc_seller_metrics_week_idx on public.fc_daily_seller_metrics (week_id, work_date);
create index fc_mapping_employee_idx on public.fc_packer_mappings (employee_id);

create trigger set_updated_at before update on public.fc_productivity_weeks
for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.fc_packer_mappings
for each row execute function private.set_updated_at();

create or replace function private.can_access_fc(
  p_organization_id uuid,
  p_branch_id uuid,
  p_department_id uuid,
  p_admin_only boolean default false
) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.departments d
    join public.branches b on b.id = d.branch_id and b.organization_id = d.organization_id
    where d.id = p_department_id and d.organization_id = p_organization_id
      and d.branch_id = p_branch_id and d.status::text = 'active' and b.status::text = 'active'
      and (upper(btrim(d.name)) = 'FC' or upper(btrim(d.code)) = 'FC')
  ) and (
    private.has_org_role(p_organization_id, array['administrator'])
    or (
      not p_admin_only and private.has_org_role(p_organization_id, array['manager'])
      and exists (
        select 1 from public.manager_profiles mp
        where mp.organization_id = p_organization_id
          and mp.user_id = (select auth.uid())
          and mp.status::text = 'active'
      )
      and exists (
        select 1 from public.departments d
        left join public.manager_scopes s on s.organization_id = d.organization_id
          and s.department_id = d.id and s.manager_user_id = (select auth.uid())
          and (s.branch_id is null or s.branch_id = d.branch_id)
        where d.id = p_department_id and d.organization_id = p_organization_id
          and (s.id is not null or d.manager_user_id = (select auth.uid()))
      )
    )
  );
$$;
revoke all on function private.can_access_fc(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function private.can_access_fc(uuid, uuid, uuid, boolean) to authenticated;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'fc_productivity_weeks','fc_daily_packer_metrics','fc_daily_seller_metrics','fc_packer_mappings',
    'fc_weekly_seller_supplements','fc_weekly_capacity_metrics','fc_weekly_adhoc_tasks'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute format('grant select on table public.%I to authenticated', v_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.can_access_fc(organization_id, branch_id, department_id, false)))',
      v_table || '_select', v_table
    );
  end loop;
end $$;

create or replace function public.save_fc_productivity_week(
  p_organization_id uuid,
  p_week_start date,
  p_import jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_branch_id uuid; v_department_id uuid; v_week_id uuid; v_revision integer;
  v_packer_count integer; v_seller_count integer; v_valid_rows integer;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if extract(dow from p_week_start) <> 0 then raise exception 'FC week must start on Sunday' using errcode = '22023'; end if;
  if jsonb_typeof(p_import) <> 'object' then raise exception 'Import payload must be an object' using errcode = '22023'; end if;
  v_valid_rows := coalesce((p_import->>'valid_rows')::integer, 0);
  if v_valid_rows < 1 or v_valid_rows > 50000 then raise exception 'Import must contain 1 to 50000 valid rows' using errcode = '22023'; end if;
  if coalesce(p_import->>'source_sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid source file hash' using errcode = '22023'; end if;
  if jsonb_typeof(p_import->'packers') <> 'array' or jsonb_typeof(p_import->'sellers') <> 'array' then
    raise exception 'Import must include packer and seller arrays' using errcode = '22023';
  end if;

  select d.branch_id, d.id into v_branch_id, v_department_id
  from public.departments d
  where d.organization_id = p_organization_id and d.status::text = 'active'
    and (upper(btrim(d.name)) = 'FC' or upper(btrim(d.code)) = 'FC')
  order by d.created_at limit 1;
  if v_department_id is null or not private.can_access_fc(p_organization_id, v_branch_id, v_department_id, false) then
    raise exception 'FC department access is required' using errcode = '42501';
  end if;

  insert into public.fc_productivity_weeks (
    organization_id, branch_id, department_id, week_start, source_file_name, source_sha256,
    source_rows, valid_rows, ignored_rows, duplicate_rows, blank_packer_rows, imported_by
  ) values (
    p_organization_id, v_branch_id, v_department_id, p_week_start,
    left(coalesce(nullif(btrim(p_import->>'source_file_name'),''),'FC Orders import'),255), p_import->>'source_sha256',
    greatest(coalesce((p_import->>'source_rows')::integer,0),0), v_valid_rows,
    greatest(coalesce((p_import->>'ignored_rows')::integer,0),0),
    greatest(coalesce((p_import->>'duplicate_rows')::integer,0),0),
    greatest(coalesce((p_import->>'blank_packer_rows')::integer,0),0), (select auth.uid())
  ) on conflict (organization_id, department_id, week_start) do update set
    status='draft', revision=public.fc_productivity_weeks.revision+1,
    source_file_name=excluded.source_file_name, source_sha256=excluded.source_sha256,
    source_rows=excluded.source_rows, valid_rows=excluded.valid_rows, ignored_rows=excluded.ignored_rows,
    duplicate_rows=excluded.duplicate_rows, blank_packer_rows=excluded.blank_packer_rows,
    seller_supplements_reviewed=false, capacity_reviewed=false, adhoc_reviewed=false,
    imported_by=excluded.imported_by, imported_at=clock_timestamp(), finalized_by=null, finalized_at=null
  returning id, revision into v_week_id, v_revision;

  delete from public.fc_daily_packer_metrics where week_id = v_week_id;
  delete from public.fc_daily_seller_metrics where week_id = v_week_id;

  insert into public.fc_daily_packer_metrics (
    organization_id, branch_id, department_id, week_id, work_date, packer_label,
    normalized_packer_label, packed_orders, packed_quantity
  )
  select p_organization_id, v_branch_id, v_department_id, v_week_id, x.work_date,
    left(btrim(x.packer_label),200), left(btrim(lower(x.normalized_packer_label)),200), x.packed_orders, x.packed_quantity
  from jsonb_to_recordset(p_import->'packers') as x(
    work_date date, packer_label text, normalized_packer_label text, packed_orders integer, packed_quantity bigint
  )
  where x.work_date between p_week_start and p_week_start+6 and nullif(btrim(x.packer_label),'') is not null
    and nullif(btrim(x.normalized_packer_label),'') is not null and x.packed_orders > 0 and x.packed_quantity >= x.packed_orders;
  get diagnostics v_packer_count = row_count;

  insert into public.fc_daily_seller_metrics (
    organization_id, branch_id, department_id, week_id, work_date, seller_name, order_type,
    packed_orders, packed_quantity, a2p_minutes, a2p_samples, p2p_minutes, p2p_samples,
    o2p_minutes, o2p_samples, p2s_minutes, p2s_samples, o2s_minutes, o2s_samples
  )
  select p_organization_id, v_branch_id, v_department_id, v_week_id, x.work_date,
    left(btrim(x.seller_name),200), x.order_type, x.packed_orders, x.packed_quantity,
    x.a2p_minutes, x.a2p_samples, x.p2p_minutes, x.p2p_samples,
    x.o2p_minutes, x.o2p_samples, x.p2s_minutes, x.p2s_samples, x.o2s_minutes, x.o2s_samples
  from jsonb_to_recordset(p_import->'sellers') as x(
    work_date date, seller_name text, order_type text, packed_orders integer, packed_quantity bigint,
    a2p_minutes numeric, a2p_samples integer, p2p_minutes numeric, p2p_samples integer,
    o2p_minutes numeric, o2p_samples integer, p2s_minutes numeric, p2s_samples integer,
    o2s_minutes numeric, o2s_samples integer
  )
  where x.work_date between p_week_start and p_week_start+6 and nullif(btrim(x.seller_name),'') is not null
    and x.order_type in ('B2B','B2C','Other') and x.packed_orders > 0 and x.packed_quantity >= x.packed_orders
    and least(x.a2p_minutes,x.p2p_minutes,x.o2p_minutes,x.p2s_minutes,x.o2s_minutes) >= 0
    and least(x.a2p_samples,x.p2p_samples,x.o2p_samples,x.p2s_samples,x.o2s_samples) >= 0;
  get diagnostics v_seller_count = row_count;

  if v_packer_count <> jsonb_array_length(p_import->'packers') or v_seller_count <> jsonb_array_length(p_import->'sellers') then
    raise exception 'One or more FC aggregate rows are invalid or outside the selected week' using errcode = '22023';
  end if;
  if (select coalesce(sum(packed_orders),0) from public.fc_daily_packer_metrics where week_id=v_week_id) <> v_valid_rows
     or (select coalesce(sum(packed_orders),0) from public.fc_daily_seller_metrics where week_id=v_week_id) <> v_valid_rows then
    raise exception 'FC aggregate totals do not reconcile to valid imported rows' using errcode = '22023';
  end if;
  if (select coalesce(sum(packed_quantity),0) from public.fc_daily_packer_metrics where week_id=v_week_id)
     <> (select coalesce(sum(packed_quantity),0) from public.fc_daily_seller_metrics where week_id=v_week_id) then
    raise exception 'FC packer and seller quantities do not reconcile' using errcode = '22023';
  end if;
  return jsonb_build_object('week_id',v_week_id,'revision',v_revision,'status','draft');
end;
$$;

create or replace function public.save_fc_week_supplements(
  p_organization_id uuid, p_week_start date, p_section text, p_rows jsonb, p_reviewed boolean
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_week public.fc_productivity_weeks%rowtype; v_count integer := 0;
begin
  select * into v_week from public.fc_productivity_weeks
  where organization_id=p_organization_id and week_start=p_week_start limit 1;
  if v_week.id is null or not private.can_access_fc(p_organization_id,v_week.branch_id,v_week.department_id,false) then
    raise exception 'FC week access is required' using errcode='42501';
  end if;
  if v_week.status='finalized' then raise exception 'Re-import the week before changing finalized supplements' using errcode='22023'; end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>500 then raise exception 'Invalid supplement rows' using errcode='22023'; end if;
  if p_section='seller' then
    delete from public.fc_weekly_seller_supplements where week_id=v_week.id;
    insert into public.fc_weekly_seller_supplements (organization_id,branch_id,department_id,week_id,seller_name,purchase_order_units,return_order_units,return_orders)
    select p_organization_id,v_week.branch_id,v_week.department_id,v_week.id,left(btrim(x.seller_name),200),x.purchase_order_units,x.return_order_units,x.return_orders
    from jsonb_to_recordset(p_rows) as x(seller_name text,purchase_order_units bigint,return_order_units bigint,return_orders bigint)
    where nullif(btrim(x.seller_name),'') is not null and least(x.purchase_order_units,x.return_order_units,x.return_orders)>=0;
    get diagnostics v_count=row_count;
    update public.fc_productivity_weeks set seller_supplements_reviewed=p_reviewed where id=v_week.id;
  elsif p_section='capacity' then
    if jsonb_array_length(p_rows)<>1 then raise exception 'Capacity requires exactly one row' using errcode='22023'; end if;
    delete from public.fc_weekly_capacity_metrics where week_id=v_week.id;
    insert into public.fc_weekly_capacity_metrics (week_id,organization_id,branch_id,department_id,capacity_bins,utilized_bins,capacity_pallets,utilized_pallets,capacity_units,utilized_units,capacity_cbm,utilized_cbm)
    select v_week.id,p_organization_id,v_week.branch_id,v_week.department_id,x.capacity_bins,x.utilized_bins,x.capacity_pallets,x.utilized_pallets,x.capacity_units,x.utilized_units,x.capacity_cbm,x.utilized_cbm
    from jsonb_to_recordset(p_rows) as x(capacity_bins bigint,utilized_bins bigint,capacity_pallets bigint,utilized_pallets bigint,capacity_units bigint,utilized_units bigint,capacity_cbm numeric,utilized_cbm numeric)
    where least(x.capacity_bins,x.utilized_bins,x.capacity_pallets,x.utilized_pallets,x.capacity_units,x.utilized_units,x.capacity_cbm,x.utilized_cbm)>=0;
    get diagnostics v_count=row_count;
    update public.fc_productivity_weeks set capacity_reviewed=p_reviewed where id=v_week.id;
  elsif p_section='adhoc' then
    delete from public.fc_weekly_adhoc_tasks where week_id=v_week.id;
    insert into public.fc_weekly_adhoc_tasks (organization_id,branch_id,department_id,week_id,seller_name,task_name,usage)
    select p_organization_id,v_week.branch_id,v_week.department_id,v_week.id,left(btrim(x.seller_name),200),left(btrim(x.task_name),200),x.usage
    from jsonb_to_recordset(p_rows) as x(seller_name text,task_name text,usage numeric)
    where nullif(btrim(x.seller_name),'') is not null and nullif(btrim(x.task_name),'') is not null and x.usage>=0;
    get diagnostics v_count=row_count;
    update public.fc_productivity_weeks set adhoc_reviewed=p_reviewed where id=v_week.id;
  else raise exception 'Unknown FC supplement section' using errcode='22023'; end if;
  if v_count<>jsonb_array_length(p_rows) then raise exception 'One or more supplement rows are invalid' using errcode='22023'; end if;
  return v_count;
end;
$$;

create or replace function public.finalize_fc_productivity_week(p_organization_id uuid,p_week_start date)
returns void language plpgsql security definer set search_path=''
as $$
declare v_week public.fc_productivity_weeks%rowtype;
begin
  select * into v_week from public.fc_productivity_weeks where organization_id=p_organization_id and week_start=p_week_start limit 1;
  if v_week.id is null or not private.can_access_fc(p_organization_id,v_week.branch_id,v_week.department_id,false) then raise exception 'FC week access is required' using errcode='42501'; end if;
  if not (v_week.seller_supplements_reviewed and v_week.capacity_reviewed and v_week.adhoc_reviewed) then
    raise exception 'Review seller supplements, capacity, and ad-hoc work before finalizing' using errcode='22023';
  end if;
  update public.fc_productivity_weeks set status='finalized',finalized_by=(select auth.uid()),finalized_at=clock_timestamp() where id=v_week.id;
end;
$$;

create or replace function public.save_fc_packer_mapping(p_organization_id uuid,p_packer_label text,p_employee_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_branch_id uuid; v_department_id uuid; v_id uuid; v_normalized text;
begin
  select d.branch_id,d.id into v_branch_id,v_department_id from public.departments d
  where d.organization_id=p_organization_id and d.status::text='active'
    and (upper(btrim(d.name))='FC' or upper(btrim(d.code))='FC') order by d.created_at limit 1;
  if v_department_id is null or not private.can_access_fc(p_organization_id,v_branch_id,v_department_id,true) then raise exception 'Administrator access to FC is required' using errcode='42501'; end if;
  v_normalized:=lower(regexp_replace(btrim(p_packer_label),'\s+',' ','g'));
  if v_normalized='' then raise exception 'Packer label is required' using errcode='22023'; end if;
  if not exists(select 1 from public.employee_profiles e where e.id=p_employee_id and e.organization_id=p_organization_id and e.branch_id=v_branch_id and e.department_id=v_department_id and e.employment_status::text='active') then
    raise exception 'Mapping employee must be active in the FC department' using errcode='22023';
  end if;
  insert into public.fc_packer_mappings(organization_id,branch_id,department_id,packer_label,normalized_packer_label,employee_id,created_by,updated_by)
  values(p_organization_id,v_branch_id,v_department_id,left(btrim(p_packer_label),200),left(v_normalized,200),p_employee_id,(select auth.uid()),(select auth.uid()))
  on conflict(organization_id,department_id,normalized_packer_label) do update set packer_label=excluded.packer_label,employee_id=excluded.employee_id,updated_by=excluded.updated_by
  returning id into v_id;
  return v_id;
end;
$$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.save_fc_productivity_week(uuid,date,jsonb)',
    'public.save_fc_week_supplements(uuid,date,text,jsonb,boolean)',
    'public.finalize_fc_productivity_week(uuid,date)',
    'public.save_fc_packer_mapping(uuid,text,uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon',v_sig);
    execute format('grant execute on function %s to authenticated',v_sig);
  end loop;
end $$;
