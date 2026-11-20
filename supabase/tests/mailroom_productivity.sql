-- Structural and security checks for the Mailroom productivity module.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'mailroom_productivity_settings', 'mailroom_clients', 'mailroom_activities',
    'mailroom_client_activities', 'mailroom_daily_shipments', 'mailroom_employee_settings',
    'mailroom_dsp_partners', 'mailroom_daily_entries', 'mailroom_daily_dsp_allocations',
    'mailroom_daily_turnaround_metrics'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'Missing Mailroom productivity table: %', v_table;
    end if;
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_table and c.relrowsecurity
    ) then
      raise exception 'RLS is not enabled on %', v_table;
    end if;
  end loop;

  if to_regprocedure('public.initialize_mailroom_productivity(uuid)') is null then
    raise exception 'Mailroom initializer RPC is missing';
  end if;
  if to_regprocedure('public.save_mailroom_productivity_week(uuid,date,jsonb)') is null then
    raise exception 'Atomic Mailroom week-save RPC is missing';
  end if;
  if to_regprocedure('public.save_mailroom_productivity_day(uuid,date,text,jsonb,bigint,bigint,jsonb,text)') is null then
    raise exception 'Atomic Mailroom day-save RPC is missing';
  end if;
  if to_regprocedure('public.save_mailroom_productivity_month(uuid,jsonb)') is null then
    raise exception 'Atomic Mailroom month-save RPC is missing';
  end if;
  if to_regprocedure('public.save_mailroom_turnaround_metrics(uuid,jsonb)') is null then
    raise exception 'Aggregate Mailroom turnaround-save RPC is missing';
  end if;
  if to_regprocedure('public.save_mailroom_client_returns(uuid,jsonb)') is null then
    raise exception 'Client-wise Mailroom returns RPC is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mailroom_productivity_settings'
      and column_name = 'overtime_hourly_cost_own'
  ) then
    raise exception 'Mailroom overtime hourly cost own setting is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mailroom_productivity_settings'
      and column_name = 'overtime_hourly_cost_3pl'
  ) then
    raise exception 'Mailroom overtime hourly cost 3PL setting is missing';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mailroom_daily_turnaround_metrics'
      and column_name in ('tracking_number', 'address', 'customer_name')
  ) then
    raise exception 'Turnaround storage must contain aggregates only';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.save_mailroom_productivity_month(uuid,jsonb)'::regprocedure) then
    raise exception 'Mailroom month-save RPC must remain security invoker';
  end if;
  if pg_get_functiondef('public.save_mailroom_productivity_day(uuid,date,text,jsonb,bigint,bigint,jsonb,text)'::regprocedure)
       not like '%cannot exceed that client processed volume%' then
    raise exception 'Mailroom day-save RPC must allow partial DSP allocation and reject only over-allocation';
  end if;
  if pg_get_functiondef('public.save_mailroom_productivity_day(uuid,date,text,jsonb,bigint,bigint,jsonb,text)'::regprocedure)
       like '%backlog_released_units, x.processed_units) <= x.processed_units%' then
    raise exception 'Mailroom day-save RPC must allow backlog release after an earlier validation event';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'mailroom_daily_shipments_org_branch_date_idx') then
    raise exception 'Mailroom daily date-range index is missing';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'mailroom_turnaround_org_client_idx') then
    raise exception 'Mailroom turnaround client foreign-key index is missing';
  end if;
  if has_table_privilege('anon', 'public.mailroom_daily_shipments', 'select')
     or has_table_privilege('anon', 'public.mailroom_daily_shipments', 'insert') then
    raise exception 'Anonymous Mailroom shipment access must remain revoked';
  end if;
  if has_table_privilege('authenticated', 'public.mailroom_daily_shipments', 'insert')
     or has_table_privilege('authenticated', 'public.mailroom_daily_shipments', 'update')
     or has_table_privilege('authenticated', 'public.mailroom_daily_shipments', 'delete') then
    raise exception 'Mailroom shipment writes must only use the atomic save RPC';
  end if;
  if has_table_privilege('authenticated', 'public.mailroom_daily_entries', 'insert')
     or has_table_privilege('authenticated', 'public.mailroom_daily_dsp_allocations', 'insert') then
    raise exception 'Daily entry and DSP allocation writes must only use the atomic save RPC';
  end if;
end $$;

-- Preserve the supplied staffing arithmetic independently of application code.
do $$
declare
  v_fte numeric;
begin
  v_fte := 41587::numeric / 600 / (6 * 8);
  if round(v_fte, 1) <> 1.4 then
    raise exception 'Sample staffing calculation is incorrect: %', v_fte;
  end if;
  if 45000::numeric / 600 <> 75 or round((45000::numeric / 600 / 8), 1) <> 9.4 then
    raise exception '45,000 shipment staffing example is incorrect';
  end if;
end $$;
