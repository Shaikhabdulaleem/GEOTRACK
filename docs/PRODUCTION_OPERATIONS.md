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

