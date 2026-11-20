alter table public.mailroom_productivity_settings
  add column if not exists overtime_hourly_cost_own numeric(12,2) not null default 0
    check (overtime_hourly_cost_own >= 0),
  add column if not exists overtime_hourly_cost_3pl numeric(12,2) not null default 0
    check (overtime_hourly_cost_3pl >= 0);

-- Backfill from existing overtime_hourly_cost if already configured
update public.mailroom_productivity_settings
set
  overtime_hourly_cost_own = case when overtime_hourly_cost_own = 0 and overtime_hourly_cost > 0 then overtime_hourly_cost else overtime_hourly_cost_own end,
  overtime_hourly_cost_3pl = case when overtime_hourly_cost_3pl = 0 and overtime_hourly_cost > 0 then overtime_hourly_cost else overtime_hourly_cost_3pl end;
