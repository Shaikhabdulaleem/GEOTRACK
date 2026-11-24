-- ============================================================================
-- Migration: 20261124140000_employee_transfers.sql
-- Description: Employee Inter-Department Transfer Module
--  1. Create public.employee_transfers table with RLS
--  2. Add indexes for high-performance querying and department isolation
--  3. Reconcile manager access rules so receiving department managers can
--     view and supervise transferred employees
--  4. Provide atomic RPCs for initiating, completing, and querying transfers
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Create public.employee_transfers table
-- ----------------------------------------------------------------------------
create table if not exists public.employee_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  from_department_id uuid not null,
  to_department_id uuid not null,
  transfer_date date not null default current_date,
  start_time timestamptz not null default clock_timestamp(),
  end_time timestamptz,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  transfer_type text not null default 'temporary' check (transfer_type in ('temporary', 'permanent', 'shift', 'overtime')),
  transferred_minutes integer not null default 0 check (transferred_minutes >= 0),
  break_minutes integer not null default 0 check (break_minutes >= 0),
  overtime_minutes integer not null default 0 check (overtime_minutes >= 0),
  reason text,
  notes text,
  transferred_by uuid references auth.users(id) on delete set null,
  completed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint employee_transfers_distinct_departments check (from_department_id <> to_department_id),
  constraint employee_transfers_valid_time_window check (end_time is null or end_time >= start_time),
  foreign key (organization_id, employee_id)
    references public.employee_profiles(organization_id, id) on delete cascade,
  foreign key (organization_id, from_department_id)
    references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, to_department_id)
    references public.departments(organization_id, id) on delete cascade
);

-- ----------------------------------------------------------------------------
-- 2. Indexes
-- ----------------------------------------------------------------------------
create index if not exists employee_transfers_org_date_idx
  on public.employee_transfers (organization_id, transfer_date desc);

create index if not exists employee_transfers_org_emp_date_idx
  on public.employee_transfers (organization_id, employee_id, transfer_date desc);

create index if not exists employee_transfers_org_status_idx
  on public.employee_transfers (organization_id, status);

create index if not exists employee_transfers_from_dept_idx
  on public.employee_transfers (organization_id, from_department_id);

create index if not exists employee_transfers_to_dept_idx
  on public.employee_transfers (organization_id, to_department_id);

-- ----------------------------------------------------------------------------
-- 3. Row Level Security Policies
-- ----------------------------------------------------------------------------
alter table public.employee_transfers enable row level security;

-- SELECT policy: Administrators can view all. Managers can view if their assigned
-- department is the source or destination department, or if they can access the employee.
-- Employees can view their own transfers.
drop policy if exists employee_transfers_select_policy on public.employee_transfers;
create policy employee_transfers_select_policy on public.employee_transfers
  for select
  using (
    -- Administrator access
    private.has_org_role(organization_id, array['administrator'])
    -- Manager access for source or target department
    or (
      private.has_org_role(organization_id, array['manager'])
      and exists (
        select 1 from public.manager_profiles mp
        where mp.user_id = (select auth.uid())
          and mp.status = 'active'
      )
      and (
        -- Source department manager
        exists (
          select 1 from public.manager_scopes ms
          where ms.organization_id = employee_transfers.organization_id
            and ms.manager_user_id = (select auth.uid())
            and ms.department_id = employee_transfers.from_department_id
        )
        or exists (
          select 1 from public.departments d
          where d.id = employee_transfers.from_department_id
            and d.organization_id = employee_transfers.organization_id
            and d.manager_user_id = (select auth.uid())
        )
        -- Destination department manager
        or exists (
          select 1 from public.manager_scopes ms
          where ms.organization_id = employee_transfers.organization_id
            and ms.manager_user_id = (select auth.uid())
            and ms.department_id = employee_transfers.to_department_id
        )
        or exists (
          select 1 from public.departments d
          where d.id = employee_transfers.to_department_id
            and d.organization_id = employee_transfers.organization_id
            and d.manager_user_id = (select auth.uid())
        )
        -- Or general employee access
        or private.can_access_employee(organization_id, employee_id)
      )
    )
    -- Self-service employee access
    or exists (
      select 1 from public.employee_profiles ep
      where ep.id = employee_transfers.employee_id
        and ep.organization_id = employee_transfers.organization_id
        and ep.user_id = (select auth.uid())
    )
  );

-- INSERT policy: Administrators or active Managers of the source department
drop policy if exists employee_transfers_insert_policy on public.employee_transfers;
create policy employee_transfers_insert_policy on public.employee_transfers
  for insert
  with check (
    private.has_org_role(organization_id, array['administrator'])
    or (
      private.has_org_role(organization_id, array['manager'])
      and exists (
        select 1 from public.manager_profiles mp
        where mp.user_id = (select auth.uid())
          and mp.status = 'active'
      )
      and (
        exists (
          select 1 from public.manager_scopes ms
          where ms.organization_id = employee_transfers.organization_id
            and ms.manager_user_id = (select auth.uid())
            and ms.department_id = employee_transfers.from_department_id
        )
        or exists (
          select 1 from public.departments d
          where d.id = employee_transfers.from_department_id
            and d.organization_id = employee_transfers.organization_id
            and d.manager_user_id = (select auth.uid())
        )
      )
    )
  );

-- UPDATE policy: Administrators, or Managers of source or destination department
drop policy if exists employee_transfers_update_policy on public.employee_transfers;
create policy employee_transfers_update_policy on public.employee_transfers
  for update
  using (
    private.has_org_role(organization_id, array['administrator'])
    or (
      private.has_org_role(organization_id, array['manager'])
      and exists (
        select 1 from public.manager_profiles mp
        where mp.user_id = (select auth.uid())
          and mp.status = 'active'
      )
      and (
        exists (
          select 1 from public.manager_scopes ms
          where ms.organization_id = employee_transfers.organization_id
            and ms.manager_user_id = (select auth.uid())
            and (ms.department_id = employee_transfers.from_department_id or ms.department_id = employee_transfers.to_department_id)
        )
        or exists (
          select 1 from public.departments d
          where (d.id = employee_transfers.from_department_id or d.id = employee_transfers.to_department_id)
            and d.organization_id = employee_transfers.organization_id
            and d.manager_user_id = (select auth.uid())
        )
      )
    )
  );

-- ----------------------------------------------------------------------------
-- 4. Reconcile Employee Access with Transfers
-- ----------------------------------------------------------------------------
-- Update private.can_access_employee so managers of target departments can
-- access transferred employees for attendance, overtime, and productivity.
create or replace function private.can_access_employee(
  p_organization_id uuid,
  p_employee_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and (
        m.role_code = 'administrator'
        or (
          m.role_code = 'manager'
          and exists (
            select 1 from public.manager_profiles mp
            where mp.user_id = m.user_id
              and mp.status = 'active'
          )
          and (
            -- Home department access
            exists (
              select 1
              from public.employee_profiles e
              where e.id = p_employee_id
                and e.organization_id = p_organization_id
                and e.department_id is not null
                and (
                  exists (
                    select 1
                    from public.manager_scopes s
                    where s.organization_id = p_organization_id
                      and s.manager_user_id = m.user_id
                      and s.department_id = e.department_id
                      and (s.branch_id is null or s.branch_id = e.branch_id)
                      and (s.employee_id is null or s.employee_id = e.id)
                  )
                  or exists (
                    select 1
                    from public.departments d
                    where d.id = e.department_id
                      and d.organization_id = p_organization_id
                      and d.manager_user_id = m.user_id
                  )
                )
            )
            -- Transferred department access: destination manager can access transferred employee
            or exists (
              select 1
              from public.employee_transfers et
              where et.organization_id = p_organization_id
                and et.employee_id = p_employee_id
                and et.status in ('active', 'completed')
                and (
                  exists (
                    select 1
                    from public.manager_scopes s
                    where s.organization_id = p_organization_id
                      and s.manager_user_id = m.user_id
                      and s.department_id = et.to_department_id
                  )
                  or exists (
                    select 1
                    from public.departments d
                    where d.id = et.to_department_id
                      and d.organization_id = p_organization_id
                      and d.manager_user_id = m.user_id
                  )
                )
            )
          )
        )
      )
  );
$$;

revoke all on function private.can_access_employee(uuid, uuid) from public, anon;
grant execute on function private.can_access_employee(uuid, uuid) to authenticated;

-- Aligned version used by table RLS policies
create or replace function private.manager_can_access_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employee_profiles e
    join public.organization_memberships m
      on m.organization_id = e.organization_id
     and m.user_id = (select auth.uid())
     and m.status = 'active'
     and m.role_code in ('manager', 'administrator')
    where e.id = p_employee_id
      and (
        m.role_code = 'administrator'
        or (
          exists (
            select 1 from public.manager_profiles mp
            where mp.user_id = m.user_id
              and mp.status = 'active'
          )
          and (
            (
              e.department_id is not null
              and (
                exists (
                  select 1
                  from public.manager_scopes s
                  where s.organization_id = e.organization_id
                    and s.manager_user_id = m.user_id
                    and s.department_id = e.department_id
                    and (s.branch_id is null or s.branch_id = e.branch_id)
                    and (s.employee_id is null or s.employee_id = e.id)
                )
                or exists (
                  select 1
                  from public.departments d
                  where d.id = e.department_id
                    and d.organization_id = e.organization_id
                    and d.manager_user_id = m.user_id
                )
              )
            )
            or exists (
              select 1
              from public.employee_transfers et
              where et.organization_id = e.organization_id
                and et.employee_id = e.id
                and et.status in ('active', 'completed')
                and (
                  exists (
                    select 1
                    from public.manager_scopes s
                    where s.organization_id = e.organization_id
                      and s.manager_user_id = m.user_id
                      and s.department_id = et.to_department_id
                  )
                  or exists (
                    select 1
                    from public.departments d
                    where d.id = et.to_department_id
                      and d.organization_id = e.organization_id
                      and d.manager_user_id = m.user_id
                  )
                )
            )
          )
        )
      )
  );
$$;

revoke all on function private.manager_can_access_employee(uuid) from public, anon;
grant execute on function private.manager_can_access_employee(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. RPC: start_employee_transfer
-- ----------------------------------------------------------------------------
create or replace function public.start_employee_transfer(
  p_organization_id uuid,
  p_employee_id uuid,
  p_to_department_id uuid,
  p_transfer_date date default null,
  p_start_time timestamptz default null,
  p_end_time timestamptz default null,
  p_break_minutes integer default 0,
  p_overtime_minutes integer default 0,
  p_transfer_type text default 'temporary',
  p_reason text default null,
  p_notes text default null
)
returns public.employee_transfers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_from_department_id uuid;
  v_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_status text;
  v_duration_min integer := 0;
  v_break_min integer;
  v_ot_min integer;
  v_result public.employee_transfers;
begin
  v_caller_id := (select auth.uid());
  if v_caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  -- Verify employee exists and get their department
  select department_id
  into v_from_department_id
  from public.employee_profiles
  where id = p_employee_id
    and organization_id = p_organization_id;

  if v_from_department_id is null then
    raise exception 'Employee not found in organization' using errcode = 'P0002';
  end if;

  if v_from_department_id = p_to_department_id then
    raise exception 'Target department must differ from current department' using errcode = '22000';
  end if;

  -- Check authorization: Admin or Manager of source department
  if not (
    private.has_org_role(p_organization_id, array['administrator'])
    or (
      private.has_org_role(p_organization_id, array['manager'])
      and exists (
        select 1 from public.manager_profiles mp
        where mp.user_id = v_caller_id
          and mp.status = 'active'
      )
      and (
        exists (
          select 1 from public.manager_scopes ms
          where ms.organization_id = p_organization_id
            and ms.manager_user_id = v_caller_id
            and ms.department_id = v_from_department_id
        )
        or exists (
          select 1 from public.departments d
          where d.id = v_from_department_id
            and d.organization_id = p_organization_id
            and d.manager_user_id = v_caller_id
        )
      )
    )
  ) then
    raise exception 'Permission denied: must be administrator or manager of the source department' using errcode = '42501';
  end if;

  -- Ensure target department is active
  if not exists (
    select 1 from public.departments
    where id = p_to_department_id
      and organization_id = p_organization_id
      and status = 'active'
  ) then
    raise exception 'Target department is not active or does not exist' using errcode = 'P0002';
  end if;

  v_start := coalesce(p_start_time, clock_timestamp());
  v_date := coalesce(p_transfer_date, (v_start at time zone 'UTC')::date);
  v_break_min := greatest(0, coalesce(p_break_minutes, 0));
  v_ot_min := greatest(0, coalesce(p_overtime_minutes, 0));

  if p_end_time is not null then
    v_end := p_end_time;
    if v_end < v_start then
      raise exception 'End time must be after start time' using errcode = '22000';
    end if;
    v_status := 'completed';
    v_duration_min := greatest(0, floor(extract(epoch from (v_end - v_start)) / 60)::integer - v_break_min);
  else
    v_end := null;
    v_status := 'active';
    v_duration_min := 0;
  end if;

  insert into public.employee_transfers (
    organization_id,
    employee_id,
    from_department_id,
    to_department_id,
    transfer_date,
    start_time,
    end_time,
    status,
    transfer_type,
    transferred_minutes,
    break_minutes,
    overtime_minutes,
    reason,
    notes,
    transferred_by,
    completed_by,
    created_at,
    updated_at
  ) values (
    p_organization_id,
    p_employee_id,
    v_from_department_id,
    p_to_department_id,
    v_date,
    v_start,
    v_end,
    v_status,
    coalesce(nullif(p_transfer_type, ''), 'temporary'),
    v_duration_min,
    v_break_min,
    v_ot_min,
    p_reason,
    p_notes,
    v_caller_id,
    case when v_status = 'completed' then v_caller_id else null end,
    clock_timestamp(),
    clock_timestamp()
  )
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.start_employee_transfer(uuid, uuid, uuid, date, timestamptz, timestamptz, integer, integer, text, text, text) from public, anon;
grant execute on function public.start_employee_transfer(uuid, uuid, uuid, date, timestamptz, timestamptz, integer, integer, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. RPC: complete_employee_transfer
-- ----------------------------------------------------------------------------
create or replace function public.complete_employee_transfer(
  p_organization_id uuid,
  p_transfer_id uuid,
  p_end_time timestamptz default null,
  p_break_minutes integer default null,
  p_overtime_minutes integer default null,
  p_notes text default null
)
returns public.employee_transfers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_transfer public.employee_transfers;
  v_end timestamptz;
  v_break integer;
  v_ot integer;
  v_total_min integer;
  v_result public.employee_transfers;
begin
  v_caller_id := (select auth.uid());
  if v_caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select * into v_transfer
  from public.employee_transfers
  where id = p_transfer_id
    and organization_id = p_organization_id;

  if not found then
    raise exception 'Transfer record not found' using errcode = 'P0002';
  end if;

  -- Verify caller is admin or manager of source or destination department
  if not (
    private.has_org_role(p_organization_id, array['administrator'])
    or (
      private.has_org_role(p_organization_id, array['manager'])
      and exists (
        select 1 from public.manager_profiles mp
        where mp.user_id = v_caller_id
          and mp.status = 'active'
      )
      and (
        exists (
          select 1 from public.manager_scopes ms
          where ms.organization_id = p_organization_id
            and ms.manager_user_id = v_caller_id
            and (ms.department_id = v_transfer.from_department_id or ms.department_id = v_transfer.to_department_id)
        )
        or exists (
          select 1 from public.departments d
          where (d.id = v_transfer.from_department_id or d.id = v_transfer.to_department_id)
            and d.organization_id = p_organization_id
            and d.manager_user_id = v_caller_id
        )
      )
    )
  ) then
    raise exception 'Permission denied to complete this transfer' using errcode = '42501';
  end if;

  v_end := coalesce(p_end_time, clock_timestamp());
  if v_end < v_transfer.start_time then
    raise exception 'End time cannot be earlier than transfer start time' using errcode = '22000';
  end if;

  v_break := greatest(0, coalesce(p_break_minutes, v_transfer.break_minutes));
  v_ot := greatest(0, coalesce(p_overtime_minutes, v_transfer.overtime_minutes));
  v_total_min := greatest(0, floor(extract(epoch from (v_end - v_transfer.start_time)) / 60)::integer - v_break);

  update public.employee_transfers
  set
    end_time = v_end,
    status = 'completed',
    transferred_minutes = v_total_min,
    break_minutes = v_break,
    overtime_minutes = v_ot,
    notes = coalesce(p_notes, notes),
    completed_by = v_caller_id,
    updated_at = clock_timestamp()
  where id = p_transfer_id
    and organization_id = p_organization_id
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.complete_employee_transfer(uuid, uuid, timestamptz, integer, integer, text) from public, anon;
grant execute on function public.complete_employee_transfer(uuid, uuid, timestamptz, integer, integer, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. RPC: cancel_employee_transfer
-- ----------------------------------------------------------------------------
create or replace function public.cancel_employee_transfer(
  p_organization_id uuid,
  p_transfer_id uuid,
  p_reason text default null
)
returns public.employee_transfers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_transfer public.employee_transfers;
  v_result public.employee_transfers;
begin
  v_caller_id := (select auth.uid());
  if v_caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select * into v_transfer
  from public.employee_transfers
  where id = p_transfer_id
    and organization_id = p_organization_id;

  if not found then
    raise exception 'Transfer record not found' using errcode = 'P0002';
  end if;

  if not (
    private.has_org_role(p_organization_id, array['administrator'])
    or (
      private.has_org_role(p_organization_id, array['manager'])
      and exists (
        select 1 from public.manager_profiles mp
        where mp.user_id = v_caller_id
          and mp.status = 'active'
      )
      and (
        exists (
          select 1 from public.manager_scopes ms
          where ms.organization_id = p_organization_id
            and ms.manager_user_id = v_caller_id
            and (ms.department_id = v_transfer.from_department_id or ms.department_id = v_transfer.to_department_id)
        )
        or exists (
          select 1 from public.departments d
          where (d.id = v_transfer.from_department_id or d.id = v_transfer.to_department_id)
            and d.organization_id = p_organization_id
            and d.manager_user_id = v_caller_id
        )
      )
    )
  ) then
    raise exception 'Permission denied to cancel this transfer' using errcode = '42501';
  end if;

  update public.employee_transfers
  set
    status = 'cancelled',
    notes = case when p_reason is not null then coalesce(notes || ' | Cancel reason: ' || p_reason, p_reason) else notes end,
    updated_at = clock_timestamp()
  where id = p_transfer_id
    and organization_id = p_organization_id
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.cancel_employee_transfer(uuid, uuid, text) from public, anon;
grant execute on function public.cancel_employee_transfer(uuid, uuid, text) to authenticated;
