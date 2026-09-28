-- GEOTRACK base schema for a brand-new Supabase project.
-- Contains structural/reference data only; no demo organizations or employees.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- New database objects are private by default. Later migrations explicitly
-- grant the narrow Data API surface required by authenticated clients.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

create type public.app_role as enum ('employee', 'manager', 'administrator');
create type public.org_status as enum ('active', 'suspended', 'archived');
create type public.membership_status as enum ('invited', 'active', 'suspended', 'removed');
create type public.record_status as enum ('active', 'inactive', 'archived');
create type public.employment_status as enum ('active', 'inactive', 'on_leave', 'terminated');
create type public.shift_assignment_status as enum ('scheduled', 'off', 'leave', 'cancelled');
create type public.assignment_source as enum ('manual', 'recurring', 'imported');
create type public.checkin_mode as enum ('automatic', 'confirmation', 'manual_only');
create type public.geofence_status as enum ('draft', 'active', 'disabled', 'archived');
create type public.attendance_event_type as enum (
  'gps_enter', 'gps_exit', 'automatic_check_in', 'automatic_check_out',
  'manual_check_in', 'manual_check_out', 'correction_applied'
);
create type public.attendance_source as enum (
  'automatic_geofence', 'manual_employee', 'manual_manager', 'admin', 'imported'
);
create type public.geofence_validation_status as enum (
  'valid', 'invalid', 'low_accuracy', 'permission_denied', 'mock_location', 'unknown'
);
create type public.approval_status as enum ('not_required', 'pending', 'approved', 'rejected');
create type public.attendance_status as enum (
  'present', 'late', 'absent', 'missing_check_in', 'missing_check_out',
  'outside_geofence', 'off_day', 'on_leave', 'invalid'
);
create type public.manual_request_type as enum ('check_in', 'check_out', 'correction');
create type public.leave_type as enum ('sick', 'annual', 'emergency', 'personal', 'hajj', 'unpaid');
create type public.leave_request_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.notification_severity as enum ('info', 'warning', 'error');
create type public.device_platform as enum ('android', 'ios', 'web');
create type public.device_integrity_status as enum ('unknown', 'valid', 'suspected', 'blocked');

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  email text,
  phone text,
  avatar_path text,
  locale text not null default 'en',
  timezone text not null default 'UTC',
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  timezone text not null default 'UTC',
  status public.org_status not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.roles (
  code public.app_role primary key,
  name text not null unique,
  description text
);

insert into public.roles (code, name, description) values
  ('employee', 'Employee', 'Employee self-service access'),
  ('manager', 'Manager', 'Scoped workforce management access'),
  ('administrator', 'Administrator', 'Organization administration access');

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_code public.app_role not null references public.roles(code),
  status public.membership_status not null default 'invited',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, user_id, role_code)
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  timezone text not null default 'UTC',
  address text,
  location_point jsonb,
  status public.record_status not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, code),
  unique (organization_id, id),
  check (location_point is null or location_point->>'type' = 'Point')
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  code text not null,
  name text not null,
  status public.record_status not null default 'active',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, code),
  unique (organization_id, id),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id) on delete cascade
);

create table public.employee_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  employee_code text not null,
  iqama_number text not null,
  full_name text not null,
  mobile_number text,
  branch_id uuid not null,
  department_id uuid not null,
  job_title text,
  manager_user_id uuid references auth.users(id) on delete set null,
  joining_date date,
  employment_status public.employment_status not null default 'active',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, employee_code),
  unique (organization_id, iqama_number),
  unique (organization_id, user_id),
  unique (organization_id, id),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id),
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id)
);

create table public.manager_scopes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  manager_user_id uuid not null references auth.users(id) on delete cascade,
  branch_id uuid,
  department_id uuid,
  employee_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id) on delete cascade,
  foreign key (organization_id, department_id)
    references public.departments(organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id)
    references public.employee_profiles(organization_id, id) on delete cascade
);

create table public.employee_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  device_identifier_hash text not null,
  platform public.device_platform not null,
  model text,
  os_version text,
  app_version text,
  integrity_status public.device_integrity_status not null default 'unknown',
  registered_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (employee_id, device_identifier_hash),
  foreign key (organization_id, employee_id)
    references public.employee_profiles(organization_id, id) on delete cascade
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  start_time time not null,
  end_time time not null,
  crosses_midnight boolean not null default false,
  break_minutes integer not null default 0 check (break_minutes between 0 and 1440),
  color text,
  status public.record_status not null default 'active',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, code),
  unique (organization_id, id)
);

create table public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  shift_id uuid,
  work_date date not null,
  status public.shift_assignment_status not null default 'scheduled',
  source public.assignment_source not null default 'manual',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (employee_id, work_date),
  foreign key (organization_id, employee_id)
    references public.employee_profiles(organization_id, id) on delete cascade,
  foreign key (organization_id, shift_id)
    references public.shifts(organization_id, id)
);

create table public.weekly_offs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (employee_id, weekday, effective_from),
  check (effective_to is null or effective_to >= effective_from),
  foreign key (organization_id, employee_id)
    references public.employee_profiles(organization_id, id) on delete cascade
);

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid,
  holiday_date date not null,
  name text not null,
  is_working_day boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, branch_id, holiday_date, name),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id) on delete cascade
);

create table public.geofences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  name text not null,
  color text,
  status public.geofence_status not null default 'draft',
  checkin_mode public.checkin_mode not null default 'confirmation',
  required_accuracy_meters integer not null default 50 check (required_accuracy_meters > 0),
  auto_checkout_timeout_minutes integer not null default 15 check (auto_checkout_timeout_minutes >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, branch_id, name),
  unique (organization_id, id),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id) on delete cascade
);

create table public.geofence_polygons (
  id uuid primary key default gen_random_uuid(),
  geofence_id uuid not null references public.geofences(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  polygon jsonb not null check (polygon->>'type' = 'MultiPolygon'),
  valid_from timestamptz not null default clock_timestamp(),
  valid_to timestamptz,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  unique (geofence_id, version_number),
  check (valid_to is null or valid_to > valid_from)
);

create table public.geofence_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  geofence_id uuid not null,
  employee_id uuid not null,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default clock_timestamp(),
  check (effective_to is null or effective_to >= effective_from),
  foreign key (organization_id, geofence_id)
    references public.geofences(organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id)
    references public.employee_profiles(organization_id, id) on delete cascade
);

create table public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  device_id text,
  event_type public.attendance_event_type not null,
  source public.attendance_source not null,
  event_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  location_point jsonb,
  accuracy_meters double precision check (accuracy_meters is null or accuracy_meters >= 0),
  geofence_id uuid,
  geofence_polygon_id uuid references public.geofence_polygons(id),
  geofence_validation public.geofence_validation_status not null default 'unknown',
  inside_geofence boolean,
  approval_status public.approval_status not null default 'not_required',
  device_info jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  check (location_point is null or location_point->>'type' = 'Point'),
  foreign key (organization_id, employee_id)
    references public.employee_profiles(organization_id, id) on delete cascade,
  foreign key (organization_id, geofence_id)
    references public.geofences(organization_id, id)
);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  shift_assignment_id uuid references public.shift_assignments(id),
  attendance_date date not null,
  session_number integer not null default 1 check (session_number > 0),
  check_in_event_id uuid references public.attendance_events(id),
  check_out_event_id uuid references public.attendance_events(id),
  check_in_at timestamptz,
  check_out_at timestamptz,
  source public.attendance_source not null,
  status public.attendance_status not null,
  late_minutes integer not null default 0 check (late_minutes >= 0),
  early_leaving_minutes integer not null default 0 check (early_leaving_minutes >= 0),
  worked_minutes integer not null default 0 check (worked_minutes >= 0),
  missing_minutes integer not null default 0 check (missing_minutes >= 0),
  overtime_minutes integer not null default 0 check (overtime_minutes >= 0),
  geofence_validated boolean not null default false,
  approval_status public.approval_status not null default 'not_required',
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  notes text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (check_out_at is null or check_in_at is null or check_out_at > check_in_at),
  foreign key (organization_id, employee_id)
    references public.employee_profiles(organization_id, id) on delete cascade
);

create table public.manual_attendance_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  attendance_record_id uuid references public.attendance_records(id) on delete set null,
  request_type public.manual_request_type not null,
  requested_at timestamptz not null,
  location_point jsonb,
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  supporting_file_path text,
  status public.approval_status not null default 'pending',
  requested_by uuid not null references auth.users(id),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (location_point is null or location_point->>'type' = 'Point'),
  foreign key (organization_id, employee_id)
    references public.employee_profiles(organization_id, id) on delete cascade
);

create table public.overtime_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  attendance_record_id uuid not null references public.attendance_records(id) on delete cascade,
  requested_minutes integer not null check (requested_minutes >= 0),
  approved_minutes integer check (approved_minutes is null or approved_minutes >= 0),
  status public.approval_status not null default 'pending',
  reason text,
  requested_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default clock_timestamp(),
  approved_at timestamptz,
  review_note text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (approved_minutes is null or approved_minutes <= requested_minutes),
  foreign key (organization_id, employee_id)
    references public.employee_profiles(organization_id, id) on delete cascade
);

create table public.productivity_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  shift_assignment_id uuid references public.shift_assignments(id) on delete set null,
  work_date date not null,
  metric_code text not null,
  target_units numeric(14,2) not null default 0 check (target_units >= 0),
  actual_units numeric(14,2) not null default 0 check (actual_units >= 0),
  productive_hours numeric(8,2) check (productive_hours is null or productive_hours >= 0),
  productivity_percent numeric(7,2) check (productivity_percent is null or productivity_percent >= 0),
  manager_notes text,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (employee_id, work_date, metric_code),
  foreign key (organization_id, employee_id)
    references public.employee_profiles(organization_id, id) on delete cascade
);

create table public.phone_usage_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  device_id text,
  work_date date not null,
  active_minutes integer not null default 0 check (active_minutes >= 0),
  within_shift_minutes integer not null default 0 check (within_shift_minutes >= 0),
  policy_limit_minutes integer check (policy_limit_minutes is null or policy_limit_minutes >= 0),
  source text,
  consent_version text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, employee_id)
    references public.employee_profiles(organization_id, id) on delete cascade
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  notification_type text not null,
  severity public.notification_severity not null default 'info',
  title text not null,
  body text not null,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  leave_type public.leave_type not null,
  from_date date not null,
  to_date date not null,
  days numeric(6,2) not null check (days > 0),
  reason text not null,
  supporting_file_path text,
  status public.leave_request_status not null default 'pending',
  requested_by uuid not null references auth.users(id),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (to_date >= from_date),
  foreign key (organization_id, employee_id)
    references public.employee_profiles(organization_id, id) on delete cascade
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default clock_timestamp()
);

-- Keep updated_at trustworthy and consistent for direct writes allowed by RLS.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'users', 'organizations', 'organization_memberships', 'branches', 'departments',
    'employee_profiles', 'employee_devices', 'shifts', 'shift_assignments',
    'weekly_offs', 'geofences', 'attendance_records', 'manual_attendance_requests',
    'overtime_records', 'productivity_records', 'phone_usage_records', 'leave_requests'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function private.set_updated_at()',
      v_table
    );
  end loop;
end
$$;

-- Every Auth account gets a non-authoritative public profile row. Authorization
-- remains in organization_memberships, never in editable user metadata.
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, display_name, email, phone)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'), ''), split_part(coalesce(new.email, 'User'), '@', 1)),
    new.email,
    new.phone
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.handle_new_auth_user() from public, anon, authenticated;

-- Defense in depth while the next migration installs the canonical policies.
do $$
declare
  v_table text;
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
  end loop;
end
$$;

grant all on table
  public.users, public.organizations, public.roles, public.organization_memberships,
  public.manager_scopes, public.branches, public.departments, public.employee_profiles,
  public.employee_devices, public.shifts, public.shift_assignments, public.weekly_offs,
  public.holidays, public.geofences, public.geofence_polygons, public.geofence_assignments,
  public.attendance_events, public.attendance_records, public.manual_attendance_requests,
  public.overtime_records, public.productivity_records, public.phone_usage_records,
  public.notifications, public.leave_requests, public.audit_logs
to service_role;
