-- Structural, least-privilege, and aggregate-only checks for FC productivity.
do $$
declare
  v_table text;
  v_definition text;
begin
  foreach v_table in array array[
    'fc_productivity_weeks', 'fc_daily_packer_metrics', 'fc_daily_seller_metrics',
    'fc_packer_mappings', 'fc_weekly_seller_supplements',
    'fc_weekly_capacity_metrics', 'fc_weekly_adhoc_tasks',
    'fc_activity_standards', 'fc_daily_manpower_productivity',
    'fc_daily_client_volumes'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'Missing FC productivity table: %', v_table;
    end if;
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=v_table and c.relrowsecurity
    ) then
      raise exception 'RLS is not enabled on %', v_table;
    end if;
    if has_table_privilege('anon', 'public.' || v_table, 'select')
       or has_table_privilege('authenticated', 'public.' || v_table, 'insert')
       or has_table_privilege('authenticated', 'public.' || v_table, 'update')
       or has_table_privilege('authenticated', 'public.' || v_table, 'delete') then
      raise exception 'FC least-privilege grants are invalid on %', v_table;
    end if;
  end loop;

  if to_regprocedure('public.save_fc_productivity_week(uuid,date,jsonb)') is null
     or to_regprocedure('public.save_fc_week_supplements(uuid,date,text,jsonb,boolean)') is null
     or to_regprocedure('public.finalize_fc_productivity_week(uuid,date)') is null
     or to_regprocedure('public.save_fc_packer_mapping(uuid,text,uuid)') is null then
    raise exception 'One or more FC atomic RPCs are missing';
  end if;
  if to_regprocedure('public.initialize_fc_activity_standards(uuid)') is null
     or to_regprocedure('public.save_fc_activity_standard(uuid,text,numeric,text,boolean)') is null
     or to_regprocedure('public.save_fc_manpower_day(uuid,date,jsonb)') is null
     or to_regprocedure('public.import_fc_manpower_days(uuid,text,jsonb)') is null
     or to_regprocedure('public.import_fc_operational_metrics(uuid,text,jsonb,jsonb)') is null
     or to_regprocedure('public.save_fc_client_daily_volumes(uuid,jsonb,date,date,jsonb)') is null
     or to_regprocedure('public.import_fc_operational_workspace(uuid,text,jsonb,date,date,jsonb,jsonb)') is null then
    raise exception 'One or more FC manpower RPCs are missing';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name like 'fc_%'
      and column_name in ('order_id','customer_name','phone','email','address','tracking_number')
  ) then
    raise exception 'FC storage must contain aggregates only';
  end if;

  v_definition := pg_get_functiondef('private.can_access_fc(uuid,uuid,uuid,boolean)'::regprocedure);
  if v_definition not like '%upper(btrim(d.name)) = ''FC''%'
     or v_definition not like '%upper(btrim(d.code)) = ''FC''%'
     or v_definition not like '%manager_profiles%status::text = ''active''%' then
    raise exception 'FC access must require exact department scope and an active manager';
  end if;

  v_definition := pg_get_functiondef('public.save_fc_productivity_week(uuid,date,jsonb)'::regprocedure);
  if v_definition not like '%extract(dow from p_week_start) <> 0%'
     or v_definition not like '%seller_supplements_reviewed=false%'
     or v_definition not like '%delete from public.fc_daily_packer_metrics%'
     or v_definition like '%delete from public.fc_weekly_seller_supplements%' then
    raise exception 'FC re-import replacement/preservation rules are incomplete';
  end if;

  v_definition := pg_get_functiondef('public.finalize_fc_productivity_week(uuid,date)'::regprocedure);
  if v_definition not like '%seller_supplements_reviewed and v_week.capacity_reviewed and v_week.adhoc_reviewed%' then
    raise exception 'FC finalization review prerequisites are missing';
  end if;

  v_definition := pg_get_functiondef('public.save_fc_packer_mapping(uuid,text,uuid)'::regprocedure);
  if v_definition not like '%can_access_fc(p_organization_id,v_branch_id,v_department_id,true)%'
     or v_definition not like '%employment_status::text=''active''%' then
    raise exception 'FC mapping must remain administrator-only and active-employee scoped';
  end if;

  v_definition := pg_get_functiondef('public.import_fc_operational_metrics(uuid,text,jsonb,jsonb)'::regprocedure);
  if v_definition not like '%case when v_has_orders%'
     or v_definition not like '%case when v_has_vas%'
     or v_definition not like '%case when v_has_grn%'
     or v_definition like '%actual_own_dlp =%'
     or v_definition like '%actual_contract_dlp =%' then
    raise exception 'FC operational import must replace source metrics while preserving manual staffing';
  end if;

  v_definition := pg_get_functiondef('public.import_fc_operational_workspace(uuid,text,jsonb,date,date,jsonb,jsonb)'::regprocedure);
  if v_definition not like '%update public.fc_daily_manpower_productivity%'
     or v_definition not like '%v_count := public.import_fc_operational_metrics%'
     or v_definition not like '%perform public.save_fc_client_daily_volumes%' then
    raise exception 'FC operational workspace import must replace aggregates atomically';
  end if;
end $$;
