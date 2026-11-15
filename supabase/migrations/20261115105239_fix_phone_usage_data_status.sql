-- Repair production schema drift that left the Device Usage page selecting a
-- missing phone_usage_records.data_status column.
alter table public.phone_usage_records
  add column if not exists data_status text;

update public.phone_usage_records
set data_status = case
  when source like '%permission_not_granted' then 'permission_not_granted'
  when source like '%partial_data' then 'partial'
  when source like '%no_data' then 'no_data'
  else 'available'
end
where data_status is null;

alter table public.phone_usage_records
  alter column data_status set default 'available',
  alter column data_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
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

comment on column public.phone_usage_records.data_status is
  'Distinguishes measured, partial, permission-denied, and unavailable data. Zero minutes is not a substitute for unavailable data.';

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
