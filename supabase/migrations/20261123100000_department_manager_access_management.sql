-- ============================================================================
-- Migration: 20261123100000_department_manager_access_management.sql
-- Description: Department Manager Access Management System
--  1. Create manager_profiles and manager_activity_logs tables with RLS
--  2. Add primary manager_user_id column to public.departments
--  3. Reconcile and harden private.can_access_employee & private.manager_can_access_employee
--  4. Remove inappropriate organization-management capabilities from manager role
--  5. Harden private.can_access_mailroom for department-scoped managers
--  6. Update complete_password_change() for manager accounts
--  7. Restrict public.departments select to administrators and assigned managers
--  8. Provide administrator RPCs for manager lifecycle and department assignment
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Alter public.departments to track primary manager
-- ----------------------------------------------------------------------------
alter table public.departments
  add column if not exists manager_user_id uuid references auth.users(id) on delete set null;

create index if not exists departments_manager_user_id_idx
  on public.departments (organization_id, manager_user_id);

-- ----------------------------------------------------------------------------
-- 2. Create public.manager_profiles
-- ----------------------------------------------------------------------------
create table if not exists public.manager_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  manager_code text not null,
  full_name text not null,
  email text,
  phone text,
  status public.membership_status not null default 'active',
  must_change_password boolean not null default false,
  login_last_reset_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint manager_profiles_manager_code_not_empty check (length(btrim(manager_code)) >= 2),
  constraint manager_profiles_full_name_not_empty check (length(btrim(full_name)) >= 1),
  constraint manager_profiles_org_code_unique unique (organization_id, manager_code),
  constraint manager_profiles_org_id_unique unique (organization_id, id),
  constraint manager_profiles_org_user_unique unique (organization_id, user_id)
);

create index if not exists manager_profiles_org_status_idx
  on public.manager_profiles (organization_id, status);

create index if not exists manager_profiles_user_id_idx
  on public.manager_profiles (user_id);

create index if not exists manager_profiles_code_lower_idx
  on public.manager_profiles (organization_id, lower(manager_code));

-- ----------------------------------------------------------------------------
-- 3. Create public.manager_activity_logs (Immutable audit trail)
-- ----------------------------------------------------------------------------
create table if not exists public.manager_activity_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  manager_profile_id uuid not null references public.manager_profiles(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists manager_activity_logs_manager_idx
  on public.manager_activity_logs (organization_id, manager_profile_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 4. Reconcile and Harden Employee Access Functions
-- ----------------------------------------------------------------------------
-- Active administrators have organization-wide access.
-- Active managers have access ONLY to employees whose department matches
-- an explicit manager_scopes entry or departments.manager_user_id.
-- Suspended managers (status != 'active') have ZERO access.
-- Wildcard department access is eliminated.
-- Inconsistent OR logic across branch/department is eliminated.
-- ----------------------------------------------------------------------------
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
          and exists (
            select 1
            from public.employee_profiles e
            where e.id = p_employee_id
              and e.organization_id = p_organization_id
              and e.department_id is not null
              and (
                -- Scoped to employee's department
                exists (
                  select 1
                  from public.manager_scopes s
                  where s.organization_id = p_organization_id
                    and s.manager_user_id = m.user_id
                    and s.department_id = e.department_id
                    and (s.branch_id is null or s.branch_id = e.branch_id)
                    and (s.employee_id is null or s.employee_id = e.id)
                )
                -- Or primary manager of the department
                or exists (
                  select 1
                  from public.departments d
                  where d.id = e.department_id
                    and d.organization_id = p_organization_id
                    and d.manager_user_id = m.user_id
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
          and e.department_id is not null
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
      )
  );
$$;

revoke all on function private.manager_can_access_employee(uuid) from public, anon;
grant execute on function private.manager_can_access_employee(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Mailroom Department Access Hardening
-- ----------------------------------------------------------------------------
create or replace function private.can_access_mailroom(
  p_organization_id uuid,
  p_branch_id uuid,
  p_admin_only boolean default false
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.branches b
    join public.departments d
      on d.branch_id = b.id
     and d.organization_id = b.organization_id
    where b.id = p_branch_id
      and b.organization_id = p_organization_id
      and b.status::text = 'active'
      and d.name ilike 'Mailroom'
      and d.status::text = 'active'
  ) and (
    private.has_org_role(p_organization_id, array['administrator'])
    or (
      not p_admin_only
      and private.has_org_role(p_organization_id, array['manager'])
      and exists (
        select 1
        from public.departments d
        left join public.manager_scopes s
          on s.department_id = d.id
         and s.organization_id = d.organization_id
         and s.manager_user_id = (select auth.uid())
        where d.branch_id = p_branch_id
          and d.organization_id = p_organization_id
          and d.name ilike 'Mailroom'
          and d.status::text = 'active'
          and (
            s.id is not null
            or d.manager_user_id = (select auth.uid())
          )
      )
    )
  );
$$;

revoke all on function private.can_access_mailroom(uuid, uuid, boolean) from public, anon;
grant execute on function private.can_access_mailroom(uuid, uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Update complete_password_change() to cover both employee & manager profiles
-- ----------------------------------------------------------------------------
create or replace function public.complete_password_change()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  update public.employee_profiles
    set must_change_password = false
    where user_id = v_user_id;

  update public.manager_profiles
    set must_change_password = false,
        updated_at = clock_timestamp()
    where user_id = v_user_id;
end;
$$;

revoke all on function public.complete_password_change() from public, anon;
grant execute on function public.complete_password_change() to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Remove Inappropriate Organization-Management Capabilities from Manager Role
-- ----------------------------------------------------------------------------
-- Managers must NOT create sites, branches, shift templates, or company geofences.
-- Only administrators are authorized.
-- ----------------------------------------------------------------------------
drop policy if exists branches_manage_master_insert on public.branches;
drop policy if exists branches_manage_master_update on public.branches;
create policy branches_manage_admin_insert on public.branches for insert to authenticated
  with check (private.has_org_role(organization_id, array['administrator']));
create policy branches_manage_admin_update on public.branches for update to authenticated
  using (private.has_org_role(organization_id, array['administrator']))
  with check (private.has_org_role(organization_id, array['administrator']));

drop policy if exists departments_manage_master_insert on public.departments;
drop policy if exists departments_manage_master_update on public.departments;
create policy departments_manage_admin_insert on public.departments for insert to authenticated
  with check (private.has_org_role(organization_id, array['administrator']));
create policy departments_manage_admin_update on public.departments for update to authenticated
  using (private.has_org_role(organization_id, array['administrator']))
  with check (private.has_org_role(organization_id, array['administrator']));

drop policy if exists geofences_manage_master_insert on public.geofences;
drop policy if exists geofences_manage_master_update on public.geofences;
create policy geofences_manage_admin_insert on public.geofences for insert to authenticated
  with check (private.has_org_role(organization_id, array['administrator']));
create policy geofences_manage_admin_update on public.geofences for update to authenticated
  using (private.has_org_role(organization_id, array['administrator']))
  with check (private.has_org_role(organization_id, array['administrator']));

drop policy if exists geofence_polygons_manage_master_insert on public.geofence_polygons;
drop policy if exists geofence_polygons_manage_master_update on public.geofence_polygons;
create policy geofence_polygons_manage_admin_insert on public.geofence_polygons for insert to authenticated
  with check (exists (
    select 1 from public.geofences g where g.id = geofence_id
      and private.has_org_role(g.organization_id, array['administrator'])
  ));
create policy geofence_polygons_manage_admin_update on public.geofence_polygons for update to authenticated
  using (exists (
    select 1 from public.geofences g where g.id = geofence_id
      and private.has_org_role(g.organization_id, array['administrator'])
  ))
  with check (exists (
    select 1 from public.geofences g where g.id = geofence_id
      and private.has_org_role(g.organization_id, array['administrator'])
  ));

-- Update RPCs to require administrator role only
drop function if exists public.save_shift_template(uuid, uuid, text, text, time, time, integer, text, date);
drop function if exists public.save_shift_template(uuid, text, text, time without time zone, time without time zone, boolean, integer, uuid);

create or replace function public.save_shift_template(
  p_shift_id uuid,
  p_organization_id uuid,
  p_code text,
  p_name text,
  p_start_time time,
  p_end_time time,
  p_break_minutes integer default 0,
  p_color text default null,
  p_effective_from date default current_date
)
returns public.shifts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.shifts%rowtype;
  v_new public.shifts%rowtype;
  v_used boolean;
begin
  if not private.has_org_role(p_organization_id, array['administrator']) then
    raise exception 'Shift management denied: administrator role required' using errcode = '42501';
  end if;
  if nullif(btrim(p_code), '') is null or nullif(btrim(p_name), '') is null
     or p_start_time is null or p_end_time is null or p_break_minutes < 0 then
    raise exception 'Code, name, times, and a valid break are required' using errcode = '22023';
  end if;

  if p_shift_id is null then
    insert into public.shifts (
      organization_id, code, name, start_time, end_time, crosses_midnight,
      break_minutes, color, template_key, version_number, effective_from, created_by
    ) values (
      p_organization_id, upper(btrim(p_code)), btrim(p_name), p_start_time, p_end_time,
      p_end_time <= p_start_time, p_break_minutes, p_color, gen_random_uuid(), 1,
      coalesce(p_effective_from, current_date), (select auth.uid())
    ) returning * into v_new;
    return v_new;
  end if;

  select * into v_old
  from public.shifts
  where id = p_shift_id and organization_id = p_organization_id for update;

  if not found then
    raise exception 'Shift template not found' using errcode = 'P0002';
  end if;

  select exists (
    select 1 from public.shift_assignments
    where shift_id = p_shift_id
  ) or exists (
    select 1 from public.recurring_schedule_rules
    where shift_id = p_shift_id
  ) into v_used;

  if not v_used and coalesce(p_effective_from, current_date) <= current_date then
    update public.shifts set
      code = upper(btrim(p_code)),
      name = btrim(p_name),
      start_time = p_start_time,
      end_time = p_end_time,
      crosses_midnight = p_end_time <= p_start_time,
      break_minutes = p_break_minutes,
      color = p_color,
      updated_at = clock_timestamp()
    where id = p_shift_id
    returning * into v_new;
    return v_new;
  end if;

  if coalesce(p_effective_from, current_date + 1) <= current_date then
    raise exception 'A used shift must be changed with a future effective date' using errcode = '22023';
  end if;

  update public.shifts
  set effective_to = coalesce(p_effective_from, current_date + 1) - 1,
      updated_at = clock_timestamp()
  where id = p_shift_id;

  insert into public.shifts (
    organization_id, code, name, start_time, end_time, crosses_midnight,
    break_minutes, color, template_key, version_number, effective_from, created_by
  ) values (
    p_organization_id, upper(btrim(p_code)), btrim(p_name), p_start_time, p_end_time,
    p_end_time <= p_start_time, p_break_minutes, p_color, v_old.template_key,
    v_old.version_number + 1, coalesce(p_effective_from, current_date + 1), (select auth.uid())
  ) returning * into v_new;

  return v_new;
end;
$$;

revoke all on function public.save_shift_template(uuid, uuid, text, text, time, time, integer, text, date) from public, anon;
grant execute on function public.save_shift_template(uuid, uuid, text, text, time, time, integer, text, date) to authenticated;

drop function if exists public.create_site(uuid, text, text, text, text, double precision, double precision, boolean, integer);

create or replace function public.create_site(
  p_organization_id uuid,
  p_name text,
  p_code text,
  p_timezone text default 'UTC',
  p_address text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_create_geofence boolean default false,
  p_geofence_radius_meters integer default 30
)
returns public.branches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site public.branches%rowtype;
  v_geofence_id uuid;
  v_points jsonb;
begin
  if not private.has_org_role(p_organization_id, array['administrator']) then
    raise exception 'Site management denied: administrator role required' using errcode = '42501';
  end if;
  if p_create_geofence and (p_latitude is null or p_longitude is null) then
    raise exception 'Coordinates are required to create a geofence' using errcode = '22023';
  end if;
  if p_geofence_radius_meters <= 0 then
    raise exception 'Geofence radius must be positive' using errcode = '22023';
  end if;

  insert into public.branches (
    organization_id, code, name, timezone, address, latitude, longitude,
    location_point, status
  ) values (
    p_organization_id, upper(btrim(p_code)), btrim(p_name), coalesce(nullif(btrim(p_timezone), ''), 'UTC'),
    nullif(btrim(p_address), ''), p_latitude, p_longitude,
    case when p_latitude is not null and p_longitude is not null
         then jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(p_longitude, p_latitude))
         else null end,
    'active'
  ) returning * into v_site;

  if p_create_geofence then
    v_points := jsonb_build_array(
      jsonb_build_array(round((p_longitude - 0.00035)::numeric, 6), round((p_latitude - 0.00035)::numeric, 6)),
      jsonb_build_array(round((p_longitude + 0.00035)::numeric, 6), round((p_latitude - 0.00035)::numeric, 6)),
      jsonb_build_array(round((p_longitude + 0.00035)::numeric, 6), round((p_latitude + 0.00035)::numeric, 6)),
      jsonb_build_array(round((p_longitude - 0.00035)::numeric, 6), round((p_latitude + 0.00035)::numeric, 6)),
      jsonb_build_array(round((p_longitude - 0.00035)::numeric, 6), round((p_latitude - 0.00035)::numeric, 6))
    );

    insert into public.geofences (
      organization_id, branch_id, name, description, geofence_type,
      validation_mode, is_active, status
    ) values (
      p_organization_id, v_site.id, v_site.name || ' Geofence',
      'Initial geofence for ' || v_site.name, 'site', 'strict', true, 'active'
    ) returning id into v_geofence_id;

    insert into public.geofence_polygons (
      organization_id, geofence_id, polygon_type, coordinates
    ) values (
      p_organization_id, v_geofence_id, 'polygon', v_points
    );
  end if;

  return v_site;
end;
$$;

revoke all on function public.create_site(uuid, text, text, text, text, double precision, double precision, boolean, integer) from public, anon;
grant execute on function public.create_site(uuid, text, text, text, text, double precision, double precision, boolean, integer) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. Department Visibility Policy: Scoped by Role
-- Administrators can view all departments.
-- Managers can ONLY view departments assigned to them.
-- Employees can ONLY view their own department.
-- ----------------------------------------------------------------------------
drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments for select to authenticated
using (
  private.has_org_role(organization_id, array['administrator'])
  or (
    private.has_org_role(organization_id, array['manager'])
    and (
      exists (
        select 1 from public.manager_scopes s
        where s.organization_id = departments.organization_id
          and s.manager_user_id = (select auth.uid())
          and s.department_id = departments.id
      )
      or departments.manager_user_id = (select auth.uid())
    )
  )
  or (
    private.has_org_role(organization_id, array['employee'])
    and exists (
      select 1 from public.employee_profiles e
      where e.organization_id = departments.organization_id
        and e.user_id = (select auth.uid())
        and e.department_id = departments.id
    )
  )
);

-- ----------------------------------------------------------------------------
-- 9. Row Level Security for manager_profiles and manager_activity_logs
-- ----------------------------------------------------------------------------
alter table public.manager_profiles enable row level security;
alter table public.manager_activity_logs enable row level security;

-- Manager Profiles RLS
create policy manager_profiles_select on public.manager_profiles for select to authenticated
using (
  private.has_org_role(organization_id, array['administrator'])
  or user_id = (select auth.uid())
);

create policy manager_profiles_manage_admin on public.manager_profiles for all to authenticated
using (private.has_org_role(organization_id, array['administrator']))
with check (private.has_org_role(organization_id, array['administrator']));

-- Manager Activity Logs RLS (Immutable audit log for admins)
create policy manager_activity_logs_select on public.manager_activity_logs for select to authenticated
using (private.has_org_role(organization_id, array['administrator']));

create policy manager_activity_logs_insert on public.manager_activity_logs for insert to authenticated
with check (private.has_org_role(organization_id, array['administrator']));

-- Secure manager_scopes RLS: managers can only read their own scopes
drop policy if exists manager_scopes_select on public.manager_scopes;
create policy manager_scopes_select on public.manager_scopes for select to authenticated
using (
  private.has_org_role(organization_id, array['administrator'])
  or manager_user_id = (select auth.uid())
);

-- Table grants for authenticated role (enforced via RLS policies above)
grant select, insert, update, delete on public.manager_profiles to authenticated;
grant select, insert on public.manager_activity_logs to authenticated;

-- ----------------------------------------------------------------------------
-- 10. Administrator RPCs for Manager Lifecycle and Department Assignment
-- ----------------------------------------------------------------------------

-- A. Assign / Reassign departments for a manager
create or replace function public.admin_assign_manager_departments(
  p_organization_id uuid,
  p_manager_user_id uuid,
  p_department_ids uuid[],
  p_primary_department_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := (select auth.uid());
  v_dept_id uuid;
  v_profile_id uuid;
begin
  if not private.has_org_role(p_organization_id, array['administrator']) then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;

  select id into v_profile_id
  from public.manager_profiles
  where organization_id = p_organization_id and user_id = p_manager_user_id;

  -- 1. Remove old department scopes for this manager
  delete from public.manager_scopes
  where organization_id = p_organization_id
    and manager_user_id = p_manager_user_id;

  -- 2. Insert new department scopes
  if p_department_ids is not null then
    foreach v_dept_id in array p_department_ids
    loop
      insert into public.manager_scopes (organization_id, manager_user_id, department_id, branch_id)
      select p_organization_id, p_manager_user_id, d.id, d.branch_id
      from public.departments d
      where d.id = v_dept_id and d.organization_id = p_organization_id
      on conflict do nothing;
    end loop;
  end if;

  -- 3. If primary department specified, link to departments.manager_user_id
  if p_primary_department_id is not null then
    update public.departments
    set manager_user_id = p_manager_user_id,
        updated_at = clock_timestamp()
    where id = p_primary_department_id and organization_id = p_organization_id;
  end if;

  -- 4. Audit activity
  if v_profile_id is not null then
    insert into public.manager_activity_logs (
      organization_id, manager_profile_id, actor_user_id, action, details
    ) values (
      p_organization_id, v_profile_id, v_caller_id, 'departments_assigned',
      jsonb_build_object('department_ids', p_department_ids, 'primary_department_id', p_primary_department_id)
    );
  end if;
end;
$$;

revoke all on function public.admin_assign_manager_departments(uuid, uuid, uuid[], uuid) from public, anon;
grant execute on function public.admin_assign_manager_departments(uuid, uuid, uuid[], uuid) to authenticated;

-- B. Update Manager Status (Active, Suspended, Removed)
create or replace function public.admin_update_manager_status(
  p_organization_id uuid,
  p_manager_profile_id uuid,
  p_new_status public.membership_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := (select auth.uid());
  v_user_id uuid;
  v_old_status public.membership_status;
begin
  if not private.has_org_role(p_organization_id, array['administrator']) then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;

  select user_id, status into v_user_id, v_old_status
  from public.manager_profiles
  where id = p_manager_profile_id and organization_id = p_organization_id;

  if not found then
    raise exception 'Manager profile not found' using errcode = 'P0002';
  end if;

  -- Prevent suspending oneself
  if v_user_id = v_caller_id then
    raise exception 'Cannot modify your own manager status' using errcode = '42501';
  end if;

  update public.manager_profiles
  set status = p_new_status,
      updated_at = clock_timestamp()
  where id = p_manager_profile_id;

  if v_user_id is not null then
    update public.organization_memberships
    set status = p_new_status,
        updated_at = clock_timestamp()
    where organization_id = p_organization_id
      and user_id = v_user_id
      and role_code = 'manager';
  end if;

  insert into public.manager_activity_logs (
    organization_id, manager_profile_id, actor_user_id, action, details
  ) values (
    p_organization_id, p_manager_profile_id, v_caller_id, 'status_changed',
    jsonb_build_object('old_status', v_old_status, 'new_status', p_new_status)
  );
end;
$$;

revoke all on function public.admin_update_manager_status(uuid, uuid, public.membership_status) from public, anon;
grant execute on function public.admin_update_manager_status(uuid, uuid, public.membership_status) to authenticated;

-- C. List Organization Managers with Details
create or replace function public.list_organization_managers(
  p_organization_id uuid
)
returns table (
  id uuid,
  organization_id uuid,
  user_id uuid,
  manager_code text,
  full_name text,
  email text,
  phone text,
  status public.membership_status,
  must_change_password boolean,
  login_last_reset_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  assigned_department_ids uuid[],
  assigned_department_names text[],
  primary_department_id uuid,
  primary_department_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_org_role(p_organization_id, array['administrator']) then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;

  return query
  select
    mp.id,
    mp.organization_id,
    mp.user_id,
    mp.manager_code,
    mp.full_name,
    mp.email,
    mp.phone,
    mp.status,
    mp.must_change_password,
    mp.login_last_reset_at,
    mp.created_at,
    mp.updated_at,
    coalesce(
      array_agg(distinct s.department_id) filter (where s.department_id is not null),
      array[]::uuid[]
    ) as assigned_department_ids,
    coalesce(
      array_agg(distinct d.name) filter (where d.name is not null),
      array[]::text[]
    ) as assigned_department_names,
    (
      select d_prim.id
      from public.departments d_prim
      where d_prim.organization_id = mp.organization_id
        and d_prim.manager_user_id = mp.user_id
      limit 1
    ) as primary_department_id,
    (
      select d_prim.name
      from public.departments d_prim
      where d_prim.organization_id = mp.organization_id
        and d_prim.manager_user_id = mp.user_id
      limit 1
    ) as primary_department_name
  from public.manager_profiles mp
  left join public.manager_scopes s
    on s.organization_id = mp.organization_id
   and s.manager_user_id = mp.user_id
  left join public.departments d
    on d.id = s.department_id
  where mp.organization_id = p_organization_id
  group by mp.id, mp.organization_id, mp.user_id, mp.manager_code, mp.full_name,
           mp.email, mp.phone, mp.status, mp.must_change_password, mp.login_last_reset_at,
           mp.created_at, mp.updated_at
  order by mp.created_at desc;
end;
$$;

revoke all on function public.list_organization_managers(uuid) from public, anon;
grant execute on function public.list_organization_managers(uuid) to authenticated;

-- D. Get Manager Activity History
create or replace function public.get_manager_activity_history(
  p_organization_id uuid,
  p_manager_profile_id uuid
)
returns table (
  id uuid,
  action text,
  details jsonb,
  created_at timestamptz,
  actor_name text,
  actor_email text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_org_role(p_organization_id, array['administrator']) then
    raise exception 'Administrator permission required' using errcode = '42501';
  end if;

  return query
  select
    l.id,
    l.action,
    l.details,
    l.created_at,
    coalesce(u.display_name, 'System') as actor_name,
    u.email as actor_email
  from public.manager_activity_logs l
  left join public.users u on u.id = l.actor_user_id
  where l.organization_id = p_organization_id
    and l.manager_profile_id = p_manager_profile_id
  order by l.created_at desc;
end;
$$;

revoke all on function public.get_manager_activity_history(uuid, uuid) from public, anon;
grant execute on function public.get_manager_activity_history(uuid, uuid) to authenticated;

-- Force PostgREST to reload schema cache immediately
notify pgrst, 'reload schema';
