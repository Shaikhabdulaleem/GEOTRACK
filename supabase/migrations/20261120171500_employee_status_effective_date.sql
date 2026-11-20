alter table public.employee_profiles
  add column if not exists status_effective_date date;

update public.employee_profiles
set status_effective_date = coalesce(joining_date, created_at::date)
where status_effective_date is null;
