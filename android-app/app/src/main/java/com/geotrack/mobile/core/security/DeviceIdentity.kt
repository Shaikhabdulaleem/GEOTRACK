package com.geotrack.mobile.core.security

import android.content.Context
import android.provider.Settings
import java.security.MessageDigest

/**
 * App-scoped, privacy-preserving device identifier used for server-side device
 * enrollment. This is an identifier, not an attestation signal: approval and
 * revocation remain server controlled.
 */
object DeviceIdentity {
    @Suppress("HardwareIds")
    fun hash(context: Context): String {
        val androidId = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ANDROID_ID,
        ) ?: "unknown"
        return MessageDigest.getInstance("SHA-256")
            .digest("geotrack-device:$androidId".toByteArray())
            .joinToString("") { "%02x".format(it) }
    }
}
