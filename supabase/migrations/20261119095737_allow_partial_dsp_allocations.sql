create or replace function public.save_mailroom_productivity_day(
  p_organization_id uuid,
  p_work_date date,
  p_status text,
  p_clients jsonb,
  p_returns_received bigint,
  p_returns_processed bigint,
  p_dsp_allocations jsonb,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch_id uuid;
  v_entry_id uuid;
  v_user_id uuid := (select auth.uid());
  v_client_count integer;
  v_input_client_count integer;
  v_processed bigint;
  v_allocated bigint;
  v_return_backlog bigint;
  v_bad_client text;
  v_bad_date date;
  v_available bigint;
  v_bad_dsp_client text;
begin
  if v_user_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_work_date is null or p_status not in ('draft', 'finalized') then
    raise exception 'A work date and valid entry status are required' using errcode = '22023';
  end if;
  if coalesce(p_returns_received, -1) < 0 or coalesce(p_returns_processed, -1) < 0 then
    raise exception 'Return volumes cannot be negative' using errcode = '22023';
  end if;

  select s.branch_id into v_branch_id
  from public.mailroom_productivity_settings s
  where s.organization_id = p_organization_id;

  if v_branch_id is null or not private.can_access_mailroom(p_organization_id, v_branch_id, false) then
    raise exception 'Mailroom access is required' using errcode = '42501';
  end if;

  select count(*) into v_client_count
  from public.mailroom_clients c
  where c.organization_id = p_organization_id
    and c.branch_id = v_branch_id
    and c.status::text = 'active';

  select count(*) into v_input_client_count
  from jsonb_to_recordset(coalesce(p_clients, '[]'::jsonb))
    as x(client_id uuid, received_units bigint, processed_units bigint)
  join public.mailroom_clients c on c.id = x.client_id
  where c.organization_id = p_organization_id
    and c.branch_id = v_branch_id
    and c.status::text = 'active'
    and x.received_units >= 0
    and x.processed_units >= 0;

  if v_input_client_count <> v_client_count
     or v_input_client_count <> (select count(distinct x.client_id) from jsonb_to_recordset(coalesce(p_clients, '[]'::jsonb)) as x(client_id uuid)) then
    raise exception 'Enter nonnegative Received and Processed values for every active Mailroom client' using errcode = '22023';
  end if;

  insert into public.mailroom_daily_entries (
    organization_id, branch_id, work_date, status, returns_received, returns_processed,
    notes, created_by, updated_by, finalized_by, finalized_at
  ) values (
    p_organization_id, v_branch_id, p_work_date, p_status,
    p_returns_received, p_returns_processed, nullif(btrim(p_notes), ''),
    v_user_id, v_user_id,
    case when p_status = 'finalized' then v_user_id end,
    case when p_status = 'finalized' then clock_timestamp() end
  )
  on conflict (organization_id, branch_id, work_date) do update set
    status = excluded.status,
    returns_received = excluded.returns_received,
    returns_processed = excluded.returns_processed,
    notes = excluded.notes,
    updated_by = v_user_id,
    finalized_by = case when excluded.status = 'finalized' then v_user_id end,
    finalized_at = case when excluded.status = 'finalized' then clock_timestamp() end
  returning id into v_entry_id;

  insert into public.mailroom_daily_shipments (
    organization_id, branch_id, client_id, work_date, received_units, validated_units,
    processed_units, created_by, updated_by
  )
  select p_organization_id, v_branch_id, x.client_id, p_work_date,
    x.received_units, x.processed_units, x.processed_units, v_user_id, v_user_id
  from jsonb_to_recordset(p_clients)
    as x(client_id uuid, received_units bigint, processed_units bigint)
  on conflict (client_id, work_date) do update set
    received_units = excluded.received_units,
    validated_units = excluded.processed_units,
    processed_units = excluded.processed_units,
    updated_by = v_user_id;

  with running as (
    select c.name, d.work_date,
      c.opening_unprocessed_units
        + sum(d.received_units - d.processed_units)
          over (partition by c.id order by d.work_date, d.id) as available
    from public.mailroom_clients c
    join public.mailroom_daily_shipments d on d.client_id = c.id
    where c.organization_id = p_organization_id
  )
  select name, work_date, available into v_bad_client, v_bad_date, v_available
  from running where available < 0
  order by work_date limit 1;

  if v_bad_client is not null then
    raise exception '% on % exceeds available backlog by % shipments',
      v_bad_client, v_bad_date, abs(v_available) using errcode = '23514';
  end if;

  with running as (
    select e.work_date,
      s.opening_return_backlog
        + sum(e.returns_received - e.returns_processed)
          over (order by e.work_date, e.id) as available
    from public.mailroom_productivity_settings s
    join public.mailroom_daily_entries e on e.organization_id = s.organization_id
    where s.organization_id = p_organization_id
  )
  select work_date, available into v_bad_date, v_return_backlog
  from running where available < 0
  order by work_date limit 1;

  if v_bad_date is not null and v_return_backlog < 0 then
    raise exception 'Returns processed on % exceed the available return backlog by % shipments',
      v_bad_date, abs(v_return_backlog) using errcode = '23514';
  end if;

  delete from public.mailroom_daily_dsp_allocations where daily_entry_id = v_entry_id;

  insert into public.mailroom_daily_dsp_allocations (
    organization_id, branch_id, daily_entry_id, client_id, partner_id, allocated_units
  )
  select p_organization_id, v_branch_id, v_entry_id, x.client_id, x.partner_id, x.allocated_units
  from jsonb_to_recordset(coalesce(p_dsp_allocations, '[]'::jsonb))
    as x(client_id uuid, partner_id uuid, allocated_units bigint)
  join public.mailroom_clients c on c.id = x.client_id
  join public.mailroom_dsp_partners p on p.id = x.partner_id
  where c.organization_id = p_organization_id
    and c.branch_id = v_branch_id
    and c.status::text = 'active'
    and p.organization_id = p_organization_id
    and p.branch_id = v_branch_id
    and p.status::text = 'active'
    and x.allocated_units >= 0;

  if (select count(*) from jsonb_to_recordset(coalesce(p_dsp_allocations, '[]'::jsonb)) as x(client_id uuid, partner_id uuid, allocated_units bigint))
     <> (select count(*) from public.mailroom_daily_dsp_allocations where daily_entry_id = v_entry_id) then
    raise exception 'DSP allocations contain an invalid client, partner, duplicate pair, or negative volume' using errcode = '22023';
  end if;

  select coalesce(sum(x.processed_units), 0) into v_processed
  from jsonb_to_recordset(p_clients) as x(client_id uuid, received_units bigint, processed_units bigint);
  select coalesce(sum(a.allocated_units), 0) into v_allocated
  from public.mailroom_daily_dsp_allocations a where a.daily_entry_id = v_entry_id;

  if p_status = 'finalized' then
    select c.name into v_bad_dsp_client
    from jsonb_to_recordset(p_clients) as x(client_id uuid, received_units bigint, processed_units bigint)
    join public.mailroom_clients c on c.id = x.client_id
    left join public.mailroom_daily_dsp_allocations a
      on a.daily_entry_id = v_entry_id and a.client_id = x.client_id
    group by c.name, x.processed_units
    having coalesce(sum(a.allocated_units), 0) > x.processed_units
    order by c.name
    limit 1;

    if v_bad_dsp_client is not null then
      raise exception 'DSP allocation for % cannot exceed that client processed volume', v_bad_dsp_client
        using errcode = '23514';
    end if;
  end if;

  return jsonb_build_object(
    'entry_id', v_entry_id,
    'status', p_status,
    'processed_units', v_processed,
    'allocated_units', v_allocated,
    'dsp_remaining', v_processed - v_allocated,
    'return_backlog', (
      select s.opening_return_backlog + coalesce(sum(e.returns_received - e.returns_processed), 0)
      from public.mailroom_productivity_settings s
      left join public.mailroom_daily_entries e
        on e.organization_id = s.organization_id and e.work_date <= p_work_date
      where s.organization_id = p_organization_id
      group by s.opening_return_backlog
    )
  );
end;
$$;

revoke all on function public.save_mailroom_productivity_day(uuid, date, text, jsonb, bigint, bigint, jsonb, text)
  from public, anon;
grant execute on function public.save_mailroom_productivity_day(uuid, date, text, jsonb, bigint, bigint, jsonb, text)
  to authenticated;

comment on table public.mailroom_daily_dsp_allocations is
  'Client-wise shipment volume allocated to each last-mile DSP partner for one Mailroom operating day.';
comment on column public.mailroom_daily_dsp_allocations.client_id is
  'Mailroom client whose processed shipments were allocated to the DSP partner.';


