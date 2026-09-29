# GeoTrack Android

Native Android foundation for the GeoTrack workforce-management application.

The project uses Kotlin, Jetpack Compose, Material 3, MVVM, Clean Architecture, Hilt, Coroutines/Flow, Room, and the Supabase Kotlin SDK. Feature screens and domain workflows will be added in later phases.

## Configuration

The APK never contains a Supabase service-role key. Configure only the client-safe URL and publishable/anon key through ignored `local.properties`, Gradle properties, or environment variables (in that precedence order: Gradle property, environment, local file):

```powershell
$env:SUPABASE_URL = "https://your-project.supabase.co"
$env:SUPABASE_ANON_KEY = "your-client-safe-key"
```

Alternatively pass them as Gradle properties:

```powershell
./gradlew assembleDebug -PSUPABASE_URL="https://your-project.supabase.co" -PSUPABASE_ANON_KEY="your-client-safe-key"
```

For FCM, also provide the client-safe Firebase values at build time:
`FIREBASE_PROJECT_ID`, `FIREBASE_APPLICATION_ID`, `FIREBASE_API_KEY`, and
`FIREBASE_SENDER_ID` (Gradle properties or environment variables). Firebase
service-account credentials are never part of the Android build.

`local.properties` is reserved for the local Android SDK path and is ignored by Git. See `local.properties.example`.

## Build

From this directory:

```powershell
./gradlew assembleDebug
```

The debug APK is generated at:

```text
app/build/outputs/apk/debug/app-debug.apk
```

If client-safe Supabase values are not configured, the foundation still builds and displays a configuration state at runtime.

The employee Overtime screen reads server-generated `overtime_records` and uses
the repository-root `supabase/migrations/20260928200448_employee_overtime_explanation.sql`
RPC for explanation-only
requests. Apply the migration before enabling the explanation action; calculated
and approved minutes remain database-owned.

Phone usage uses Android `UsageStatsManager` foreground events only after the
employee explicitly enables Usage Access in Android Settings. If access is not
enabled, the app records a permission-not-granted state and never invents usage
data. Apply `20260928200454_phone_usage_shift_metrics.sql` before enabling phone
usage synchronization; it adds shift duration, overlap percentage, sync time,
and the owner-checked summary RPC.

Manager Home loads only the employees permitted by the signed-in manager's
direct assignment or `manager_scopes`. Apply
the repository-root migration history before enabling manager access; the
canonical server-side RLS scopes employees, attendance, shifts, weekly offs,
overtime, productivity, phone usage, and recipient notifications.

Offline attendance uses the Room outbox and displays `Synced`, `Pending Sync`,
or `Sync Failed`. Offline events retain a local event ID, employee ID, device
timestamp, original event time, GPS, mock-location flag, assigned geofence ID,
and pending geofence validation. `20260928200503_offline_attendance_outbox.sql`
plus `20260928200508_offline_attendance_geofence.sql` add the authenticated,
idempotent server RPC overload; the server validates the event and geofence
before an authoritative attendance record is accepted. Apply both migrations
before enabling offline attendance synchronization.

## Notifications

The Android client schedules shift reminders locally from the employee's current
schedule. It registers FCM tokens through the `mobile_push_tokens` migration.
Schedule-change rows are dispatched by the `supabase/functions/send-mobile-notification`
edge function as FCM data messages containing only `notification_id`; the client
then reads the authorized notification row before displaying it.

Deploy the function with these server-only secrets (never put them in the APK or
the web bundle): `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and
`FIREBASE_PRIVATE_KEY`. The function also uses Supabase's automatically
available `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS`, and
`SUPABASE_SECRET_KEYS` environment variables. Legacy `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` remain supported as fallbacks.
