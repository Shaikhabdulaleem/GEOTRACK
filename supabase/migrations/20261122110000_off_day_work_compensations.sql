-- Migration: off_day_work_compensations
-- Tracks reminders and compensation decisions for employees working on their regular off days.
-- Managers can define whether to keep the work hours for Overtime (OT) or grant compensatory leave (Comp-Off).

create table if not exists public.off_day_compensations (
  id text primary key, -- formatted as employee_id || '_' || work_date
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employee_profiles(id) on delete cascade,
  work_date date not null,
  shift_id uuid references public.shifts(id) on delete set null,
  compensation_type text not null default 'pending' check (compensation_type in ('pending', 'overtime', 'comp_off')),
  comp_off_date date,
  notes text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_off_day_comp_org_emp on public.off_day_compensations (organization_id, employee_id, work_date);

-- Revoke all table privileges from public and anon, grant authenticated access
revoke all on public.off_day_compensations from public, anon;
grant select, insert, update, delete on public.off_day_compensations to authenticated;

alter table public.off_day_compensations enable row level security;

drop policy if exists "Authenticated users can view off_day_compensations" on public.off_day_compensations;
create policy "Authenticated users can view off_day_compensations"
  on public.off_day_compensations
  for select
  to authenticated
  using (
    private.is_employee_owner(employee_id)
    or private.can_access_employee(organization_id, employee_id)
  );

drop policy if exists "Authenticated users can insert off_day_compensations" on public.off_day_compensations;
create policy "Authenticated users can insert off_day_compensations"
  on public.off_day_compensations
  for insert
  to authenticated
  with check (
    private.can_access_employee(organization_id, employee_id)
    and private.employee_belongs_to_org(employee_id, organization_id)
  );

drop policy if exists "Authenticated users can update off_day_compensations" on public.off_day_compensations;
create policy "Authenticated users can update off_day_compensations"
  on public.off_day_compensations
  for update
  to authenticated
  using (private.can_access_employee(organization_id, employee_id))
  with check (
    private.can_access_employee(organization_id, employee_id)
    and private.employee_belongs_to_org(employee_id, organization_id)
  );

drop policy if exists "Authenticated users can delete off_day_compensations" on public.off_day_compensations;
create policy "Authenticated users can delete off_day_compensations"
  on public.off_day_compensations
  for delete
  to authenticated
  using (private.can_access_employee(organization_id, employee_id));

