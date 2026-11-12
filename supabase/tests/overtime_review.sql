-- Structural and privilege smoke checks for employee-centric overtime review.
begin;

do $$
declare
  signature regprocedure;
begin
  foreach signature in array array[
    'public.list_overtime_review_employees(uuid,date,date,text,uuid,uuid,text,text,text,boolean,integer,integer)'::regprocedure,
    'public.get_overtime_review_detail(uuid,uuid,date,date)'::regprocedure,
    'public.review_overtime_batch(jsonb)'::regprocedure,
    'public.manager_correct_attendance(uuid,uuid,date,uuid,timestamptz,timestamptz,text)'::regprocedure
  ] loop
    if has_function_privilege('anon', signature, 'execute') then
      raise exception 'anon must not execute %', signature;
    end if;
    if not has_function_privilege('authenticated', signature, 'execute') then
      raise exception 'authenticated must execute %', signature;
    end if;
  end loop;

  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'overtime_records_org_employee_requested_status_idx') then
    raise exception 'overtime review index is missing';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  begin
    perform * from public.list_overtime_review_employees(
      '00000000-0000-0000-0000-000000000000', current_date, current_date,
      null, null, null, null, null, null, null, 25, 0
    );
    raise exception 'unauthenticated overtime review was accepted';
  exception when invalid_authorization_specification then null;
  end;
end;
$$;

reset role;
rollback;
