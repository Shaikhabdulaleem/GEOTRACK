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

> **Rotate the signing credentials before first production release.** The
> development keystore ships with a weak, well-known password. Because the app
> has not been distributed yet (versionCode 1), generate a fresh release
> keystore with a strong, vault-stored passphrase now — changing it after the
> first public/Play release is impossible without an app-signing key reset:
>
>     keytool -genkeypair -v -keystore release.keystore -alias geotrack \
>       -keyalg RSA -keysize 4096 -validity 10000
>
> Then update keystore.properties with the new store/key passwords (store the
> real values only in the secrets vault, never in git) and re-verify the signer
> certificate SHA-256 in the release gate below.

Release builds are minified and resource-shrunk (R8). Keep rules live in
app/proguard-rules.pro; after any dependency change, build a signed release and
complete the on-device smoke test in the release gate before distributing.

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

