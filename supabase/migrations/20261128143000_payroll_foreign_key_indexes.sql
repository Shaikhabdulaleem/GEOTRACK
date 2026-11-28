-- Cover payroll foreign keys used by scoped reads, run regeneration, and audit lookups.
-- These indexes are intentionally separate from the feature migration so an already-live
-- payroll schema can be remediated without rebuilding or rewriting payroll data.

create index if not exists payroll_settings_updated_by_idx
  on public.payroll_settings (updated_by)
  where updated_by is not null;

create index if not exists employee_compensations_created_by_idx
  on public.employee_compensations (created_by)
  where created_by is not null;

create index if not exists employee_payroll_components_created_by_idx
  on public.employee_payroll_components (created_by)
  where created_by is not null;

create index if not exists payroll_runs_generated_by_idx
  on public.payroll_runs (generated_by)
  where generated_by is not null;

create index if not exists payroll_runs_finalized_by_idx
  on public.payroll_runs (finalized_by)
  where finalized_by is not null;

create index if not exists payroll_runs_reopened_by_idx
  on public.payroll_runs (reopened_by)
  where reopened_by is not null;

create index if not exists payroll_runs_created_by_idx
  on public.payroll_runs (created_by)
  where created_by is not null;

create index if not exists payroll_entries_org_employee_idx
  on public.payroll_entries (organization_id, employee_id);

create index if not exists payroll_entries_reviewed_by_idx
  on public.payroll_entries (reviewed_by)
  where reviewed_by is not null;

create index if not exists payroll_line_items_run_idx
  on public.payroll_line_items (payroll_run_id);

create index if not exists payroll_line_items_org_employee_idx
  on public.payroll_line_items (organization_id, employee_id);

create index if not exists payroll_line_items_created_by_idx
  on public.payroll_line_items (created_by)
  where created_by is not null;

create index if not exists payroll_exceptions_run_idx
  on public.payroll_exceptions (payroll_run_id);

create index if not exists payroll_exceptions_org_employee_idx
  on public.payroll_exceptions (organization_id, employee_id);

create index if not exists payroll_exceptions_attendance_record_idx
  on public.payroll_exceptions (attendance_record_id)
  where attendance_record_id is not null;

create index if not exists payroll_exceptions_resolved_by_idx
  on public.payroll_exceptions (resolved_by)
  where resolved_by is not null;
