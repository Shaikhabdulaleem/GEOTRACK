-- Offline sync must carry the assignment selected by the client.  The
-- attendance RPC intentionally requires an explicit geofence id; passing NULL
-- makes every event fail validation.  Keep the original overload for older
-- clients and add this overload for current Android builds.
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
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.offline_attendance_events%rowtype;
  response jsonb;
begin
  if not private.is_employee_owner(p_employee_id)
     or not private.employee_belongs_to_org(p_employee_id, p_organization_id) then
    raise exception 'Not authorized to sync offline attendance' using errcode = '42501';
  end if;
  if p_geofence_id is null then
    raise exception 'A geofence assignment is required to sync attendance' using errcode = '22023';
  end if;

  select * into existing from public.offline_attendance_events where local_event_id = p_local_event_id;
  if found then
    return coalesce(existing.server_response, jsonb_build_object('status', existing.sync_status, 'event_id', existing.server_event_id));
  end if;

  insert into public.offline_attendance_events (
    local_event_id, organization_id, employee_id, action_type, device_timestamp,
    original_event_time, latitude, longitude, accuracy_meters, is_mock_location,
    geofence_validation
  ) values (
    p_local_event_id, p_organization_id, p_employee_id, p_action_type, p_device_timestamp,
    p_original_event_time, p_latitude, p_longitude, p_accuracy_meters, p_is_mock_location,
    p_geofence_validation
  );

  begin
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
        )
      ) processed
      limit 1;

    update public.offline_attendance_events
       set sync_status = case when coalesce(response->>'status', '') in ('rejected', 'error', 'failed', 'outside_geofence') then 'SYNC_FAILED' else 'SYNCED' end,
           server_event_id = nullif(response->>'event_id', '')::uuid,
           server_response = response,
           geofence_validation = coalesce(response->>'validation_status', geofence_validation),
           updated_at = clock_timestamp()
     where local_event_id = p_local_event_id;
    return coalesce(response, jsonb_build_object('status', 'SYNC_FAILED', 'error', 'No server response'));
  exception when others then
    update public.offline_attendance_events
       set sync_status = 'SYNC_FAILED', last_error = sqlerrm, updated_at = clock_timestamp()
     where local_event_id = p_local_event_id;
    return jsonb_build_object('status', 'SYNC_FAILED', 'error', sqlerrm);
  end;
end;
$$;

revoke all on function public.sync_offline_attendance_event(uuid, uuid, uuid, text, uuid, timestamptz, timestamptz, double precision, double precision, real, boolean, text) from public, anon;
grant execute on function public.sync_offline_attendance_event(uuid, uuid, uuid, text, uuid, timestamptz, timestamptz, double precision, double precision, real, boolean, text) to authenticated;
