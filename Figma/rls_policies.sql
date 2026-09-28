-- GEOTRACK database authorization and attendance hardening.
-- Apply as the database owner. This script is intentionally idempotent.
-- It assumes the tables and enum types represented by src/types/database.ts exist.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- Authorization helpers live outside the exposed schema. SECURITY DEFINER is
-- required only to avoid recursive membership policies; every helper binds its
-- decision to auth.uid(), uses an empty search_path, and exposes no row data.
create or replace function private.is_org_member(p_organization_id uuid)
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
      and m.status::text = 'active'
  );
$$;

create or replace function private.has_org_role(p_organization_id uuid, p_roles text[])
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
      and m.status::text = 'active'
      and m.role_code::text = any (p_roles)
  );
$$;

create or replace function private.is_employee_owner(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employee_profiles e
    where e.id = p_employee_id
      and e.user_id = (select auth.uid())
  );
$$;

create or replace function private.employee_belongs_to_org(
  p_employee_id uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.employee_profiles e
    where e.id = p_employee_id and e.organization_id = p_organization_id
  );
$$;

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
  select
    private.has_org_role(p_organization_id, array['administrator'])
    or (
      private.has_org_role(p_organization_id, array['manager'])
      and exists (
        select 1
        from public.employee_profiles e
        where e.id = p_employee_id
          and e.organization_id = p_organization_id
          and (
            e.manager_user_id = (select auth.uid())
            or exists (
              select 1
              from public.manager_scopes s
              where s.organization_id = p_organization_id
                and s.manager_user_id = (select auth.uid())
                and (s.employee_id is null or s.employee_id = e.id)
                and (s.branch_id is null or s.branch_id = e.branch_id)
                and (s.department_id is null or s.department_id = e.department_id)
            )
          )
      )
    );
$$;

create or replace function private.can_manage_branch(
  p_organization_id uuid,
  p_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.branches b
    where b.id = p_branch_id and b.organization_id = p_organization_id
  ) and (
    private.has_org_role(p_organization_id, array['administrator'])
    or (
      private.has_org_role(p_organization_id, array['manager'])
      and exists (
        select 1 from public.manager_scopes s
        where s.organization_id = p_organization_id
          and s.manager_user_id = (select auth.uid())
          and s.employee_id is null
          and s.department_id is null
          and (s.branch_id is null or s.branch_id = p_branch_id)
      )
    )
  );
$$;

create or replace function private.valid_employee_references(
  p_organization_id uuid,
  p_branch_id uuid,
  p_department_id uuid,
  p_manager_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.branches b
      where b.id = p_branch_id and b.organization_id = p_organization_id
    )
    and exists (
      select 1 from public.departments d
      where d.id = p_department_id
        and d.branch_id = p_branch_id
        and d.organization_id = p_organization_id
    )
    and (
      p_manager_user_id is null
      or exists (
        select 1 from public.organization_memberships m
        where m.organization_id = p_organization_id
          and m.user_id = p_manager_user_id
          and m.status::text = 'active'
          and m.role_code::text in ('manager', 'administrator')
      )
    );
$$;

revoke all on function private.is_org_member(uuid) from public, anon, authenticated;
revoke all on function private.has_org_role(uuid, text[]) from public, anon, authenticated;
revoke all on function private.is_employee_owner(uuid) from public, anon, authenticated;
revoke all on function private.employee_belongs_to_org(uuid, uuid) from public, anon, authenticated;
revoke all on function private.can_access_employee(uuid, uuid) from public, anon, authenticated;
revoke all on function private.can_manage_branch(uuid, uuid) from public, anon, authenticated;
revoke all on function private.valid_employee_references(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid, text[]) to authenticated;
grant execute on function private.is_employee_owner(uuid) to authenticated;
grant execute on function private.employee_belongs_to_org(uuid, uuid) to authenticated;
grant execute on function private.can_access_employee(uuid, uuid) to authenticated;
grant execute on function private.can_manage_branch(uuid, uuid) to authenticated;
grant execute on function private.valid_employee_references(uuid, uuid, uuid, uuid) to authenticated;

-- Remove legacy and ad-hoc policies before installing the canonical set.
do $$
declare
  v_table text;
  v_policy record;
begin
  foreach v_table in array array[
    'users', 'organizations', 'roles', 'organization_memberships', 'manager_scopes',
    'branches', 'departments', 'employee_profiles', 'employee_devices', 'shifts',
    'shift_assignments', 'weekly_offs', 'holidays', 'geofences', 'geofence_polygons',
    'geofence_assignments', 'attendance_events', 'attendance_records',
    'manual_attendance_requests', 'overtime_records', 'productivity_records',
    'phone_usage_records', 'notifications', 'leave_requests', 'audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    for v_policy in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = v_table
    loop
      execute format('drop policy if exists %I on public.%I', v_policy.policyname, v_table);
    end loop;
  end loop;
end
$$;

-- Identity and organization data.
create policy users_select on public.users for select to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.organization_memberships mine
    join public.organization_memberships theirs
      on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid())
      and mine.status::text = 'active'
      and theirs.user_id = users.id
      and theirs.status::text = 'active'
  )
);
create policy users_update_self on public.users for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy organizations_select on public.organizations for select to authenticated
using (private.is_org_member(id));
create policy organizations_update_admin on public.organizations for update to authenticated
using (private.has_org_role(id, array['administrator']))
with check (private.has_org_role(id, array['administrator']));

create policy roles_select on public.roles for select to authenticated using (true);

create policy memberships_select on public.organization_memberships for select to authenticated
using (
  user_id = (select auth.uid())
  or private.has_org_role(organization_id, array['administrator', 'manager'])
);
create policy memberships_manage_admin on public.organization_memberships for all to authenticated
using (private.has_org_role(organization_id, array['administrator']))
with check (private.has_org_role(organization_id, array['administrator']));

create policy manager_scopes_select on public.manager_scopes for select to authenticated
using (
  manager_user_id = (select auth.uid())
  or private.has_org_role(organization_id, array['administrator'])
);
create policy manager_scopes_manage_admin on public.manager_scopes for all to authenticated
using (private.has_org_role(organization_id, array['administrator']))
with check (
  private.has_org_role(organization_id, array['administrator'])
  and exists (
    select 1 from public.organization_memberships m
    where m.organization_id = manager_scopes.organization_id
      and m.user_id = manager_scopes.manager_user_id
      and m.status::text = 'active'
      and m.role_code::text = 'manager'
  )
  and (
    branch_id is null
    or exists (
      select 1 from public.branches b
      where b.id = manager_scopes.branch_id
        and b.organization_id = manager_scopes.organization_id
    )
  )
  and (
    department_id is null
    or exists (
      select 1 from public.departments d
      where d.id = manager_scopes.department_id
        and d.organization_id = manager_scopes.organization_id
        and (manager_scopes.branch_id is null or d.branch_id = manager_scopes.branch_id)
    )
  )
  and (employee_id is null or private.employee_belongs_to_org(employee_id, organization_id))
);

-- Organization structure.
create policy branches_select on public.branches for select to authenticated
using (private.is_org_member(organization_id));
create policy branches_manage_admin on public.branches for all to authenticated
using (private.has_org_role(organization_id, array['administrator']))
with check (private.has_org_role(organization_id, array['administrator']));

create policy departments_select on public.departments for select to authenticated
using (private.is_org_member(organization_id));
create policy departments_manage_admin on public.departments for all to authenticated
using (private.has_org_role(organization_id, array['administrator']))
with check (private.has_org_role(organization_id, array['administrator']));

create policy employee_profiles_select on public.employee_profiles for select to authenticated
using (
  user_id = (select auth.uid())
  or private.can_access_employee(organization_id, id)
);
create policy employee_profiles_manage_admin on public.employee_profiles for all to authenticated
using (private.has_org_role(organization_id, array['administrator']))
with check (
  private.has_org_role(organization_id, array['administrator'])
  and private.valid_employee_references(
    organization_id, branch_id, department_id, manager_user_id
  )
);

create policy employee_devices_select on public.employee_devices for select to authenticated
using (
  private.is_employee_owner(employee_id)
  or private.can_access_employee(organization_id, employee_id)
);
create policy employee_devices_insert_self on public.employee_devices for insert to authenticated
with check (
  private.is_employee_owner(employee_id)
  and private.employee_belongs_to_org(employee_id, organization_id)
);
create policy employee_devices_update_self on public.employee_devices for update to authenticated
using (private.is_employee_owner(employee_id))
with check (
  private.is_employee_owner(employee_id)
  and private.employee_belongs_to_org(employee_id, organization_id)
);

-- Scheduling.
create policy shifts_select on public.shifts for select to authenticated
using (private.is_org_member(organization_id));
create policy shifts_manage on public.shifts for all to authenticated
using (private.has_org_role(organization_id, array['administrator', 'manager']))
with check (private.has_org_role(organization_id, array['administrator', 'manager']));

create policy shift_assignments_select on public.shift_assignments for select to authenticated
using (
  private.is_employee_owner(employee_id)
  or private.can_access_employee(organization_id, employee_id)
);
create policy shift_assignments_manage on public.shift_assignments for all to authenticated
using (private.can_access_employee(organization_id, employee_id))
with check (
  private.can_access_employee(organization_id, employee_id)
  and private.employee_belongs_to_org(employee_id, organization_id)
  and (
    shift_id is null
    or exists (
      select 1 from public.shifts s
      where s.id = shift_assignments.shift_id
        and s.organization_id = shift_assignments.organization_id
    )
  )
);

create policy weekly_offs_select on public.weekly_offs for select to authenticated
using (
  private.is_employee_owner(employee_id)
  or private.can_access_employee(organization_id, employee_id)
);
create policy weekly_offs_manage on public.weekly_offs for all to authenticated
using (private.can_access_employee(organization_id, employee_id))
with check (
  private.can_access_employee(organization_id, employee_id)
  and private.employee_belongs_to_org(employee_id, organization_id)
);

create policy holidays_select on public.holidays for select to authenticated
using (private.is_org_member(organization_id));
create policy holidays_manage_admin on public.holidays for all to authenticated
using (private.has_org_role(organization_id, array['administrator']))
with check (private.has_org_role(organization_id, array['administrator']));

-- Geofences. Employees may read organization geofence geometry because the
-- client displays it, but attendance acceptance is revalidated in the RPC.
create policy geofences_select on public.geofences for select to authenticated
using (private.is_org_member(organization_id));
create policy geofences_manage on public.geofences for all to authenticated
using (private.can_manage_branch(organization_id, branch_id))
with check (private.can_manage_branch(organization_id, branch_id));

create policy geofence_polygons_select on public.geofence_polygons for select to authenticated
using (
  exists (
    select 1 from public.geofences g
    where g.id = geofence_polygons.geofence_id
      and private.is_org_member(g.organization_id)
  )
);
create policy geofence_polygons_manage on public.geofence_polygons for all to authenticated
using (
  exists (
    select 1 from public.geofences g
    where g.id = geofence_polygons.geofence_id
      and private.can_manage_branch(g.organization_id, g.branch_id)
  )
)
with check (
  exists (
    select 1 from public.geofences g
    where g.id = geofence_polygons.geofence_id
      and private.can_manage_branch(g.organization_id, g.branch_id)
  )
);

create policy geofence_assignments_select on public.geofence_assignments for select to authenticated
using (
  private.is_employee_owner(employee_id)
  or private.can_access_employee(organization_id, employee_id)
);
create policy geofence_assignments_manage on public.geofence_assignments for all to authenticated
using (private.can_access_employee(organization_id, employee_id))
with check (
  private.can_access_employee(organization_id, employee_id)
  and private.employee_belongs_to_org(employee_id, organization_id)
  and exists (
    select 1 from public.geofences g
    where g.id = geofence_assignments.geofence_id
      and g.organization_id = geofence_assignments.organization_id
      and private.can_manage_branch(g.organization_id, g.branch_id)
  )
);

-- Attendance is read through RLS, but mutations are RPC-only. This prevents a
-- browser client from forging timestamps, validation results, or totals.
create policy attendance_events_select on public.attendance_events for select to authenticated
using (
  private.is_employee_owner(employee_id)
  or private.can_access_employee(organization_id, employee_id)
);
create policy attendance_records_select on public.attendance_records for select to authenticated
using (
  private.is_employee_owner(employee_id)
  or private.can_access_employee(organization_id, employee_id)
);

create policy manual_requests_select on public.manual_attendance_requests for select to authenticated
using (
  private.is_employee_owner(employee_id)
  or private.can_access_employee(organization_id, employee_id)
);
create policy manual_requests_insert_self on public.manual_attendance_requests for insert to authenticated
with check (
  private.is_employee_owner(employee_id)
  and private.employee_belongs_to_org(employee_id, organization_id)
  and requested_by = (select auth.uid())
  and status::text = 'pending'
  and reviewed_by is null
  and reviewed_at is null
);

create policy overtime_select on public.overtime_records for select to authenticated
using (
  private.is_employee_owner(employee_id)
  or private.can_access_employee(organization_id, employee_id)
);

create policy productivity_select on public.productivity_records for select to authenticated
using (
  private.is_employee_owner(employee_id)
  or private.can_access_employee(organization_id, employee_id)
);
create policy productivity_manage on public.productivity_records for all to authenticated
using (private.can_access_employee(organization_id, employee_id))
with check (
  private.can_access_employee(organization_id, employee_id)
  and private.employee_belongs_to_org(employee_id, organization_id)
);

create policy phone_usage_select on public.phone_usage_records for select to authenticated
using (
  private.is_employee_owner(employee_id)
  or private.can_access_employee(organization_id, employee_id)
);
create policy phone_usage_insert_self on public.phone_usage_records for insert to authenticated
with check (
  private.is_employee_owner(employee_id)
  and private.employee_belongs_to_org(employee_id, organization_id)
);
create policy phone_usage_update_self on public.phone_usage_records for update to authenticated
using (private.is_employee_owner(employee_id))
with check (
  private.is_employee_owner(employee_id)
  and private.employee_belongs_to_org(employee_id, organization_id)
);

create policy notifications_select_self on public.notifications for select to authenticated
using (recipient_user_id = (select auth.uid()));
create policy notifications_insert_manager on public.notifications for insert to authenticated
with check (
  private.has_org_role(organization_id, array['administrator', 'manager'])
  and exists (
    select 1 from public.organization_memberships m
    where m.organization_id = notifications.organization_id
      and m.user_id = notifications.recipient_user_id
      and m.status::text = 'active'
  )
);

create policy leave_requests_select on public.leave_requests for select to authenticated
using (
  private.is_employee_owner(employee_id)
  or private.can_access_employee(organization_id, employee_id)
);
create policy leave_requests_insert_self on public.leave_requests for insert to authenticated
with check (
  private.is_employee_owner(employee_id)
  and private.employee_belongs_to_org(employee_id, organization_id)
  and requested_by = (select auth.uid())
  and status::text = 'pending'
);
create policy leave_requests_update_manager on public.leave_requests for update to authenticated
using (private.can_access_employee(organization_id, employee_id))
with check (private.can_access_employee(organization_id, employee_id));

create policy audit_logs_select_admin on public.audit_logs for select to authenticated
using (private.has_org_role(organization_id, array['administrator']));

-- Data API grants are explicit so this remains compatible with Supabase's 2026
-- opt-in exposure behavior. Anonymous clients receive no table privileges.
revoke all on table
  public.users, public.organizations, public.roles, public.organization_memberships,
  public.manager_scopes, public.branches, public.departments, public.employee_profiles,
  public.employee_devices, public.shifts, public.shift_assignments, public.weekly_offs,
  public.holidays, public.geofences, public.geofence_polygons, public.geofence_assignments,
  public.attendance_events, public.attendance_records, public.manual_attendance_requests,
  public.overtime_records, public.productivity_records, public.phone_usage_records,
  public.notifications, public.leave_requests, public.audit_logs
from anon;

revoke all on table
  public.users, public.organizations, public.roles, public.organization_memberships,
  public.manager_scopes, public.branches, public.departments, public.employee_profiles,
  public.employee_devices, public.shifts, public.shift_assignments, public.weekly_offs,
  public.holidays, public.geofences, public.geofence_polygons, public.geofence_assignments,
  public.attendance_events, public.attendance_records, public.manual_attendance_requests,
  public.overtime_records, public.productivity_records, public.phone_usage_records,
  public.notifications, public.leave_requests, public.audit_logs
from authenticated;

grant select on table
  public.users, public.organizations, public.roles, public.organization_memberships,
  public.manager_scopes, public.branches, public.departments, public.employee_profiles,
  public.employee_devices, public.shifts, public.shift_assignments, public.weekly_offs,
  public.holidays, public.geofences, public.geofence_polygons, public.geofence_assignments,
  public.attendance_events, public.attendance_records, public.manual_attendance_requests,
  public.overtime_records, public.productivity_records, public.phone_usage_records,
  public.notifications, public.leave_requests, public.audit_logs
to authenticated;

grant update on public.users, public.organizations to authenticated;
grant insert, update, delete on public.organization_memberships, public.manager_scopes,
  public.branches, public.departments, public.employee_profiles, public.employee_devices,
  public.shifts, public.shift_assignments, public.weekly_offs, public.holidays,
  public.geofences, public.geofence_polygons, public.geofence_assignments,
  public.productivity_records, public.phone_usage_records, public.leave_requests
to authenticated;
grant insert on public.manual_attendance_requests, public.notifications to authenticated;

-- Constraints and indexes used by idempotency, concurrency control, and RLS.
create unique index if not exists attendance_events_employee_idempotency_uidx
  on public.attendance_events (employee_id, idempotency_key);
create unique index if not exists attendance_records_employee_date_session_uidx
  on public.attendance_records (employee_id, attendance_date, session_number);
create unique index if not exists overtime_attendance_record_uidx
  on public.overtime_records (attendance_record_id);
create unique index if not exists geofence_active_polygon_uidx
  on public.geofence_polygons (geofence_id) where is_active;
create unique index if not exists geofence_active_assignment_uidx
  on public.geofence_assignments (geofence_id, employee_id) where effective_to is null;
create index if not exists memberships_user_org_status_idx
  on public.organization_memberships (user_id, organization_id, status, role_code);
create index if not exists employee_profiles_user_org_idx
  on public.employee_profiles (user_id, organization_id);
create index if not exists manager_scopes_lookup_idx
  on public.manager_scopes (manager_user_id, organization_id, employee_id, branch_id, department_id);
create index if not exists shift_assignments_employee_date_idx
  on public.shift_assignments (employee_id, work_date, status);
create index if not exists attendance_records_org_date_idx
  on public.attendance_records (organization_id, attendance_date, employee_id);
create index if not exists attendance_events_org_time_idx
  on public.attendance_events (organization_id, event_at desc, employee_id);
create index if not exists geofence_assignments_employee_dates_idx
  on public.geofence_assignments (employee_id, effective_from, effective_to);

-- Pure GeoJSON helpers for authoritative server-side geofence validation.
create or replace function private.point_in_ring(p_lng double precision, p_lat double precision, p_ring jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_inside boolean := false;
  v_count integer;
  i integer;
  j integer;
  xi double precision;
  yi double precision;
  xj double precision;
  yj double precision;
  v_cross double precision;
begin
  v_count := coalesce(jsonb_array_length(p_ring), 0);
  if v_count < 3 then return false; end if;
  j := v_count - 1;
  for i in 0..v_count - 1 loop
    xi := (p_ring -> i ->> 0)::double precision;
    yi := (p_ring -> i ->> 1)::double precision;
    xj := (p_ring -> j ->> 0)::double precision;
    yj := (p_ring -> j ->> 1)::double precision;

    -- Boundary points count as inside.
    v_cross := (p_lat - yi) * (xj - xi) - (p_lng - xi) * (yj - yi);
    if abs(v_cross) < 1e-10
      and p_lng between least(xi, xj) - 1e-10 and greatest(xi, xj) + 1e-10
      and p_lat between least(yi, yj) - 1e-10 and greatest(yi, yj) + 1e-10 then
      return true;
    end if;

    if ((yi > p_lat) <> (yj > p_lat))
      and p_lng < ((xj - xi) * (p_lat - yi) / nullif(yj - yi, 0)) + xi then
      v_inside := not v_inside;
    end if;
    j := i;
  end loop;
  return v_inside;
end;
$$;

create or replace function private.point_in_multipolygon(
  p_lng double precision,
  p_lat double precision,
  p_geometry jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_polygon jsonb;
  v_ring jsonb;
  v_in_hole boolean;
  v_ring_index integer;
begin
  if p_geometry ->> 'type' <> 'MultiPolygon' then return false; end if;
  for v_polygon in select value from jsonb_array_elements(p_geometry -> 'coordinates') loop
    if jsonb_array_length(v_polygon) = 0
      or not private.point_in_ring(p_lng, p_lat, v_polygon -> 0) then
      continue;
    end if;
    v_in_hole := false;
    if jsonb_array_length(v_polygon) > 1 then
      for v_ring_index in 1..jsonb_array_length(v_polygon) - 1 loop
        v_ring := v_polygon -> v_ring_index;
        if private.point_in_ring(p_lng, p_lat, v_ring) then
          v_in_hole := true;
          exit;
        end if;
      end loop;
    end if;
    if not v_in_hole then return true; end if;
  end loop;
  return false;
end;
$$;

revoke all on function private.point_in_ring(double precision, double precision, jsonb) from public, anon, authenticated;
revoke all on function private.point_in_multipolygon(double precision, double precision, jsonb) from public, anon, authenticated;

-- Transactional attendance engine. The function is SECURITY DEFINER so direct
-- table mutations can remain revoked. It authenticates and authorizes the
-- caller before every write and serializes each employee's attendance stream.
create or replace function public.process_attendance_event(
  p_employee_id uuid,
  p_geofence_id uuid,
  p_action_type text,
  p_is_auto boolean,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision,
  p_is_mock_location boolean,
  p_idempotency_key text,
  p_device_info jsonb
)
returns table (
  attendance_record_id uuid,
  event_id uuid,
  status text,
  inside_geofence boolean,
  validation_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_employee public.employee_profiles%rowtype;
  v_assignment public.shift_assignments%rowtype;
  v_shift public.shifts%rowtype;
  v_record public.attendance_records%rowtype;
  v_existing_event public.attendance_events%rowtype;
  v_now timestamptz := clock_timestamp();
  v_timezone text;
  v_local_now timestamp;
  v_today date;
  v_work_date date;
  v_polygon_id uuid;
  v_polygon jsonb;
  v_required_accuracy double precision;
  v_inside boolean := false;
  v_validation text := 'unknown';
  v_event_id uuid;
  v_event_type text;
  v_source text;
  v_shift_start timestamptz;
  v_shift_end timestamptz;
  v_scheduled integer := 0;
  v_presence integer := 0;
  v_overlap integer := 0;
  v_regular integer := 0;
  v_worked integer := 0;
  v_overtime integer := 0;
  v_late integer := 0;
  v_early integer := 0;
  v_missing integer := 0;
begin
  if v_user_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_action_type not in ('check_in', 'check_out') then
    raise exception 'Invalid attendance action' using errcode = '22023';
  end if;
  if p_latitude is null or p_latitude < -90 or p_latitude > 90
    or p_longitude is null or p_longitude < -180 or p_longitude > 180 then
    raise exception 'Invalid coordinates' using errcode = '22023';
  end if;
  if p_accuracy_meters is null or p_accuracy_meters < 0 then
    raise exception 'A GPS accuracy reading is required' using errcode = '22023';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null or length(p_idempotency_key) > 200 then
    raise exception 'Invalid idempotency key' using errcode = '22023';
  end if;

  select * into v_employee
  from public.employee_profiles e
  where e.id = p_employee_id and e.employment_status::text = 'active';
  if not found then raise exception 'Active employee not found' using errcode = 'P0002'; end if;
  -- Attendance mutations are self-service only. Manager/admin visibility does
  -- not grant impersonation rights; automatic capture must use a separate
  -- trusted server integration rather than this browser-callable RPC.
  if not private.is_employee_owner(p_employee_id) then
    raise exception 'Attendance can only be submitted by the employee owner' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text, 0));

  select * into v_existing_event
  from public.attendance_events ae
  where ae.employee_id = p_employee_id and ae.idempotency_key = p_idempotency_key;
  if found then
    select ar.* into v_record
    from public.attendance_records ar
    where ar.check_in_event_id = v_existing_event.id or ar.check_out_event_id = v_existing_event.id
    limit 1;
    return query select
      v_record.id,
      v_existing_event.id,
      coalesce(v_record.status::text, 'recorded'),
      coalesce(v_existing_event.inside_geofence, false),
      v_existing_event.geofence_validation::text;
    return;
  end if;

  select coalesce(nullif(b.timezone, ''), nullif(o.timezone, ''), 'UTC') into v_timezone
  from public.organizations o
  left join public.branches b on b.id = v_employee.branch_id and b.organization_id = o.id
  where o.id = v_employee.organization_id;
  v_timezone := coalesce(v_timezone, 'UTC');
  v_local_now := v_now at time zone v_timezone;
  v_today := v_local_now::date;
  v_work_date := v_today;

  if p_action_type = 'check_out' then
    select * into v_record
    from public.attendance_records ar
    where ar.employee_id = p_employee_id
      and ar.check_out_at is null
      and ar.attendance_date between v_today - 1 and v_today
    order by ar.attendance_date desc, ar.session_number desc
    limit 1
    for update;
    if not found or v_record.check_in_at is null then
      raise exception 'Cannot check out without an open check-in' using errcode = '22023';
    end if;
    v_work_date := v_record.attendance_date;
    if v_record.shift_assignment_id is not null then
      select * into v_assignment from public.shift_assignments where id = v_record.shift_assignment_id;
    end if;
  else
    select sa.* into v_assignment
    from public.shift_assignments sa
    join public.shifts s on s.id = sa.shift_id
    where sa.employee_id = p_employee_id
      and sa.status::text = 'scheduled'
      and (
        sa.work_date = v_today
        or (
          sa.work_date = v_today - 1
          and s.crosses_midnight
          and v_local_now::time <= s.end_time
        )
      )
    order by
      case when sa.work_date = v_today - 1 then 0 else 1 end,
      sa.work_date desc
    limit 1;
    if found then v_work_date := v_assignment.work_date; end if;

    select * into v_record
    from public.attendance_records ar
    where ar.employee_id = p_employee_id
      and ar.attendance_date = v_work_date
      and ar.session_number = 1
    for update;
  end if;

  if v_assignment.id is null then
    select * into v_assignment
    from public.shift_assignments sa
    where sa.employee_id = p_employee_id
      and sa.work_date = v_work_date
      and sa.status::text = 'scheduled'
    limit 1;
  end if;
  if v_assignment.shift_id is not null then
    select * into v_shift from public.shifts where id = v_assignment.shift_id;
  end if;

  select gp.id, gp.polygon::jsonb, gf.required_accuracy_meters
    into v_polygon_id, v_polygon, v_required_accuracy
  from public.geofence_assignments ga
  join public.geofences gf on gf.id = ga.geofence_id
  join public.geofence_polygons gp on gp.geofence_id = gf.id and gp.is_active
  where ga.employee_id = p_employee_id
    and ga.organization_id = v_employee.organization_id
    and ga.geofence_id = p_geofence_id
    and ga.effective_from <= v_work_date
    and (ga.effective_to is null or ga.effective_to >= v_work_date)
    and gf.status::text = 'active'
  order by ga.effective_from desc
  limit 1;

  if p_is_mock_location then
    v_validation := 'mock_location';
  elsif v_polygon_id is null then
    v_validation := 'invalid';
  elsif p_accuracy_meters > v_required_accuracy then
    v_validation := 'low_accuracy';
  else
    v_inside := private.point_in_multipolygon(p_longitude, p_latitude, v_polygon);
    v_validation := case when v_inside then 'valid' else 'invalid' end;
  end if;

  v_event_type := case
    when p_action_type = 'check_in' and p_is_auto then 'gps_enter'
    when p_action_type = 'check_in' then 'manual_check_in'
    when p_is_auto then 'gps_exit'
    else 'manual_check_out'
  end;
  v_source := case when p_is_auto then 'automatic_geofence' else 'manual_employee' end;

  insert into public.attendance_events (
    organization_id, employee_id, event_type, source, event_at, received_at,
    location_point, accuracy_meters, geofence_id, geofence_polygon_id,
    geofence_validation, inside_geofence, approval_status, device_info,
    metadata, idempotency_key, created_by
  ) values (
    v_employee.organization_id, p_employee_id,
    v_event_type::public.attendance_event_type,
    v_source::public.attendance_source,
    v_now, v_now,
    jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(p_longitude, p_latitude)),
    p_accuracy_meters, p_geofence_id, v_polygon_id,
    v_validation::public.geofence_validation_status, v_inside,
    'not_required'::public.approval_status, coalesce(p_device_info, '{}'::jsonb),
    '{}'::jsonb, p_idempotency_key, v_user_id
  ) returning id into v_event_id;

  if not v_inside then
    insert into public.notifications (
      organization_id, recipient_user_id, notification_type, severity, title, body,
      entity_type, entity_id
    )
    select v_employee.organization_id, m.user_id, 'geofence', 'warning',
      'Geofence validation failed',
      'An attendance attempt was rejected outside the assigned geofence.',
      'employee', p_employee_id
    from public.organization_memberships m
    where m.organization_id = v_employee.organization_id
      and m.status::text = 'active'
      and m.role_code::text in ('manager', 'administrator');

    return query select null::uuid, v_event_id, 'outside_geofence', false, v_validation;
    return;
  end if;

  if v_shift.id is not null then
    v_shift_start := (v_work_date + v_shift.start_time) at time zone v_timezone;
    v_shift_end := (
      v_work_date + v_shift.end_time
      + case when v_shift.crosses_midnight or v_shift.end_time <= v_shift.start_time
        then interval '1 day' else interval '0 day' end
    ) at time zone v_timezone;
    v_scheduled := greatest(0,
      floor(extract(epoch from (v_shift_end - v_shift_start)) / 60)::integer
      - greatest(0, v_shift.break_minutes)
    );
  end if;

  if p_action_type = 'check_in' then
    if v_record.id is not null and v_record.check_in_at is not null then
      return query select v_record.id, v_event_id, v_record.status::text, true, v_validation;
      return;
    end if;
    if v_shift_start is not null then
      v_late := greatest(0, floor(extract(epoch from (v_now - v_shift_start)) / 60)::integer);
    end if;

    if v_record.id is null then
      insert into public.attendance_records (
        organization_id, employee_id, shift_assignment_id, attendance_date,
        session_number, check_in_event_id, check_in_at, source, status,
        late_minutes, early_leaving_minutes, worked_minutes, missing_minutes,
        overtime_minutes, geofence_validated, approval_status
      ) values (
        v_employee.organization_id, p_employee_id, v_assignment.id, v_work_date,
        1, v_event_id, v_now, v_source::public.attendance_source,
        (case when v_late > 0 then 'late' else 'present' end)::public.attendance_status,
        v_late, 0, 0, v_scheduled, 0, true, 'not_required'::public.approval_status
      ) returning * into v_record;
    else
      update public.attendance_records ar set
        shift_assignment_id = coalesce(ar.shift_assignment_id, v_assignment.id),
        check_in_event_id = v_event_id,
        check_in_at = v_now,
        source = v_source::public.attendance_source,
        status = (case when v_late > 0 then 'late' else 'present' end)::public.attendance_status,
        late_minutes = v_late,
        missing_minutes = v_scheduled,
        geofence_validated = true
      where ar.id = v_record.id
      returning ar.* into v_record;
    end if;
  else
    v_presence := greatest(0, floor(extract(epoch from (v_now - v_record.check_in_at)) / 60)::integer);
    v_worked := greatest(0, v_presence - least(coalesce(v_shift.break_minutes, 0), v_presence));

    if v_shift_start is not null then
      v_overlap := greatest(0, floor(extract(epoch from (
        least(v_now, v_shift_end) - greatest(v_record.check_in_at, v_shift_start)
      )) / 60)::integer);
      v_regular := greatest(0, v_overlap - least(coalesce(v_shift.break_minutes, 0), v_overlap));
      v_regular := least(v_regular, v_scheduled);
      v_overtime := greatest(0, v_worked - v_regular);
      v_late := greatest(0, floor(extract(epoch from (v_record.check_in_at - v_shift_start)) / 60)::integer);
      v_early := greatest(0, floor(extract(epoch from (v_shift_end - v_now)) / 60)::integer);
      v_missing := greatest(0, v_scheduled - v_regular);
    else
      v_overtime := v_worked;
    end if;

    update public.attendance_records ar set
      check_out_event_id = v_event_id,
      check_out_at = v_now,
      worked_minutes = v_worked,
      overtime_minutes = v_overtime,
      late_minutes = v_late,
      early_leaving_minutes = v_early,
      missing_minutes = v_missing,
      geofence_validated = ar.geofence_validated and v_inside
    where ar.id = v_record.id
    returning ar.* into v_record;

    if v_overtime > 0 then
      insert into public.overtime_records (
        organization_id, employee_id, attendance_record_id, requested_minutes,
        approved_minutes, status, reason, requested_by, requested_at
      ) values (
        v_employee.organization_id, p_employee_id, v_record.id, v_overtime,
        null, 'pending'::public.approval_status, 'System calculated overtime',
        v_user_id, v_now
      )
      on conflict (attendance_record_id) do update
        set requested_minutes = excluded.requested_minutes,
            updated_at = clock_timestamp()
        where public.overtime_records.status::text = 'pending';
    end if;
  end if;

  return query select v_record.id, v_event_id, v_record.status::text, true, v_validation;
end;
$$;

-- Approval functions keep status changes and their dependent writes atomic.
create or replace function private.recalculate_attendance(p_attendance_record_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.attendance_records%rowtype;
  v_shift public.shifts%rowtype;
  v_timezone text := 'UTC';
  v_shift_start timestamptz;
  v_shift_end timestamptz;
  v_scheduled integer := 0;
  v_presence integer := 0;
  v_overlap integer := 0;
  v_regular integer := 0;
  v_worked integer := 0;
  v_overtime integer := 0;
  v_late integer := 0;
  v_early integer := 0;
  v_missing integer := 0;
  v_break integer := 0;
begin
  select * into v_record from public.attendance_records
  where id = p_attendance_record_id for update;
  if not found then raise exception 'Attendance record not found' using errcode = 'P0002'; end if;

  select coalesce(nullif(b.timezone, ''), nullif(o.timezone, ''), 'UTC') into v_timezone
  from public.organizations o
  join public.employee_profiles e
    on e.id = v_record.employee_id and e.organization_id = o.id
  left join public.branches b on b.id = e.branch_id and b.organization_id = o.id
  where o.id = v_record.organization_id;
  if v_record.shift_assignment_id is not null then
    select s.* into v_shift
    from public.shift_assignments sa
    join public.shifts s on s.id = sa.shift_id
    where sa.id = v_record.shift_assignment_id;
  end if;

  if v_shift.id is not null then
    v_break := greatest(0, v_shift.break_minutes);
    v_shift_start := (v_record.attendance_date + v_shift.start_time) at time zone v_timezone;
    v_shift_end := (
      v_record.attendance_date + v_shift.end_time
      + case when v_shift.crosses_midnight or v_shift.end_time <= v_shift.start_time
        then interval '1 day' else interval '0 day' end
    ) at time zone v_timezone;
    v_scheduled := greatest(0,
      floor(extract(epoch from (v_shift_end - v_shift_start)) / 60)::integer - v_break
    );
  end if;

  if v_record.check_in_at is null then
    update public.attendance_records set
      worked_minutes = 0, overtime_minutes = 0, late_minutes = 0,
      early_leaving_minutes = 0, missing_minutes = v_scheduled,
      status = 'missing_check_in'::public.attendance_status
    where id = v_record.id;
    return;
  end if;

  if v_shift_start is not null then
    v_late := greatest(0,
      floor(extract(epoch from (v_record.check_in_at - v_shift_start)) / 60)::integer
    );
  end if;
  if v_record.check_out_at is null then
    update public.attendance_records set
      late_minutes = v_late, missing_minutes = v_scheduled,
      status = (case when v_late > 0 then 'late' else 'present' end)::public.attendance_status
    where id = v_record.id;
    return;
  end if;
  if v_record.check_out_at <= v_record.check_in_at then
    raise exception 'Check-out must be after check-in' using errcode = '22023';
  end if;

  v_presence := floor(extract(epoch from (v_record.check_out_at - v_record.check_in_at)) / 60)::integer;
  v_worked := greatest(0, v_presence - least(v_break, v_presence));
  if v_shift_start is not null then
    v_overlap := greatest(0, floor(extract(epoch from (
      least(v_record.check_out_at, v_shift_end) - greatest(v_record.check_in_at, v_shift_start)
    )) / 60)::integer);
    v_regular := least(v_scheduled, greatest(0, v_overlap - least(v_break, v_overlap)));
    v_overtime := greatest(0, v_worked - v_regular);
    v_early := greatest(0,
      floor(extract(epoch from (v_shift_end - v_record.check_out_at)) / 60)::integer
    );
    v_missing := greatest(0, v_scheduled - v_regular);
  else
    v_overtime := v_worked;
  end if;

  update public.attendance_records set
    worked_minutes = v_worked,
    overtime_minutes = v_overtime,
    late_minutes = v_late,
    early_leaving_minutes = v_early,
    missing_minutes = v_missing,
    status = (case when v_late > 0 then 'late' else 'present' end)::public.attendance_status
  where id = v_record.id;
end;
$$;

revoke all on function private.recalculate_attendance(uuid) from public, anon, authenticated;

create or replace function public.review_manual_attendance_request(
  p_request_id uuid,
  p_status text,
  p_review_note text
)
returns setof public.manual_attendance_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.manual_attendance_requests%rowtype;
  v_user_id uuid := (select auth.uid());
  v_recipient uuid;
begin
  if p_status not in ('approved', 'rejected') then
    raise exception 'Invalid review status' using errcode = '22023';
  end if;
  select * into v_request from public.manual_attendance_requests
  where id = p_request_id for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if not private.can_access_employee(v_request.organization_id, v_request.employee_id) then
    raise exception 'Not authorized to review this request' using errcode = '42501';
  end if;
  if v_request.status::text <> 'pending' then
    raise exception 'Request has already been reviewed' using errcode = '22023';
  end if;

  update public.manual_attendance_requests set
    status = p_status::public.approval_status,
    reviewed_by = v_user_id,
    reviewed_at = clock_timestamp(),
    review_note = nullif(btrim(p_review_note), '')
  where id = p_request_id returning * into v_request;

  if p_status = 'approved' and v_request.attendance_record_id is not null then
    if v_request.request_type::text = 'check_in' then
      if exists (
        select 1 from public.attendance_records ar
        where ar.id = v_request.attendance_record_id
          and ar.check_out_at is not null
          and ar.check_out_at <= v_request.requested_at
      ) then
        raise exception 'Corrected check-in must be before check-out' using errcode = '22023';
      end if;
      update public.attendance_records set check_in_at = v_request.requested_at
      where id = v_request.attendance_record_id and employee_id = v_request.employee_id;
    elsif v_request.request_type::text = 'check_out' then
      if exists (
        select 1 from public.attendance_records ar
        where ar.id = v_request.attendance_record_id
          and ar.check_in_at is not null
          and ar.check_in_at >= v_request.requested_at
      ) then
        raise exception 'Corrected check-out must be after check-in' using errcode = '22023';
      end if;
      update public.attendance_records set check_out_at = v_request.requested_at
      where id = v_request.attendance_record_id and employee_id = v_request.employee_id;
    else
      raise exception 'Generic corrections require explicit corrected fields' using errcode = '22023';
    end if;
    perform private.recalculate_attendance(v_request.attendance_record_id);
  end if;

  select user_id into v_recipient from public.employee_profiles where id = v_request.employee_id;
  if v_recipient is not null then
    insert into public.notifications (
      organization_id, recipient_user_id, notification_type, severity, title, body,
      entity_type, entity_id
    ) values (
      v_request.organization_id, v_recipient, 'correction',
      case when p_status = 'approved' then 'info' else 'warning' end::public.notification_severity,
      'Correction request ' || p_status,
      'Your manual attendance request has been ' || p_status || '.',
      'manual_attendance_request', v_request.id
    );
  end if;
  return next v_request;
end;
$$;

create or replace function public.review_overtime_record(
  p_overtime_id uuid,
  p_status text,
  p_approved_minutes integer,
  p_review_note text
)
returns setof public.overtime_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.overtime_records%rowtype;
  v_user_id uuid := (select auth.uid());
  v_recipient uuid;
begin
  if p_status not in ('approved', 'rejected') then
    raise exception 'Invalid review status' using errcode = '22023';
  end if;
  select * into v_record from public.overtime_records where id = p_overtime_id for update;
  if not found then raise exception 'Overtime record not found' using errcode = 'P0002'; end if;
  if not private.can_access_employee(v_record.organization_id, v_record.employee_id) then
    raise exception 'Not authorized to review overtime' using errcode = '42501';
  end if;
  if v_record.status::text <> 'pending' then
    raise exception 'Overtime has already been reviewed' using errcode = '22023';
  end if;
  if p_status = 'approved'
    and (p_approved_minutes is null or p_approved_minutes < 0 or p_approved_minutes > v_record.requested_minutes) then
    raise exception 'Approved minutes must be between zero and requested minutes' using errcode = '22023';
  end if;

  update public.overtime_records set
    status = p_status::public.approval_status,
    approved_minutes = case when p_status = 'approved' then p_approved_minutes else 0 end,
    approved_by = v_user_id,
    approved_at = clock_timestamp(),
    review_note = nullif(btrim(p_review_note), '')
  where id = p_overtime_id returning * into v_record;

  select user_id into v_recipient from public.employee_profiles where id = v_record.employee_id;
  if v_recipient is not null then
    insert into public.notifications (
      organization_id, recipient_user_id, notification_type, severity, title, body,
      entity_type, entity_id
    ) values (
      v_record.organization_id, v_recipient, 'overtime',
      case when p_status = 'approved' then 'info' else 'warning' end::public.notification_severity,
      'Overtime ' || p_status,
      'Your overtime request has been ' || p_status || '.',
      'overtime_record', v_record.id
    );
  end if;
  return next v_record;
end;
$$;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns setof public.notifications
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notification public.notifications%rowtype;
begin
  update public.notifications set read_at = coalesce(read_at, clock_timestamp())
  where id = p_notification_id and recipient_user_id = (select auth.uid())
  returning * into v_notification;
  if not found then raise exception 'Notification not found' using errcode = 'P0002'; end if;
  return next v_notification;
end;
$$;

revoke all on function public.process_attendance_event(uuid, uuid, text, boolean, double precision, double precision, double precision, boolean, text, jsonb) from public, anon, authenticated;
revoke all on function public.review_manual_attendance_request(uuid, text, text) from public, anon, authenticated;
revoke all on function public.review_overtime_record(uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public.mark_notification_read(uuid) from public, anon, authenticated;
grant execute on function public.process_attendance_event(uuid, uuid, text, boolean, double precision, double precision, double precision, boolean, text, jsonb) to authenticated;
grant execute on function public.review_manual_attendance_request(uuid, text, text) to authenticated;
grant execute on function public.review_overtime_record(uuid, text, integer, text) to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;

commit;
