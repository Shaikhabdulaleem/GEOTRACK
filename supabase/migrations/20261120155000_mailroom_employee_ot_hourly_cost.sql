alter table public.mailroom_employee_settings
  add column if not exists overtime_hourly_cost numeric(12,2)
    check (overtime_hourly_cost is null or overtime_hourly_cost >= 0);

comment on column public.mailroom_employee_settings.overtime_hourly_cost is
  'Optional per-employee hourly overtime cost override. If null, inherits department setting.';
