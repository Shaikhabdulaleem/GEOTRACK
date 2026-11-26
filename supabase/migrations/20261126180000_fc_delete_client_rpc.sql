-- Allow FC administrators to delete an FC client when it has no recorded daily volumes.

create or replace function public.delete_fc_client(
  p_organization_id uuid,
  p_client_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.fc_clients%rowtype;
  v_has_history boolean := false;
begin
  select * into v_row
  from public.fc_clients
  where id = p_client_id
    and organization_id = p_organization_id;

  if v_row.id is null then
    raise exception 'FC client not found' using errcode = 'P0002';
  end if;

  if not private.can_access_fc(p_organization_id, v_row.branch_id, v_row.department_id, true) then
    raise exception 'Administrator access to FC is required' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.fc_daily_client_volumes v
    where v.organization_id = p_organization_id
      and v.department_id = v_row.department_id
      and (
        upper(btrim(v.client_name)) = upper(btrim(v_row.name))
        or upper(btrim(v.client_name)) = upper(btrim(v_row.code))
      )
  ) or exists (
    select 1
    from public.fc_daily_seller_metrics m
    where m.organization_id = p_organization_id
      and m.department_id = v_row.department_id
      and (
        upper(btrim(m.seller_name)) = upper(btrim(v_row.name))
        or upper(btrim(m.seller_name)) = upper(btrim(v_row.code))
      )
  ) into v_has_history;

  if v_has_history then
    raise exception 'Cannot delete this FC client because it has recorded daily volumes. Set it to inactive instead.' using errcode = '23503';
  end if;

  delete from public.fc_clients
  where id = p_client_id
    and organization_id = p_organization_id;
end;
$$;

revoke all on function public.delete_fc_client(uuid, uuid) from public, anon;
grant execute on function public.delete_fc_client(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
