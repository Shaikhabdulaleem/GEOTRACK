# Android release and update procedure

## Version policy

- Increment versionCode for every distributed APK. It must never decrease.
- Use versionName in semantic form (major.minor.patch).
- Patch: fixes only; minor: backward-compatible features; major: incompatible
  behavior, policy or data-model changes.
- Tag the source used for a production artifact as android-v<versionName>.

## Build

Keep release.keystore and keystore.properties outside source control and back
them up in the approved secrets vault. Losing the signing key prevents trusted
updates to the installed application.

From android-app:

    .\gradlew.bat clean assembleRelease

The signed APK is generated at
app/build/outputs/apk/release/app-release.apk.

## Release gate

1. Run unit/lint checks and the production web/database smoke tests.
2. Verify the APK signature with the Android SDK apksigner verify
   --verbose --print-certs command.
3. Record versionCode, versionName, Git commit, SHA-256, signer certificate
   SHA-256, build date and approver.
4. Install as an update over the previous production version on a physical
   test phone; confirm app data/session behavior.
5. Test login, permissions, foreground/background location, geofence
   entry/exit, offline attendance replay and FCM receipt.
6. Roll out to a pilot group before broad distribution. Retain the previous
   signed APK and rollback instructions.

## Update behavior

Android accepts an in-place update only when the application ID and signing
certificate match and the new versionCode is higher. Never distribute debug
builds as production updates. If an emergency rollback is required, ship a
newly built, higher-versionCode release containing the prior known-good code.

