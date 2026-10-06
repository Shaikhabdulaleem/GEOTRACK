# GEOTRACK go-live plan

Owner: _______________  Target launch: _______________  Last updated: 2026-10-06

This plan covers the remaining release blockers. Items are marked:
**[CODE: done]** fixed in this repo · **[YOU]** requires your live environment,
secrets, or a decision I cannot make for you.

---

## 1. Deploy & verify the database — **[YOU]** (highest priority)

The hardened RLS/RPC schema and all migrations must be applied to the production
Supabase project and smoke-tested. Until this is done, the secure attendance
path is not live. One migration (`request_employee_invitation`) previously had a
column/value mismatch that would fail `plpgsql` validation on apply — **[CODE:
done]** fixed, so the set now applies cleanly.

```bash
# Install the CLI, then from the repo root:
supabase login
supabase link --project-ref gaixauomldxecknkkejl
supabase db push                 # applies supabase/migrations in order
supabase functions deploy provision-employee
supabase functions deploy send-mobile-notification
```

Set Edge Function secrets (never in client config):
```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... \
  FIREBASE_CLIENT_EMAIL=... FIREBASE_PRIVATE_KEY=...
```

Verification checklist after push:
- [ ] `supabase migration list` shows every migration applied, no drift.
- [ ] Supabase **Security Advisor** and **Performance Advisor** are clean.
- [ ] `resolve_login_email` no longer exists; no seeded auth credentials exist.
- [ ] Auth settings in the dashboard match `config.toml`: **signup disabled**,
      email rate limit raised, SMTP (SendGrid) configured and sending.
- [ ] `provision-employee` has `verify_jwt = true` and rejects anonymous calls.
- [ ] Run the SQL tests against a staging copy (CI does this automatically now —
      see §4): `rls_smoke`, `recurring_schedule_resolver`, `e2e_workflow`.
- [ ] Manual smoke: invite an employee → set password on web → log in on Android
      → check-in inside geofence (valid), outside (rejected), mock location
      (rejected), low accuracy (rejected), offline then sync, session expiry.

---

## 2. First admin bootstrap — **[CODE: done]** / **[YOU]** to run once

`supabase/bootstrap/first_admin.sql.example` was fixed (clean placeholders, a
run-time IANA-timezone check, apostrophe-escaping guidance). To use it:
1. Create the admin user in Supabase Auth (dashboard or invite).
2. Copy the example, replace the four placeholders (timezone must be IANA, e.g.
   `Asia/Riyadh` — not an AWS region), run it once in the SQL editor.
3. All further accounts go through the in-app admin provisioning flow.

---

## 3. Employee onboarding workflow — **[YOU]** (document & communicate)

Current flow is two-surface and must be written down for field/mailroom staff:
1. Admin provisions an employee (sends an email invitation via the Edge Function).
2. Employee opens the **web** app link, sets a password.
3. Employee logs into the **Android** app with work email + password.

- Password reset from Android also routes to the web app (`/reset-password`).
- Optional improvement: add an Android deep link to `additional_redirect_urls`
  so invites/resets can complete in-app. Not required for launch.
- Confirm SendGrid deliverability (SPF/DKIM) and that the raised email rate
  limit covers your onboarding batch size.

---

## 4. Automated tests in CI — **[CODE: done]** / **[YOU]** to extend

- CI now has a **database** job that boots a local Supabase stack, applies all
  migrations, and runs the three transactional SQL tests (RLS isolation,
  recurring-schedule resolver, end-to-end workflow). A failing migration or a
  broken RPC authorization now breaks the build.
- Still recommended before heavy reliance: Android instrumented tests and web
  unit tests for geofence polygon holes/boundaries, duplicate-retry idempotency,
  DST/overnight shift math, and offline replay. These are additive, not launch
  blockers once §1 smoke tests pass.

---

## 5. Data retention / PDPL minimization — **[CODE: done]** / **[YOU]** to enable

- Migration `20261006000000_data_retention.sql` adds
  `private.enforce_data_retention()`: redacts precise location + device details
  from attendance audit events after 180 days (keeps the validation outcome),
  purges notifications and phone-usage after 365 days.
- It tries to self-schedule via pg_cron and no-ops if pg_cron is unavailable.
  **[YOU]**: enable pg_cron (Dashboard → Database → Extensions) if it isn't, then
  confirm the `geotrack-data-retention` job exists:
  ```sql
  select * from cron.job where jobname = 'geotrack-data-retention';
  -- adjust windows if legal/HR require different periods:
  -- select private.enforce_data_retention(90, 180, 180);
  ```
- Confirm the windows match the approved schedule in the employee privacy notice.

---

## 6. Backups, monitoring, operations — **[YOU]**

Fill the register in `docs/OPERATIONS_REGISTER.md`. Concretely:
- [ ] Enable production DB backups + **Point-in-Time Recovery**; record retention.
- [ ] Run one restore drill into an isolated project; record the result.
- [ ] Alerts on: sustained 5xx, repeated 401/403 spikes, Edge Function failures,
      failed migrations, DB saturation (see `docs/PRODUCTION_OPERATIONS.md`).
- [ ] Set and rotate secrets: `SMTP_USER`/`SMTP_PASS`, Firebase service account.
- [ ] Restrict the Firebase Android API key and Mapbox token to your app/referrers.
- [ ] Define Sev-1/2/3 owners and the PDPL breach procedure.

---

## 7. Android release signing — **[YOU]** (safety-gated, must run locally)

The dev keystore uses a weak, well-known password. Because the app has not
shipped (versionCode 1), rotate the signing key now — it is effectively
impossible after the first public release. Full command and gate are in
`android-app/RELEASE.md`. Summary:
```bash
cd android-app
cp release.keystore release.keystore.weak-backup
keytool -genkeypair -v -keystore release.keystore -alias geotrack \
  -keyalg RSA -keysize 4096 -validity 10000
# update keystore.properties with the new strong passwords (vault them)
```

---

## 8. R8 / minified release build — **[CODE: done]** / **[YOU]** to validate

- Release builds now enable R8 minify + resource shrink, with keep rules in
  `android-app/app/proguard-rules.pro` for kotlinx.serialization, Supabase/Ktor,
  Hilt, Room and FCM.
- **[YOU]**: build a **signed** release and smoke-test on a device — R8 can strip
  reflection/serialization paths that only surface at runtime:
  ```bash
  cd android-app && ./gradlew :app:assembleRelease
  ```
  Verify login, attendance check-in/out, offline sync, and push all work. If a
  model fails to (de)serialize, add a keep rule for it and rebuild.

---

## 9. Location anti-spoofing — **[YOU]** (risk decision)

The server already rejects `is_mock_location`, enforces accuracy thresholds, and
validates geofence containment server-side. But consumer GPS + the Android mock
flag are defeatable on rooted/modified devices, and there is **no device
attestation**. Decide before launch:
- **Accept the residual risk** for the initial rollout (document it, monitor the
  `mock_location`/`invalid` validation rates, and treat spoofing as a
  disciplinary matter), **or**
- **Add Google Play Integrity API** (+ device registration) before launch. This
  needs a Play Console + Google Cloud project and app-side integration; it is a
  feature project, not a config change. Recommended if attendance drives pay and
  the workforce has incentive and capability to spoof.

Recommendation: launch the pilot with the risk accepted + monitoring, and
schedule Play Integrity as a fast follow if spoofing appears in the data.

---

## 10. Product completeness — **[YOU]** (scope/label)

Leave management is disabled/placeholder; Android manager approval + roster and
full admin mutations do not exist (summary-only). Ensure the UI labels these as
unavailable so staff don't rely on non-functional workflows, or complete them
before depending on them.
