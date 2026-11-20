-- Daily Mailroom entry, DSP allocation and decision-ready staffing inputs.

alter table public.mailroom_productivity_settings
  add column opening_return_backlog bigint not null default 0
  check (opening_return_backlog >= 0);

alter table public.mailroom_clients
  add column opening_unprocessed_units bigint not null default 0
  check (opening_unprocessed_units >= 0);

update public.mailroom_clients
set opening_unprocessed_units = opening_awaiting_validation + opening_ready_to_process;

alter table public.mailroom_activities
  add column volume_source text not null default 'client_mapping';

alter table public.mailroom_activities
  add constraint mailroom_activities_volume_source_check
  check (volume_source in ('client_mapping', 'dsp_allocated', 'returns_received'));

update public.mailroom_activities
set volume_source = case
  when code in ('DSP_CREATE', 'DSP_AWB', 'DSP_PREALERT') then 'dsp_allocated'
  when code = 'RETURNS' then 'returns_received'
  else 'client_mapping'
end;

create or replace function private.set_mailroom_activity_volume_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.volume_source := case
    when new.code in ('DSP_CREATE', 'DSP_AWB', 'DSP_PREALERT') then 'dsp_allocated'
    when new.code = 'RETURNS' then 'returns_received'
    else coalesce(new.volume_source, 'client_mapping')
  end;
  return new;
end;
$$;

create trigger set_mailroom_activity_volume_source
before insert or update of code on public.mailroom_activities
for each row execute function private.set_mailroom_activity_volume_source();

update public.mailroom_client_activities
set volume_driver = 'processed'
where volume_driver = 'validated';

delete from public.mailroom_client_activities m
using public.mailroom_activities a
where a.id = m.activity_id
  and a.code in ('DSP_CREATE', 'DSP_AWB', 'DSP_PREALERT', 'RETURNS');

create table public.mailroom_dsp_partners (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  code text not null,
  name text not null,
  status public.record_status not null default 'active',
  sort_order integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, code),
  unique (organization_id, id),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id)
);

create table public.mailroom_daily_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  work_date date not null,
  status text not null default 'draft' check (status in ('draft', 'finalized')),
  returns_received bigint not null default 0 check (returns_received >= 0),
  returns_processed bigint not null default 0 check (returns_processed >= 0),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  finalized_by uuid references auth.users(id) on delete set null,
  finalized_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, branch_id, work_date),
  unique (organization_id, id),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id),
  check ((status = 'finalized' and finalized_at is not null) or status = 'draft')
);

create table public.mailroom_daily_dsp_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  daily_entry_id uuid not null,
  partner_id uuid not null,
  allocated_units bigint not null default 0 check (allocated_units >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (daily_entry_id, partner_id),
  foreign key (organization_id, branch_id) references public.branches(organization_id, id),
  foreign key (organization_id, daily_entry_id) references public.mailroom_daily_entries(organization_id, id) on delete cascade,
  foreign key (organization_id, partner_id) references public.mailroom_dsp_partners(organization_id, id) on delete restrict
);

create index mailroom_dsp_partners_org_branch_status_idx
  on public.mailroom_dsp_partners (organization_id, branch_id, status);
create index mailroom_daily_entries_org_branch_date_idx
  on public.mailroom_daily_entries (organization_id, branch_id, work_date desc);
create index mailroom_daily_entries_org_status_date_idx
  on public.mailroom_daily_entries (organization_id, status, work_date desc);
create index mailroom_daily_entries_created_by_idx on public.mailroom_daily_entries (created_by);
create index mailroom_daily_entries_updated_by_idx on public.mailroom_daily_entries (updated_by);
create index mailroom_daily_entries_finalized_by_idx on public.mailroom_daily_entries (finalized_by);
create index mailroom_daily_dsp_allocations_org_entry_idx
  on public.mailroom_daily_dsp_allocations (organization_id, daily_entry_id);
create index mailroom_daily_dsp_allocations_org_partner_idx
  on public.mailroom_daily_dsp_allocations (organization_id, partner_id);
create index mailroom_daily_dsp_allocations_org_branch_idx
  on public.mailroom_daily_dsp_allocations (organization_id, branch_id);

create trigger set_updated_at before update on public.mailroom_dsp_partners
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.mailroom_daily_entries
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.mailroom_daily_dsp_allocations
  for each row execute function private.set_updated_at();

alter table public.mailroom_dsp_partners enable row level security;
alter table public.mailroom_daily_entries enable row level security;
alter table public.mailroom_daily_dsp_allocations enable row level security;

revoke all on table public.mailroom_dsp_partners, public.mailroom_daily_entries,
  public.mailroom_daily_dsp_allocations from public, anon, authenticated;
grant select on table public.mailroom_dsp_partners, public.mailroom_daily_entries,
  public.mailroom_daily_dsp_allocations to authenticated;
grant insert, update, delete on table public.mailroom_dsp_partners to authenticated;

create policy mailroom_dsp_partners_select on public.mailroom_dsp_partners
  for select to authenticated
  using ((select private.can_access_mailroom(organization_id, branch_id, false)));
create policy mailroom_dsp_partners_admin_insert on public.mailroom_dsp_partners
  for insert to authenticated
  with check ((select private.can_access_mailroom(organization_id, branch_id, true)));
create policy mailroom_dsp_partners_admin_update on public.mailroom_dsp_partners
  for update to authenticated
  using ((select private.can_access_mailroom(organization_id, branch_id, true)))
  with check ((select private.can_access_mailroom(organization_id, branch_id, true)));
create policy mailroom_dsp_partners_admin_delete on public.mailroom_dsp_partners
  for delete to authenticated
  using ((select private.can_access_mailroom(organization_id, branch_id, true)));

create policy mailroom_daily_entries_select on public.mailroom_daily_entries
  for select to authenticated
  using ((select private.can_access_mailroom(organization_id, branch_id, false)));
create policy mailroom_daily_dsp_allocations_select on public.mailroom_daily_dsp_allocations
  for select to authenticated
  using ((select private.can_access_mailroom(organization_id, branch_id, false)));

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
    organization_id, branch_id, daily_entry_id, partner_id, allocated_units
  )
  select p_organization_id, v_branch_id, v_entry_id, x.partner_id, x.allocated_units
  from jsonb_to_recordset(coalesce(p_dsp_allocations, '[]'::jsonb))
    as x(partner_id uuid, allocated_units bigint)
  join public.mailroom_dsp_partners p on p.id = x.partner_id
  where p.organization_id = p_organization_id
    and p.branch_id = v_branch_id
    and p.status::text = 'active'
    and x.allocated_units >= 0;

  if (select count(*) from jsonb_to_recordset(coalesce(p_dsp_allocations, '[]'::jsonb)) as x(partner_id uuid, allocated_units bigint))
     <> (select count(*) from public.mailroom_daily_dsp_allocations where daily_entry_id = v_entry_id) then
    raise exception 'DSP allocations contain an invalid partner, duplicate partner, or negative volume' using errcode = '22023';
  end if;

  select coalesce(sum(x.processed_units), 0) into v_processed
  from jsonb_to_recordset(p_clients) as x(client_id uuid, received_units bigint, processed_units bigint);
  select coalesce(sum(a.allocated_units), 0) into v_allocated
  from public.mailroom_daily_dsp_allocations a where a.daily_entry_id = v_entry_id;

  if p_status = 'finalized' and v_allocated <> v_processed then
    raise exception 'DSP allocation must equal processed shipments: processed %, allocated %, remaining %',
      v_processed, v_allocated, v_processed - v_allocated using errcode = '23514';
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

comment on table public.mailroom_daily_entries is
  'One auditable Mailroom operating day. Drafts are excluded from official staffing dashboards.';
comment on table public.mailroom_daily_dsp_allocations is
  'Shipment volume allocated to each last-mile DSP partner for one Mailroom operating day.';
comment on function public.save_mailroom_productivity_day(uuid, date, text, jsonb, bigint, bigint, jsonb, text) is
  'Atomically saves a daily Mailroom entry and finalizes only when backlog and DSP reconciliation checks pass.';
