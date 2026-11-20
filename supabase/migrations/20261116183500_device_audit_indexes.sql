-- Cover audit-log foreign keys used by review and retention operations.
create index if not exists employee_device_audit_device_idx
  on public.employee_device_audit_log (device_id);

create index if not exists employee_device_audit_actor_idx
  on public.employee_device_audit_log (actor_user_id);
