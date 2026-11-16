create index if not exists mailroom_client_activities_org_activity_idx
  on public.mailroom_client_activities (organization_id, activity_id);

create index if not exists mailroom_client_activities_org_branch_idx
  on public.mailroom_client_activities (organization_id, branch_id);

create index if not exists mailroom_daily_shipments_org_client_idx
  on public.mailroom_daily_shipments (organization_id, client_id);

create index if not exists mailroom_daily_shipments_created_by_idx
  on public.mailroom_daily_shipments (created_by);

create index if not exists mailroom_daily_shipments_updated_by_idx
  on public.mailroom_daily_shipments (updated_by);

create index if not exists mailroom_employee_settings_org_employee_idx
  on public.mailroom_employee_settings (organization_id, employee_id);
