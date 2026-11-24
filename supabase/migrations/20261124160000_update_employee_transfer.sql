-- Migration: Add update_employee_transfer RPC and ensure manager permissions for transfer editing
-- Description: Allows managers of source/destination departments (and admins) to update transfer details
-- (e.g., correct destination department, dates, times, breaks, overtime, reason, notes).

create or replace function public.update_employee_transfer(
  p_organization_id uuid,
  p_transfer_id uuid,
  p_to_department_id uuid default null,
  p_transfer_date date default null,
  p_start_time timestamptz default null,
  p_end_time timestamptz default null,
  p_break_minutes integer default null,
  p_overtime_minutes integer default null,
  p_transfer_type text default null,
  p_reason text default null,
  p_notes text default null,
  p_status text default null
)
returns public.employee_transfers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_transfer public.employee_transfers;
  v_start timestamptz;
  v_end timestamptz;
  v_break integer;
  v_ot integer;
  v_total_min integer;
  v_target_dept_id uuid;
  v_status text;
  v_result public.employee_transfers;
begin
  v_caller_id := (select auth.uid());
  if v_caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select * into v_transfer
  from public.employee_transfers
  where id = p_transfer_id
    and organization_id = p_organization_id;

  if not found then
    raise exception 'Transfer record not found' using errcode = 'P0002';
  end if;

  -- Verify caller is admin or manager of source or destination department
  if not (
    private.has_org_role(p_organization_id, array['administrator'])
    or (
      private.has_org_role(p_organization_id, array['manager'])
      and exists (
        select 1 from public.manager_profiles mp
        where mp.user_id = v_caller_id
          and mp.status = 'active'
      )
      and (
        exists (
          select 1 from public.manager_scopes ms
          where ms.organization_id = p_organization_id
            and ms.manager_user_id = v_caller_id
            and (ms.department_id = v_transfer.from_department_id or ms.department_id = v_transfer.to_department_id)
        )
        or exists (
          select 1 from public.departments d
          where (d.id = v_transfer.from_department_id or d.id = v_transfer.to_department_id)
            and d.organization_id = p_organization_id
            and d.manager_user_id = v_caller_id
        )
      )
    )
  ) then
    raise exception 'Permission denied to edit this transfer' using errcode = '42501';
  end if;

  -- Validate target department if provided
  v_target_dept_id := coalesce(p_to_department_id, v_transfer.to_department_id);
  if p_to_department_id is not null and p_to_department_id <> v_transfer.to_department_id then
    if not exists (
      select 1 from public.departments
      where id = p_to_department_id
        and organization_id = p_organization_id
        and status = 'active'
    ) then
      raise exception 'Destination department does not exist in this organization' using errcode = '23503';
    end if;

    if p_to_department_id = v_transfer.from_department_id then
      raise exception 'Destination department cannot be the same as the source department' using errcode = '22000';
    end if;
  end if;

  v_start := coalesce(p_start_time, v_transfer.start_time);
  v_end := coalesce(p_end_time, v_transfer.end_time);

  if v_end is not null and v_end < v_start then
    raise exception 'End time cannot be earlier than start time' using errcode = '22000';
  end if;

  v_break := greatest(0, coalesce(p_break_minutes, v_transfer.break_minutes));
  v_ot := greatest(0, coalesce(p_overtime_minutes, v_transfer.overtime_minutes));

  if v_end is not null then
    v_total_min := greatest(0, floor(extract(epoch from (v_end - v_start)) / 60)::integer - v_break);
  else
    v_total_min := 0;
  end if;

  v_status := coalesce(p_status, case when v_end is not null then 'completed' else v_transfer.status end);

  update public.employee_transfers
  set
    to_department_id = v_target_dept_id,
    transfer_date = coalesce(p_transfer_date, v_transfer.transfer_date),
    start_time = v_start,
    end_time = v_end,
    status = v_status,
    transfer_type = coalesce(p_transfer_type, v_transfer.transfer_type),
    transferred_minutes = v_total_min,
    break_minutes = v_break,
    overtime_minutes = v_ot,
    reason = coalesce(p_reason, v_transfer.reason),
    notes = coalesce(p_notes, v_transfer.notes),
    updated_at = clock_timestamp()
  where id = p_transfer_id
    and organization_id = p_organization_id
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.update_employee_transfer(uuid, uuid, uuid, date, timestamptz, timestamptz, integer, integer, text, text, text, text) from public, anon;
grant execute on function public.update_employee_transfer(uuid, uuid, uuid, date, timestamptz, timestamptz, integer, integer, text, text, text, text) to authenticated;
