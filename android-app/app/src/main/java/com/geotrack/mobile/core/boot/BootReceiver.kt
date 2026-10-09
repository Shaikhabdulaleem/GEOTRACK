package com.geotrack.mobile.core.boot

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.geotrack.mobile.cache.WorkforceCacheScheduler
import com.geotrack.mobile.location.AutoAttendanceScheduler
import com.geotrack.mobile.location.GeofenceDiagnostics
import com.geotrack.mobile.location.LocationHeartbeatScheduler
import com.geotrack.mobile.notifications.AttendanceRefreshWorker

/**
 * Android drops registered geofences and all AlarmManager alarms on reboot, and
 * a package update clears scheduled work. This receiver re-establishes the
 * automatic-attendance pipeline so monitoring and reminders survive both.
 *
 * Every re-enqueued worker restores the session itself and no-ops when the
 * device is signed out, so this is safe to run unconditionally on boot.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_LOCKED_BOOT_COMPLETED,
            "android.intent.action.QUICKBOOT_POWERON",
            Intent.ACTION_MY_PACKAGE_REPLACED,
            -> Unit
            else -> return
        }

        runCatching { GeofenceDiagnostics.from(context) }
            .getOrNull()
            ?.record(GeofenceDiagnostics.Stage.REGISTRATION, ok = true, message = "Reconciling after ${intent.action?.substringAfterLast('.')}.")

        // Re-registers geofences from the cached assignments.
        WorkforceCacheScheduler.enqueue(context)
        // Re-establishes the in-shift reconciliation and breach heartbeat.
        AutoAttendanceScheduler.enqueue(context)
        LocationHeartbeatScheduler.enqueue(context)
        // Re-arms the exact reminder alarms for the upcoming horizon.
        WorkManager.getInstance(context).enqueueUniqueWork(
            "attendance-refresh-now",
            ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<AttendanceRefreshWorker>().build(),
        )
    }
}
