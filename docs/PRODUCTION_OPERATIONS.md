# GEOTRACK production operations

## Backup and recovery

- Supabase database backups must be enabled for the production project.
  Record the plan, retention window and whether point-in-time recovery is
  available in the operations register.
- Export configuration and keep repository migrations under version control;
  never treat a SQL export containing employee data as source code.
- Run a documented restore exercise at least quarterly into an isolated
  non-production project. Verify schema version, row counts, Auth access and
  RLS before declaring the exercise successful.
- Android application data is deliberately excluded from Android cloud backup
  (allowBackup=false); the server remains the system of record.

## Monitoring and alerting

- Monitor Supabase Auth, PostgREST, database and Edge Function error rates.
  Alert on sustained 5xx responses, failed migrations, repeated 401/403 spikes,
  Edge Function failures and database resource saturation.
- Monitor Vercel availability, deployment failures and client-side errors.
- Enable Firebase Crashlytics only after adding the approved Android
  configuration and updating the employee privacy notice. Do not attach precise
  location, access tokens, email, iqama numbers or attendance payloads to crash
  reports.
- Define severity and response owners: Sev-1 data exposure/auth bypass;
  Sev-2 attendance outage or notification failure; Sev-3 degraded reporting.
- Review Supabase security and performance advisors after every schema change
  and at least monthly.

### Automatic checkout health

Run these checks after each mobile/database release and alert when any result is
non-zero (except `last_cron_success`, which must be recent):

```sql
select count(*) as open_sessions_over_12h
from public.attendance_records
where check_in_at is not null and check_out_at is null
  and check_in_at < clock_timestamp() - interval '12 hours';

select count(*) as attendance_ot_without_approval
from public.attendance_records ar
where coalesce(ar.overtime_minutes, 0) > 0
  and not exists (
    select 1 from public.overtime_records ot
    where ot.attendance_record_id = ar.id
  );

select max(end_time) as last_cron_success
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'geotrack-auto-close-attendance')
  and status = 'succeeded';

select count(*) as recent_rejected_exit_samples
from public.employee_location_pings
where event_at > clock_timestamp() - interval '1 hour'
  and inside_geofence is null;
```

Also monitor Android diagnostics for checkout foreground-service start failures,
missing background-location/exact-alarm access, and repeated offline replay
failures. The setup banner must remain visible while precision is degraded.

Historical sessions in `private.attendance_repair_audit` with
`status = 'manual_review'` are deliberately excluded from automatic cleanup.
Review them using approved attendance evidence; never infer a checkout time.

## Incident checklist

1. Preserve relevant logs without copying secrets or unnecessary employee data.
2. Revoke affected sessions/credentials and contain the failing integration.
3. Determine affected users, records, time window and cross-tenant impact.
4. Follow the approved Saudi PDPL breach assessment/notification procedure.
5. Restore service, validate RLS and document corrective actions.

## Required production register

Record the owners and current state for: backup plan/retention, last restore
test, alert destinations, on-call contact, SMTP provider, Firebase service
account rotation, API-key restrictions, privacy-notice version, subprocessor
list and data-retention schedule.

