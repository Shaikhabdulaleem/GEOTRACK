-- ============================================================================
-- Migration: 20261128140000_payroll_operations_module.sql
-- Description: Calendar-month Payroll Operations Module
--   - Organization payroll settings (currency, 30-day divisor, 8h day, 1.5x OT)
--   - Effective-dated employee compensations (overlap-protected) & recurring components
--   - Payroll runs, scoped employee entries, normalized line items, attendance exceptions
--   - Idempotent draft regeneration, review invalidation on source changes
--   - Immutable finalized runs & audited administrator reopening
--   - Strict RLS & RPC authorization reusing manager scopes
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Enum Types
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'payroll_run_status') then
    create type public.payroll_run_status as enum ('draft', 'under_review', 'finalized');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'payroll_review_status') then
    create type public.payroll_review_status as enum ('pending', 'reviewed');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'payroll_component_kind') then
    create type public.payroll_component_kind as enum ('allowance', 'deduction');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'payroll_line_category') then
    create type public.payroll_line_category as enum (
      'base_salary',
      'allowance',
      'overtime',
      'absence_deduction',
      'unpaid_leave_deduction',
      'recurring_deduction',
      'manual_allowance',
      'manual_deduction'
    );
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'payroll_exception_type') then
    create type public.payroll_exception_type as enum ('late', 'early_departure', 'incomplete_attendance');
  end if;
  if not exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname = 'payroll_exception_status') then
    create type public.payroll_exception_status as enum ('open', 'corrected', 'waived');
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 2. Tables
-- ----------------------------------------------------------------------------
create table if not exists public.payroll_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  currency_code text not null default 'SAR' check (currency_code ~ '^[A-Z]{3}$'),
  month_basis_days integer not null default 30 check (month_basis_days between 1 and 31),
  daily_hours numeric(5,2) not null default 8.00 check (daily_hours > 0 and daily_hours <= 24),
  overtime_multiplier numeric(5,2) not null default 1.50 check (overtime_multiplier >= 1.00 and overtime_multiplier <= 10.00),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.employee_compensations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  monthly_base_salary numeric(12,2) not null check (monthly_base_salary >= 0),
  currency_code text not null default 'SAR' check (currency_code ~ '^[A-Z]{3}$'),
  effective_from date not null,
  effective_to date,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (effective_to is null or effective_to >= effective_from),
  foreign key (organization_id, employee_id)
    references public.employee_profiles(organization_id, id) on delete cascade
);

create index if not exists employee_compensations_org_emp_dates_idx
  on public.employee_compensations (organization_id, employee_id, effective_from, effective_to);

create table if not exists public.employee_payroll_components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  component_kind public.payroll_component_kind not null,
  code text not null check (length(btrim(code)) between 1 and 64),
  name text not null check (length(btrim(name)) between 1 and 120),
  amount numeric(12,2) not null check (amount >= 0),
  effective_from date not null,
  effective_to date,
  is_active boolean not null default true,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (effective_to is null or effective_to >= effective_from),
  foreign key (organization_id, employee_id)
    references public.employee_profiles(organization_id, id) on delete cascade
);

create index if not exists employee_payroll_components_org_emp_idx
  on public.employee_payroll_components (organization_id, employee_id, is_active, effective_from);

create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payroll_month date not null check (payroll_month = date_trunc('month', payroll_month)::date),
  status public.payroll_run_status not null default 'draft',
  currency_code text not null default 'SAR' check (currency_code ~ '^[A-Z]{3}$'),
  month_basis_days integer not null default 30 check (month_basis_days between 1 and 31),
  daily_hours numeric(5,2) not null default 8.00 check (daily_hours > 0 and daily_hours <= 24),
  overtime_multiplier numeric(5,2) not null default 1.50 check (overtime_multiplier >= 1.00 and overtime_multiplier <= 10.00),
  organization_timezone text not null default 'UTC',
  employee_count integer not null default 0,
  total_gross_pay numeric(14,2) not null default 0,
  total_deductions numeric(14,2) not null default 0,
  total_net_pay numeric(14,2) not null default 0,
  generated_at timestamptz,
  generated_by uuid references auth.users(id) on delete set null,
  finalized_at timestamptz,
  finalized_by uuid references auth.users(id) on delete set null,
  reopened_at timestamptz,
  reopened_by uuid references auth.users(id) on delete set null,
  reopen_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, payroll_month),
  unique (organization_id, id)
);

create index if not exists payroll_runs_org_month_idx
  on public.payroll_runs (organization_id, payroll_month desc);

create table if not exists public.payroll_entries (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  employee_code text not null,
  employee_name text not null,
  branch_id uuid,
  branch_name text not null,
  department_id uuid,
  department_name text not null,
  job_title text,
  active_days integer not null default 0,
  payable_days numeric(6,2) not null default 0,
  scheduled_working_days integer not null default 0,
  worked_days integer not null default 0,
  absent_days integer not null default 0,
  unpaid_leave_days integer not null default 0,
  approved_overtime_minutes integer not null default 0,
  pending_overtime_minutes integer not null default 0,
  pending_overtime_count integer not null default 0,
  unresolved_exception_count integer not null default 0,
  base_pay numeric(12,2) not null default 0,
  allowances_pay numeric(12,2) not null default 0,
  overtime_pay numeric(12,2) not null default 0,
  manual_additions numeric(12,2) not null default 0,
  absence_deduction numeric(12,2) not null default 0,
  unpaid_leave_deduction numeric(12,2) not null default 0,
  recurring_deductions numeric(12,2) not null default 0,
  manual_deductions numeric(12,2) not null default 0,
  gross_pay numeric(12,2) not null default 0,
  total_deductions numeric(12,2) not null default 0,
  net_pay numeric(12,2) not null default 0,
  currency_code text not null default 'SAR' check (currency_code ~ '^[A-Z]{3}$'),
  review_status public.payroll_review_status not null default 'pending',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  source_fingerprint text not null default '',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (payroll_run_id, employee_id),
  unique (organization_id, id),
  foreign key (organization_id, employee_id)
    references public.employee_profiles(organization_id, id) on delete cascade
);

create index if not exists payroll_entries_run_idx
  on public.payroll_entries (payroll_run_id, department_id, branch_id);

create table if not exists public.payroll_line_items (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  payroll_entry_id uuid not null references public.payroll_entries(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  category public.payroll_line_category not null,
  direction text not null check (direction in ('earning', 'deduction')),
  code text not null check (length(btrim(code)) between 1 and 64),
  label text not null check (length(btrim(label)) between 1 and 200),
  is_manual boolean not null default false,
  quantity numeric(10,4),
  unit text,
  rate numeric(12,4),
  amount numeric(12,2) not null check (amount >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, employee_id)
    references public.employee_profiles(organization_id, id) on delete cascade
);

create index if not exists payroll_line_items_entry_idx
  on public.payroll_line_items (payroll_entry_id, is_manual);

create table if not exists public.payroll_exceptions (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  payroll_entry_id uuid not null references public.payroll_entries(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  work_date date not null,
  exception_type public.payroll_exception_type not null,
  minutes integer not null default 0 check (minutes >= 0),
  attendance_record_id uuid references public.attendance_records(id) on delete set null,
  status public.payroll_exception_status not null default 'open',
  waive_reason text,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (payroll_entry_id, work_date, exception_type),
  foreign key (organization_id, employee_id)
    references public.employee_profiles(organization_id, id) on delete cascade
);

create index if not exists payroll_exceptions_entry_status_idx
  on public.payroll_exceptions (payroll_entry_id, status);

-- ----------------------------------------------------------------------------
-- 3. Updated-at, Overlap Protection & Immutability Triggers
-- ----------------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'payroll_settings',
    'employee_compensations',
    'employee_payroll_components',
    'payroll_runs',
    'payroll_entries',
    'payroll_line_items',
    'payroll_exceptions'
  ] loop
    execute format('drop trigger if exists set_updated_at on public.%I', v_table);
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()',
      v_table
    );
  end loop;
end
$$;

create or replace function private.prevent_overlapping_compensation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.employee_compensations c
    where c.employee_id = new.employee_id
      and c.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and daterange(c.effective_from, coalesce(c.effective_to, 'infinity'::date), '[]')
       && daterange(new.effective_from, coalesce(new.effective_to, 'infinity'::date), '[]')
  ) then
    raise exception 'Overlapping compensation period for employee %', new.employee_id
      using errcode = '23P01';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_overlapping_compensation on public.employee_compensations;
create trigger trg_prevent_overlapping_compensation
  before insert or update on public.employee_compensations
  for each row execute function private.prevent_overlapping_compensation();

create or replace function private.enforce_finalized_payroll_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_status public.payroll_run_status;
begin
  if current_setting('geotrack.allow_payroll_reopen', true) = 'true' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_table_name = 'payroll_runs' then
    if old.status = 'finalized' then
      raise exception 'Finalized payroll run is immutable and must be reopened first'
        using errcode = '42501';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_run_id := case when tg_op = 'DELETE' then old.payroll_run_id else new.payroll_run_id end;
  select r.status into v_status
  from public.payroll_runs r
  where r.id = v_run_id;

  if v_status = 'finalized' then
    raise exception 'Finalized payroll run data is immutable'
      using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_immutable_payroll_runs on public.payroll_runs;
create trigger trg_immutable_payroll_runs
  before update or delete on public.payroll_runs
  for each row execute function private.enforce_finalized_payroll_immutability();

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'payroll_entries',
    'payroll_line_items',
    'payroll_exceptions'
  ] loop
    execute format('drop trigger if exists trg_immutable_%I on public.%I', v_table, v_table);
    execute format(
      'create trigger trg_immutable_%I before insert or update or delete on public.%I for each row execute function private.enforce_finalized_payroll_immutability()',
      v_table, v_table
    );
  end loop;
end
$$;

revoke all on function private.prevent_overlapping_compensation() from public, anon, authenticated;
revoke all on function private.enforce_finalized_payroll_immutability() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Row Level Security & Table Grants
-- ----------------------------------------------------------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'payroll_settings',
    'employee_compensations',
    'employee_payroll_components',
    'payroll_runs',
    'payroll_entries',
    'payroll_line_items',
    'payroll_exceptions'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon', v_table);
    execute format('grant select on table public.%I to authenticated', v_table);
    execute format('grant all on table public.%I to service_role', v_table);
  end loop;
end
$$;

drop policy if exists payroll_settings_select on public.payroll_settings;
create policy payroll_settings_select on public.payroll_settings
  for select to authenticated
  using (private.has_org_role(organization_id, array['administrator', 'manager']));

drop policy if exists payroll_runs_select on public.payroll_runs;
create policy payroll_runs_select on public.payroll_runs
  for select to authenticated
  using (private.has_org_role(organization_id, array['administrator', 'manager']));

drop policy if exists employee_compensations_select on public.employee_compensations;
create policy employee_compensations_select on public.employee_compensations
  for select to authenticated
  using (private.can_access_employee(organization_id, employee_id));

drop policy if exists employee_payroll_components_select on public.employee_payroll_components;
create policy employee_payroll_components_select on public.employee_payroll_components
  for select to authenticated
  using (private.can_access_employee(organization_id, employee_id));

drop policy if exists payroll_entries_select on public.payroll_entries;
create policy payroll_entries_select on public.payroll_entries
  for select to authenticated
  using (private.can_access_employee(organization_id, employee_id));

drop policy if exists payroll_line_items_select on public.payroll_line_items;
create policy payroll_line_items_select on public.payroll_line_items
  for select to authenticated
  using (private.can_access_employee(organization_id, employee_id));

drop policy if exists payroll_exceptions_select on public.payroll_exceptions;
create policy payroll_exceptions_select on public.payroll_exceptions
  for select to authenticated
  using (private.can_access_employee(organization_id, employee_id));

-- ----------------------------------------------------------------------------
-- 5. Internal Calculation Helpers
-- ----------------------------------------------------------------------------
create or replace function private.payroll_days_in_segment(
  p_seg_from date,
  p_seg_to date,
  p_month_start date,
  p_month_end date,
  p_emp_active_from date,
  p_emp_active_to date,
  p_month_basis_days integer
)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_calendar_days integer;
  v_days integer;
begin
  if p_seg_from is null or p_seg_to is null or p_seg_to < p_seg_from then
    return 0;
  end if;

  if p_seg_from = p_month_start and p_seg_to = p_month_end then
    return p_month_basis_days;
  end if;

  select count(*)::integer into v_days
  from generate_series(p_seg_from, p_seg_to, interval '1 day') as gs(d)
  where extract(day from gs.d)::integer <= p_month_basis_days;

  v_calendar_days := extract(day from p_month_end)::integer;

  -- Complete February (or shorter month) with mid-month salary change:
  -- top up the final segment ending on p_month_end so full-month employment totals p_month_basis_days.
  if p_emp_active_from = p_month_start
     and p_emp_active_to = p_month_end
     and p_seg_to = p_month_end
     and v_calendar_days < p_month_basis_days then
    v_days := v_days + (p_month_basis_days - v_calendar_days);
  end if;

  return greatest(0, least(p_month_basis_days, v_days));
end;
$$;

create or replace function private.recompute_payroll_entry_totals(p_payroll_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_manual_additions numeric(12,2);
  v_manual_deductions numeric(12,2);
  v_entry public.payroll_entries%rowtype;
  v_gross numeric(12,2);
  v_ded numeric(12,2);
  v_net numeric(12,2);
  v_unresolved integer;
  v_fingerprint text;
begin
  select * into v_entry
  from public.payroll_entries
  where id = p_payroll_entry_id;

  if not found then
    return;
  end if;

  v_run_id := v_entry.payroll_run_id;

  select
    coalesce(round(sum(amount) filter (where is_manual and direction = 'earning'), 2), 0),
    coalesce(round(sum(amount) filter (where is_manual and direction = 'deduction'), 2), 0)
  into v_manual_additions, v_manual_deductions
  from public.payroll_line_items
  where payroll_entry_id = p_payroll_entry_id;

  select count(*)::integer into v_unresolved
  from public.payroll_exceptions
  where payroll_entry_id = p_payroll_entry_id
    and status = 'open';

  v_gross := round(v_entry.base_pay + v_entry.allowances_pay + v_entry.overtime_pay + v_manual_additions, 2);
  v_ded := round(v_entry.absence_deduction + v_entry.unpaid_leave_deduction + v_entry.recurring_deductions + v_manual_deductions, 2);
  v_net := round(v_gross - v_ded, 2);

  v_fingerprint := md5(concat_ws('|',
    v_entry.payable_days::text,
    v_entry.base_pay::text,
    v_entry.allowances_pay::text,
    v_entry.overtime_pay::text,
    v_manual_additions::text,
    v_entry.absence_deduction::text,
    v_entry.unpaid_leave_deduction::text,
    v_entry.recurring_deductions::text,
    v_manual_deductions::text,
    v_entry.pending_overtime_count::text,
    v_unresolved::text
  ));

  update public.payroll_entries
  set manual_additions = v_manual_additions,
      manual_deductions = v_manual_deductions,
      unresolved_exception_count = v_unresolved,
      gross_pay = v_gross,
      total_deductions = v_ded,
      net_pay = v_net,
      source_fingerprint = v_fingerprint
  where id = p_payroll_entry_id;

  update public.payroll_runs r
  set employee_count = coalesce((select count(*)::integer from public.payroll_entries e where e.payroll_run_id = v_run_id), 0),
      total_gross_pay = coalesce((select round(sum(e.gross_pay), 2) from public.payroll_entries e where e.payroll_run_id = v_run_id), 0),
      total_deductions = coalesce((select round(sum(e.total_deductions), 2) from public.payroll_entries e where e.payroll_run_id = v_run_id), 0),
      total_net_pay = coalesce((select round(sum(e.net_pay), 2) from public.payroll_entries e where e.payroll_run_id = v_run_id), 0)
  where r.id = v_run_id;
end;
$$;

revoke all on function private.payroll_days_in_segment(date, date, date, date, date, date, integer) from public, anon, authenticated;
revoke all on function private.recompute_payroll_entry_totals(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. Settings & Compensation RPCs
-- ----------------------------------------------------------------------------
create or replace function public.get_payroll_settings(p_organization_id uuid)
returns table (
  organization_id uuid,
  currency_code text,
  month_basis_days integer,
  daily_hours numeric,
  overtime_multiplier numeric,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.has_org_role(p_organization_id, array['administrator', 'manager']) then
    raise exception 'Payroll access denied' using errcode = '42501';
  end if;

  return query
  select
    p_organization_id,
    coalesce(ps.currency_code, 'SAR'),
    coalesce(ps.month_basis_days, 30),
    coalesce(ps.daily_hours, 8.00),
    coalesce(ps.overtime_multiplier, 1.50),
    ps.updated_at
  from public.organizations o
  left join public.payroll_settings ps on ps.organization_id = o.id
  where o.id = p_organization_id;
end;
$$;

create or replace function public.upsert_payroll_settings(
  p_organization_id uuid,
  p_currency_code text,
  p_month_basis_days integer,
  p_daily_hours numeric,
  p_overtime_multiplier numeric
)
returns public.payroll_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.payroll_settings;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.has_org_role(p_organization_id, array['administrator']) then
    raise exception 'Administrator role required' using errcode = '42501';
  end if;

  insert into public.payroll_settings (
    organization_id, currency_code, month_basis_days, daily_hours, overtime_multiplier, updated_by
  ) values (
    p_organization_id, upper(btrim(p_currency_code)), p_month_basis_days, p_daily_hours, p_overtime_multiplier, (select auth.uid())
  )
  on conflict (organization_id) do update
    set currency_code = excluded.currency_code,
        month_basis_days = excluded.month_basis_days,
        daily_hours = excluded.daily_hours,
        overtime_multiplier = excluded.overtime_multiplier,
        updated_by = excluded.updated_by
  returning * into v_row;

  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, after_data)
  values (p_organization_id, (select auth.uid()), 'payroll_settings_updated', 'payroll_settings', p_organization_id, to_jsonb(v_row));

  return v_row;
end;
$$;

create or replace function public.list_employee_compensations(
  p_organization_id uuid,
  p_employee_id uuid default null
)
returns setof public.employee_compensations
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.has_org_role(p_organization_id, array['administrator', 'manager']) then
    raise exception 'Payroll access denied' using errcode = '42501';
  end if;

  return query
  select c.*
  from public.employee_compensations c
  where c.organization_id = p_organization_id
    and (p_employee_id is null or c.employee_id = p_employee_id)
    and private.can_access_employee(p_organization_id, c.employee_id)
  order by c.effective_from desc, c.created_at desc;
end;
$$;

create or replace function public.upsert_employee_compensation(
  p_organization_id uuid,
  p_employee_id uuid,
  p_monthly_base_salary numeric,
  p_currency_code text,
  p_effective_from date,
  p_effective_to date default null,
  p_notes text default null,
  p_id uuid default null
)
returns public.employee_compensations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.employee_compensations;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.has_org_role(p_organization_id, array['administrator']) then
    raise exception 'Administrator role required' using errcode = '42501';
  end if;
  if not private.employee_belongs_to_org(p_employee_id, p_organization_id) then
    raise exception 'Employee does not belong to organization' using errcode = '42501';
  end if;

  if p_id is not null then
    update public.employee_compensations
    set monthly_base_salary = p_monthly_base_salary,
        currency_code = upper(btrim(coalesce(p_currency_code, 'SAR'))),
        effective_from = p_effective_from,
        effective_to = p_effective_to,
        notes = nullif(btrim(p_notes), '')
    where id = p_id
      and organization_id = p_organization_id
      and employee_id = p_employee_id
    returning * into v_row;

    if not found then
      raise exception 'Compensation record not found' using errcode = 'P0002';
    end if;
  else
    insert into public.employee_compensations (
      organization_id, employee_id, monthly_base_salary, currency_code,
      effective_from, effective_to, notes, created_by
    ) values (
      p_organization_id, p_employee_id, p_monthly_base_salary, upper(btrim(coalesce(p_currency_code, 'SAR'))),
      p_effective_from, p_effective_to, nullif(btrim(p_notes), ''), (select auth.uid())
    )
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

create or replace function public.delete_employee_compensation(
  p_organization_id uuid,
  p_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.has_org_role(p_organization_id, array['administrator']) then
    raise exception 'Administrator role required' using errcode = '42501';
  end if;

  delete from public.employee_compensations
  where id = p_id and organization_id = p_organization_id;

  if not found then
    raise exception 'Compensation record not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.list_employee_payroll_components(
  p_organization_id uuid,
  p_employee_id uuid default null
)
returns setof public.employee_payroll_components
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.has_org_role(p_organization_id, array['administrator', 'manager']) then
    raise exception 'Payroll access denied' using errcode = '42501';
  end if;

  return query
  select c.*
  from public.employee_payroll_components c
  where c.organization_id = p_organization_id
    and (p_employee_id is null or c.employee_id = p_employee_id)
    and private.can_access_employee(p_organization_id, c.employee_id)
  order by c.effective_from desc, c.created_at desc;
end;
$$;

create or replace function public.upsert_employee_payroll_component(
  p_organization_id uuid,
  p_employee_id uuid,
  p_component_kind public.payroll_component_kind,
  p_code text,
  p_name text,
  p_amount numeric,
  p_effective_from date,
  p_effective_to date default null,
  p_is_active boolean default true,
  p_notes text default null,
  p_id uuid default null
)
returns public.employee_payroll_components
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.employee_payroll_components;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.has_org_role(p_organization_id, array['administrator']) then
    raise exception 'Administrator role required' using errcode = '42501';
  end if;
  if not private.employee_belongs_to_org(p_employee_id, p_organization_id) then
    raise exception 'Employee does not belong to organization' using errcode = '42501';
  end if;

  if p_id is not null then
    update public.employee_payroll_components
    set component_kind = p_component_kind,
        code = upper(btrim(p_code)),
        name = btrim(p_name),
        amount = p_amount,
        effective_from = p_effective_from,
        effective_to = p_effective_to,
        is_active = coalesce(p_is_active, true),
        notes = nullif(btrim(p_notes), '')
    where id = p_id
      and organization_id = p_organization_id
      and employee_id = p_employee_id
    returning * into v_row;

    if not found then
      raise exception 'Component record not found' using errcode = 'P0002';
    end if;
  else
    insert into public.employee_payroll_components (
      organization_id, employee_id, component_kind, code, name, amount,
      effective_from, effective_to, is_active, notes, created_by
    ) values (
      p_organization_id, p_employee_id, p_component_kind, upper(btrim(p_code)), btrim(p_name), p_amount,
      p_effective_from, p_effective_to, coalesce(p_is_active, true), nullif(btrim(p_notes), ''), (select auth.uid())
    )
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

create or replace function public.delete_employee_payroll_component(
  p_organization_id uuid,
  p_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.has_org_role(p_organization_id, array['administrator']) then
    raise exception 'Administrator role required' using errcode = '42501';
  end if;

  delete from public.employee_payroll_components
  where id = p_id and organization_id = p_organization_id;

  if not found then
    raise exception 'Component record not found' using errcode = 'P0002';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Payroll Run Generation & Calculation RPC
-- ----------------------------------------------------------------------------
create or replace function public.generate_payroll_run(
  p_organization_id uuid,
  p_payroll_month date
)
returns public.payroll_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month_start date := date_trunc('month', p_payroll_month)::date;
  v_month_end date := (date_trunc('month', p_payroll_month) + interval '1 month - 1 day')::date;
  v_org_tz text;
  v_today_org date;
  v_currency text := 'SAR';
  v_basis_days integer := 30;
  v_daily_hours numeric(5,2) := 8.00;
  v_ot_multiplier numeric(5,2) := 1.50;
  v_run public.payroll_runs;
  v_emp record;
  v_join_date date;
  v_active_from date;
  v_active_to date;
  v_active_days integer;
  v_entry_id uuid;
  v_prev_review_status public.payroll_review_status;
  v_prev_reviewed_by uuid;
  v_prev_reviewed_at timestamptz;
  v_prev_review_note text;
  v_prev_fingerprint text;
  v_comp record;
  v_seg_from date;
  v_seg_to date;
  v_seg_days integer;
  v_seg_amount numeric(12,2);
  v_total_payable_days numeric(6,2);
  v_base_pay numeric(12,2);
  v_allowances_pay numeric(12,2);
  v_recurring_deductions numeric(12,2);
  v_overtime_pay numeric(12,2);
  v_approved_ot_min integer;
  v_pending_ot_min integer;
  v_pending_ot_count integer;
  v_ot_rec record;
  v_ot_salary numeric(12,2);
  v_ot_amount numeric(12,2);
  v_absence_deduction numeric(12,2);
  v_unpaid_leave_deduction numeric(12,2);
  v_absent_days integer;
  v_unpaid_days integer;
  v_sched_working_days integer;
  v_worked_days integer;
  v_day_rec record;
  v_day_salary numeric(12,2);
  v_day_deduction numeric(12,2);
  v_is_unpaid_leave boolean;
  v_is_paid_leave boolean;
  v_att record;
  v_manual_add numeric(12,2);
  v_manual_ded numeric(12,2);
  v_unresolved integer;
  v_gross numeric(12,2);
  v_total_ded numeric(12,2);
  v_net numeric(12,2);
  v_new_fingerprint text;
  v_waived_exceptions jsonb;
  v_waived_item jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.has_org_role(p_organization_id, array['administrator']) then
    raise exception 'Administrator role required to generate payroll' using errcode = '42501';
  end if;

  select o.timezone into v_org_tz
  from public.organizations o
  where o.id = p_organization_id;

  if not found then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;

  v_org_tz := coalesce(nullif(btrim(v_org_tz), ''), 'UTC');
  v_today_org := (clock_timestamp() at time zone v_org_tz)::date;

  select
    coalesce(ps.currency_code, 'SAR'),
    coalesce(ps.month_basis_days, 30),
    coalesce(ps.daily_hours, 8.00),
    coalesce(ps.overtime_multiplier, 1.50)
  into v_currency, v_basis_days, v_daily_hours, v_ot_multiplier
  from public.organizations o
  left join public.payroll_settings ps on ps.organization_id = o.id
  where o.id = p_organization_id;

  select * into v_run
  from public.payroll_runs
  where organization_id = p_organization_id
    and payroll_month = v_month_start;

  if found then
    if v_run.status = 'finalized' then
      raise exception 'Finalized payroll run cannot be regenerated; reopen it first' using errcode = '42501';
    end if;

    -- Refresh settings snapshot while in draft; preserve run's snapshot if already under_review
    if v_run.status = 'draft' then
      update public.payroll_runs
      set currency_code = v_currency,
          month_basis_days = v_basis_days,
          daily_hours = v_daily_hours,
          overtime_multiplier = v_ot_multiplier,
          organization_timezone = v_org_tz,
          generated_at = clock_timestamp(),
          generated_by = (select auth.uid())
      where id = v_run.id
      returning * into v_run;
    else
      v_currency := v_run.currency_code;
      v_basis_days := v_run.month_basis_days;
      v_daily_hours := v_run.daily_hours;
      v_ot_multiplier := v_run.overtime_multiplier;

      update public.payroll_runs
      set generated_at = clock_timestamp(),
          generated_by = (select auth.uid())
      where id = v_run.id
      returning * into v_run;
    end if;
  else
    insert into public.payroll_runs (
      organization_id, payroll_month, status,
      currency_code, month_basis_days, daily_hours, overtime_multiplier, organization_timezone,
      generated_at, generated_by, created_by
    ) values (
      p_organization_id, v_month_start, 'draft',
      v_currency, v_basis_days, v_daily_hours, v_ot_multiplier, v_org_tz,
      clock_timestamp(), (select auth.uid()), (select auth.uid())
    )
    returning * into v_run;
  end if;

  -- Remove non-manual line items for regeneration; manual items stay intact
  delete from public.payroll_line_items
  where payroll_run_id = v_run.id
    and is_manual = false;

  for v_emp in
    select
      e.id,
      e.employee_code,
      e.full_name,
      e.branch_id,
      b.name as branch_name,
      e.department_id,
      d.name as department_name,
      e.job_title,
      e.joining_date,
      e.status_effective_date,
      e.employment_status,
      e.created_at
    from public.employee_profiles e
    join public.branches b on b.id = e.branch_id
    join public.departments d on d.id = e.department_id
    where e.organization_id = p_organization_id
    order by e.employee_code
  loop
    v_join_date := coalesce(v_emp.joining_date, v_emp.created_at::date);
    v_active_from := greatest(v_month_start, v_join_date);
    v_active_to := v_month_end;

    if v_emp.employment_status::text = 'active' then
      if v_emp.status_effective_date is not null and v_emp.status_effective_date > v_active_from then
        v_active_from := v_emp.status_effective_date;
      end if;
    elsif v_emp.employment_status::text in ('inactive', 'terminated') then
      if v_emp.status_effective_date is not null and v_emp.status_effective_date <> v_join_date then
        v_active_to := least(v_month_end, v_emp.status_effective_date);
      else
        -- Inactive without distinct effective date -> not active
        v_active_to := v_active_from - 1;
      end if;
    end if;

    if v_active_from > v_active_to then
      -- If employee had a stale entry from an earlier draft, remove it
      delete from public.payroll_entries
      where payroll_run_id = v_run.id and employee_id = v_emp.id;
      continue;
    end if;

    v_active_days := (v_active_to - v_active_from + 1);

    -- Check existing entry for review preservation & waived exceptions
    select id, review_status, reviewed_by, reviewed_at, review_note, source_fingerprint
    into v_entry_id, v_prev_review_status, v_prev_reviewed_by, v_prev_reviewed_at, v_prev_review_note, v_prev_fingerprint
    from public.payroll_entries
    where payroll_run_id = v_run.id and employee_id = v_emp.id;

    if v_entry_id is null then
      insert into public.payroll_entries (
        payroll_run_id, organization_id, employee_id,
        employee_code, employee_name, branch_id, branch_name, department_id, department_name, job_title,
        currency_code
      ) values (
        v_run.id, p_organization_id, v_emp.id,
        v_emp.employee_code, v_emp.full_name, v_emp.branch_id, v_emp.branch_name, v_emp.department_id, v_emp.department_name, v_emp.job_title,
        v_currency
      )
      returning id into v_entry_id;
    else
      -- Capture waived exceptions before clearing exceptions
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'work_date', px.work_date,
          'exception_type', px.exception_type::text,
          'minutes', px.minutes,
          'waive_reason', px.waive_reason,
          'resolved_by', px.resolved_by,
          'resolved_at', px.resolved_at
        )),
        '[]'::jsonb
      ) into v_waived_exceptions
      from public.payroll_exceptions px
      where px.payroll_entry_id = v_entry_id
        and px.status = 'waived';

      delete from public.payroll_exceptions
      where payroll_entry_id = v_entry_id;
    end if;

    -- 1) Base Salary Segments
    v_base_pay := 0;
    v_total_payable_days := 0;

    for v_comp in
      select c.id, c.monthly_base_salary, c.effective_from, c.effective_to
      from public.employee_compensations c
      where c.organization_id = p_organization_id
        and c.employee_id = v_emp.id
        and daterange(c.effective_from, coalesce(c.effective_to, 'infinity'::date), '[]')
         && daterange(v_active_from, v_active_to, '[]')
      order by c.effective_from
    loop
      v_seg_from := greatest(v_active_from, v_comp.effective_from);
      v_seg_to := least(v_active_to, coalesce(v_comp.effective_to, v_active_to));
      v_seg_days := private.payroll_days_in_segment(
        v_seg_from, v_seg_to, v_month_start, v_month_end, v_active_from, v_active_to, v_basis_days
      );

      if v_seg_days > 0 then
        v_seg_amount := round(v_comp.monthly_base_salary * (v_seg_days::numeric / v_basis_days::numeric), 2);
        v_base_pay := round(v_base_pay + v_seg_amount, 2);
        v_total_payable_days := v_total_payable_days + v_seg_days;

        insert into public.payroll_line_items (
          payroll_run_id, payroll_entry_id, organization_id, employee_id,
          category, direction, code, label, is_manual,
          quantity, unit, rate, amount, metadata
        ) values (
          v_run.id, v_entry_id, p_organization_id, v_emp.id,
          'base_salary', 'earning', 'BASE',
          format('Base Salary (%s to %s)', v_seg_from, v_seg_to),
          false,
          v_seg_days, 'days', round(v_comp.monthly_base_salary / v_basis_days::numeric, 4), v_seg_amount,
          jsonb_build_object('from', v_seg_from, 'to', v_seg_to, 'monthly_salary', v_comp.monthly_base_salary)
        );
      end if;
    end loop;

    -- 2) Recurring Allowances & Deductions
    v_allowances_pay := 0;
    v_recurring_deductions := 0;

    for v_comp in
      select c.id, c.component_kind, c.code, c.name, c.amount, c.effective_from, c.effective_to
      from public.employee_payroll_components c
      where c.organization_id = p_organization_id
        and c.employee_id = v_emp.id
        and c.is_active = true
        and daterange(c.effective_from, coalesce(c.effective_to, 'infinity'::date), '[]')
         && daterange(v_active_from, v_active_to, '[]')
      order by c.component_kind, c.code
    loop
      v_seg_from := greatest(v_active_from, v_comp.effective_from);
      v_seg_to := least(v_active_to, coalesce(v_comp.effective_to, v_active_to));
      v_seg_days := private.payroll_days_in_segment(
        v_seg_from, v_seg_to, v_month_start, v_month_end, v_active_from, v_active_to, v_basis_days
      );

      if v_seg_days > 0 then
        v_seg_amount := round(v_comp.amount * (v_seg_days::numeric / v_basis_days::numeric), 2);
        if v_comp.component_kind = 'allowance' then
          v_allowances_pay := round(v_allowances_pay + v_seg_amount, 2);
          insert into public.payroll_line_items (
            payroll_run_id, payroll_entry_id, organization_id, employee_id,
            category, direction, code, label, is_manual,
            quantity, unit, rate, amount, metadata
          ) values (
            v_run.id, v_entry_id, p_organization_id, v_emp.id,
            'allowance', 'earning', v_comp.code, v_comp.name, false,
            v_seg_days, 'days', round(v_comp.amount / v_basis_days::numeric, 4), v_seg_amount,
            jsonb_build_object('component_id', v_comp.id, 'from', v_seg_from, 'to', v_seg_to)
          );
        else
          v_recurring_deductions := round(v_recurring_deductions + v_seg_amount, 2);
          insert into public.payroll_line_items (
            payroll_run_id, payroll_entry_id, organization_id, employee_id,
            category, direction, code, label, is_manual,
            quantity, unit, rate, amount, metadata
          ) values (
            v_run.id, v_entry_id, p_organization_id, v_emp.id,
            'recurring_deduction', 'deduction', v_comp.code, v_comp.name, false,
            v_seg_days, 'days', round(v_comp.amount / v_basis_days::numeric, 4), v_seg_amount,
            jsonb_build_object('component_id', v_comp.id, 'from', v_seg_from, 'to', v_seg_to)
          );
        end if;
      end if;
    end loop;

    -- 3) Overtime (approved minutes x base hourly rate x multiplier; pending tracked as blocker)
    v_overtime_pay := 0;
    v_approved_ot_min := 0;
    v_pending_ot_min := 0;
    v_pending_ot_count := 0;

    for v_ot_rec in
      select
        ot.id,
        ot.status,
        ot.requested_minutes,
        coalesce(ot.approved_minutes, ot.requested_minutes, 0) as eff_approved_minutes,
        ar.attendance_date
      from public.overtime_records ot
      join public.attendance_records ar on ar.id = ot.attendance_record_id
      where ot.organization_id = p_organization_id
        and ot.employee_id = v_emp.id
        and ar.attendance_date between v_active_from and v_active_to
    loop
      if v_ot_rec.status::text = 'pending' then
        v_pending_ot_count := v_pending_ot_count + 1;
        v_pending_ot_min := v_pending_ot_min + coalesce(v_ot_rec.requested_minutes, 0);
      elsif v_ot_rec.status::text = 'approved' and v_ot_rec.eff_approved_minutes > 0 then
        select c.monthly_base_salary into v_ot_salary
        from public.employee_compensations c
        where c.organization_id = p_organization_id
          and c.employee_id = v_emp.id
          and v_ot_rec.attendance_date between c.effective_from and coalesce(c.effective_to, v_active_to)
        order by c.effective_from desc
        limit 1;

        v_ot_salary := coalesce(v_ot_salary, 0);
        v_approved_ot_min := v_approved_ot_min + v_ot_rec.eff_approved_minutes;
        if v_ot_salary > 0 then
          v_ot_amount := round(
            (v_ot_rec.eff_approved_minutes::numeric / 60.0)
            * (v_ot_salary / (v_basis_days::numeric * v_daily_hours))
            * v_ot_multiplier,
            2
          );
          v_overtime_pay := round(v_overtime_pay + v_ot_amount, 2);
        end if;
      end if;
    end loop;

    if v_approved_ot_min > 0 then
      insert into public.payroll_line_items (
        payroll_run_id, payroll_entry_id, organization_id, employee_id,
        category, direction, code, label, is_manual,
        quantity, unit, rate, amount, metadata
      ) values (
        v_run.id, v_entry_id, p_organization_id, v_emp.id,
        'overtime', 'earning', 'OT',
        format('Approved Overtime (%s hrs @ %sx)', round(v_approved_ot_min::numeric / 60.0, 2), v_ot_multiplier),
        false,
        round(v_approved_ot_min::numeric / 60.0, 4), 'hours',
        case when v_approved_ot_min > 0 then round(v_overtime_pay / (v_approved_ot_min::numeric / 60.0), 4) else 0 end,
        v_overtime_pay,
        jsonb_build_object('approved_minutes', v_approved_ot_min, 'multiplier', v_ot_multiplier)
      );
    end if;

    -- 4) Daily Schedule, Absences, Unpaid Leave (no double counting), and Attendance Exceptions
    v_absence_deduction := 0;
    v_unpaid_leave_deduction := 0;
    v_absent_days := 0;
    v_unpaid_days := 0;
    v_sched_working_days := 0;
    v_worked_days := 0;

    for v_day_rec in
      select s.work_date, s.state
      from private.resolve_employee_schedule_internal(v_emp.id, v_active_from, v_active_to) s
      order by s.work_date
    loop
      if v_day_rec.state = 'working' then
        v_sched_working_days := v_sched_working_days + 1;
      end if;

      select exists (
        select 1 from public.leave_requests lr
        where lr.organization_id = p_organization_id
          and lr.employee_id = v_emp.id
          and lr.status = 'approved'
          and lr.leave_type = 'unpaid'
          and v_day_rec.work_date between lr.from_date and lr.to_date
      ) into v_is_unpaid_leave;

      select exists (
        select 1 from public.leave_requests lr
        where lr.organization_id = p_organization_id
          and lr.employee_id = v_emp.id
          and lr.status = 'approved'
          and lr.leave_type <> 'unpaid'
          and v_day_rec.work_date between lr.from_date and lr.to_date
      ) into v_is_paid_leave;

      select c.monthly_base_salary into v_day_salary
      from public.employee_compensations c
      where c.organization_id = p_organization_id
        and c.employee_id = v_emp.id
        and v_day_rec.work_date between c.effective_from and coalesce(c.effective_to, v_active_to)
      order by c.effective_from desc
      limit 1;
      v_day_salary := coalesce(v_day_salary, 0);
      v_day_deduction := round(v_day_salary / v_basis_days::numeric, 2);

      select * into v_att
      from public.attendance_records ar
      where ar.organization_id = p_organization_id
        and ar.employee_id = v_emp.id
        and ar.attendance_date = v_day_rec.work_date
      order by ar.session_number asc
      limit 1;

      if found and coalesce(v_att.worked_minutes, 0) > 0 then
        v_worked_days := v_worked_days + 1;
      end if;

      -- Unpaid leave takes precedence so overlapping absence + unpaid leave is never double-counted
      if v_is_unpaid_leave then
        v_unpaid_days := v_unpaid_days + 1;
        v_unpaid_leave_deduction := round(v_unpaid_leave_deduction + v_day_deduction, 2);
      elsif not v_is_paid_leave and v_day_rec.state = 'working' then
        if v_att.id is not null then
          if v_att.status::text = 'absent' then
            v_absent_days := v_absent_days + 1;
            v_absence_deduction := round(v_absence_deduction + v_day_deduction, 2);
          elsif v_att.status::text <> 'on_leave' then
            -- Attendance exceptions: incomplete, late, early departure
            if v_att.status::text in ('missing_check_in', 'missing_check_out', 'invalid')
               or (v_att.check_in_at is not null and v_att.check_out_at is null)
               or (v_att.check_out_at is not null and v_att.check_in_at is null) then
              insert into public.payroll_exceptions (
                payroll_run_id, payroll_entry_id, organization_id, employee_id,
                work_date, exception_type, minutes, attendance_record_id, status
              ) values (
                v_run.id, v_entry_id, p_organization_id, v_emp.id,
                v_day_rec.work_date, 'incomplete_attendance', coalesce(v_att.missing_minutes, 0), v_att.id, 'open'
              )
              on conflict (payroll_entry_id, work_date, exception_type) do nothing;
            end if;

            if coalesce(v_att.late_minutes, 0) > 0 then
              insert into public.payroll_exceptions (
                payroll_run_id, payroll_entry_id, organization_id, employee_id,
                work_date, exception_type, minutes, attendance_record_id, status
              ) values (
                v_run.id, v_entry_id, p_organization_id, v_emp.id,
                v_day_rec.work_date, 'late', v_att.late_minutes, v_att.id, 'open'
              )
              on conflict (payroll_entry_id, work_date, exception_type) do nothing;
            end if;

            if coalesce(v_att.early_leaving_minutes, 0) > 0 then
              insert into public.payroll_exceptions (
                payroll_run_id, payroll_entry_id, organization_id, employee_id,
                work_date, exception_type, minutes, attendance_record_id, status
              ) values (
                v_run.id, v_entry_id, p_organization_id, v_emp.id,
                v_day_rec.work_date, 'early_departure', v_att.early_leaving_minutes, v_att.id, 'open'
              )
              on conflict (payroll_entry_id, work_date, exception_type) do nothing;
            end if;
          end if;
        elsif v_day_rec.work_date < v_today_org then
          -- Past scheduled working day with no attendance record and no leave -> incomplete attendance exception
          insert into public.payroll_exceptions (
            payroll_run_id, payroll_entry_id, organization_id, employee_id,
            work_date, exception_type, minutes, attendance_record_id, status
          ) values (
            v_run.id, v_entry_id, p_organization_id, v_emp.id,
            v_day_rec.work_date, 'incomplete_attendance', round(v_daily_hours * 60)::integer, null, 'open'
          )
          on conflict (payroll_entry_id, work_date, exception_type) do nothing;
        end if;
      end if;
    end loop;

    -- Restore valid waivers from prior regeneration
    if v_waived_exceptions is not null and jsonb_array_length(v_waived_exceptions) > 0 then
      for v_waived_item in select * from jsonb_array_elements(v_waived_exceptions)
      loop
        update public.payroll_exceptions
        set status = 'waived',
            waive_reason = v_waived_item->>'waive_reason',
            resolved_by = nullif(v_waived_item->>'resolved_by', '')::uuid,
            resolved_at = nullif(v_waived_item->>'resolved_at', '')::timestamptz
        where payroll_entry_id = v_entry_id
          and work_date = (v_waived_item->>'work_date')::date
          and exception_type::text = v_waived_item->>'exception_type'
          and minutes = (v_waived_item->>'minutes')::integer;
      end loop;
    end if;

    if v_absent_days > 0 then
      insert into public.payroll_line_items (
        payroll_run_id, payroll_entry_id, organization_id, employee_id,
        category, direction, code, label, is_manual,
        quantity, unit, rate, amount, metadata
      ) values (
        v_run.id, v_entry_id, p_organization_id, v_emp.id,
        'absence_deduction', 'deduction', 'ABSENCE',
        format('Confirmed Absence Deduction (%s days)', v_absent_days),
        false,
        v_absent_days, 'days', round(v_absence_deduction / v_absent_days::numeric, 4), v_absence_deduction,
        jsonb_build_object('absent_days', v_absent_days)
      );
    end if;

    if v_unpaid_days > 0 then
      insert into public.payroll_line_items (
        payroll_run_id, payroll_entry_id, organization_id, employee_id,
        category, direction, code, label, is_manual,
        quantity, unit, rate, amount, metadata
      ) values (
        v_run.id, v_entry_id, p_organization_id, v_emp.id,
        'unpaid_leave_deduction', 'deduction', 'UNPAID_LEAVE',
        format('Approved Unpaid Leave Deduction (%s days)', v_unpaid_days),
        false,
        v_unpaid_days, 'days', round(v_unpaid_leave_deduction / v_unpaid_days::numeric, 4), v_unpaid_leave_deduction,
        jsonb_build_object('unpaid_leave_days', v_unpaid_days)
      );
    end if;

    -- Manual line items & unresolved exception count
    select
      coalesce(round(sum(amount) filter (where is_manual and direction = 'earning'), 2), 0),
      coalesce(round(sum(amount) filter (where is_manual and direction = 'deduction'), 2), 0)
    into v_manual_add, v_manual_ded
    from public.payroll_line_items
    where payroll_entry_id = v_entry_id;

    select count(*)::integer into v_unresolved
    from public.payroll_exceptions
    where payroll_entry_id = v_entry_id and status = 'open';

    v_gross := round(v_base_pay + v_allowances_pay + v_overtime_pay + v_manual_add, 2);
    v_total_ded := round(v_absence_deduction + v_unpaid_leave_deduction + v_recurring_deductions + v_manual_ded, 2);
    v_net := round(v_gross - v_total_ded, 2);

    v_new_fingerprint := md5(concat_ws('|',
      v_total_payable_days::text,
      v_base_pay::text,
      v_allowances_pay::text,
      v_overtime_pay::text,
      v_manual_add::text,
      v_absence_deduction::text,
      v_unpaid_leave_deduction::text,
      v_recurring_deductions::text,
      v_manual_ded::text,
      v_pending_ot_count::text,
      v_unresolved::text
    ));

    -- Source changes reset affected reviews; identical fingerprint preserves review
    if v_prev_fingerprint is not null and v_prev_fingerprint = v_new_fingerprint and v_prev_review_status = 'reviewed' then
      null; -- keep review_status, reviewed_by, reviewed_at, review_note
    else
      v_prev_review_status := 'pending';
      v_prev_reviewed_by := null;
      v_prev_reviewed_at := null;
      v_prev_review_note := null;
    end if;

    update public.payroll_entries
    set employee_code = v_emp.employee_code,
        employee_name = v_emp.full_name,
        branch_id = v_emp.branch_id,
        branch_name = v_emp.branch_name,
        department_id = v_emp.department_id,
        department_name = v_emp.department_name,
        job_title = v_emp.job_title,
        active_days = v_active_days,
        payable_days = v_total_payable_days,
        scheduled_working_days = v_sched_working_days,
        worked_days = v_worked_days,
        absent_days = v_absent_days,
        unpaid_leave_days = v_unpaid_days,
        approved_overtime_minutes = v_approved_ot_min,
        pending_overtime_minutes = v_pending_ot_min,
        pending_overtime_count = v_pending_ot_count,
        unresolved_exception_count = v_unresolved,
        base_pay = v_base_pay,
        allowances_pay = v_allowances_pay,
        overtime_pay = v_overtime_pay,
        manual_additions = v_manual_add,
        absence_deduction = v_absence_deduction,
        unpaid_leave_deduction = v_unpaid_leave_deduction,
        recurring_deductions = v_recurring_deductions,
        manual_deductions = v_manual_ded,
        gross_pay = v_gross,
        total_deductions = v_total_ded,
        net_pay = v_net,
        currency_code = v_currency,
        review_status = v_prev_review_status,
        reviewed_by = v_prev_reviewed_by,
        reviewed_at = v_prev_reviewed_at,
        review_note = v_prev_review_note,
        source_fingerprint = v_new_fingerprint
    where id = v_entry_id;
  end loop;

  update public.payroll_runs r
  set employee_count = coalesce((select count(*)::integer from public.payroll_entries e where e.payroll_run_id = v_run.id), 0),
      total_gross_pay = coalesce((select round(sum(e.gross_pay), 2) from public.payroll_entries e where e.payroll_run_id = v_run.id), 0),
      total_deductions = coalesce((select round(sum(e.total_deductions), 2) from public.payroll_entries e where e.payroll_run_id = v_run.id), 0),
      total_net_pay = coalesce((select round(sum(e.net_pay), 2) from public.payroll_entries e where e.payroll_run_id = v_run.id), 0)
  where r.id = v_run.id
  returning * into v_run;

  return v_run;
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. Scoped Query, Review, Exception, Adjustment, Finalize, Reopen & Export RPCs
-- ----------------------------------------------------------------------------
create or replace function public.list_payroll_runs(p_organization_id uuid)
returns setof public.payroll_runs
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.has_org_role(p_organization_id, array['administrator', 'manager']) then
    raise exception 'Payroll access denied' using errcode = '42501';
  end if;

  return query
  select r.*
  from public.payroll_runs r
  where r.organization_id = p_organization_id
  order by r.payroll_month desc;
end;
$$;

create or replace function public.list_payroll_entries(
  p_organization_id uuid,
  p_payroll_run_id uuid,
  p_search text default null,
  p_branch_id uuid default null,
  p_department_id uuid default null,
  p_review_status public.payroll_review_status default null
)
returns setof public.payroll_entries
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.has_org_role(p_organization_id, array['administrator', 'manager']) then
    raise exception 'Payroll access denied' using errcode = '42501';
  end if;

  return query
  select e.*
  from public.payroll_entries e
  where e.organization_id = p_organization_id
    and e.payroll_run_id = p_payroll_run_id
    and private.can_access_employee(p_organization_id, e.employee_id)
    and (p_branch_id is null or e.branch_id = p_branch_id)
    and (p_department_id is null or e.department_id = p_department_id)
    and (p_review_status is null or e.review_status = p_review_status)
    and (
      nullif(btrim(p_search), '') is null
      or e.employee_name ilike '%' || btrim(p_search) || '%'
      or e.employee_code ilike '%' || btrim(p_search) || '%'
    )
  order by e.employee_code asc;
end;
$$;

create or replace function public.get_payroll_entry_detail(
  p_organization_id uuid,
  p_payroll_entry_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entry public.payroll_entries;
  v_items jsonb;
  v_exceptions jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select * into v_entry
  from public.payroll_entries e
  where e.id = p_payroll_entry_id
    and e.organization_id = p_organization_id;

  if not found then
    raise exception 'Payroll entry not found' using errcode = 'P0002';
  end if;

  if not private.can_access_employee(p_organization_id, v_entry.employee_id) then
    raise exception 'Payroll entry access denied' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(li) order by li.is_manual, li.category, li.code), '[]'::jsonb)
  into v_items
  from public.payroll_line_items li
  where li.payroll_entry_id = p_payroll_entry_id;

  select coalesce(jsonb_agg(to_jsonb(px) order by px.work_date, px.exception_type), '[]'::jsonb)
  into v_exceptions
  from public.payroll_exceptions px
  where px.payroll_entry_id = p_payroll_entry_id;

  return jsonb_build_object(
    'entry', to_jsonb(v_entry),
    'line_items', v_items,
    'exceptions', v_exceptions
  );
end;
$$;

create or replace function public.add_payroll_manual_adjustment(
  p_organization_id uuid,
  p_payroll_entry_id uuid,
  p_direction text,
  p_code text,
  p_label text,
  p_amount numeric,
  p_notes text default null
)
returns public.payroll_line_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.payroll_entries;
  v_run_status public.payroll_run_status;
  v_category public.payroll_line_category;
  v_item public.payroll_line_items;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.has_org_role(p_organization_id, array['administrator']) then
    raise exception 'Administrator role required' using errcode = '42501';
  end if;
  if p_direction not in ('earning', 'deduction') then
    raise exception 'Invalid adjustment direction' using errcode = '22023';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'Adjustment amount must be non-negative' using errcode = '22023';
  end if;

  select * into v_entry
  from public.payroll_entries
  where id = p_payroll_entry_id and organization_id = p_organization_id;

  if not found then
    raise exception 'Payroll entry not found' using errcode = 'P0002';
  end if;

  select status into v_run_status from public.payroll_runs where id = v_entry.payroll_run_id;
  if v_run_status = 'finalized' then
    raise exception 'Cannot modify finalized payroll run' using errcode = '42501';
  end if;

  v_category := case when p_direction = 'earning' then 'manual_allowance' else 'manual_deduction' end;

  insert into public.payroll_line_items (
    payroll_run_id, payroll_entry_id, organization_id, employee_id,
    category, direction, code, label, is_manual,
    quantity, unit, rate, amount, metadata, created_by
  ) values (
    v_entry.payroll_run_id, v_entry.id, p_organization_id, v_entry.employee_id,
    v_category, p_direction, upper(btrim(p_code)), btrim(p_label), true,
    1, 'fixed', round(p_amount, 4), round(p_amount, 2),
    jsonb_build_object('notes', nullif(btrim(p_notes), '')),
    (select auth.uid())
  )
  returning * into v_item;

  perform private.recompute_payroll_entry_totals(v_entry.id);

  -- Reset review if already reviewed since manual adjustment changed totals
  update public.payroll_entries
  set review_status = 'pending',
      reviewed_by = null,
      reviewed_at = null,
      review_note = null
  where id = v_entry.id and review_status = 'reviewed';

  return v_item;
end;
$$;

create or replace function public.delete_payroll_manual_adjustment(
  p_organization_id uuid,
  p_line_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.payroll_line_items;
  v_run_status public.payroll_run_status;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.has_org_role(p_organization_id, array['administrator']) then
    raise exception 'Administrator role required' using errcode = '42501';
  end if;

  select * into v_item
  from public.payroll_line_items
  where id = p_line_item_id and organization_id = p_organization_id;

  if not found or not v_item.is_manual then
    raise exception 'Manual adjustment not found' using errcode = 'P0002';
  end if;

  select status into v_run_status from public.payroll_runs where id = v_item.payroll_run_id;
  if v_run_status = 'finalized' then
    raise exception 'Cannot modify finalized payroll run' using errcode = '42501';
  end if;

  delete from public.payroll_line_items where id = p_line_item_id;
  perform private.recompute_payroll_entry_totals(v_item.payroll_entry_id);

  update public.payroll_entries
  set review_status = 'pending',
      reviewed_by = null,
      reviewed_at = null,
      review_note = null
  where id = v_item.payroll_entry_id and review_status = 'reviewed';
end;
$$;

create or replace function public.waive_payroll_exception(
  p_organization_id uuid,
  p_exception_id uuid,
  p_reason text
)
returns public.payroll_exceptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ex public.payroll_exceptions;
  v_run_status public.payroll_run_status;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Waiver reason is required' using errcode = '22023';
  end if;

  select * into v_ex
  from public.payroll_exceptions
  where id = p_exception_id and organization_id = p_organization_id;

  if not found then
    raise exception 'Payroll exception not found' using errcode = 'P0002';
  end if;

  if not private.can_access_employee(p_organization_id, v_ex.employee_id) then
    raise exception 'Payroll exception access denied' using errcode = '42501';
  end if;

  select status into v_run_status from public.payroll_runs where id = v_ex.payroll_run_id;
  if v_run_status = 'finalized' then
    raise exception 'Cannot waive exception on a finalized payroll run' using errcode = '42501';
  end if;

  update public.payroll_exceptions
  set status = 'waived',
      waive_reason = btrim(p_reason),
      resolved_by = (select auth.uid()),
      resolved_at = clock_timestamp()
  where id = p_exception_id
  returning * into v_ex;

  perform private.recompute_payroll_entry_totals(v_ex.payroll_entry_id);

  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    p_organization_id,
    (select auth.uid()),
    'payroll_exception_waived',
    'payroll_exception',
    v_ex.id,
    jsonb_build_object('reason', btrim(p_reason), 'employee_id', v_ex.employee_id, 'work_date', v_ex.work_date)
  );

  return v_ex;
end;
$$;

create or replace function public.review_payroll_entry(
  p_organization_id uuid,
  p_payroll_entry_id uuid,
  p_review_status public.payroll_review_status,
  p_review_note text default null
)
returns public.payroll_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.payroll_entries;
  v_run_status public.payroll_run_status;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select * into v_entry
  from public.payroll_entries
  where id = p_payroll_entry_id and organization_id = p_organization_id;

  if not found then
    raise exception 'Payroll entry not found' using errcode = 'P0002';
  end if;

  if not private.can_access_employee(p_organization_id, v_entry.employee_id) then
    raise exception 'Payroll entry access denied' using errcode = '42501';
  end if;

  select status into v_run_status from public.payroll_runs where id = v_entry.payroll_run_id;
  if v_run_status = 'finalized' then
    raise exception 'Finalized payroll run cannot be reviewed' using errcode = '42501';
  end if;

  if p_review_status = 'reviewed' then
    if v_entry.unresolved_exception_count > 0 then
      raise exception 'Resolve or waive all attendance exceptions before marking reviewed' using errcode = 'P0001';
    end if;
    if v_entry.pending_overtime_count > 0 then
      raise exception 'Resolve all pending overtime records before marking reviewed' using errcode = 'P0001';
    end if;
  end if;

  update public.payroll_entries
  set review_status = p_review_status,
      reviewed_by = case when p_review_status = 'reviewed' then (select auth.uid()) else null end,
      reviewed_at = case when p_review_status = 'reviewed' then clock_timestamp() else null end,
      review_note = nullif(btrim(p_review_note), '')
  where id = p_payroll_entry_id
  returning * into v_entry;

  return v_entry;
end;
$$;

create or replace function public.submit_payroll_run_for_review(
  p_organization_id uuid,
  p_payroll_run_id uuid
)
returns public.payroll_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.payroll_runs;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.has_org_role(p_organization_id, array['administrator']) then
    raise exception 'Administrator role required' using errcode = '42501';
  end if;

  select * into v_run
  from public.payroll_runs
  where id = p_payroll_run_id and organization_id = p_organization_id;

  if not found then
    raise exception 'Payroll run not found' using errcode = 'P0002';
  end if;
  if v_run.status = 'finalized' then
    raise exception 'Finalized payroll run cannot be moved to review' using errcode = '42501';
  end if;

  update public.payroll_runs
  set status = 'under_review'
  where id = p_payroll_run_id
  returning * into v_run;

  return v_run;
end;
$$;

create or replace function public.finalize_payroll_run(
  p_organization_id uuid,
  p_payroll_run_id uuid
)
returns public.payroll_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.payroll_runs;
  v_entry_count integer;
  v_unresolved_exceptions integer;
  v_pending_ot integer;
  v_unreviewed integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.has_org_role(p_organization_id, array['administrator']) then
    raise exception 'Administrator role required to finalize payroll' using errcode = '42501';
  end if;

  select * into v_run
  from public.payroll_runs
  where id = p_payroll_run_id and organization_id = p_organization_id;

  if not found then
    raise exception 'Payroll run not found' using errcode = 'P0002';
  end if;
  if v_run.status = 'finalized' then
    return v_run;
  end if;

  select
    count(*)::integer,
    coalesce(sum(unresolved_exception_count), 0)::integer,
    coalesce(sum(pending_overtime_count), 0)::integer,
    count(*) filter (where review_status <> 'reviewed')::integer
  into v_entry_count, v_unresolved_exceptions, v_pending_ot, v_unreviewed
  from public.payroll_entries
  where payroll_run_id = p_payroll_run_id;

  if v_entry_count = 0 then
    raise exception 'Cannot finalize an empty payroll run' using errcode = 'P0001';
  end if;
  if v_unresolved_exceptions > 0 then
    raise exception 'Cannot finalize payroll: % unresolved attendance exception(s) remain', v_unresolved_exceptions using errcode = 'P0001';
  end if;
  if v_pending_ot > 0 then
    raise exception 'Cannot finalize payroll: % pending overtime record(s) remain', v_pending_ot using errcode = 'P0001';
  end if;
  if v_unreviewed > 0 then
    raise exception 'Cannot finalize payroll: % unreviewed employee entry/entries remain', v_unreviewed using errcode = 'P0001';
  end if;

  update public.payroll_runs
  set status = 'finalized',
      finalized_at = clock_timestamp(),
      finalized_by = (select auth.uid())
  where id = p_payroll_run_id
  returning * into v_run;

  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, after_data)
  values (p_organization_id, (select auth.uid()), 'payroll_run_finalized', 'payroll_run', v_run.id, to_jsonb(v_run));

  return v_run;
end;
$$;

create or replace function public.reopen_payroll_run(
  p_organization_id uuid,
  p_payroll_run_id uuid,
  p_reason text
)
returns public.payroll_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before public.payroll_runs;
  v_after public.payroll_runs;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.has_org_role(p_organization_id, array['administrator']) then
    raise exception 'Administrator role required to reopen payroll' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'A reason is required to reopen a finalized payroll run' using errcode = '22023';
  end if;

  select * into v_before
  from public.payroll_runs
  where id = p_payroll_run_id and organization_id = p_organization_id;

  if not found then
    raise exception 'Payroll run not found' using errcode = 'P0002';
  end if;
  if v_before.status <> 'finalized' then
    raise exception 'Only finalized payroll runs can be reopened' using errcode = 'P0001';
  end if;

  perform set_config('geotrack.allow_payroll_reopen', 'true', true);

  update public.payroll_runs
  set status = 'under_review',
      reopened_at = clock_timestamp(),
      reopened_by = (select auth.uid()),
      reopen_reason = btrim(p_reason)
  where id = p_payroll_run_id
  returning * into v_after;

  insert into public.audit_logs (
    organization_id, actor_user_id, action, entity_type, entity_id,
    before_data, after_data, metadata
  ) values (
    p_organization_id, (select auth.uid()), 'payroll_run_reopened', 'payroll_run', v_after.id,
    to_jsonb(v_before), to_jsonb(v_after), jsonb_build_object('reason', btrim(p_reason))
  );

  return v_after;
end;
$$;

create or replace function public.export_payroll_run_rows(
  p_organization_id uuid,
  p_payroll_run_id uuid
)
returns table (
  employee_code text,
  employee_name text,
  branch_name text,
  department_name text,
  job_title text,
  base_pay numeric,
  allowances_pay numeric,
  overtime_hours numeric,
  overtime_pay numeric,
  absence_deduction numeric,
  unpaid_leave_deduction numeric,
  other_adjustments numeric,
  gross_pay numeric,
  total_deductions numeric,
  net_pay numeric,
  currency_code text,
  review_status public.payroll_review_status
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status public.payroll_run_status;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.has_org_role(p_organization_id, array['administrator']) then
    raise exception 'Administrator role required to export payroll CSV' using errcode = '42501';
  end if;

  select r.status into v_status
  from public.payroll_runs r
  where r.id = p_payroll_run_id and r.organization_id = p_organization_id;

  if not found then
    raise exception 'Payroll run not found' using errcode = 'P0002';
  end if;
  if v_status <> 'finalized' then
    raise exception 'Only finalized payroll runs can be exported' using errcode = 'P0001';
  end if;

  return query
  select
    e.employee_code,
    e.employee_name,
    e.branch_name,
    e.department_name,
    e.job_title,
    e.base_pay,
    e.allowances_pay,
    round(e.approved_overtime_minutes::numeric / 60.0, 2) as overtime_hours,
    e.overtime_pay,
    e.absence_deduction,
    e.unpaid_leave_deduction,
    round(e.manual_additions - e.manual_deductions - e.recurring_deductions, 2) as other_adjustments,
    e.gross_pay,
    e.total_deductions,
    e.net_pay,
    e.currency_code,
    e.review_status
  from public.payroll_entries e
  where e.payroll_run_id = p_payroll_run_id
    and e.organization_id = p_organization_id
  order by e.employee_code asc;
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. Function Execute Grants (Authenticated only, never Anon)
-- ----------------------------------------------------------------------------
do $$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.get_payroll_settings(uuid)',
    'public.upsert_payroll_settings(uuid,text,integer,numeric,numeric)',
    'public.list_employee_compensations(uuid,uuid)',
    'public.upsert_employee_compensation(uuid,uuid,numeric,text,date,date,text,uuid)',
    'public.delete_employee_compensation(uuid,uuid)',
    'public.list_employee_payroll_components(uuid,uuid)',
    'public.upsert_employee_payroll_component(uuid,uuid,public.payroll_component_kind,text,text,numeric,date,date,boolean,text,uuid)',
    'public.delete_employee_payroll_component(uuid,uuid)',
    'public.generate_payroll_run(uuid,date)',
    'public.list_payroll_runs(uuid)',
    'public.list_payroll_entries(uuid,uuid,text,uuid,uuid,public.payroll_review_status)',
    'public.get_payroll_entry_detail(uuid,uuid)',
    'public.add_payroll_manual_adjustment(uuid,uuid,text,text,text,numeric,text)',
    'public.delete_payroll_manual_adjustment(uuid,uuid)',
    'public.waive_payroll_exception(uuid,uuid,text)',
    'public.review_payroll_entry(uuid,uuid,public.payroll_review_status,text)',
    'public.submit_payroll_run_for_review(uuid,uuid)',
    'public.finalize_payroll_run(uuid,uuid)',
    'public.reopen_payroll_run(uuid,uuid,text)',
    'public.export_payroll_run_rows(uuid,uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end
$$;
