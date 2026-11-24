-- Grant authenticated role permissions to select, insert, and update employee_transfers
-- Row level security (RLS) is enabled on public.employee_transfers and enforces access policies.
revoke all on table public.employee_transfers from public, anon;
grant select, insert, update on table public.employee_transfers to authenticated;
