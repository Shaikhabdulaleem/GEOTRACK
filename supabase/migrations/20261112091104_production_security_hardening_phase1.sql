-- Production hardening phase 1:
--   * make geofence breach detection deterministic and session-scoped;
--   * prevent missing/low-quality samples from fabricating or resolving a breach;
--   * remove direct client writes to device trust state;
--   * require an administrator-approved device for employee attendance writes;
--   * keep device enrollment/replacement decisions auditable.

-- ---------------------------------------------------------------------------
-- Device enrollment audit trail. Raw device identifiers are never stored.
-- ---------------------------------------------------------------------------
create table if not exists public.employee_device_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  device_id uuid references public.employee_devices(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in (
    'enrollment_requested', 'approved', 'rejected', 'revoked', 'reset'
  )),
  previous_integrity_status public.device_integrity_status,
  new_integrity_status public.device_integrity_status,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
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

-- Clients may read the device state they are allowed to see, but every trust
-- transition is now mediated by a reviewed RPC. This removes column-level
-- escalation through broad table UPDATE policies.
drop policy if exists employee_devices_insert_self on public.employee_devices;
drop policy if exists employee_devices_update_self on public.employee_devices;
drop policy if exists employee_devices_admin_manage on public.employee_devices;
revoke insert, update, delete on table public.employee_devices from authenticated;

-- Internal helper used only by the attendance wrappers below. A new or revoked
-- identifier is recorded as pending/blocked but is never approved or reactivated
-- by the employee request itself.
create or replace function private.validate_attendance_device(
  p_employee_id uuid,
  p_device_hash text,
  p_metadata jsonb default '{}'::jsonb
)
returns table(device_id uuid, approved boolean, decision text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_employee public.employee_profiles%rowtype;
  v_device public.employee_devices%rowtype;
  v_hash text := nullif(btrim(coalesce(p_device_hash, '')), '');
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select * into v_employee
  from public.employee_profiles ep
  where ep.id = p_employee_id
    and ep.employment_status::text = 'active';
  if not found or not private.is_employee_owner(p_employee_id) then
    raise exception 'Device identity can only be submitted by the employee owner'
      using errcode = '42501';
  end if;

  if v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then
    return query select null::uuid, false, 'device_required'::text;
    return;
  end if;

  select * into v_device
  from public.employee_devices d
  where d.employee_id = p_employee_id
    and d.device_identifier_hash = v_hash
  for update;

  if found then
    update public.employee_devices
       set last_seen_at = clock_timestamp()
     where id = v_device.id;

    if v_device.integrity_status = 'valid' and v_device.revoked_at is null then
      return query select v_device.id, true, 'approved'::text;
    elsif v_device.revoked_at is not null or v_device.integrity_status = 'blocked' then
      return query select v_device.id, false, 'device_revoked'::text;
    else
      return query select v_device.id, false, 'device_pending_approval'::text;
    end if;
    return;
  end if;

  insert into public.employee_devices (
    organization_id, employee_id, device_identifier_hash, platform,
    model, os_version, app_version, integrity_status, last_seen_at
  ) values (
    v_employee.organization_id, p_employee_id, v_hash, 'android',
    nullif(p_metadata->>'model', ''),
    nullif(p_metadata->>'os_version', ''),
    nullif(p_metadata->>'app_version', ''),
    'suspected', clock_timestamp()
  )
  returning * into v_device;

  insert into public.employee_device_audit_log (
    organization_id, employee_id, device_id, actor_user_id, action,
    previous_integrity_status, new_integrity_status, reason, metadata
  ) values (
    v_employee.organization_id, p_employee_id, v_device.id, v_user_id,
    'enrollment_requested', null, 'suspected',
    'Attendance request from an unrecognized device',
    jsonb_build_object('platform', 'android')
  );

  return query select v_device.id, false, 'device_pending_approval'::text;
end;
$$;

revoke all on function private.validate_attendance_device(uuid, text, jsonb)
  from public, anon, authenticated, service_role;

-- Administrator review is the only path that can approve or reactivate a
-- device. Approving a replacement revokes any other currently approved device.
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
  v_previous public.device_integrity_status;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'Decision must be approve or reject' using errcode = '22023';
  end if;
  if p_reason is not null and length(p_reason) > 1000 then
    raise exception 'Reason is too long' using errcode = '22023';
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

  v_previous := v_device.integrity_status;
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
        coalesce(nullif(btrim(p_reason), ''), 'Replaced by an approved device')
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
      'approved', v_previous, 'valid', nullif(btrim(p_reason), '')
    );
  else
    update public.employee_devices
       set integrity_status = 'blocked',
           revoked_at = coalesce(revoked_at, clock_timestamp()),
           updated_at = clock_timestamp()
     where id = v_device.id
     returning * into v_device;

    insert into public.employee_device_audit_log (
      organization_id, employee_id, device_id, actor_user_id, action,
      previous_integrity_status, new_integrity_status, reason
    ) values (
      v_device.organization_id, v_device.employee_id, v_device.id, v_actor,
      'rejected', v_previous, 'blocked', nullif(btrim(p_reason), '')
    );
  end if;

  return v_device;
end;
$$;

revoke all on function public.review_employee_device_enrollment(uuid, text, text)
  from public, anon;
grant execute on function public.review_employee_device_enrollment(uuid, text, text)
  to authenticated;

-- Keep the existing attendance implementation intact behind a device gate so
-- schedule/geofence behavior remains backward compatible for approved devices.
alter function public.process_attendance_event(
  uuid, uuid, text, boolean, double precision, double precision,
  double precision, boolean, text, jsonb, text
) rename to process_attendance_event_device_impl;

revoke all on function public.process_attendance_event_device_impl(
  uuid, uuid, text, boolean, double precision, double precision,
  double precision, boolean, text, jsonb, text
) from public, anon, authenticated, service_role;

create or replace function public.process_attendance_event(
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
  p_device_hash text default null
)
returns table(
  attendance_record_id uuid,
  event_id uuid,
  status text,
  inside_geofence boolean,
  validation_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employee_profiles%rowtype;
  v_device record;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select * into v_employee from public.employee_profiles where id = p_employee_id;
  if not found or not (
    private.is_employee_owner(p_employee_id)
    or private.can_access_employee(v_employee.organization_id, p_employee_id)
  ) then
    raise exception 'Attendance access denied' using errcode = '42501';
  end if;

  if private.is_employee_owner(p_employee_id) then
    select * into v_device
    from private.validate_attendance_device(
      p_employee_id, p_device_hash, coalesce(p_device_info, '{}'::jsonb)
    );
    if not coalesce(v_device.approved, false) then
      return query select null::uuid, null::uuid, 'device_blocked'::text,
        false, coalesce(v_device.decision, 'device_required')::text;
      return;
    end if;
  end if;

  return query
  select * from public.process_attendance_event_device_impl(
    p_employee_id, p_geofence_id, p_action_type, p_is_auto,
    p_latitude, p_longitude, p_accuracy_meters, p_is_mock_location,
    p_idempotency_key, p_device_info, p_device_hash
  );
end;
$$;

revoke all on function public.process_attendance_event(
  uuid, uuid, text, boolean, double precision, double precision,
  double precision, boolean, text, jsonb, text
) from public, anon;
grant execute on function public.process_attendance_event(
  uuid, uuid, text, boolean, double precision, double precision,
  double precision, boolean, text, jsonb, text
) to authenticated;

alter function public.record_attendance_location(
  uuid, uuid, double precision, double precision, double precision, boolean,
  timestamptz, text, text, text
) rename to record_attendance_location_device_impl;

revoke all on function public.record_attendance_location_device_impl(
  uuid, uuid, double precision, double precision, double precision, boolean,
  timestamptz, text, text, text
) from public, anon, authenticated, service_role;

create or replace function public.record_attendance_location(
  p_employee_id uuid,
  p_geofence_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision,
  p_is_mock boolean,
  p_observed_at timestamptz,
  p_idempotency_key text,
  p_device_hash text,
  p_sample_source text
)
returns table(
  location_event_id uuid,
  attendance_record_id uuid,
  inside_geofence boolean,
  classified_position text,
  outcome text,
  checkout_at timestamptz,
  overtime_minutes integer,
  reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device record;
begin
  select * into v_device
  from private.validate_attendance_device(
    p_employee_id, p_device_hash,
    jsonb_build_object('sample_source', coalesce(p_sample_source, 'unknown'))
  );
  if not coalesce(v_device.approved, false) then
    return query select null::uuid, null::uuid, null::boolean, 'rejected'::text,
      'device_blocked'::text, null::timestamptz, 0,
      coalesce(v_device.decision, 'device_required')::text;
    return;
  end if;

  return query
  select * from public.record_attendance_location_device_impl(
    p_employee_id, p_geofence_id, p_latitude, p_longitude,
    p_accuracy_meters, p_is_mock, p_observed_at, p_idempotency_key,
    p_device_hash, p_sample_source
  );
end;
$$;

revoke all on function public.record_attendance_location(
  uuid, uuid, double precision, double precision, double precision, boolean,
  timestamptz, text, text, text
) from public, anon;
grant execute on function public.record_attendance_location(
  uuid, uuid, double precision, double precision, double precision, boolean,
  timestamptz, text, text, text
) to authenticated;

-- Hash-aware offline replay contract. The older overload remains present for
-- deployed clients, but its call into the hardened attendance RPC returns a
-- device_required result. Updated Android clients call this overload.
alter table public.offline_attendance_events
  add column if not exists failure_class text,
  add column if not exists retry_count integer not null default 0,
  add column if not exists last_attempt_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'offline_attendance_events_failure_class_check'
      and conrelid = 'public.offline_attendance_events'::regclass
  ) then
    alter table public.offline_attendance_events
      add constraint offline_attendance_events_failure_class_check
      check (failure_class is null or failure_class in (
        'retryable', 'permanent', 'review_required', 'reauthentication'
      ));
  end if;
end
$$;

create or replace function public.sync_offline_attendance_event(
  p_local_event_id uuid,
  p_organization_id uuid,
  p_employee_id uuid,
  p_action_type text,
  p_geofence_id uuid,
  p_device_timestamp timestamptz,
  p_original_event_time timestamptz,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters real,
  p_is_mock_location boolean,
  p_geofence_validation text,
  p_device_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.offline_attendance_events%rowtype;
  response jsonb;
  v_disposition text;
  v_reason text;
  v_failure_class text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.is_employee_owner(p_employee_id)
     or not private.employee_belongs_to_org(p_employee_id, p_organization_id) then
    raise exception 'Not authorized to sync offline attendance' using errcode = '42501';
  end if;
  if p_geofence_id is null then
    raise exception 'A geofence assignment is required to sync attendance'
      using errcode = '22023';
  end if;
  if p_action_type not in ('check_in', 'check_out', 'geofence_exit') then
    raise exception 'Invalid attendance action' using errcode = '22023';
  end if;
  if p_original_event_time is null
     or p_original_event_time > clock_timestamp() + interval '5 minutes' then
    raise exception 'Invalid original event timestamp' using errcode = '22023';
  end if;

  select * into existing
  from public.offline_attendance_events
  where local_event_id = p_local_event_id
  for update;

  if found and (
    existing.sync_status = 'SYNCED'
    or existing.failure_class in ('permanent', 'review_required')
  ) then
    return coalesce(
      existing.server_response,
      jsonb_build_object(
        'status', existing.sync_status,
        'event_id', existing.server_event_id,
        'failure_class', existing.failure_class,
        'retryable', false
      )
    );
  end if;

  if not found then
    insert into public.offline_attendance_events (
      local_event_id, organization_id, employee_id, action_type,
      device_timestamp, original_event_time, latitude, longitude,
      accuracy_meters, is_mock_location, geofence_validation,
      retry_count, last_attempt_at
    ) values (
      p_local_event_id, p_organization_id, p_employee_id, p_action_type,
      p_device_timestamp, p_original_event_time, p_latitude, p_longitude,
      p_accuracy_meters, p_is_mock_location, p_geofence_validation,
      1, clock_timestamp()
    );
  else
    update public.offline_attendance_events
       set retry_count = retry_count + 1,
           last_attempt_at = clock_timestamp(),
           updated_at = clock_timestamp()
     where local_event_id = p_local_event_id;
  end if;

  begin
    if p_action_type = 'geofence_exit' then
      select to_jsonb(processed) into response
      from public.record_attendance_location(
        p_employee_id, p_geofence_id, p_latitude, p_longitude,
        p_accuracy_meters, p_is_mock_location, p_original_event_time,
        p_local_event_id::text, p_device_hash, 'offline_geofence_exit'
      ) processed
      limit 1;
    else
      select to_jsonb(processed) into response
      from public.process_attendance_event(
        p_employee_id => p_employee_id,
        p_geofence_id => p_geofence_id,
        p_action_type => p_action_type,
        p_is_auto => false,
        p_latitude => p_latitude,
        p_longitude => p_longitude,
        p_accuracy_meters => p_accuracy_meters,
        p_is_mock_location => p_is_mock_location,
        p_idempotency_key => p_local_event_id::text,
        p_device_info => jsonb_build_object(
          'platform', 'android',
          'offline_local_event_id', p_local_event_id,
          'original_event_time', p_original_event_time,
          'device_timestamp', p_device_timestamp
        ),
        p_device_hash => p_device_hash
      ) processed
      limit 1;
    end if;

    v_disposition := coalesce(response->>'outcome', response->>'status', '');
    v_reason := coalesce(response->>'reason', response->>'validation_status', '');
    v_failure_class := case
      when v_disposition = 'device_blocked'
        and v_reason = 'device_pending_approval' then 'review_required'
      when v_disposition = 'device_blocked' then 'permanent'
      when v_disposition in ('rejected', 'error', 'failed') then 'permanent'
      when v_disposition = '' then 'retryable'
      else null
    end;

    response := coalesce(response, '{}'::jsonb) || jsonb_build_object(
      'failure_class', v_failure_class,
      'retryable', v_failure_class = 'retryable',
      'original_event_time', p_original_event_time
    );

    update public.offline_attendance_events
       set sync_status = case when v_failure_class is null then 'SYNCED' else 'SYNC_FAILED' end,
           failure_class = v_failure_class,
           server_event_id = coalesce(
             nullif(response->>'location_event_id', '')::uuid,
             nullif(response->>'event_id', '')::uuid
           ),
           server_response = response,
           geofence_validation = coalesce(
             nullif(response->>'reason', ''),
             nullif(response->>'validation_status', ''),
             geofence_validation
           ),
           last_error = case when v_failure_class is null then null else v_reason end,
           updated_at = clock_timestamp()
     where local_event_id = p_local_event_id;
    return response;
  exception when others then
    update public.offline_attendance_events
       set sync_status = 'SYNC_FAILED',
           failure_class = case
             when sqlstate = '28000' then 'reauthentication'
             when sqlstate like '08%' then 'retryable'
             else 'retryable'
           end,
           last_error = sqlstate || ': attendance sync failed',
           updated_at = clock_timestamp()
     where local_event_id = p_local_event_id;
    return jsonb_build_object(
      'status', 'SYNC_FAILED',
      'error', 'Attendance sync failed',
      'failure_class', case
        when sqlstate = '28000' then 'reauthentication'
        else 'retryable'
      end,
      'retryable', sqlstate <> '28000',
      'original_event_time', p_original_event_time
    );
  end;
end;
$$;

revoke all on function public.sync_offline_attendance_event(
  uuid, uuid, uuid, text, uuid, timestamptz, timestamptz,
  double precision, double precision, real, boolean, text, text
) from public, anon;
grant execute on function public.sync_offline_attendance_event(
  uuid, uuid, uuid, text, uuid, timestamptz, timestamptz,
  double precision, double precision, real, boolean, text, text
) to authenticated;

-- Legacy clients cannot prove which approved device submitted an event. Keep
-- both historical signatures callable during the controlled upgrade window,
-- but never acknowledge a new unbound event as synced. The row is retained so
-- an administrator can reconcile it instead of losing payroll evidence.
create or replace function public.sync_offline_attendance_event(
  p_local_event_id uuid,
  p_organization_id uuid,
  p_employee_id uuid,
  p_action_type text,
  p_device_timestamp timestamptz,
  p_original_event_time timestamptz,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters real,
  p_is_mock_location boolean,
  p_geofence_validation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response jsonb := jsonb_build_object(
    'status', 'SYNC_FAILED',
    'outcome', 'client_upgrade_required',
    'reason', 'approved_device_identity_required',
    'failure_class', 'review_required',
    'retryable', false,
    'original_event_time', p_original_event_time
  );
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.is_employee_owner(p_employee_id)
     or not private.employee_belongs_to_org(p_employee_id, p_organization_id) then
    raise exception 'Not authorized to sync offline attendance' using errcode = '42501';
  end if;

  insert into public.offline_attendance_events (
    local_event_id, organization_id, employee_id, action_type,
    device_timestamp, original_event_time, latitude, longitude,
    accuracy_meters, is_mock_location, geofence_validation,
    sync_status, failure_class, retry_count, last_attempt_at,
    server_response, last_error
  ) values (
    p_local_event_id, p_organization_id, p_employee_id, p_action_type,
    p_device_timestamp, p_original_event_time, p_latitude, p_longitude,
    p_accuracy_meters, p_is_mock_location, p_geofence_validation,
    'SYNC_FAILED', 'review_required', 1, clock_timestamp(),
    v_response, 'Client upgrade required: approved device identity missing'
  )
  on conflict (local_event_id) do nothing;

  return coalesce(
    (select server_response from public.offline_attendance_events
      where local_event_id = p_local_event_id
        and employee_id = p_employee_id
        and organization_id = p_organization_id),
    v_response
  );
end;
$$;

revoke all on function public.sync_offline_attendance_event(
  uuid, uuid, uuid, text, timestamptz, timestamptz,
  double precision, double precision, real, boolean, text
) from public, anon;
grant execute on function public.sync_offline_attendance_event(
  uuid, uuid, uuid, text, timestamptz, timestamptz,
  double precision, double precision, real, boolean, text
) to authenticated;

create or replace function public.sync_offline_attendance_event(
  p_local_event_id uuid,
  p_organization_id uuid,
  p_employee_id uuid,
  p_action_type text,
  p_geofence_id uuid,
  p_device_timestamp timestamptz,
  p_original_event_time timestamptz,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters real,
  p_is_mock_location boolean,
  p_geofence_validation text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.sync_offline_attendance_event(
    p_local_event_id, p_organization_id, p_employee_id, p_action_type,
    p_geofence_id, p_device_timestamp, p_original_event_time,
    p_latitude, p_longitude, p_accuracy_meters, p_is_mock_location,
    p_geofence_validation, null::text
  );
$$;

revoke all on function public.sync_offline_attendance_event(
  uuid, uuid, uuid, text, uuid, timestamptz, timestamptz,
  double precision, double precision, real, boolean, text
) from public, anon;
grant execute on function public.sync_offline_attendance_event(
  uuid, uuid, uuid, text, uuid, timestamptz, timestamptz,
  double precision, double precision, real, boolean, text
) to authenticated;

-- Phone-usage summaries are client-generated supporting evidence. Remove
-- direct table writes and require the same administrator-approved device used
-- for attendance. Explicit data status prevents unavailable telemetry from
-- being presented as zero usage.
alter table public.phone_usage_records
  add column if not exists data_status text not null default 'available';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'phone_usage_records_data_status_check'
      and conrelid = 'public.phone_usage_records'::regclass
  ) then
    alter table public.phone_usage_records
      add constraint phone_usage_records_data_status_check
      check (data_status in (
        'available', 'partial', 'permission_not_granted', 'no_data'
      ));
  end if;
end
$$;

comment on table public.phone_usage_records is
  'Employee-device generated usage summaries. Supporting evidence only; not independently verified.';
comment on column public.phone_usage_records.data_status is
  'Distinguishes measured, partial, permission-denied, and unavailable data. Zero minutes is not a substitute for unavailable data.';

drop policy if exists phone_usage_insert_self on public.phone_usage_records;
drop policy if exists phone_usage_update_self on public.phone_usage_records;
revoke insert, update, delete on table public.phone_usage_records from authenticated;

create or replace function public.upsert_phone_usage_summary(
  p_organization_id uuid,
  p_employee_id uuid,
  p_device_id text,
  p_work_date date,
  p_shift_assignment_id uuid,
  p_active_minutes integer,
  p_within_shift_minutes integer,
  p_total_shift_minutes integer,
  p_usage_percentage numeric,
  p_source text,
  p_consent_version text,
  p_synced_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift record;
  v_expected_minutes integer;
  v_status text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not private.is_employee_owner(p_employee_id)
     or not private.employee_belongs_to_org(p_employee_id, p_organization_id) then
    raise exception 'Not authorized to sync phone usage' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_device_id, '')), '') is null
     or p_device_id !~ '^[0-9a-f]{64}$' then
    raise exception 'Approved device identity is required' using errcode = '42501';
  end if;

  perform 1
  from public.employee_devices d
  where d.organization_id = p_organization_id
    and d.employee_id = p_employee_id
    and d.device_identifier_hash = p_device_id
    and d.integrity_status = 'valid'
    and d.revoked_at is null;
  if not found then
    raise exception 'Device is not approved for telemetry' using errcode = '42501';
  end if;

  if p_shift_assignment_id is not null then
    select sa.id as shift_assignment_id, sa.work_date,
           s.start_time, s.end_time, s.crosses_midnight,
           coalesce(s.break_minutes, 0) as break_minutes
      into v_shift
    from public.shift_assignments sa
    join public.shifts s
      on s.id = sa.shift_id and s.organization_id = sa.organization_id
    where sa.id = p_shift_assignment_id
      and sa.organization_id = p_organization_id
      and sa.employee_id = p_employee_id
      and sa.work_date = p_work_date;
  else
    -- Recurring schedules are resolved server-side and may intentionally have
    -- no materialized shift_assignment row. Do not reject legitimate telemetry
    -- merely because the schedule source is recurring.
    select r.shift_assignment_id, r.work_date, r.start_time, r.end_time,
           r.crosses_midnight, coalesce(r.break_minutes, 0) as break_minutes
      into v_shift
    from private.resolve_employee_schedule_internal(
      p_employee_id, p_work_date, p_work_date
    ) r
    where r.work_date = p_work_date and r.state = 'working'
    limit 1;
  end if;
  if not found then
    raise exception 'Telemetry does not match the employee shift'
      using errcode = '22023';
  end if;

  v_expected_minutes := (
    extract(epoch from (
      (p_work_date + v_shift.end_time
        + case when v_shift.crosses_midnight or v_shift.end_time <= v_shift.start_time
               then interval '1 day' else interval '0 day' end)
      - (p_work_date + v_shift.start_time)
    )) / 60
  )::integer;

  if p_active_minutes is null or p_within_shift_minutes is null
     or p_total_shift_minutes is null
     or p_active_minutes < 0 or p_within_shift_minutes < 0
     or p_total_shift_minutes <= 0 or p_total_shift_minutes > 1440
     or p_active_minutes > 1440
     or p_within_shift_minutes > p_active_minutes
     or p_within_shift_minutes > p_total_shift_minutes
     or abs(p_total_shift_minutes - v_expected_minutes) > 5 then
    raise exception 'Phone usage durations are inconsistent with the assigned shift'
      using errcode = '22023';
  end if;
  if p_usage_percentage is not null
     and (p_usage_percentage < 0 or p_usage_percentage > 100) then
    raise exception 'Phone usage percentage must be between 0 and 100'
      using errcode = '22023';
  end if;
  if p_synced_at is not null and p_synced_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'Telemetry sync timestamp is in the future' using errcode = '22023';
  end if;

  v_status := case
    when p_source like '%permission_not_granted' then 'permission_not_granted'
    when p_source like '%partial_data' then 'partial'
    when p_source like '%no_data' then 'no_data'
    when p_source like '%permission_granted' then 'available'
    else null
  end;
  if v_status is null then
    raise exception 'Unsupported phone usage data status' using errcode = '22023';
  end if;
  if v_status in ('permission_not_granted', 'no_data')
     and (p_active_minutes <> 0 or p_within_shift_minutes <> 0
          or p_usage_percentage is not null) then
    raise exception 'Unavailable phone usage must not be reported as measured data'
      using errcode = '22023';
  end if;

  insert into public.phone_usage_records (
    organization_id, employee_id, device_id, work_date, shift_assignment_id,
    active_minutes, within_shift_minutes, total_shift_minutes, usage_percentage,
    source, consent_version, synced_at, data_status
  ) values (
    p_organization_id, p_employee_id, p_device_id, p_work_date,
    v_shift.shift_assignment_id, p_active_minutes, p_within_shift_minutes,
    p_total_shift_minutes, p_usage_percentage, p_source, p_consent_version,
    coalesce(p_synced_at, clock_timestamp()), v_status
  )
  on conflict (employee_id, work_date) do update set
    device_id = excluded.device_id,
    shift_assignment_id = excluded.shift_assignment_id,
    active_minutes = excluded.active_minutes,
    within_shift_minutes = excluded.within_shift_minutes,
    total_shift_minutes = excluded.total_shift_minutes,
    usage_percentage = excluded.usage_percentage,
    source = excluded.source,
    consent_version = excluded.consent_version,
    synced_at = excluded.synced_at,
    data_status = excluded.data_status,
    updated_at = clock_timestamp();
end;
$$;

revoke all on function public.upsert_phone_usage_summary(
  uuid, uuid, text, date, uuid, integer, integer, integer,
  numeric, text, text, timestamptz
) from public, anon;
grant execute on function public.upsert_phone_usage_summary(
  uuid, uuid, text, date, uuid, integer, integer, integer,
  numeric, text, text, timestamptz
) to authenticated;

-- The legacy heartbeat RPC has no device identity parameter and therefore
-- cannot meet the attendance trust boundary. New clients use
-- record_attendance_location with p_device_hash.
revoke execute on function public.record_location_ping(
  uuid, double precision, double precision, double precision, boolean
) from authenticated;

-- Device reset is administrator-only and cannot implicitly trust the next
-- phone. The replacement must submit a request and then be approved.
create or replace function public.reset_employee_device(p_employee_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_org uuid;
  v_count integer := 0;
  v_device public.employee_devices%rowtype;
begin
  select organization_id into v_org
  from public.employee_profiles
  where id = p_employee_id;
  if v_actor is null or v_org is null
     or not private.has_org_role(v_org, array['administrator']) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  for v_device in
    update public.employee_devices d
       set revoked_at = coalesce(d.revoked_at, clock_timestamp()),
           integrity_status = 'blocked',
           updated_at = clock_timestamp()
     where d.employee_id = p_employee_id
       and (d.revoked_at is null or d.integrity_status <> 'blocked')
    returning d.*
  loop
    v_count := v_count + 1;
    insert into public.employee_device_audit_log (
      organization_id, employee_id, device_id, actor_user_id, action,
      previous_integrity_status, new_integrity_status, reason
    ) values (
      v_device.organization_id, v_device.employee_id, v_device.id, v_actor,
      'reset', null, 'blocked', 'Administrator initiated device replacement'
    );
  end loop;
  return v_count;
end;
$$;

revoke all on function public.reset_employee_device(uuid) from public, anon;
grant execute on function public.reset_employee_device(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Deterministic, evidence-based geofence breach detection.
-- ---------------------------------------------------------------------------
create unique index if not exists geofence_breach_alerts_breach_recipient_key
  on public.geofence_breach_alerts (breach_id, recipient_user_id);

create or replace function private.detect_geofence_breaches()
returns table(breaches_opened integer, breaches_resolved integer, breaches_updated integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opened integer := 0;
  v_resolved integer := 0;
  v_updated integer := 0;
  v_now timestamptz := clock_timestamp();
  r record;
  v_threshold integer;
  v_boundary timestamptz;
  v_streak_start timestamptz;
  v_last_outside timestamptz;
  v_minutes integer;
  v_breach public.geofence_breaches%rowtype;
  v_geofence_id uuid;
  v_notification_id uuid;
  m record;
begin
  -- A checked-out/removed session cannot remain an active breach. This is an
  -- explicit session transition, not an inference from missing GPS samples.
  with resolved as (
    update public.geofence_breaches b
       set status = 'resolved', resolved_at = v_now, updated_at = v_now
     where b.status = 'open'
       and not exists (
         select 1 from public.attendance_records ar
         where ar.id = b.attendance_record_id
           and ar.organization_id = b.organization_id
           and ar.employee_id = b.employee_id
           and ar.check_in_at is not null
           and ar.check_out_at is null
       )
    returning 1
  )
  select count(*) into v_resolved from resolved;

  for r in
    select ar.id as record_id, ar.organization_id, ar.employee_id,
           ar.check_in_at, o.geofence_breach_threshold_minutes as threshold,
           ep.full_name, ep.manager_user_id, ep.branch_id, ep.department_id
    from public.attendance_records ar
    join public.organizations o
      on o.id = ar.organization_id and o.status::text = 'active'
    join public.employee_profiles ep
      on ep.id = ar.employee_id and ep.organization_id = ar.organization_id
    where ar.check_in_at is not null
      and ar.check_out_at is null
      and ar.attendance_date >=
        (v_now at time zone coalesce(nullif(o.timezone, ''), 'UTC'))::date - 1
  loop
    v_threshold := coalesce(r.threshold, 30);
    v_boundary := r.check_in_at;
    v_streak_start := null;
    v_last_outside := null;
    v_geofence_id := null;
    v_breach := null;

    -- Only a positively classified inside sample ends an outside streak.
    -- Low-accuracy, mock, or unclassified samples neither create nor resolve a
    -- violation.
    select max(lp.event_at) into v_boundary
    from public.employee_location_pings lp
    where lp.organization_id = r.organization_id
      and lp.employee_id = r.employee_id
      and lp.attendance_record_id = r.record_id
      and lp.event_at >= r.check_in_at
      and lp.inside_geofence is true;
    v_boundary := greatest(coalesce(v_boundary, r.check_in_at), r.check_in_at);

    select min(lp.event_at), max(lp.event_at)
      into v_streak_start, v_last_outside
    from public.employee_location_pings lp
    where lp.organization_id = r.organization_id
      and lp.employee_id = r.employee_id
      and lp.attendance_record_id = r.record_id
      and lp.event_at > v_boundary
      and lp.inside_geofence is false;

    if v_last_outside is not null then
      select lp.geofence_id into v_geofence_id
      from public.employee_location_pings lp
      where lp.organization_id = r.organization_id
        and lp.employee_id = r.employee_id
        and lp.attendance_record_id = r.record_id
        and lp.event_at > v_boundary
        and lp.inside_geofence is false
      order by lp.event_at desc, lp.id desc
      limit 1;
    end if;

    select * into v_breach
    from public.geofence_breaches b
    where b.organization_id = r.organization_id
      and b.employee_id = r.employee_id
      and b.attendance_record_id = r.record_id
      and b.status = 'open'
    order by b.detected_at desc, b.id desc
    limit 1;

    if v_streak_start is null then
      -- Resolve only with affirmative return-inside evidence after the breach.
      -- No samples or only unknown samples leave the incident open for review.
      if v_breach.id is not null and v_boundary > v_breach.started_at then
        update public.geofence_breaches
           set status = 'resolved', resolved_at = v_now, updated_at = v_now
         where id = v_breach.id;
        v_resolved := v_resolved + 1;
      end if;
      continue;
    end if;

    -- Duration is bounded by reliable outside observations. A single stale
    -- point followed by missing GPS must not turn into a sustained violation.
    v_minutes := greatest(
      0,
      floor(extract(epoch from (v_last_outside - v_streak_start)) / 60)::integer
    );

    if v_breach.id is not null then
      update public.geofence_breaches
         set minutes_outside = greatest(minutes_outside, v_minutes),
             last_seen_outside_at = greatest(last_seen_outside_at, v_last_outside),
             geofence_id = coalesce(v_geofence_id, geofence_id),
             started_at = least(started_at, v_streak_start),
             updated_at = v_now
       where id = v_breach.id;
      v_updated := v_updated + 1;
      continue;
    end if;

    if v_minutes < v_threshold then
      continue;
    end if;

    insert into public.geofence_breaches (
      organization_id, employee_id, attendance_record_id, geofence_id, status,
      started_at, detected_at, last_seen_outside_at, minutes_outside
    ) values (
      r.organization_id, r.employee_id, r.record_id, v_geofence_id, 'open',
      v_streak_start, v_now, v_last_outside, v_minutes
    )
    on conflict (employee_id) where status = 'open' do nothing
    returning * into v_breach;

    if v_breach.id is null then
      continue;
    end if;
    v_opened := v_opened + 1;

    -- Administrators receive organization-wide alerts. Managers receive only
    -- alerts for their direct reports or configured scopes.
    for m in
      select distinct mem.user_id
      from public.organization_memberships mem
      where mem.organization_id = r.organization_id
        and mem.status::text = 'active'
        and (
          mem.role_code::text = 'administrator'
          or (
            mem.role_code::text = 'manager'
            and (
              r.manager_user_id = mem.user_id
              or exists (
                select 1 from public.manager_scopes s
                where s.organization_id = r.organization_id
                  and s.manager_user_id = mem.user_id
                  and (s.employee_id is null or s.employee_id = r.employee_id)
                  and (s.branch_id is null or s.branch_id = r.branch_id)
                  and (s.department_id is null or s.department_id = r.department_id)
              )
            )
          )
        )
    loop
      insert into public.notifications (
        organization_id, recipient_user_id, notification_type, severity,
        title, body, entity_type, entity_id
      ) values (
        r.organization_id, m.user_id, 'geofence_breach', 'warning',
        'Employee outside geofence',
        coalesce(r.full_name, 'An employee') ||
          ' has verified outside-geofence samples spanning ' ||
          v_minutes || ' minutes during their shift.',
        'employee', r.employee_id
      ) returning id into v_notification_id;

      insert into public.geofence_breach_alerts (
        breach_id, organization_id, recipient_user_id, notification_id
      ) values (v_breach.id, r.organization_id, m.user_id, v_notification_id)
      on conflict (breach_id, recipient_user_id) do nothing;
    end loop;
  end loop;

  return query select v_opened, v_resolved, v_updated;
end;
$$;

revoke all on function private.detect_geofence_breaches()
  from public, anon, authenticated;
grant execute on function private.detect_geofence_breaches() to service_role;
