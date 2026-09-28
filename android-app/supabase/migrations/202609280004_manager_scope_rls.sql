-- Manager access is limited by direct assignment or an explicit manager scope.
-- These policies are intentionally server-side; Android filters are not security boundaries.
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
       and m.user_id = auth.uid()
       and m.status = 'active'
       and m.role_code in ('manager', 'administrator')
     where e.id = p_employee_id
       and (
         m.role_code = 'administrator'
         or e.manager_user_id = auth.uid()
         or exists (
           select 1
             from public.manager_scopes s
            where s.organization_id = e.organization_id
              and s.manager_user_id = auth.uid()
              and (s.employee_id = e.id or s.branch_id = e.branch_id or s.department_id = e.department_id)
         )
       )
  );
$$;

revoke all on function private.manager_can_access_employee(uuid) from public;
grant execute on function private.manager_can_access_employee(uuid) to authenticated;

alter table public.employee_profiles enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.weekly_offs enable row level security;
alter table public.leave_requests enable row level security;
alter table public.attendance_records enable row level security;
alter table public.overtime_records enable row level security;
alter table public.productivity_records enable row level security;
alter table public.phone_usage_records enable row level security;
alter table public.notifications enable row level security;

drop policy if exists manager_scoped_employee_select on public.employee_profiles;
create policy manager_scoped_employee_select on public.employee_profiles
  for select to authenticated
  using (private.manager_can_access_employee(id));

drop policy if exists manager_scoped_shift_select on public.shift_assignments;
create policy manager_scoped_shift_select on public.shift_assignments
  for select to authenticated
  using (private.manager_can_access_employee(employee_id));

drop policy if exists manager_scoped_weekly_off_select on public.weekly_offs;
create policy manager_scoped_weekly_off_select on public.weekly_offs
  for select to authenticated
  using (private.manager_can_access_employee(employee_id));

drop policy if exists manager_scoped_leave_select on public.leave_requests;
create policy manager_scoped_leave_select on public.leave_requests
  for select to authenticated
  using (private.manager_can_access_employee(employee_id));

drop policy if exists manager_scoped_attendance_select on public.attendance_records;
create policy manager_scoped_attendance_select on public.attendance_records
  for select to authenticated
  using (private.manager_can_access_employee(employee_id));

drop policy if exists manager_scoped_overtime_select on public.overtime_records;
create policy manager_scoped_overtime_select on public.overtime_records
  for select to authenticated
  using (private.manager_can_access_employee(employee_id));

drop policy if exists manager_scoped_productivity_select on public.productivity_records;
create policy manager_scoped_productivity_select on public.productivity_records
  for select to authenticated
  using (private.manager_can_access_employee(employee_id));

drop policy if exists manager_scoped_phone_usage_select on public.phone_usage_records;
create policy manager_scoped_phone_usage_select on public.phone_usage_records
  for select to authenticated
  using (private.manager_can_access_employee(employee_id));

drop policy if exists recipient_notification_select on public.notifications;
create policy recipient_notification_select on public.notifications
  for select to authenticated
  using (recipient_user_id = auth.uid());

comment on function private.manager_can_access_employee(uuid) is
  'Returns true only for active managers/admins with direct, branch, department, or explicit employee scope.';
