-- Shift-scoped, summarized phone usage. No app/package names or content are stored.
alter table public.phone_usage_records
  add column if not exists shift_assignment_id uuid references public.shift_assignments(id),
  add column if not exists total_shift_minutes integer,
  add column if not exists usage_percentage numeric(5,2),
  add column if not exists synced_at timestamptz;

alter table public.phone_usage_records
  drop constraint if exists phone_usage_records_total_shift_minutes_check,
  drop constraint if exists phone_usage_records_within_shift_minutes_check,
  drop constraint if exists phone_usage_records_usage_percentage_check;

alter table public.phone_usage_records
  add constraint phone_usage_records_total_shift_minutes_check
    check (total_shift_minutes is null or total_shift_minutes >= 0),
  add constraint phone_usage_records_within_shift_minutes_check
    check (within_shift_minutes >= 0 and (total_shift_minutes is null or within_shift_minutes <= total_shift_minutes)),
  add constraint phone_usage_records_usage_percentage_check
    check (usage_percentage is null or (usage_percentage >= 0 and usage_percentage <= 100));

create unique index if not exists phone_usage_employee_date_uidx
  on public.phone_usage_records (employee_id, work_date);

comment on column public.phone_usage_records.usage_percentage is
  'Phone foreground time overlapping the assigned shift divided by total shift duration.';

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
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_employee_owner(p_employee_id)
     or not private.employee_belongs_to_org(p_employee_id, p_organization_id) then
    raise exception 'Not authorized to sync phone usage' using errcode = '42501';
  end if;
  if p_active_minutes < 0 or p_within_shift_minutes < 0 or p_total_shift_minutes < 0 then
    raise exception 'Phone usage durations must be non-negative' using errcode = '22023';
  end if;
  if p_usage_percentage is not null and (p_usage_percentage < 0 or p_usage_percentage > 100) then
    raise exception 'Phone usage percentage must be between 0 and 100' using errcode = '22023';
  end if;

  insert into public.phone_usage_records (
    organization_id, employee_id, device_id, work_date, shift_assignment_id,
    active_minutes, within_shift_minutes, total_shift_minutes, usage_percentage,
    source, consent_version, synced_at
  ) values (
    p_organization_id, p_employee_id, p_device_id, p_work_date, p_shift_assignment_id,
    p_active_minutes, p_within_shift_minutes, p_total_shift_minutes, p_usage_percentage,
    p_source, p_consent_version, coalesce(p_synced_at, clock_timestamp())
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
    updated_at = clock_timestamp();
end;
$$;

revoke all on function public.upsert_phone_usage_summary(uuid, uuid, text, date, uuid, integer, integer, integer, numeric, text, text, timestamptz) from public, anon;
grant execute on function public.upsert_phone_usage_summary(uuid, uuid, text, date, uuid, integer, integer, integer, numeric, text, text, timestamptz) to authenticated;
