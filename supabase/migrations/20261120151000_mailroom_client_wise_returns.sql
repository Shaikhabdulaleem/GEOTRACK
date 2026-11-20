alter table public.mailroom_daily_shipments
  add column if not exists returns_received bigint not null default 0 check (returns_received >= 0),
  add column if not exists returns_processed bigint not null default 0 check (returns_processed >= 0);

create or replace function public.save_mailroom_client_returns(
  p_organization_id uuid,
  p_rows jsonb
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch_id uuid;
  v_input_count bigint;
  v_valid_count bigint;
  v_updated_count bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 10000 then
    raise exception 'Client returns must be an array of at most 10000 aggregate rows' using errcode = '22023';
  end if;

  select s.branch_id into v_branch_id
  from public.mailroom_productivity_settings s
  where s.organization_id = p_organization_id;
  if v_branch_id is null or not private.can_access_mailroom(p_organization_id, v_branch_id, false) then
    raise exception 'Mailroom access is required' using errcode = '42501';
  end if;

  v_input_count := jsonb_array_length(coalesce(p_rows, '[]'::jsonb));
  if v_input_count = 0 then return 0; end if;

  select count(*) into v_valid_count
  from jsonb_to_recordset(p_rows) as x(client_id uuid, work_date date, return_units bigint)
  join public.mailroom_clients c on c.id = x.client_id
  join public.mailroom_daily_shipments d
    on d.organization_id = p_organization_id
   and d.branch_id = v_branch_id
   and d.client_id = x.client_id
   and d.work_date = x.work_date
  where c.organization_id = p_organization_id
    and c.branch_id = v_branch_id
    and c.status::text = 'active'
    and x.work_date is not null
    and x.return_units >= 0;

  if v_valid_count <> v_input_count or v_valid_count <> (
    select count(*) from (
      select distinct x.client_id, x.work_date
      from jsonb_to_recordset(p_rows) as x(client_id uuid, work_date date)
    ) distinct_rows
  ) then
    raise exception 'Client returns contain an invalid client, date, duplicate, or negative count' using errcode = '22023';
  end if;

  update public.mailroom_daily_shipments d
  set returns_received = x.return_units,
      returns_processed = x.return_units,
      updated_at = clock_timestamp()
  from jsonb_to_recordset(p_rows) as x(client_id uuid, work_date date, return_units bigint)
  where d.organization_id = p_organization_id
    and d.branch_id = v_branch_id
    and d.client_id = x.client_id
    and d.work_date = x.work_date;
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> v_input_count then
    raise exception 'Not every client return aggregate was updated' using errcode = 'P0001';
  end if;

  update public.mailroom_daily_entries e
  set returns_received = totals.received,
      returns_processed = totals.processed,
      updated_at = clock_timestamp()
  from (
    select d.organization_id, d.branch_id, d.work_date,
      sum(d.returns_received)::bigint as received,
      sum(d.returns_processed)::bigint as processed
    from public.mailroom_daily_shipments d
    join (
      select distinct x.work_date
      from jsonb_to_recordset(p_rows) as x(work_date date)
    ) changed on changed.work_date = d.work_date
    where d.organization_id = p_organization_id and d.branch_id = v_branch_id
    group by d.organization_id, d.branch_id, d.work_date
  ) totals
  where e.organization_id = totals.organization_id
    and e.branch_id = totals.branch_id
    and e.work_date = totals.work_date;

  return v_updated_count;
end;
$$;

revoke all on function public.save_mailroom_client_returns(uuid, jsonb) from public, anon;
grant execute on function public.save_mailroom_client_returns(uuid, jsonb) to authenticated;

comment on column public.mailroom_daily_shipments.returns_received is
  'Aggregate MR-On hold return count for this client on Updated At date; no shipment rows are stored.';
comment on column public.mailroom_daily_shipments.returns_processed is
  'Processed return aggregate for this client; currently equal to returns_received.';

notify pgrst, 'reload schema';
