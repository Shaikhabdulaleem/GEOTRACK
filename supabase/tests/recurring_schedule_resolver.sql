begin;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values ('30000000-0000-0000-0000-000000000001', 'schedule-admin@example.invalid', '{}'::jsonb, '{"display_name":"Schedule Admin"}'::jsonb);
insert into public.organizations (id, name, slug, timezone)
values ('31000000-0000-0000-0000-000000000001', 'Schedule Test', 'schedule-test', 'UTC');
insert into public.organization_memberships (organization_id, user_id, role_code, status)
values ('31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'administrator', 'active');
insert into public.branches (id, organization_id, code, name)
values ('32000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', 'SITE', 'Site');
insert into public.departments (id, organization_id, branch_id, code, name)
values ('33000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', '32000000-0000-0000-0000-000000000001', 'OPS', 'Operations');
insert into public.employee_profiles (id, organization_id, employee_code, iqama_number, full_name, branch_id, department_id)
values ('34000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', 'SCHED-1', '3000000001', 'Schedule Employee', '32000000-0000-0000-0000-000000000001', '33000000-0000-0000-0000-000000000001');

-- Seed the approved leave as part of privileged setup. RLS only lets an
-- employee create their OWN leave in 'pending' status; a manager then approves
-- via update. This fixture only needs the approved row to exist so the resolver
-- can be checked, so it is inserted here (owner role) rather than faked as an
-- authenticated admin, which the leave_requests policies correctly forbid.
insert into public.leave_requests (
  organization_id, employee_id, leave_type, from_date, to_date, days,
  reason, status, requested_by
) values (
  '31000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000001',
  'annual', '2026-10-03', '2026-10-03', 1, 'Test', 'approved',
  '30000000-0000-0000-0000-000000000001'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);

do $test$
declare
  v_shift public.shifts%rowtype;
  v_schedule public.recurring_schedules%rowtype;
  v_row record;
begin
  select * into v_shift from public.save_shift_template(
    null, '31000000-0000-0000-0000-000000000001', 'MORNING', 'Morning',
    '08:00', '16:00', 30, '#2563eb', '2026-10-01'
  );
  select * into v_schedule from public.set_recurring_schedule(
    '34000000-0000-0000-0000-000000000001', '2026-10-01', null,
    jsonb_build_array(
      jsonb_build_object('weekday',0,'shift_id',v_shift.id,'is_off',false),
      jsonb_build_object('weekday',1,'shift_id',v_shift.id,'is_off',false),
      jsonb_build_object('weekday',2,'shift_id',v_shift.id,'is_off',false),
      jsonb_build_object('weekday',3,'shift_id',v_shift.id,'is_off',false),
      jsonb_build_object('weekday',4,'shift_id',v_shift.id,'is_off',false),
      jsonb_build_object('weekday',5,'shift_id',null,'is_off',true),
      jsonb_build_object('weekday',6,'shift_id',v_shift.id,'is_off',false)
    )
  );

  select * into v_row from public.resolve_employee_schedule(
    '34000000-0000-0000-0000-000000000001', '2026-10-02', '2026-10-02'
  );
  if v_row.state <> 'off' or v_row.source <> 'recurring' then
    raise exception 'Friday recurring OFF resolution failed: %/%', v_row.state, v_row.source;
  end if;

  insert into public.holidays (organization_id, holiday_date, name)
  values ('31000000-0000-0000-0000-000000000001', '2026-10-03', 'Test Holiday');
  insert into public.shift_assignments (organization_id, employee_id, shift_id, work_date, status, source)
  values ('31000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000001', v_shift.id, '2026-10-03', 'scheduled', 'manual');
  select * into v_row from public.resolve_employee_schedule(
    '34000000-0000-0000-0000-000000000001', '2026-10-03', '2026-10-03'
  );
  if v_row.state <> 'working' or v_row.source <> 'dated_override' then
    raise exception 'Dated override did not take precedence over holiday';
  end if;

  -- Leave row seeded above during privileged setup.
  select * into v_row from public.resolve_employee_schedule(
    '34000000-0000-0000-0000-000000000001', '2026-10-03', '2026-10-03'
  );
  if v_row.state <> 'leave' then raise exception 'Leave precedence failed'; end if;
end
$test$;

reset role;
rollback;
