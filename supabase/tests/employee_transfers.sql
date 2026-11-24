-- Structural and security checks for the Employee Transfers module.
do $$
declare
  v_definition text;
begin
  if to_regclass('public.employee_transfers') is null then
    raise exception 'Missing table: public.employee_transfers';
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'employee_transfers' and c.relrowsecurity
  ) then
    raise exception 'RLS is not enabled on public.employee_transfers';
  end if;

  -- Verify least-privilege table grants: authenticated can select, anon cannot
  if not has_table_privilege('authenticated', 'public.employee_transfers', 'select') then
    raise exception 'authenticated role must have select privilege on public.employee_transfers';
  end if;
  if has_table_privilege('anon', 'public.employee_transfers', 'select') then
    raise exception 'anon role must not have select privilege on public.employee_transfers';
  end if;

  -- Verify RPCs exist with exact parameter signatures
  if to_regprocedure('public.start_employee_transfer(uuid,uuid,uuid,date,timestamptz,timestamptz,integer,integer,text,text,text)') is null then
    raise exception 'Missing RPC: public.start_employee_transfer';
  end if;

  if to_regprocedure('public.complete_employee_transfer(uuid,uuid,timestamptz,integer,integer,text)') is null then
    raise exception 'Missing RPC: public.complete_employee_transfer';
  end if;

  if to_regprocedure('public.cancel_employee_transfer(uuid,uuid,text)') is null then
    raise exception 'Missing RPC: public.cancel_employee_transfer';
  end if;

  -- Verify that destination department manager access is wired into private.can_access_employee
  v_definition := pg_get_functiondef('private.can_access_employee(uuid,uuid)'::regprocedure);
  if v_definition not like '%employee_transfers%'
     or v_definition not like '%to_department_id%' then
    raise exception 'private.can_access_employee must check transferred employee access via employee_transfers';
  end if;
end $$;
