-- Client-safe push registration contract. Firebase service credentials remain in
-- the server/Edge Function environment; this table only stores device tokens.
create table if not exists public.mobile_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  token text not null,
  device_identifier text not null,
  platform text not null default 'android' check (platform = 'android'),
  app_version text,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, token)
);

alter table public.mobile_push_tokens enable row level security;
create policy "users manage their own push tokens" on public.mobile_push_tokens
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.register_mobile_push_token(
  p_token text, p_device_identifier text, p_app_version text
) returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select organization_id into v_org
    from public.organization_memberships
   where user_id = auth.uid() and status = 'active'
   order by created_at desc limit 1;
  if v_org is null then raise exception 'No active organization membership'; end if;
  insert into public.mobile_push_tokens(user_id, organization_id, token, device_identifier, app_version, revoked_at, last_seen_at)
  values (auth.uid(), v_org, p_token, p_device_identifier, p_app_version, null, now())
  on conflict (user_id, token) do update set organization_id = excluded.organization_id,
    device_identifier = excluded.device_identifier, app_version = excluded.app_version,
    revoked_at = null, last_seen_at = now();
end $$;

create or replace function public.unregister_mobile_push_token(p_token text)
returns void language sql security definer set search_path = public as $$
  update public.mobile_push_tokens set revoked_at = now()
   where user_id = auth.uid() and token = p_token;
$$;

revoke all on function public.register_mobile_push_token(text,text,text) from public;
grant execute on function public.register_mobile_push_token(text,text,text) to authenticated;
revoke all on function public.unregister_mobile_push_token(text) from public;
grant execute on function public.unregister_mobile_push_token(text) to authenticated;

-- The server-side notification sender should select active tokens for the
-- recipient and send an FCM data message containing only notification_id.
