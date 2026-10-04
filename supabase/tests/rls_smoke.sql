-- Transactional RLS smoke test. Every fixture is rolled back.
begin;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-0000-0000-000000000001', 'admin@example.invalid', '{}'::jsonb, '{"display_name":"Admin"}'::jsonb),
  ('10000000-0000-0000-0000-000000000002', 'manager@example.invalid', '{}'::jsonb, '{"display_name":"Manager"}'::jsonb),
  ('10000000-0000-0000-0000-000000000003', 'employee@example.invalid', '{}'::jsonb, '{"display_name":"Employee"}'::jsonb),
  ('20000000-0000-0000-0000-000000000001', 'other@example.invalid', '{}'::jsonb, '{"display_name":"Other"}'::jsonb);

insert into public.organizations (id, name, slug, timezone) values
  ('11000000-0000-0000-0000-000000000001', 'RLS Org One', 'rls-org-one', 'UTC'),
  ('21000000-0000-0000-0000-000000000001', 'RLS Org Two', 'rls-org-two', 'UTC');

insert into public.organization_memberships (organization_id, user_id, role_code, status) values
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'administrator', 'active'),
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'manager', 'active'),
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'employee', 'active'),
  ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'employee', 'active');

insert into public.branches (id, organization_id, code, name) values
  ('12000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'ONE', 'One'),
  ('22000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'TWO', 'Two');
insert into public.departments (id, organization_id, branch_id, code, name) values
  ('13000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', 'ONE', 'One'),
  ('23000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', 'TWO', 'Two');

insert into public.employee_profiles (
  id, organization_id, user_id, employee_code, iqama_number, full_name,
  branch_id, department_id, manager_user_id
) values
  ('14000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'EMP-1', '1000000001', 'Employee One', '12000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002'),
  ('14000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001', null, 'EMP-2', '1000000002', 'Employee Two', '12000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', null),
  ('24000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'EMP-X', '2000000001', 'Other Tenant', '22000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', null);

insert into public.audit_logs (organization_id, action, entity_type)
values
  ('11000000-0000-0000-0000-000000000001', 'test', 'fixture'),
  ('21000000-0000-0000-0000-000000000001', 'test', 'fixture');

do $$ begin
  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = 'anon'
  ) then
    raise exception 'anon must not have public table privileges';
  end if;
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and has_function_privilege('anon', p.oid, 'execute')
  ) then
    raise exception 'anon must not execute application functions';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
do $$ begin
  if (select count(*) from public.employee_profiles) <> 2 then
    raise exception 'administrator employee scope failed';
  end if;
  if (select count(*) from public.audit_logs) <> 1 then
    raise exception 'administrator audit scope failed';
  end if;
  insert into public.shifts (
    organization_id, code, name, start_time, end_time, crosses_midnight
  ) values (
    '11000000-0000-0000-0000-000000000001', 'RLS-ADMIN', 'Admin Shift',
    '08:00', '16:00', false
  );
end $$;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
do $$ begin
  if (select count(*) from public.employee_profiles) <> 1 then
    raise exception 'manager scope failed';
  end if;
  if (select count(*) from public.audit_logs) <> 0 then
    raise exception 'manager audit isolation failed';
  end if;
  insert into public.weekly_offs (
    organization_id, employee_id, weekday, effective_from
  ) values (
    '11000000-0000-0000-0000-000000000001',
    '14000000-0000-0000-0000-000000000001',
    5,
    current_date
  );
  begin
    insert into public.weekly_offs (
      organization_id, employee_id, weekday, effective_from
    ) values (
      '11000000-0000-0000-0000-000000000001',
      '14000000-0000-0000-0000-000000000002',
      6,
      current_date
    );
    raise exception 'manager wrote outside assigned scope';
  exception
    when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
do $employee$
declare
  affected integer;
begin
  if (select count(*) from public.employee_profiles) <> 1 then
    raise exception 'employee self scope failed';
  end if;
  if has_table_privilege('authenticated', 'public.attendance_events', 'INSERT') then
    raise exception 'direct attendance insert must remain revoked';
  end if;
  update public.employee_profiles
     set full_name = 'Unauthorized change'
   where id = '14000000-0000-0000-0000-000000000002';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'employee updated another employee profile';
  end if;
  begin
    perform *
    from public.process_attendance_event(
      '14000000-0000-0000-0000-000000000002',
      null,
      'check_in',
      false,
      0,
      0,
      10,
      false,
      'rls-impersonation-attempt',
      '{}'::jsonb
    );
    raise exception 'employee attendance impersonation was accepted';
  exception
    when insufficient_privilege then null;
  end;
end
$employee$;

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
do $$ begin
  if (select count(*) from public.employee_profiles) <> 1 then
    raise exception 'cross-tenant isolation failed';
  end if;
end $$;

reset role;
rollback;
