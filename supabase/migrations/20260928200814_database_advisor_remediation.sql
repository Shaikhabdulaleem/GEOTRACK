-- Production advisor remediation.
--
-- The canonical RLS migration already includes manager scoping through
-- private.can_access_employee(). The Android manager-scope migration predated
-- that implementation, so its additional SELECT policies are redundant.

drop policy if exists manager_scoped_employee_select on public.employee_profiles;
drop policy if exists manager_scoped_shift_select on public.shift_assignments;
drop policy if exists manager_scoped_weekly_off_select on public.weekly_offs;
drop policy if exists manager_scoped_leave_select on public.leave_requests;
drop policy if exists manager_scoped_attendance_select on public.attendance_records;
drop policy if exists manager_scoped_overtime_select on public.overtime_records;
drop policy if exists manager_scoped_productivity_select on public.productivity_records;
drop policy if exists manager_scoped_phone_usage_select on public.phone_usage_records;
drop policy if exists recipient_notification_select on public.notifications;

revoke all on function private.manager_can_access_employee(uuid)
  from public, anon, authenticated;
drop function if exists private.manager_can_access_employee(uuid);

-- A FOR ALL policy also applies to SELECT, which creates redundant permissive
-- SELECT policies where a dedicated read policy already exists. Split every
-- remaining FOR ALL policy into mutation-only policies while preserving its
-- original USING and WITH CHECK expressions.
do $$
declare
  p record;
  v_using text;
  v_check text;
begin
  for p in
    select schemaname, tablename, policyname, roles, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and cmd = 'ALL'
  loop
    v_using := coalesce(p.qual, 'true');
    v_check := coalesce(p.with_check, p.qual, 'true');

    execute format('drop policy %I on %I.%I',
      p.policyname, p.schemaname, p.tablename);
    execute format(
      'create policy %I on %I.%I for insert to %s with check (%s)',
      p.policyname || '_insert', p.schemaname, p.tablename,
      array_to_string(p.roles, ', '), v_check
    );
    execute format(
      'create policy %I on %I.%I for update to %s using (%s) with check (%s)',
      p.policyname || '_update', p.schemaname, p.tablename,
      array_to_string(p.roles, ', '), v_using, v_check
    );
    execute format(
      'create policy %I on %I.%I for delete to %s using (%s)',
      p.policyname || '_delete', p.schemaname, p.tablename,
      array_to_string(p.roles, ', '), v_using
    );
  end loop;
end;
$$;

-- Ensure auth.uid() is evaluated once per statement in the one remaining
-- mobile-specific policy.
drop policy if exists "users manage their own push tokens" on public.mobile_push_tokens;
create policy mobile_push_tokens_select_self on public.mobile_push_tokens
  for select to authenticated
  using (user_id = (select auth.uid()));

-- PostgreSQL does not automatically index referencing foreign-key columns.
-- Add a covering btree index for every public FK that does not already have
-- one. Names derive from constraint names, making the migration deterministic.
do $$
declare
  fk record;
  v_columns text;
  v_index_name text;
begin
  for fk in
    select c.oid,
           n.nspname as schema_name,
           t.relname as table_name,
           c.conname,
           c.conkey
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where c.contype = 'f'
       and n.nspname = 'public'
       and not exists (
         select 1
           from pg_index i
          where i.indrelid = c.conrelid
            and i.indisvalid
            and i.indpred is null
            and (i.indkey::smallint[])[0:cardinality(c.conkey) - 1] = c.conkey
       )
  loop
    select string_agg(quote_ident(a.attname), ', ' order by k.ordinality)
      into v_columns
      from unnest(fk.conkey) with ordinality as k(attnum, ordinality)
      join pg_attribute a
        on a.attrelid = (select conrelid from pg_constraint where oid = fk.oid)
       and a.attnum = k.attnum;

    v_index_name := left(fk.conname || '_idx', 63);
    execute format('create index if not exists %I on %I.%I (%s)',
      v_index_name, fk.schema_name, fk.table_name, v_columns);
  end loop;
end;
$$;
