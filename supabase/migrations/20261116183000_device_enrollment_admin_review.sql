-- Administrator-reviewed attendance device replacements.
-- Keeps the existing attendance flow intact while removing direct client
-- writes to device trust state and recording every review decision.

create table if not exists public.employee_device_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  device_id uuid references public.employee_devices(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('approved', 'rejected', 'revoked')),
  previous_integrity_status public.device_integrity_status,
  new_integrity_status public.device_integrity_status,
  reason text,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, employee_id)
    references public.employee_profiles(organization_id, id) on delete cascade
);

create index if not exists employee_device_audit_org_employee_created_idx
  on public.employee_device_audit_log (organization_id, employee_id, created_at desc);

alter table public.employee_device_audit_log enable row level security;
revoke all on table public.employee_device_audit_log from public, anon, authenticated;
grant all on table public.employee_device_audit_log to service_role;

drop policy if exists employee_device_audit_admin_select
  on public.employee_device_audit_log;
create policy employee_device_audit_admin_select
  on public.employee_device_audit_log
  for select to authenticated
  using (private.has_org_role(organization_id, array['administrator']));
grant select on table public.employee_device_audit_log to authenticated;

-- Device rows are still created by SECURITY DEFINER attendance functions.
-- Browser clients can inspect permitted rows but cannot change trust state.
drop policy if exists employee_devices_insert_self on public.employee_devices;
drop policy if exists employee_devices_update_self on public.employee_devices;
drop policy if exists employee_devices_admin_manage on public.employee_devices;
revoke insert, update, delete on table public.employee_devices from authenticated;

create or replace function public.review_employee_device_enrollment(
  p_device_id uuid,
  p_decision text,
  p_reason text default null
)
returns public.employee_devices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_device public.employee_devices%rowtype;
  v_other public.employee_devices%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'Decision must be approve or reject' using errcode = '22023';
  end if;
  if length(coalesce(p_reason, '')) > 1000 then
    raise exception 'Reason is too long' using errcode = '22023';
  end if;
  if p_decision = 'reject' and v_reason is null then
    raise exception 'A rejection reason is required' using errcode = '22023';
  end if;

  select * into v_device
  from public.employee_devices d
  where d.id = p_device_id
  for update;

  if not found then
    raise exception 'Device enrollment not found' using errcode = 'P0002';
  end if;
  if not private.has_org_role(v_device.organization_id, array['administrator']) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if v_device.integrity_status <> 'suspected' or v_device.revoked_at is not null then
    raise exception 'Device enrollment has already been reviewed' using errcode = '22023';
  end if;

  if p_decision = 'approve' then
    for v_other in
      update public.employee_devices d
         set integrity_status = 'blocked',
             revoked_at = clock_timestamp(),
             updated_at = clock_timestamp()
       where d.employee_id = v_device.employee_id
         and d.id <> v_device.id
         and d.integrity_status = 'valid'
         and d.revoked_at is null
      returning d.*
    loop
      insert into public.employee_device_audit_log (
        organization_id, employee_id, device_id, actor_user_id, action,
        previous_integrity_status, new_integrity_status, reason
      ) values (
        v_other.organization_id, v_other.employee_id, v_other.id, v_actor,
        'revoked', 'valid', 'blocked',
        coalesce(v_reason, 'Replaced by an approved device')
      );
    end loop;

    update public.employee_devices
       set integrity_status = 'valid',
           revoked_at = null,
           updated_at = clock_timestamp()
     where id = v_device.id
     returning * into v_device;

    insert into public.employee_device_audit_log (
      organization_id, employee_id, device_id, actor_user_id, action,
      previous_integrity_status, new_integrity_status, reason
    ) values (
      v_device.organization_id, v_device.employee_id, v_device.id, v_actor,
      'approved', 'suspected', 'valid', v_reason
    );
  else
    update public.employee_devices
       set integrity_status = 'blocked',
           revoked_at = clock_timestamp(),
           updated_at = clock_timestamp()
     where id = v_device.id
     returning * into v_device;

    insert into public.employee_device_audit_log (
      organization_id, employee_id, device_id, actor_user_id, action,
      previous_integrity_status, new_integrity_status, reason
    ) values (
      v_device.organization_id, v_device.employee_id, v_device.id, v_actor,
      'rejected', 'suspected', 'blocked', v_reason
    );
  end if;

  return v_device;
end;
$$;

revoke all on function public.review_employee_device_enrollment(uuid, text, text)
  from public, anon;
grant execute on function public.review_employee_device_enrollment(uuid, text, text)
  to authenticated;
