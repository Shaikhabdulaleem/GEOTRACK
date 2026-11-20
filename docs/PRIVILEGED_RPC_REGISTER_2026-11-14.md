# Privileged RPC register — 2026-11-14

Production exposed 21 `SECURITY DEFINER` functions to `authenticated` at the
time of inspection. Every listed function uses `search_path = ''`. Elevated
execution is retained only where the operation must cross RLS boundaries; the
function itself must enforce the caller and tenant boundary.

| RPC | Intended caller | Authorization boundary | Audit action |
|---|---|---|---|
| `complete_password_change()` | Signed-in employee/admin changing own password | Requires `auth.uid()` and a matching invitation/user flow | Retain; generic errors and Auth rate limits |
| `get_active_geofence_breaches(org)` | Manager/admin dashboard | Organization role plus employee scope | Retain; regression-test cross-org access |
| `get_overtime_review_detail(...)` | Manager/admin | Organization role and employee scope | Retain; SQL tests pass |
| `list_overtime_review_employees(...)` | Manager/admin | Organization role, scope, bounded pagination | Retain; SQL tests pass |
| `manager_correct_attendance(...)` | Scoped manager/admin | `can_access_employee`, date/timestamp/reason validation | Retain; correction is audited |
| `mark_notification_read(id)` | Notification recipient | Row recipient must equal `auth.uid()` | Retain |
| `process_attendance_event(...)` | Employee owner; scoped manager/admin manual flow | Owner/scope check; employee owner must present approved device hash | Hardened locally; retain |
| `record_attendance_location(...)` | Employee Android client | Owner check through device validator; approved hash required | Hardened locally; retain |
| `record_location_ping(...)` | Legacy Android client | No internal authorization check was detected | **Revoke from authenticated** in phase 1 |
| `register_mobile_push_token(...)` | Signed-in user | Token is bound to `auth.uid()`/active organization | Retain |
| `request_overtime_explanation(...)` | Employee/authorized reviewer | Caller access to overtime record | Retain |
| `reset_employee_device(employee)` | Organization administrator | Administrator role in the employee organization | Hardened locally; retain |
| `resolve_employee_schedule(...)` | Employee owner or scoped manager/admin | Owner/scope check and bounded date range | Retain |
| `review_manual_attendance_request(...)` | Scoped manager/admin | Request organization/employee scope | Retain |
| `review_overtime_batch(json)` | Scoped manager/admin | Each decision is re-authorized server-side | Retain; batch tests pass |
| `review_overtime_record(...)` | Scoped manager/admin | Overtime row organization/employee scope | Retain; tests pass |
| `sync_offline_attendance_event(...)` legacy, no geofence | Employee owner | Owner/org check; cannot prove device | Retain temporarily; return review-required, never synced |
| `sync_offline_attendance_event(...)` legacy, geofence | Employee owner | Owner/org check; no device proof | Retain temporarily; delegate to hardened gate and return permanent failure |
| `unregister_mobile_push_token(token)` | Signed-in token owner | Deletes/revokes only caller-owned token | Retain |
| `update_attendance_policy(org, grace)` | Organization administrator | Admin role and numeric bounds | Retain |
| `upsert_phone_usage_summary(...)` | Employee Android client | Owner/org/approved-device/exact-shift/value/status checks | Hardened locally; retain |

Local hardening adds `review_employee_device_enrollment` (administrator only)
and `get_dashboard_trends` (scoped manager/administrator). Queue claim/completion
RPCs are service-role-only. Internal detector, reconciliation, retention, and
monitoring functions are not executable by `authenticated`.

The advisor warning is category-based: a callable definer function is not by
itself an exploit. It remains high-risk unless its grant, `search_path`, tenant
predicate, ownership/role check, input bounds, idempotency, and unauthorized
tests are all present. Re-run the advisor after staging migrations and compare
the exact callable set to this register.
