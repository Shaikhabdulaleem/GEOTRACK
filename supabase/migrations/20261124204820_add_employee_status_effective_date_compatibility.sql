-- Production was missing this column even though the web application and the
-- local schema already use it to preserve historical employee activity.
-- Keep existing rows nullable because their true effective dates cannot be
-- reconstructed safely from joining or update timestamps.
alter table public.employee_profiles
  add column if not exists status_effective_date date;

comment on column public.employee_profiles.status_effective_date is
  'Date from which the current employment_status takes effect.';
