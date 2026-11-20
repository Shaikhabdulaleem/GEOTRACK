create index if not exists mailroom_turnaround_org_client_idx
  on public.mailroom_daily_turnaround_metrics (organization_id, client_id);
