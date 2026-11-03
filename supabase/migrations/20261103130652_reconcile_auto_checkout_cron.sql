-- Production ledger version: 20261103130652.
-- Preserve the production cron job's canonical name while replacing its
-- command with the consolidated checkout engine. pg_cron updates this named
-- job in place, so job history and monitoring remain continuous.
select cron.schedule(
  'geotrack-auto-close-attendance',
  '*/5 * * * *',
  'select private.auto_close_attendance_sessions();'
);

create index if not exists attendance_repair_audit_record_idx
  on private.attendance_repair_audit(attendance_record_id);
