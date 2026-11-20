package com.geotrack.mobile.location

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OfflineSyncPolicyTest {
    @Test
    fun `permanent rejection is never classified for retry`() {
        assertEquals(
            OfflineSyncPolicy.Disposition.PERMANENT,
            OfflineSyncPolicy.classify("SYNC_FAILED", "rejected", "permanent", false),
        )
    }

    @Test
    fun `device approval requirement remains visible for review`() {
        assertEquals(
            OfflineSyncPolicy.Disposition.REVIEW_REQUIRED,
            OfflineSyncPolicy.classify("SYNC_FAILED", "device_blocked", "review_required", false),
        )
    }

    @Test
    fun `transport failure uses bounded exponential delay`() {
        val now = 1_000_000L
        val first = OfflineSyncPolicy.nextAttemptAt(now, 1) - now
        val later = OfflineSyncPolicy.nextAttemptAt(now, 8) - now
        assertEquals(30_000L, first)
        assertTrue(later > first)
        assertTrue(later <= 6 * 60 * 60 * 1_000L)
    }

    @Test
    fun `successful duplicate replay is treated as synced`() {
        assertEquals(
            OfflineSyncPolicy.Disposition.SYNCED,
            OfflineSyncPolicy.classify("duplicate", null, null, false),
        )
    }
}
