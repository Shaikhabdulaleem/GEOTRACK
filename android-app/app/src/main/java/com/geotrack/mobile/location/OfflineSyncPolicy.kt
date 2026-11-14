package com.geotrack.mobile.location

import kotlin.math.min

internal object OfflineSyncPolicy {
    const val MAX_RETRIES = 8
    private const val BASE_DELAY_MILLIS = 30_000L
    private const val MAX_DELAY_MILLIS = 6 * 60 * 60 * 1_000L

    enum class Disposition {
        SYNCED,
        RETRYABLE,
        REAUTHENTICATION,
        REVIEW_REQUIRED,
        PERMANENT,
    }

    fun classify(
        status: String?,
        outcome: String?,
        failureClass: String?,
        retryable: Boolean?,
    ): Disposition {
        if (failureClass == "reauthentication") return Disposition.REAUTHENTICATION
        if (failureClass == "review_required") return Disposition.REVIEW_REQUIRED
        if (failureClass == "permanent") return Disposition.PERMANENT
        if (failureClass == "retryable" || retryable == true) return Disposition.RETRYABLE

        val value = outcome ?: status
        return when (value) {
            "device_blocked" -> Disposition.REVIEW_REQUIRED
            "rejected", "error", "failed" -> Disposition.PERMANENT
            "SYNC_FAILED", null, "" -> Disposition.RETRYABLE
            else -> Disposition.SYNCED
        }
    }

    fun nextAttemptAt(nowEpochMillis: Long, retryCount: Int): Long {
        val exponent = (retryCount - 1).coerceIn(0, 20)
        val delay = min(MAX_DELAY_MILLIS, BASE_DELAY_MILLIS * (1L shl exponent))
        return nowEpochMillis + delay
    }
}
