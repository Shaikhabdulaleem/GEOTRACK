# GEOTRACK testing matrix

Use staging organizations and purpose-created test accounts. Never create test
attendance, location, or employee records in production.

Status meanings: **Automated** is covered in repository tests; **Manual** must
be executed on staging/devices; **Blocked** requires external access, hardware,
or approval.

## Authentication and security

| Scenario | Method | Current status |
|---|---|---|
| Employee/manager/admin RLS boundaries | `rls_smoke.sql`, device/overtime tests | Automated — pass |
| Cross-organization reads and privileged RPC calls | RLS/device/overtime tests | Automated — pass |
| Employee direct device trust mutation | `device_authorization.sql` | Automated — pass |
| Unknown, pending, approved, replaced, and revoked device | `device_authorization.sql` | Automated — pass |
| Missing/forged device hash | Device test and hardened RPC validation | Automated — pass |
| Expired session / reauthentication recovery | Offline policy unit test plus staging session expiry | Partial; manual staging required |
| Login enumeration and brute force | Generic-response code review; rate-limit load test | Manual staging required |
| Leaked-password rejection and CAPTCHA/WAF | Auth dashboard configuration | Blocked pending approval |
| Privileged RPC callable/grant inventory | Advisor and register comparison | Manual release gate |

## Attendance and location

| Scenario | Method | Current status |
|---|---|---|
| Manual check-in/check-out and duplicate idempotency | `e2e_workflow.sql` | Automated — pass |
| Automatic checkout and overtime reconciliation | `auto_close_attendance.sql`, `e2e_workflow.sql` | Automated — pass |
| Geofence inside → sustained outside → inside | `geofence_breach_detection.sql` | Automated — pass |
| Poor accuracy/mock/unclassified sample | Detector and attendance SQL tests | Automated — pass |
| Missing GPS samples do not fabricate a breach | `geofence_breach_detection.sql` | Automated — pass |
| Overnight attendance session | Detector/E2E SQL tests | Automated — pass |
| Off day and schedule changes | E2E/recurring resolver tests | Automated — pass |
| Early departure, late, worked time, overtime | E2E/auto-close/overtime tests | Automated — pass |
| Manual correction and overtime review | `overtime_review.sql` | Automated — pass |
| Android 12–current geofence entry/exit | Physical devices | Blocked pending device lab |
| Background permission denied/revoked | Physical device permission matrix | Blocked pending device lab |
| Battery optimization and foreground-service restrictions | OEM/device matrix | Blocked pending device lab |

## Offline and process recovery

| Scenario | Method | Current status |
|---|---|---|
| Retryable vs permanent classification | `OfflineSyncPolicyTest` | Automated — pass |
| Bounded exponential retry | `OfflineSyncPolicyTest` | Automated — pass |
| Duplicate replay | Android unit + SQL idempotency | Automated — pass |
| Legacy client event is retained, not falsely synced | `device_authorization.sql` | Automated — pass |
| Network interruption/restoration | WorkManager staging test | Manual staging required |
| App process death with Room event pending | Instrumented device test | Blocked pending device lab |
| Phone restart / boot receiver re-registration | Instrumented physical-device test | Blocked pending device lab |
| Server/Edge downtime | Staging fault exercise | Manual staging required |
| Permanent-event correction workflow | Admin correction UI/RPC staging test | Manual staging required |

## Notifications and operations

| Scenario | Method | Current status |
|---|---|---|
| Duplicate queue claim prevention | `geofence_breach_detection.sql` | Automated — pass |
| FCM success marks delivery | Queue completion SQL test; staging FCM | Partial; real FCM manual |
| Transient retry and stale lease | Queue SQL test/code review | Automated — pass |
| Invalid token cleanup | Edge Function staging test | Manual staging required |
| Permanent delivery escalation is emitted once | `geofence_breach_detection.sql` | Automated — pass |
| Cron failure escalation | Local migration/function inspection; staged failed job | Manual staging required |
| API/Auth/REST availability | `deployment-smoke.yml` | Ready; requires protected environment |
| Backup/PITR and restore | Isolated restore drill | Blocked pending owner/project plan |

## Reporting

| Scenario | Method | Current status |
|---|---|---|
| Seven complete daily series | `dashboard_reporting.sql` | Automated — pass |
| Riyadh/local date boundary | `dashboard_reporting.sql` | Automated — pass |
| Attendance/overtime/productivity/geofence totals | `dashboard_reporting.sql` | Automated — pass |
| Branch/department/manager/employee isolation | RPC predicates plus RLS tests | Automated/inspection; add staging volume test |
| Empty and partial telemetry | Web type tests/manual UI | Manual staging required |
| Large employee dataset and pagination | Generated staging fixtures | Manual staging required |
| Leave and Auth session inventory | Explicit unavailable state | Correctly labeled; feature not implemented |

## Release checks

| Check | Result |
|---|---|
| Local database reset, all 35 migrations | Pass |
| Eight transactional SQL files | Pass |
| Schema lint | New functions clean; two pre-existing non-blocking warnings |
| Web typecheck/lint/unit/build | Pass |
| Android unit/lint/debug build | Pass |
| Android minified signed release build | Build pass |
| Release APK update signer | **Fail/blocker: signer mismatch** |
| Upgrade without data loss | Blocked until correct signer/device available |
| Vercel current production commit revalidation | Blocked by expired team authorization |
