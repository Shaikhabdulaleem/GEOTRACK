-- Employees may explain a pending, server-calculated overtime record.
-- This RPC deliberately does not accept calculated or approved minutes.
create or replace function public.request_overtime_explanation(
  p_overtime_id uuid,
  p_reason text
) returns setof public.overtime_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.overtime_records%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is null then
    raise exception 'An explanation is required' using errcode = '22023';
  end if;
  if char_length(v_reason) > 2000 then
    raise exception 'Explanation is too long' using errcode = '22023';
  end if;

  select * into v_record
    from public.overtime_records
   where id = p_overtime_id
   for update;
  if not found then
    raise exception 'Overtime record not found' using errcode = 'P0002';
  end if;
  if not private.is_employee_owner(v_record.employee_id) then
    raise exception 'Not authorized to update overtime explanation' using errcode = '42501';
  end if;
  if v_record.status::text <> 'pending' then
    raise exception 'Only pending overtime can be explained' using errcode = '22023';
  end if;

  update public.overtime_records
     set reason = v_reason,
         updated_at = clock_timestamp()
   where id = v_record.id
   returning * into v_record;
  return next v_record;
end;
$$;

revoke all on function public.request_overtime_explanation(uuid, text) from public, anon;
grant execute on function public.request_overtime_explanation(uuid, text) to authenticated;
