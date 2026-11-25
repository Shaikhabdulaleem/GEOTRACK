alter table public.mailroom_daily_turnaround_metrics
  add column if not exists shift_type text not null default 'all'
    check (shift_type in ('day', 'night', 'unassigned', 'all'));

alter table public.mailroom_daily_turnaround_metrics
  drop constraint if exists mailroom_daily_turnaround_metrics_pkey;

alter table public.mailroom_daily_turnaround_metrics
  add primary key (organization_id, branch_id, client_id, work_date, warehouse_code, shift_type);

create index if not exists mailroom_turnaround_org_branch_date_shift_idx
  on public.mailroom_daily_turnaround_metrics (organization_id, branch_id, work_date, shift_type, warehouse_code);

create or replace function public.save_mailroom_turnaround_metrics(
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
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 10000 then
    raise exception 'Turnaround metrics must be an array of at most 10000 aggregate rows' using errcode = '22023';
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
  from jsonb_to_recordset(p_rows)
    as x(client_id uuid, work_date date, warehouse_code text, shift_type text, total_minutes numeric, shipment_count bigint)
  join public.mailroom_clients c on c.id = x.client_id
  where c.organization_id = p_organization_id
    and c.branch_id = v_branch_id
    and x.work_date is not null
    and nullif(btrim(x.warehouse_code), '') is not null
    and coalesce(nullif(btrim(x.shift_type), ''), 'all') in ('day', 'night', 'unassigned', 'all')
    and x.total_minutes >= 0
    and x.shipment_count >= 0;
  if v_valid_count <> v_input_count or v_valid_count <> (
    select count(*) from (
      select distinct x.client_id, x.work_date, btrim(x.warehouse_code), coalesce(nullif(btrim(x.shift_type), ''), 'all')
      from jsonb_to_recordset(p_rows)
        as x(client_id uuid, work_date date, warehouse_code text, shift_type text)
    ) distinct_rows
  ) then
    raise exception 'Turnaround metrics contain an invalid client, date, branch, shift, duplicate, or negative value' using errcode = '22023';
  end if;

  delete from public.mailroom_daily_turnaround_metrics m
  using (
    select distinct x.client_id, x.work_date
    from jsonb_to_recordset(p_rows) as x(client_id uuid, work_date date)
  ) replaced
  where m.organization_id = p_organization_id
    and m.branch_id = v_branch_id
    and m.client_id = replaced.client_id
    and m.work_date = replaced.work_date;

  insert into public.mailroom_daily_turnaround_metrics (
    organization_id, branch_id, client_id, work_date, warehouse_code, shift_type, total_minutes, shipment_count
  )
  select p_organization_id, v_branch_id, x.client_id, x.work_date, btrim(x.warehouse_code),
    coalesce(nullif(btrim(x.shift_type), ''), 'all'),
    round(x.total_minutes, 2), x.shipment_count
  from jsonb_to_recordset(p_rows)
    as x(client_id uuid, work_date date, warehouse_code text, shift_type text, total_minutes numeric, shipment_count bigint)
  where x.shipment_count > 0;

  return v_input_count;
end;
$$;

revoke all on function public.save_mailroom_turnaround_metrics(uuid, jsonb) from public, anon;
grant execute on function public.save_mailroom_turnaround_metrics(uuid, jsonb) to authenticated;

comment on table public.mailroom_daily_turnaround_metrics is
  'Daily aggregate turnaround minutes and shipment samples by client, destination warehouse, and shift; no raw shipment rows are stored.';

notify pgrst, 'reload schema';
