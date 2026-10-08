-- First-login / post-reset forced password change for employee accounts.
--
-- Field employees are provisioned with a one-time temporary password (see the
-- provision-employee / reset-employee-login functions). They must replace it
-- with their own password before using the app. We track that requirement with
-- a flag on the employee profile rather than storing any password: Supabase Auth
-- keeps only a one-way hash, and no plaintext password is ever persisted or
-- shown after the single hand-off. A forgotten password is handled by a manager
-- issuing a NEW temporary password (which re-sets this flag), never by revealing
-- the old one.

alter table public.employee_profiles
  add column if not exists must_change_password boolean not null default false;

-- When a temporary password was last issued (provisioning or a manager reset),
-- for display/audit on the dashboard. Null once never issued or after the
-- employee has set their own password is irrelevant - we keep the last issue
-- time purely as operational context.
alter table public.employee_profiles
  add column if not exists login_last_reset_at timestamptz;

comment on column public.employee_profiles.must_change_password is
  'True while the employee still holds a temporary password and must set their own before using the app.';

-- The employee clears their own flag after changing their password. SECURITY
-- DEFINER so it can update the profile despite table-level RLS, but it only
-- ever touches the caller''s own row (user_id = auth.uid()).
create or replace function public.complete_password_change()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  update public.employee_profiles
    set must_change_password = false
    where user_id = v_user_id;
end;
$$;

revoke all on function public.complete_password_change() from public, anon;
grant execute on function public.complete_password_change() to authenticated;
