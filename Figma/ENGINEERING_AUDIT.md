# GEOTRACK engineering audit

Date: 2026-09-27  
Scope: `src/`, `rls_policies.sql`, `package.json`, environment/template files, and the production build.

## Executive summary

The largest risks were attendance mutations trusted to the browser, broad/incomplete RLS policies, race-prone duplicate prevention, and calculations performed from client-controlled timestamps and IDs. Those paths are now centralized in transactional, `SECURITY DEFINER` RPCs with server-side authorization, geofence checks, idempotency, uniqueness constraints, and schedule-aware calculations. The frontend now calls those RPCs and no longer writes attendance, correction reviews, overtime reviews, or notification-read state directly.

The SQL hardening is present in `rls_policies.sql` but has **not been applied to a live Supabase project in this workspace**. Applying and smoke-testing it is the remaining release gate; until then, the new RPC-backed attendance path cannot be considered deployed.

## Prioritized issue list

### Critical

1. **Attendance forgery / cross-tenant mutation** — **fixed in code; deployment required**. The old client path accepted employee, organization, event time, and attendance values from the browser and performed multiple independent writes. `process_attendance_event` now requires the authenticated employee owner (manager/admin visibility cannot impersonate an employee), validates active employment and organization/branch scope, validates the server-side geofence, writes an audit event and attendance record atomically, and calculates work/overtime on the server. Direct table mutations are revoked in the SQL policy script.
2. **Broken object-level authorization and RLS coverage** — **fixed in policy script; deployment required**. The replacement policy set enables RLS on all application tables, scopes manager access to assigned employees/branches, limits employee self-access, removes unrestricted direct mutations, revokes `anon`, and grants only the authenticated RPC surface. It also adds cross-tenant reference checks and indexes used by policy predicates.
3. **Duplicate attendance race / replay** — **fixed in code and schema**. Event idempotency, employee/date/session uniqueness, and an advisory lock are enforced inside the attendance RPC; retries return the existing event instead of creating a second record.

### High

1. **Client-controlled geofence and time values** — **fixed in code; deployment required**. The RPC validates coordinates, accuracy, mock-location flag, active assignments/polygons, and derives timestamps from the database clock. Polygon containment supports holes and rejects invalid/low-accuracy locations. Browser geolocation remains inherently spoofable; native attestation is still required for a high-assurance anti-fraud product.
2. **Night-shift and overtime errors** — **fixed in code; deployment required**. Server logic handles crossing-midnight windows, branch/organization time zones, break deduction, schedule overlap, and overtime upsert/recalculation after approved corrections. Client-side time arithmetic in the deleted `timesheet.ts` path is gone.
3. **Review/notification authorization** — **fixed in code; deployment required**. Correction and overtime decisions now use authorization-checked RPCs with status-concurrency checks; notification reads are limited to the recipient. The correction notification recipient bug was removed.
4. **Unverified cached authentication state** — **fixed in code**. Auth boot now verifies the cached session with `supabase.auth.getUser()` and signs out locally when verification fails.
5. **Dashboard data accuracy** — **fixed in code**. Attendance batching now covers all employees, current-work counts exclude checked-out records, and shift assignments are batched instead of silently truncating at 100 employees.
6. **Policy screens falsely reported persistence** — **fixed in code**. Settings, alert-policy, and overtime-policy screens now identify draft-only values and disable save controls until backend policy storage exists. This avoids implying that security thresholds or overtime rules are active when they are not.
7. **Release/deployment integrity** — **open operational item**. The repository has a policy SQL file but no migration history/base schema in the project, and no live Supabase credentials were available for execution. Create a reviewed Supabase migration, apply it in staging, run the supplied Supabase smoke check, then promote it before production.

### Medium

1. Leave management is explicitly unintegrated/disabled and contains placeholder state; it should not be presented as an operational workflow until backed by tables/RPCs.
2. Dashboard trend, geofence summary, session, and leave widgets still return empty fallback arrays. These are no longer random/hardcoded, but the features are incomplete and should be labeled or implemented.
3. Reports and several dashboard/live views still use browser UTC date boundaries rather than the organization/branch timezone. This can shift events around midnight.
4. Some pages use broad `select('*')`, client-side aggregation, or sequential per-batch queries. Add server-side aggregate views/RPCs and pagination for larger organizations.
5. Error UX is inconsistent: a few flows still use `alert()`/`console.error` instead of the shared error surface and retry pattern.
6. Several form controls lack stable `id`/`htmlFor` associations, and a few icon-only controls needed explicit labels. The highest-impact modal/refresh controls were labeled; a full accessibility pass remains.
7. There is no automated unit/integration test suite in `package.json`. Add tests for RPC authorization, polygon holes/boundaries, duplicate retries, DST/cross-midnight shifts, and correction recalculation.
8. Client-side device usage ingestion is intentionally limited by RLS to the current user; an admin dashboard cannot backfill employee usage without a reviewed ingestion path.
9. Settings include device-registration and mock-location toggles, but no native device registration/attestation service exists. The UI now avoids claiming those controls are active.

### Low

1. The mobile-app view and random telemetry/avatar scaffolding were removed; empty typed mock stores remain only as configuration fallbacks for local preview.
2. Some unused imports/`any` casts remain in legacy views and should be cleaned during the next refactor.
3. The `configurationFallback` route prop is currently unused and can be removed or wired to a dedicated configuration screen.
4. Add a documented data-retention policy for location events, attendance audit events, and notification history.

## Verification performed

- TypeScript: `node_modules/.bin/tsc.CMD --noEmit` — passed.
- Production build: `pnpm run build` — passed; main entry chunk is about 261 KB (gzip about 82 KB), with route/chart chunks split; no oversized-chunk warning.
- Dependency audit: `pnpm audit --prod` — no known vulnerabilities.
- Pure geofence checks: inside/outside, polygon holes, closed rings, low accuracy, and mock-location rejection — passed.
- Secret/stale-mock scan: no service-role keys, secret keys, external avatar URLs, or random telemetry paths remain in production code.

## Release checklist

1. Review `rls_policies.sql` against the actual Supabase base schema and run it in staging.
2. Confirm the Data API grants and RPC signatures are present, then run `pnpm test:supabase` with a non-production `.env.local`.
3. Test employee, manager, and administrator accounts across organizations; verify direct table writes fail and authorized RPC calls succeed.
4. Add timezone/DST and native anti-spoof/device-attestation coverage before treating the system as high-assurance attendance software.
