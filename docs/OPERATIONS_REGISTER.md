# GEOTRACK operations register

Single source of truth for production ownership and current state. Fill every
field before go-live and review after each significant change. See
`docs/PRODUCTION_OPERATIONS.md` for the procedures behind these entries.

## Ownership & contacts

| Item | Value |
|---|---|
| Product / launch owner | |
| On-call / incident owner | |
| Privacy contact / DPO | |
| Supabase project ref | gaixauomldxecknkkejl |
| Firebase project | geotracker-25063 |
| Web (Vercel) URL | https://geotrack-fieldtrack-ksa.vercel.app |

## Backup & recovery

| Item | Value / state |
|---|---|
| DB backup plan & retention window | |
| Point-in-Time Recovery enabled | ☐ yes ☐ no |
| Last restore drill (date, result) | |
| Backup owner | |

## Monitoring & alerting

| Signal | Alert destination | Owner |
|---|---|---|
| Sustained 5xx (PostgREST/API) | | |
| 401/403 spikes (auth abuse) | | |
| Edge Function failures | | |
| Failed migrations | | |
| DB resource saturation | | |
| Vercel availability / deploy failures | | |

## Secrets & key management

| Secret | Location | Last rotated | Owner |
|---|---|---|---|
| Supabase service_role key | Edge Function secrets | | |
| SMTP_USER / SMTP_PASS (SendGrid) | Edge Function / Auth config | | |
| Firebase service account (CLIENT_EMAIL/PRIVATE_KEY) | Edge Function secrets | | |
| Android release keystore password | Secrets vault | | |
| Firebase Android API key restriction | Google Cloud console | ☐ restricted | |
| Mapbox token URL restriction | Mapbox account | ☐ restricted | |

## Compliance (Saudi PDPL)

| Item | Value / state |
|---|---|
| Privacy notice version issued | |
| Legal basis documented per purpose | ☐ done |
| Subprocessor list (Supabase, Vercel, Firebase/GCP, Mapbox, SendGrid) | |
| Cross-border transfer mechanism documented | ☐ done |
| Data-retention schedule approved | |
| `enforce_data_retention` windows (location / notif / phone) | 180 / 365 / 365 days |
| pg_cron `geotrack-data-retention` job active | ☐ yes |
| Data-subject request procedure owner | |
| Breach assessment/notification procedure | ☐ documented |

## Incident severities

| Severity | Definition | Response owner |
|---|---|---|
| Sev-1 | Data exposure / auth bypass | |
| Sev-2 | Attendance outage / notification failure | |
| Sev-3 | Degraded reporting | |
