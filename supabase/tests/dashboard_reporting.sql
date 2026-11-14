-- Database-backed dashboard aggregates must honor tenant scope and local dates.
begin;

insert into auth.users (id, email)
values ('71000000-0000-0000-0000-000000000001', 'report-admin@example.invalid'),
       ('71000000-0000-0000-0000-000000000002', 'report-employee@example.invalid');

insert into public.organizations (id, name, slug, timezone)
values ('72000000-0000-0000-0000-000000000001', 'Reporting Test', 'reporting-test', 'Asia/Riyadh');
insert into public.organization_memberships (organization_id, user_id, role_code, status)
values ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 'administrator', 'active'),
       ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'employee', 'active');
insert into public.branches (id, organization_id, code, name, timezone)
values ('73000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', 'RPT', 'Reporting Branch', 'Asia/Riyadh');
insert into public.departments (id, organization_id, branch_id, code, name)
values ('74000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001',
        '73000000-0000-0000-0000-000000000001', 'OPS', 'Operations');
insert into public.employee_profiles (
  id, organization_id, user_id, employee_code, iqama_number, full_name, branch_id, department_id
) values (
  '75000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001',
  '71000000-0000-0000-0000-000000000002', 'RPT-1', '7000000001', 'Report Employee',
  '73000000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000001'
);
insert into public.attendance_records (
  organization_id, employee_id, attendance_date, session_number, check_in_at, check_out_at,
  source, status, worked_minutes, overtime_minutes
) values (
  '72000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000001',
  current_date, 1, clock_timestamp() - interval '9 hours', clock_timestamp(),
  'automatic_geofence', 'late', 480, 60
);
insert into public.productivity_records (
  organization_id, employee_id, work_date, metric_code, target_units, actual_units
) values (
  '72000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000001',
  current_date, 'packages', 100, 80
);
insert into public.attendance_events (
  organization_id, employee_id, event_type, source, event_at, inside_geofence,
  geofence_validation, idempotency_key
) values (
  '72000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000001',
  'gps_exit', 'automatic_geofence',
  (current_date + time '09:00') at time zone 'Asia/Riyadh', false, 'invalid', 'report-exit-1'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);

do $test$
declare
  v_result jsonb;
  v_today jsonb;
begin
  v_result := public.get_dashboard_trends(
    '72000000-0000-0000-0000-000000000001', current_date, 7,
    null, null, null, null, null
  );
  if jsonb_array_length(v_result->'attendance') <> 7
     or jsonb_array_length(v_result->'overtime') <> 7
     or jsonb_array_length(v_result->'productivity') <> 7
     or jsonb_array_length(v_result->'geofence') <> 7 then
    raise exception 'Dashboard trend series did not return seven complete days';
  end if;

  select item into v_today
  from jsonb_array_elements(v_result->'attendance') item
  where item->>'date' = current_date::text;
  if (v_today->>'present')::integer <> 1
     or (v_today->>'late')::integer <> 1
     or (v_today->>'workedHours')::numeric <> 8.0 then
    raise exception 'Attendance trend aggregate is incorrect: %', v_today;
  end if;
  select item into v_today
  from jsonb_array_elements(v_result->'overtime') item
  where item->>'date' = current_date::text;
  if (v_today->>'hours')::numeric <> 1.0 then
    raise exception 'Overtime trend aggregate is incorrect: %', v_today;
  end if;
  select item into v_today
  from jsonb_array_elements(v_result->'productivity') item
  where item->>'date' = current_date::text;
  if (v_today->>'productivity')::numeric <> 80.0 or not (v_today->>'available')::boolean then
    raise exception 'Productivity trend aggregate is incorrect: %', v_today;
  end if;
  select item into v_today
  from jsonb_array_elements(v_result->'geofence') item
  where item->>'date' = current_date::text;
  if (v_today->>'violations')::integer <> 1 then
    raise exception 'Timezone-aware geofence aggregate is incorrect: %', v_today;
  end if;
end
$test$;

reset role;
rollback;
