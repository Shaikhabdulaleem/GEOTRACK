# GeoTrack Android audit

Date: 2026-09-28

## Verification

- `./gradlew testDebugUnitTest lintDebug assembleDebug --warning-mode all` — passed.
- Unit-test source sets are empty (`NO-SOURCE`); no automated employee, manager, admin, or instrumentation scenarios exist yet.
- Lint: 0 errors, 30 warnings. The remaining warnings are dependency-update notices, deprecations, locale formatting, Compose parameter ordering, missing app icon, backup metadata, and KTX/kapt modernization.
- An OSV batch check of the direct dependencies declared in `app/build.gradle.kts` returned no advisories for those exact coordinates/versions. This is not a substitute for a complete resolved-transitive SBOM scan.

## Critical/high findings fixed

1. **Critical — attendance always rejected by geofence validation.** Android sent `p_geofence_id = null` while the server RPC requires an explicit assigned geofence. The client now resolves an active assignment, persists it in the Room outbox, and the new `202609280006_offline_attendance_geofence.sql` RPC overload carries it through offline sync.
2. **High — session expiry left protected screens reachable.** Navigation now globally routes expired/unauthorized sessions to Login/Unauthorized and clears cached employee, schedule, attendance, geofence, notification, and pending-outbox data.
3. **High — background workers silently no-op after process death.** WorkManager workers now restore the persisted Supabase session and organization context before using repositories; offline sync explicitly marks events failed when the session is expired.
4. **High — geofence monitoring was never registered.** Cached geofence polygons are now converted to conservative circular triggers for Android monitoring; server polygon validation remains authoritative. Sign-out removes registered triggers.
5. **High — offline sync retried permanent auth/validation failures forever.** Only transport-loss failures return `Result.retry()`; connected permanent failures are recorded as `SYNC_FAILED`.
6. **High — organization timezone was ignored in employee date calculations.** Dashboard, schedule, attendance history, and geofence worker use the organization timezone, including overnight/next-day shifts.
7. **High — holiday could be overridden by a shift assignment.** Schedule precedence is now leave → holiday → temporary assignment → weekly off.
8. **High — admin summary returned a hard-coded exception count and omitted overtime approvals.** Summary now counts geofence exceptions and pending overtime.
9. **High — WorkManager eager initializer conflicted with custom `Configuration.Provider`.** The manifest now removes `androidx.work.WorkManagerInitializer`; lint is clean of errors.
10. **Medium/high UX — notification permission was requested before authentication and twice.** The pre-auth request was removed; the role shell requests it only after authentication. Background-location permission is now explicitly requestable from the attendance card.
11. **Medium — unused Supabase Realtime/Storage plugins increased surface area and exposed a known Realtime token-expiry crash path.** Both unused client plugins/dependencies were removed.

## Scenario coverage

| Area | Result |
|---|---|
| Working/off/leave/holiday | Schedule state and attendance gating implemented; holiday precedence fixed. |
| Day/night/overnight/next-day | Server RPC handles cross-midnight; client date/time calculations use org timezone. |
| Late arrival/early departure | Server calculates late/early minutes; UI exposes late/history and server remains authoritative. |
| Normal check-in/out | Explicit geofence assignment now reaches RPC; GPS/mock/accuracy checks remain enforced. |
| Outside geofence | Server rejects and records the event; client shows the exception. |
| GPS unavailable/permission denied | Device status blocks the action and offers permission/settings actions. |
| Offline | Room outbox + WorkManager sync; requires a previously synced geofence assignment. |
| Session expired | Global route protection, worker session bootstrap, and cache purge. |
| Manager visibility/team attendance | Server RLS is the boundary; manager repository consumes RLS-scoped rows. |
| Approvals/roster | Server RPCs/RLS exist; Android manager UI does not yet expose manual/overtime approval or roster-management screens. |
| Admin authorization | Role routing and server RLS exist; Android admin dashboard is summary-only, not a complete admin console. |

## Remaining release blockers / follow-up

- Add instrumented tests with seeded Supabase fixtures for every row in the requested matrix, including permission denial, process death, offline replay, and session expiry.
- Apply and smoke-test migrations `202609280001`–`202609280006` in a staging Supabase project; verify PostgREST overload resolution for `sync_offline_attendance_event`.
- Run a resolved-transitive dependency scanner (OSV/OWASP Dependency-Check) in CI and generate an SBOM. The exact direct-coordinate OSV query was clean, but transitive artifacts were not exhaustively scanned.
- Add the Android 12+ `dataExtractionRules`, a real application icon, and migrate `kotlinOptions`/Room kapt to modern compiler/KSP APIs.
- Implement Android manager approval and roster workflows, and complete admin mutations; these are product gaps, not hidden client authorization bypasses.
