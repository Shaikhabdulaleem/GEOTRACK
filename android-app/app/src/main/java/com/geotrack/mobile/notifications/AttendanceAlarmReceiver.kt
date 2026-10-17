package com.geotrack.mobile.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.geotrack.mobile.location.AutoAttendanceWorker
import com.geotrack.mobile.location.LocationHeartbeatWorker
import java.time.Duration

/**
 * Fired by [AttendanceAlarmScheduler] at a reminder's scheduled instant.
 *
 * The exact alarm is the one wake-up Doze can't defer, so besides posting the
 * reminder notification ([AttendanceReminderWorker]) we use it to drive the
 * actual attendance reconciliation that the 15-minute periodic workers would
 * otherwise run late (or skip) overnight:
 *  - at/just-after shift start -> [AutoAttendanceWorker] attempts the auto check-in;
 *  - around/after shift end     -> [LocationHeartbeatWorker] posts a fresh presence
 *    ping so the server sees the current position and can close the session
 *    (at the exit, or back-dated to last-seen if the phone then goes quiet).
 */
class AttendanceAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != AttendanceAlarmScheduler.ACTION_FIRE) return
        val type = intent.getStringExtra(AttendanceAlarmScheduler.EXTRA_TYPE) ?: return
        val date = intent.getStringExtra(AttendanceAlarmScheduler.EXTRA_DATE) ?: return

        val wm = WorkManager.getInstance(context)
        val reminder = OneTimeWorkRequestBuilder<AttendanceReminderWorker>()
            .setInputData(workDataOf("type" to type, "date" to date))
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofSeconds(30))
            .build()
        wm.enqueueUniqueWork("attendance-reminder-$type-$date", ExistingWorkPolicy.REPLACE, reminder)

        when (type) {
            AttendanceNotificationType.SHIFT_START.name,
            AttendanceNotificationType.NOT_CHECKED_IN.name ->
                wm.enqueueUniqueWork(
                    "auto-attendance-alarm", ExistingWorkPolicy.REPLACE,
                    reconcile<AutoAttendanceWorker>(),
                )
            AttendanceNotificationType.SHIFT_ENDING.name,
            AttendanceNotificationType.FORGOT_CHECKOUT.name ->
                wm.enqueueUniqueWork(
                    "location-heartbeat-alarm", ExistingWorkPolicy.REPLACE,
                    reconcile<LocationHeartbeatWorker>(),
                )
        }
    }

    private inline fun <reified W : androidx.work.ListenableWorker> reconcile(): OneTimeWorkRequest =
        OneTimeWorkRequestBuilder<W>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofSeconds(30))
            .build()
}
