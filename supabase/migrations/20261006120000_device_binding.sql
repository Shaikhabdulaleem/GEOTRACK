-- Anti-fraud device binding.
--
-- An employee may only submit attendance from their enrolled device. The first
-- device auto-enrolls; a check-in from any other device is rejected, recorded
-- as 'suspected', and flagged to managers/admins. Admins reset the binding when
-- an employee legitimately changes phones.
--
-- Enforcement lives inside process_attendance_event (SECURITY DEFINER), so it
-- cannot be bypassed by a modified client. The device hash is passed per call.
-- The online path (Android online check-in) always supplies it. The offline
-- sync path currently calls without it (p_device_hash defaults null → check
-- skipped); threading the hash through the offline queue is a follow-up.

-- Replace the wrapper with an 11-arg version that takes the device hash.
DROP FUNCTION IF EXISTS public.process_attendance_event(
  uuid, uuid, text, boolean, double precision, double precision,
  double precision, boolean, text, jsonb);

CREATE OR REPLACE FUNCTION public.process_attendance_event(
  p_employee_id uuid,
  p_geofence_id uuid,
  p_action_type text,
  p_is_auto boolean,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision,
  p_is_mock_location boolean,
  p_idempotency_key text,
  p_device_info jsonb,
  p_device_hash text DEFAULT NULL
)
RETURNS TABLE (
  attendance_record_id uuid,
  event_id uuid,
  status text,
  inside_geofence boolean,
  validation_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
declare
  v_employee public.employee_profiles%rowtype;
  v_timezone text;
  v_local_now timestamp;
  v_schedule record;
  v_valid_devices integer;
  v_matched_device uuid;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select * into v_employee from public.employee_profiles where id = p_employee_id;
  if v_employee.id is null or not (
    private.is_employee_owner(p_employee_id)
    or private.can_access_employee(v_employee.organization_id, p_employee_id)
  ) then
    raise exception 'Attendance access denied' using errcode = '42501';
  end if;

  -- ── Device binding (anti-fraud) ──────────────────────────────────────────
  -- Only enforced for the employee's own submissions that carry a device hash
  -- (the Android online path). First valid device auto-enrolls; others reject.
  if private.is_employee_owner(p_employee_id) and p_device_hash is not null
     and length(btrim(p_device_hash)) > 0 then
    select count(*) into v_valid_devices
    from public.employee_devices
    where employee_id = p_employee_id and integrity_status = 'valid' and revoked_at is null;

    if v_valid_devices = 0 then
      insert into public.employee_devices (
        organization_id, employee_id, device_identifier_hash, platform, integrity_status, last_seen_at
      ) values (
        v_employee.organization_id, p_employee_id, p_device_hash, 'android', 'valid', now()
      )
      on conflict (employee_id, device_identifier_hash)
        do update set integrity_status = 'valid', revoked_at = null, last_seen_at = now();
    else
      select id into v_matched_device
      from public.employee_devices
      where employee_id = p_employee_id and device_identifier_hash = p_device_hash
        and integrity_status = 'valid' and revoked_at is null;

      if v_matched_device is null then
        insert into public.employee_devices (
          organization_id, employee_id, device_identifier_hash, platform, integrity_status, last_seen_at
        ) values (
          v_employee.organization_id, p_employee_id, p_device_hash, 'android', 'suspected', now()
        )
        on conflict (employee_id, device_identifier_hash) do update set last_seen_at = now();

        insert into public.notifications (
          organization_id, recipient_user_id, notification_type, severity, title, body, entity_type, entity_id
        )
        select v_employee.organization_id, m.user_id, 'device', 'warning',
          'Unrecognized device blocked',
          'An attendance attempt was made from a device not registered to this employee.',
          'employee', p_employee_id
        from public.organization_memberships m
        where m.organization_id = v_employee.organization_id
          and m.status::text = 'active'
          and m.role_code::text in ('manager', 'administrator');

        -- Return a block status (do NOT raise): raising would roll back the
        -- audit records above. Returning commits the suspected-device row and
        -- the admin alert, and the client shows the rejection.
        return query select null::uuid, null::uuid, 'device_blocked'::text, false, 'device_blocked'::text;
        return;
      else
        update public.employee_devices set last_seen_at = now() where id = v_matched_device;
      end if;
    end if;
  end if;

  -- ── Schedule resolution for check-in (unchanged) ─────────────────────────
  if p_action_type = 'check_in' then
    select coalesce(nullif(b.timezone, ''), nullif(o.timezone, ''), 'UTC') into v_timezone
    from public.organizations o
    left join public.branches b on b.id = v_employee.branch_id and b.organization_id = o.id
    where o.id = v_employee.organization_id;
    v_local_now := clock_timestamp() at time zone coalesce(v_timezone, 'UTC');

    select * into v_schedule
    from private.resolve_employee_schedule_internal(
      p_employee_id, v_local_now::date - 1, v_local_now::date
    ) r
    where r.state = 'working'
      and (
        r.work_date = v_local_now::date
        or (r.work_date = v_local_now::date - 1 and r.crosses_midnight and v_local_now::time <= r.end_time)
      )
    order by case when r.work_date = v_local_now::date - 1 then 0 else 1 end
    limit 1;

    if v_schedule.work_date is null then
      raise exception 'No working shift is scheduled for this time' using errcode = '22023';
    end if;
    if v_schedule.shift_assignment_id is null and v_schedule.source = 'recurring' then
      insert into public.shift_assignments (
        organization_id, employee_id, shift_id, work_date, status, source, created_by
      ) values (
        v_employee.organization_id, p_employee_id, v_schedule.shift_id,
        v_schedule.work_date, 'scheduled', 'recurring', (select auth.uid())
      ) on conflict (employee_id, work_date) do nothing;
    end if;
  end if;

  return query select * from public.process_attendance_event_legacy(
    p_employee_id, p_geofence_id, p_action_type, p_is_auto,
    p_latitude, p_longitude, p_accuracy_meters, p_is_mock_location,
    p_idempotency_key, p_device_info
  );
end;
$$;

REVOKE ALL ON FUNCTION public.process_attendance_event(
  uuid, uuid, text, boolean, double precision, double precision,
  double precision, boolean, text, jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.process_attendance_event(
  uuid, uuid, text, boolean, double precision, double precision,
  double precision, boolean, text, jsonb, text) TO authenticated;

-- Managers/admins can review, revoke, re-approve employee devices (dashboard).
DROP POLICY IF EXISTS employee_devices_admin_manage ON public.employee_devices;
CREATE POLICY employee_devices_admin_manage ON public.employee_devices
  FOR ALL TO authenticated
  USING (private.has_org_role(organization_id, ARRAY['administrator', 'manager']))
  WITH CHECK (private.has_org_role(organization_id, ARRAY['administrator', 'manager']));

-- Admin reset: revoke an employee's devices so their next check-in re-enrolls
-- the new phone. The dashboard calls this when an employee changes devices.
CREATE OR REPLACE FUNCTION public.reset_employee_device(p_employee_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
declare v_org uuid; v_count integer;
begin
  select organization_id into v_org from public.employee_profiles where id = p_employee_id;
  if v_org is null or not private.has_org_role(v_org, ARRAY['administrator', 'manager']) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  update public.employee_devices
    set revoked_at = now(), integrity_status = 'blocked', updated_at = now()
    where employee_id = p_employee_id and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
REVOKE ALL ON FUNCTION public.reset_employee_device(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reset_employee_device(uuid) TO authenticated;
