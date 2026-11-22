-- Migration: allow_updating_approved_overtime
-- Allows managers to adjust/update approved overtime hours for an employee even after initial approval.
-- Enforces authentication, manager organization scope, valid minute boundaries, and audit logging.

create or replace function public.update_approved_overtime(
  p_overtime_id uuid,
  p_approved_minutes integer,
  p_review_note text default null
)
returns public.overtime_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_record public.overtime_records%rowtype;
  v_recipient uuid;
  v_note text;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_approved_minutes is null or p_approved_minutes < 0 then
    raise exception 'Approved minutes must be non-negative' using errcode = '22023';
  end if;

  select * into v_record from public.overtime_records
  where id = p_overtime_id
  for update;

  if not found then
    raise exception 'Overtime record not found' using errcode = 'P0002';
  end if;

  if not private.can_access_employee(v_record.organization_id, v_record.employee_id) then
    raise exception 'Not authorized to adjust overtime for this employee' using errcode = '42501';
  end if;

  if p_approved_minutes > v_record.requested_minutes then
    raise exception 'Approved minutes (%m) cannot exceed requested minutes (%m)',
      p_approved_minutes, v_record.requested_minutes
      using errcode = '22023';
  end if;

  v_note := nullif(btrim(p_review_note), '');

  -- Audit the change
  insert into public.audit_logs (
    organization_id, actor_user_id, action, entity_type, entity_id,
    before_data, metadata
  ) values (
    v_record.organization_id, v_actor, 'overtime_hours_adjusted', 'overtime_record', v_record.id,
    to_jsonb(v_record),
    jsonb_build_object(
      'previous_approved_minutes', v_record.approved_minutes,
      'new_approved_minutes', p_approved_minutes,
      'adjustment_note', v_note
    )
  );

  update public.overtime_records set
    status = 'approved'::public.approval_status,
    approved_minutes = p_approved_minutes,
    approved_by = v_actor,
    approved_at = clock_timestamp(),
    review_note = coalesce(v_note, review_note)
  where id = v_record.id
  returning * into v_record;

  update public.audit_logs set after_data = to_jsonb(v_record)
  where id = (
    select id from public.audit_logs
    where entity_type = 'overtime_record' and entity_id = v_record.id and actor_user_id = v_actor
    order by created_at desc limit 1
  );

  -- Notify employee if linked
  select user_id into v_recipient from public.employee_profiles where id = v_record.employee_id;
  if v_recipient is not null then
    insert into public.notifications (
      organization_id, recipient_user_id, notification_type, severity,
      title, body, entity_type, entity_id
    ) values (
      v_record.organization_id, v_recipient, 'overtime', 'info'::public.notification_severity,
      'Overtime Hours Adjusted',
      'Your approved overtime has been updated to ' || p_approved_minutes || ' minutes.',
      'overtime_record', v_record.id
    );
  end if;

  return v_record;
end;
$$;

-- Security hardening: revoke all execution from public and anon, grant authenticated only
revoke all on function public.update_approved_overtime(uuid, integer, text) from public, anon;
grant execute on function public.update_approved_overtime(uuid, integer, text) to authenticated;
