package com.geotrack.mobile.phoneusage

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Process
import android.provider.Settings
import com.geotrack.mobile.domain.model.PhoneUsageDataStatus
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.Duration
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AndroidPhoneUsageReader @Inject constructor(
    @ApplicationContext private val context: Context,
) : PhoneUsageReader {
    private val usageStats: UsageStatsManager? = context.getSystemService(UsageStatsManager::class.java)

    override fun hasUsageAccess(): Boolean {
        val appOps = context.getSystemService(AppOpsManager::class.java)
        return appOps.checkOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS,
            Process.myUid(),
            context.packageName,
        ) == AppOpsManager.MODE_ALLOWED
    }

    override fun usageAccessSettingsIntent(): Intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)

    override fun measure(shiftStart: Instant, shiftEnd: Instant): PhoneUsageMeasurement {
        if (!hasUsageAccess()) return PhoneUsageMeasurement(PhoneUsageDataStatus.PERMISSION_NOT_GRANTED, null)
        val now = Instant.now()
        val end = minOf(shiftEnd, now)
        if (!end.isAfter(shiftStart)) return PhoneUsageMeasurement(PhoneUsageDataStatus.NO_DATA, null)
        val manager = usageStats ?: return PhoneUsageMeasurement(PhoneUsageDataStatus.NO_DATA, null)

        // UsageEvents gives foreground transitions without exposing package names
        // outside this process. Only the union of active foreground intervals is kept.
        val events = manager.queryEvents(shiftStart.toEpochMilli(), end.toEpochMilli())
        val activePackages = mutableSetOf<String>()
        var activeWindowStart: Long? = null
        var totalMillis = 0L
        var sawEvent = false
        var malformedTransition = false
        val event = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            sawEvent = true
            val timestamp = event.timeStamp.coerceIn(shiftStart.toEpochMilli(), end.toEpochMilli())
            if (isForeground(event.eventType)) {
                if (activePackages.add(event.packageName) && activePackages.size == 1) activeWindowStart = timestamp
            } else if (isBackground(event.eventType)) {
                if (!activePackages.remove(event.packageName)) {
                    malformedTransition = true
                } else if (activePackages.isEmpty()) {
                    activeWindowStart?.let { totalMillis += (timestamp - it).coerceAtLeast(0) }
                    activeWindowStart = null
                }
            }
        }
        if (activePackages.isNotEmpty()) {
            activeWindowStart?.let { totalMillis += (end.toEpochMilli() - it).coerceAtLeast(0) }
        }
        if (!sawEvent || totalMillis <= 0) return PhoneUsageMeasurement(PhoneUsageDataStatus.NO_DATA, null)

        val partial = malformedTransition || activePackages.isNotEmpty() || end < shiftEnd
        return PhoneUsageMeasurement(
            if (partial) PhoneUsageDataStatus.PARTIAL_DATA else PhoneUsageDataStatus.PERMISSION_GRANTED,
            Duration.ofMillis(totalMillis).toMinutes().toInt().coerceAtLeast(0),
        )
    }

    private fun isForeground(type: Int): Boolean =
        type == UsageEvents.Event.MOVE_TO_FOREGROUND ||
            (Build.VERSION.SDK_INT >= 29 && type == UsageEvents.Event.ACTIVITY_RESUMED)

    private fun isBackground(type: Int): Boolean =
        type == UsageEvents.Event.MOVE_TO_BACKGROUND ||
            (Build.VERSION.SDK_INT >= 29 && type == UsageEvents.Event.ACTIVITY_PAUSED)
}
