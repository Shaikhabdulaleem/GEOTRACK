do $body$
declare
  func record;
  params text;
begin
  for func in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on p.pronamespace = n.oid
    where p.prosecdef = true
      and n.nspname in ('public', 'private')
      and not exists (
        select 1 from unnest(p.proconfig) as config
        where config ilike 'search_path=%'
      )
  loop
    execute format('alter function %I.%I(%s) set search_path = ''''', func.nspname, func.proname, func.args);
  end loop;
end;
$body$;
