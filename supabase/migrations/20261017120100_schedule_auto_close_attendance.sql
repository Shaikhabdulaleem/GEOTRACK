-- The 20261010 migration scheduled the auto-close job inside a best-effort
-- DO/EXCEPTION block. On prod that block raised and was swallowed, so the
-- 'geotrack-auto-close-attendance' cron job was never created and NO attendance
-- session ever auto-closed (verified against prod cron.job on 2026-10-17).
--
-- Schedule it explicitly here, and do NOT swallow failures: if an environment
-- cannot schedule it, the migration should fail loudly rather than silently
-- leave auto-close dead. cron.schedule upserts by job name, so this is
-- idempotent and safe to re-run.
create extension if not exists pg_cron;

select cron.schedule(
  'geotrack-auto-close-attendance',
  '*/5 * * * *',
  $job$ SELECT private.auto_close_attendance_sessions(); $job$
);
