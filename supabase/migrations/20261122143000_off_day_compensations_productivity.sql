-- Migration: off_day_compensations_productivity
-- Adds shift_name column to off_day_compensations and ensures indexes and permissions

alter table if exists public.off_day_compensations
  add column if not exists shift_name text;

create index if not exists idx_off_day_comp_org_date on public.off_day_compensations (organization_id, work_date);
