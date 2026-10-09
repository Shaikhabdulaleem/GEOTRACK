package com.geotrack.mobile.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.BackoffPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.time.Duration

/**
 * Fired by [AttendanceAlarmScheduler] at a reminder's scheduled instant. It
 * only wakes the device; the network resolve and suppression re-check happen in
 * [AttendanceReminderWorker], which this receiver enqueues.
 */
class AttendanceAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != AttendanceAlarmScheduler.ACTION_FIRE) return
        val type = intent.getStringExtra(AttendanceAlarmScheduler.EXTRA_TYPE) ?: return
        val date = intent.getStringExtra(AttendanceAlarmScheduler.EXTRA_DATE) ?: return

        val work = OneTimeWorkRequestBuilder<AttendanceReminderWorker>()
            .setInputData(workDataOf("type" to type, "date" to date))
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofSeconds(30))
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            "attendance-reminder-$type-$date",
            ExistingWorkPolicy.REPLACE,
            work,
        )
    }
}
