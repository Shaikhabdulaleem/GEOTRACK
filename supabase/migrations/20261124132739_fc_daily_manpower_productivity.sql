-- Daily FC manpower productivity model based on operational volume and activity standards.

create table public.fc_activity_standards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  department_id uuid not null,
  activity_code text not null,
  activity_name text not null,
  volume_driver text not null check (volume_driver in (
    'inbound','return_rto','return_cir','returns_total','outbound_b2c','outbound_b2b','vas','gift_wrap','other'
  )),
  target_uom text not null check (target_uom in ('hour','day')),
  units_per_worker numeric(16,4) not null check (units_per_worker > 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, department_id, activity_code),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id),
  foreign key (organization_id, department_id) references public.departments(organization_id, id)
);

create table public.fc_daily_manpower_productivity (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  department_id uuid not null,
  work_date date not null,
  available_hours numeric(5,2) not null default 8 check (available_hours > 0 and available_hours <= 24),
  inbound_quantity bigint not null default 0 check (inbound_quantity >= 0),
  return_rto_quantity bigint not null default 0 check (return_rto_quantity >= 0),
  return_cir_quantity bigint not null default 0 check (return_cir_quantity >= 0),
  outbound_b2c_quantity bigint not null default 0 check (outbound_b2c_quantity >= 0),
  outbound_b2b_quantity bigint not null default 0 check (outbound_b2b_quantity >= 0),
  vas_quantity bigint not null default 0 check (vas_quantity >= 0),
  gift_wrap_quantity bigint not null default 0 check (gift_wrap_quantity >= 0),
  other_activity_name text,
  other_activity_quantity bigint not null default 0 check (other_activity_quantity >= 0),
  b2c_orders bigint not null default 0 check (b2c_orders >= 0),
  b2b_orders bigint not null default 0 check (b2b_orders >= 0),
  closing_storage_quantity bigint not null default 0 check (closing_storage_quantity >= 0),
  actual_own_dlp numeric(10,2) not null default 0 check (actual_own_dlp >= 0),
  actual_contract_dlp numeric(10,2) not null default 0 check (actual_contract_dlp >= 0),
  cycle_count_staff numeric(10,2) not null default 0 check (cycle_count_staff >= 0),
  supervisor_staff numeric(10,2) not null default 0 check (supervisor_staff >= 0),
  assistant_manager_staff numeric(10,2) not null default 0 check (assistant_manager_staff >= 0),
  manager_staff numeric(10,2) not null default 0 check (manager_staff >= 0),
  security_staff numeric(10,2) not null default 0 check (security_staff >= 0),
  security_supervisor_staff numeric(10,2) not null default 0 check (security_supervisor_staff >= 0),
  housekeeping_staff numeric(10,2) not null default 0 check (housekeeping_staff >= 0),
  other_staff numeric(10,2) not null default 0 check (other_staff >= 0),
  notes text,
  source_file_name text,
  entered_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, department_id, work_date),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id),
  foreign key (organization_id, department_id) references public.departments(organization_id, id)
);

create index fc_daily_manpower_org_date_idx on public.fc_daily_manpower_productivity (organization_id, department_id, work_date desc);
create trigger set_updated_at before update on public.fc_activity_standards for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.fc_daily_manpower_productivity for each row execute function private.set_updated_at();

do $$
declare v_table text;
begin
  foreach v_table in array array['fc_activity_standards','fc_daily_manpower_productivity'] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated',v_table);
    execute format('grant select on table public.%I to authenticated',v_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.can_access_fc(organization_id,branch_id,department_id,false)))',
      v_table || '_select',v_table
    );
  end loop;
end $$;

create or replace function public.initialize_fc_activity_standards(p_organization_id uuid)
returns integer language plpgsql security definer set search_path=''
as $$
declare v_branch_id uuid; v_department_id uuid; v_count integer;
begin
  select d.branch_id,d.id into v_branch_id,v_department_id from public.departments d
  where d.organization_id=p_organization_id and d.status::text='active'
    and (upper(btrim(d.name))='FC' or upper(btrim(d.code))='FC') order by d.created_at limit 1;
  if v_department_id is null or not private.can_access_fc(p_organization_id,v_branch_id,v_department_id,true) then
    raise exception 'Administrator access to FC is required' using errcode='42501';
  end if;
  insert into public.fc_activity_standards(organization_id,branch_id,department_id,activity_code,activity_name,volume_driver,target_uom,units_per_worker,sort_order)
  values
    (p_organization_id,v_branch_id,v_department_id,'INBOUND_QC','Inward QC / GRN','inbound','hour',532.4,10),
    (p_organization_id,v_branch_id,v_department_id,'PUTAWAY','Putaway','inbound','day',8077.5128,20),
    (p_organization_id,v_branch_id,v_department_id,'PICK_B2C','Picker B2C','outbound_b2c','hour',200,30),
    (p_organization_id,v_branch_id,v_department_id,'PICK_B2B','Picker B2B','outbound_b2b','hour',800,40),
    (p_organization_id,v_branch_id,v_department_id,'PACK_B2C','Packer B2C','outbound_b2c','hour',100,50),
    (p_organization_id,v_branch_id,v_department_id,'PACK_B2B','Packer B2B','outbound_b2b','hour',1000,60),
    (p_organization_id,v_branch_id,v_department_id,'MANIFEST_B2C','Packer / Manifest B2C','outbound_b2c','hour',200,70),
    (p_organization_id,v_branch_id,v_department_id,'MANIFEST_B2B','Packer / Manifest B2B','outbound_b2b','hour',1000,80),
    (p_organization_id,v_branch_id,v_department_id,'SORT_B2C','Picker / Sorting B2C','outbound_b2c','hour',200,90),
    (p_organization_id,v_branch_id,v_department_id,'SORT_B2B','Picker / Sorting B2B','outbound_b2b','hour',1000,100),
    (p_organization_id,v_branch_id,v_department_id,'CONSOLIDATE_B2C','Order Consolidation B2C','outbound_b2c','hour',200,110),
    (p_organization_id,v_branch_id,v_department_id,'CONSOLIDATE_B2B','Order Consolidation B2B','outbound_b2b','hour',1000,120),
    (p_organization_id,v_branch_id,v_department_id,'VAS','VAS Activities','vas','hour',200,130),
    (p_organization_id,v_branch_id,v_department_id,'RETURN_QC_RTO','Return QC / RTO','return_rto','day',320,140),
    (p_organization_id,v_branch_id,v_department_id,'RETURN_QC_CIR','Return QC / CIR','return_cir','day',240,150),
    (p_organization_id,v_branch_id,v_department_id,'RETURN_PUTAWAY','Return Putaway','returns_total','day',8077.5128,160),
    (p_organization_id,v_branch_id,v_department_id,'RETURN_RECEIVING','Return Receiving','returns_total','day',4259.2,170),
    (p_organization_id,v_branch_id,v_department_id,'GIFT_WRAP','Gift Wrapping','gift_wrap','hour',20,180),
    (p_organization_id,v_branch_id,v_department_id,'OTHER','Other Activity','other','hour',30,190)
  on conflict(organization_id,department_id,activity_code) do nothing;
  get diagnostics v_count=row_count;
  return v_count;
end; $$;

create or replace function public.save_fc_activity_standard(
  p_organization_id uuid,p_activity_code text,p_units_per_worker numeric,p_target_uom text,p_is_active boolean
) returns void language plpgsql security definer set search_path=''
as $$
declare v_row public.fc_activity_standards%rowtype;
begin
  select * into v_row from public.fc_activity_standards where organization_id=p_organization_id and activity_code=p_activity_code limit 1;
  if v_row.id is null or not private.can_access_fc(p_organization_id,v_row.branch_id,v_row.department_id,true) then raise exception 'Administrator access to FC is required' using errcode='42501'; end if;
  if p_units_per_worker<=0 or p_target_uom not in('hour','day') then raise exception 'Invalid FC activity standard' using errcode='22023'; end if;
  update public.fc_activity_standards set units_per_worker=p_units_per_worker,target_uom=p_target_uom,is_active=p_is_active where id=v_row.id;
end; $$;

create or replace function public.save_fc_manpower_day(p_organization_id uuid,p_work_date date,p_data jsonb)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_branch_id uuid; v_department_id uuid; v_id uuid;
begin
  select d.branch_id,d.id into v_branch_id,v_department_id from public.departments d
  where d.organization_id=p_organization_id and d.status::text='active'
    and (upper(btrim(d.name))='FC' or upper(btrim(d.code))='FC') order by d.created_at limit 1;
  if v_department_id is null or not private.can_access_fc(p_organization_id,v_branch_id,v_department_id,false) then raise exception 'FC department access is required' using errcode='42501'; end if;
  insert into public.fc_daily_manpower_productivity(
    organization_id,branch_id,department_id,work_date,available_hours,inbound_quantity,return_rto_quantity,return_cir_quantity,
    outbound_b2c_quantity,outbound_b2b_quantity,vas_quantity,gift_wrap_quantity,other_activity_name,other_activity_quantity,
    b2c_orders,b2b_orders,closing_storage_quantity,actual_own_dlp,actual_contract_dlp,cycle_count_staff,supervisor_staff,
    assistant_manager_staff,manager_staff,security_staff,security_supervisor_staff,housekeeping_staff,other_staff,notes,source_file_name,entered_by
  ) values (
    p_organization_id,v_branch_id,v_department_id,p_work_date,coalesce((p_data->>'available_hours')::numeric,8),
    coalesce((p_data->>'inbound_quantity')::bigint,0),coalesce((p_data->>'return_rto_quantity')::bigint,0),coalesce((p_data->>'return_cir_quantity')::bigint,0),
    coalesce((p_data->>'outbound_b2c_quantity')::bigint,0),coalesce((p_data->>'outbound_b2b_quantity')::bigint,0),coalesce((p_data->>'vas_quantity')::bigint,0),
    coalesce((p_data->>'gift_wrap_quantity')::bigint,0),nullif(left(btrim(p_data->>'other_activity_name'),200),''),coalesce((p_data->>'other_activity_quantity')::bigint,0),
    coalesce((p_data->>'b2c_orders')::bigint,0),coalesce((p_data->>'b2b_orders')::bigint,0),coalesce((p_data->>'closing_storage_quantity')::bigint,0),
    coalesce((p_data->>'actual_own_dlp')::numeric,0),coalesce((p_data->>'actual_contract_dlp')::numeric,0),coalesce((p_data->>'cycle_count_staff')::numeric,0),
    coalesce((p_data->>'supervisor_staff')::numeric,0),coalesce((p_data->>'assistant_manager_staff')::numeric,0),coalesce((p_data->>'manager_staff')::numeric,0),
    coalesce((p_data->>'security_staff')::numeric,0),coalesce((p_data->>'security_supervisor_staff')::numeric,0),coalesce((p_data->>'housekeeping_staff')::numeric,0),
    coalesce((p_data->>'other_staff')::numeric,0),nullif(left(p_data->>'notes',2000),''),nullif(left(p_data->>'source_file_name',255),''),(select auth.uid())
  ) on conflict(organization_id,department_id,work_date) do update set
    available_hours=excluded.available_hours,inbound_quantity=excluded.inbound_quantity,return_rto_quantity=excluded.return_rto_quantity,
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

create or replace function public.import_fc_manpower_days(p_organization_id uuid,p_source_file_name text,p_rows jsonb)
returns integer language plpgsql security definer set search_path=''
as $$
declare v_row jsonb; v_count integer:=0;
begin
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>366 then raise exception 'FC manpower import must contain up to 366 daily rows' using errcode='22023'; end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    perform public.save_fc_manpower_day(p_organization_id,(v_row->>'work_date')::date,v_row || jsonb_build_object('source_file_name',p_source_file_name));
    v_count:=v_count+1;
  end loop;
  return v_count;
end; $$;

do $$
declare v_sig text;
begin
  foreach v_sig in array array[
    'public.initialize_fc_activity_standards(uuid)',
    'public.save_fc_activity_standard(uuid,text,numeric,text,boolean)',
    'public.save_fc_manpower_day(uuid,date,jsonb)',
    'public.import_fc_manpower_days(uuid,text,jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon',v_sig);
    execute format('grant execute on function %s to authenticated',v_sig);
  end loop;
end $$;
