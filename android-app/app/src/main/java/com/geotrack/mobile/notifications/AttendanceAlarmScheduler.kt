package com.geotrack.mobile.notifications

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.LocalDate
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Delivers time-critical attendance reminders via [AlarmManager] rather than a
 * delayed WorkManager job.
 *
 * Why: WorkManager's `setInitialDelay` makes no delivery-time guarantee — Doze
 * can defer a job for many minutes — which is wrong for a "15 minutes before
 * your shift" alert. An exact alarm wakes the device at (or very near) the
 * requested instant; the alarm then enqueues [AttendanceReminderWorker], which
 * does the network resolve and re-checks suppression before posting.
 *
 * Honesty about timing: exact delivery requires the user's permission on
 * Android 12+ ([AlarmManager.canScheduleExactAlarms]). When it is not granted
 * we fall back to [AlarmManager.setAndAllowWhileIdle], which is only
 * approximate — the setup guidance surfaces the missing permission so the user
 * can enable precise delivery.
 */
@Singleton
class AttendanceAlarmScheduler @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val alarmManager = context.getSystemService(AlarmManager::class.java)
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun canScheduleExact(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            alarmManager?.canScheduleExactAlarms() == true
        } else {
            true
        }

    /** Replaces all previously scheduled reminder alarms with [plans]. */
    @Synchronized
    fun schedule(plans: List<ScheduledNotification>) {
        cancelAll()
        val mgr = alarmManager ?: return
        val keys = mutableSetOf<String>()
        plans.forEach { plan ->
            val key = keyFor(plan.type, plan.workDate)
            keys += key
            val pending = pendingIntent(plan.type, plan.workDate, create = true) ?: return@forEach
            val triggerAt = plan.at.toEpochMilli()
            runCatching {
                if (canScheduleExact()) {
                    mgr.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending)
                } else {
                    mgr.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending)
                }
            }.onFailure {
                // SecurityException when exact permission is revoked between the
                // check and the call — downgrade to an inexact alarm.
                Log.w(TAG, "Exact alarm denied, using inexact: ${it.message}")
                runCatching { mgr.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending) }
            }
        }
        prefs.edit().putStringSet(KEY_SCHEDULED, keys).apply()
    }

    @Synchronized
    fun cancelAll() {
        val mgr = alarmManager ?: return
        val existing = prefs.getStringSet(KEY_SCHEDULED, emptySet()).orEmpty()
        existing.forEach { key ->
            val (type, date) = parseKey(key) ?: return@forEach
            pendingIntent(type, date, create = false)?.let { mgr.cancel(it) }
        }
        prefs.edit().remove(KEY_SCHEDULED).apply()
    }

    private fun pendingIntent(
        type: AttendanceNotificationType,
        date: LocalDate,
        create: Boolean,
    ): PendingIntent? {
        val intent = Intent(context, AttendanceAlarmReceiver::class.java).apply {
            action = ACTION_FIRE
            putExtra(EXTRA_TYPE, type.name)
            putExtra(EXTRA_DATE, date.toString())
        }
        val flags = (if (create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE) or
            PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getBroadcast(context, requestCode(type, date), intent, flags)
    }

    private fun requestCode(type: AttendanceNotificationType, date: LocalDate): Int =
        keyFor(type, date).hashCode()

    private fun keyFor(type: AttendanceNotificationType, date: LocalDate): String = "${type.name}|$date"

    private fun parseKey(key: String): Pair<AttendanceNotificationType, LocalDate>? {
        val parts = key.split("|")
        if (parts.size != 2) return null
        val type = runCatching { AttendanceNotificationType.valueOf(parts[0]) }.getOrNull() ?: return null
        val date = runCatching { LocalDate.parse(parts[1]) }.getOrNull() ?: return null
        return type to date
    }

    companion object {
        const val ACTION_FIRE = "com.geotrack.mobile.ATTENDANCE_REMINDER"
        const val EXTRA_TYPE = "type"
        const val EXTRA_DATE = "date"
        private const val TAG = "GeoTrackAlarm"
        private const val PREFS = "attendance-alarms"
        private const val KEY_SCHEDULED = "scheduled"
    }
}
