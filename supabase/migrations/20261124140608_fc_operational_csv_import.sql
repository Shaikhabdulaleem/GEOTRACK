-- Atomic daily/weekly FC operational CSV import.
-- Only source-derived metrics are replaced. Manual staffing, hours, notes,
-- storage, and management fields remain unchanged on re-import.

create or replace function public.import_fc_operational_metrics(
  p_organization_id uuid,
  p_source_file_names text,
  p_sources jsonb,
  p_rows jsonb
) returns integer
language plpgsql
security definer
set search_path = ''
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
  if jsonb_typeof(p_sources) <> 'array' or jsonb_array_length(p_sources) = 0 then
    raise exception 'At least one FC operational source is required' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_sources) source
    where source not in ('orders', 'vas', 'grn_returns')
  ) then
    raise exception 'Unsupported FC operational source' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 366 then
    raise exception 'FC operational import must contain between 1 and 366 daily rows' using errcode = '22023';
  end if;

  select d.branch_id, d.id into v_branch_id, v_department_id
  from public.departments d
  where d.organization_id = p_organization_id
    and d.status::text = 'active'
    and (upper(btrim(d.name)) = 'FC' or upper(btrim(d.code)) = 'FC')
  order by d.created_at
  limit 1;

  if v_department_id is null or not private.can_access_fc(p_organization_id, v_branch_id, v_department_id, false) then
    raise exception 'FC department access is required' using errcode = '42501';
  end if;

  v_has_orders := p_sources ? 'orders';
  v_has_vas := p_sources ? 'vas';
  v_has_grn := p_sources ? 'grn_returns';

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_work_date := nullif(v_row->>'work_date', '')::date;
    if v_work_date is null then
      raise exception 'Each FC operational row requires a valid work_date' using errcode = '22023';
    end if;
    if coalesce((v_row->>'inbound_quantity')::numeric, 0) < 0
      or coalesce((v_row->>'return_rto_quantity')::numeric, 0) < 0
      or coalesce((v_row->>'return_cir_quantity')::numeric, 0) < 0
      or coalesce((v_row->>'outbound_b2c_quantity')::numeric, 0) < 0
      or coalesce((v_row->>'outbound_b2b_quantity')::numeric, 0) < 0
      or coalesce((v_row->>'vas_quantity')::numeric, 0) < 0
      or coalesce((v_row->>'gift_wrap_quantity')::numeric, 0) < 0
      or coalesce((v_row->>'other_activity_quantity')::numeric, 0) < 0
      or coalesce((v_row->>'b2c_orders')::numeric, 0) < 0
      or coalesce((v_row->>'b2b_orders')::numeric, 0) < 0 then
      raise exception 'FC operational quantities cannot be negative' using errcode = '22023';
    end if;

    insert into public.fc_daily_manpower_productivity (
      organization_id, branch_id, department_id, work_date,
      inbound_quantity, return_rto_quantity, return_cir_quantity,
      outbound_b2c_quantity, outbound_b2b_quantity,
      vas_quantity, gift_wrap_quantity, other_activity_quantity,
      b2c_orders, b2b_orders, source_file_name, entered_by
    ) values (
      p_organization_id, v_branch_id, v_department_id, v_work_date,
      coalesce((v_row->>'inbound_quantity')::bigint, 0),
      coalesce((v_row->>'return_rto_quantity')::bigint, 0),
      coalesce((v_row->>'return_cir_quantity')::bigint, 0),
      coalesce((v_row->>'outbound_b2c_quantity')::bigint, 0),
      coalesce((v_row->>'outbound_b2b_quantity')::bigint, 0),
      coalesce((v_row->>'vas_quantity')::bigint, 0),
      coalesce((v_row->>'gift_wrap_quantity')::bigint, 0),
      coalesce((v_row->>'other_activity_quantity')::bigint, 0),
      coalesce((v_row->>'b2c_orders')::bigint, 0),
      coalesce((v_row->>'b2b_orders')::bigint, 0),
      nullif(left(btrim(p_source_file_names), 255), ''),
      (select auth.uid())
    ) on conflict (organization_id, department_id, work_date) do update set
      inbound_quantity = case when v_has_grn then excluded.inbound_quantity else public.fc_daily_manpower_productivity.inbound_quantity end,
      return_rto_quantity = case when v_has_grn then excluded.return_rto_quantity else public.fc_daily_manpower_productivity.return_rto_quantity end,
      return_cir_quantity = case when v_has_grn then excluded.return_cir_quantity else public.fc_daily_manpower_productivity.return_cir_quantity end,
      outbound_b2c_quantity = case when v_has_orders then excluded.outbound_b2c_quantity else public.fc_daily_manpower_productivity.outbound_b2c_quantity end,
      outbound_b2b_quantity = case when v_has_orders then excluded.outbound_b2b_quantity else public.fc_daily_manpower_productivity.outbound_b2b_quantity end,
      other_activity_quantity = case when v_has_orders then excluded.other_activity_quantity else public.fc_daily_manpower_productivity.other_activity_quantity end,
      b2c_orders = case when v_has_orders then excluded.b2c_orders else public.fc_daily_manpower_productivity.b2c_orders end,
      b2b_orders = case when v_has_orders then excluded.b2b_orders else public.fc_daily_manpower_productivity.b2b_orders end,
      vas_quantity = case when v_has_vas then excluded.vas_quantity else public.fc_daily_manpower_productivity.vas_quantity end,
      gift_wrap_quantity = case when v_has_vas then excluded.gift_wrap_quantity else public.fc_daily_manpower_productivity.gift_wrap_quantity end,
      source_file_name = excluded.source_file_name,
      entered_by = excluded.entered_by;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.import_fc_operational_metrics(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.import_fc_operational_metrics(uuid, text, jsonb, jsonb) to authenticated;
