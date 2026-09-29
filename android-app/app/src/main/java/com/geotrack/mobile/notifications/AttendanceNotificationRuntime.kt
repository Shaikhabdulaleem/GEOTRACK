package com.geotrack.mobile.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.hilt.work.HiltWorker
import androidx.work.*
import com.geotrack.mobile.R
import com.geotrack.mobile.BuildConfig
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.geotrack.mobile.phoneusage.PhoneUsageScheduler
import com.geotrack.mobile.location.OfflineAttendanceSyncScheduler
import com.geotrack.mobile.location.GeofenceManager
import com.geotrack.mobile.core.session.WorkerSessionBootstrapper
import com.geotrack.mobile.data.remote.supabase.SupabaseClientHolder
import io.github.jan.supabase.auth.auth
import com.geotrack.mobile.cache.WorkforceCacheScheduler
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.tasks.await
import java.time.Instant
import java.time.LocalDate
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

object AttendanceChannels {
    const val REMINDERS = "attendance_reminders"; const val STATUS = "attendance_status"; const val SCHEDULE = "schedule_changes"
    fun create(context: Context) { val manager = context.getSystemService(NotificationManager::class.java); manager.createNotificationChannels(listOf(NotificationChannel(REMINDERS, "Attendance reminders", NotificationManager.IMPORTANCE_HIGH), NotificationChannel(STATUS, "Attendance status", NotificationManager.IMPORTANCE_DEFAULT), NotificationChannel(SCHEDULE, "Schedule changes", NotificationManager.IMPORTANCE_DEFAULT))) }
}

@Singleton
class AttendanceNotificationPoster @Inject constructor(@ApplicationContext private val context: Context) {
    fun post(n: AttendanceNotification) { if (android.os.Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return; AttendanceChannels.create(context); val channel = if (n.type in setOf(AttendanceNotificationType.ATTENDANCE_RECORDED, AttendanceNotificationType.OUTSIDE_GEOFENCE)) AttendanceChannels.STATUS else if (n.type in setOf(AttendanceNotificationType.SHIFT_CHANGED, AttendanceNotificationType.WEEKLY_OFF_CHANGED)) AttendanceChannels.SCHEDULE else AttendanceChannels.REMINDERS; NotificationManagerCompat.from(context).notify((n.id ?: n.type.name).hashCode(), NotificationCompat.Builder(context, channel).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(n.title).setContentText(n.body).setAutoCancel(true).build()) }
}

@Singleton
class AndroidAttendanceNotificationCoordinator @Inject constructor(@ApplicationContext private val context: Context, private val poster: AttendanceNotificationPoster, private val phoneUsageScheduler: PhoneUsageScheduler, private val geofenceManager: GeofenceManager) : NotificationCoordinator {
    private val _state = MutableStateFlow(PushRegistrationState(false, false)); override val registrationState = _state.asStateFlow()
    override fun onAuthenticated() { AttendanceChannels.create(context); WorkManager.getInstance(context).enqueueUniqueWork("attendance-refresh-now", ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<AttendanceRefreshWorker>().build()); WorkManager.getInstance(context).enqueueUniquePeriodicWork("attendance-refresh", ExistingPeriodicWorkPolicy.UPDATE, PeriodicWorkRequestBuilder<AttendanceRefreshWorker>(12, TimeUnit.HOURS).build()); FirebaseConfig.ensure(context); if (FirebaseConfig.isConfigured(context)) WorkManager.getInstance(context).enqueueUniqueWork("push-token", ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<PushTokenWorker>().build()); phoneUsageScheduler.onAuthenticated(); OfflineAttendanceSyncScheduler.enqueue(context); WorkforceCacheScheduler.enqueue(context) }
    override fun onSignedOut() {
        WorkManager.getInstance(context).apply {
            cancelUniqueWork("attendance-refresh-now")
            cancelUniqueWork("attendance-refresh")
            OfflineAttendanceSyncScheduler.cancel(context)
            WorkforceCacheScheduler.cancel(context)
            cancelUniqueWork("push-token")
            cancelAllWorkByTag("attendance-reminder")
        }
        phoneUsageScheduler.onSignedOut()
        runCatching { geofenceManager.removeGeofences() }
        _state.value = PushRegistrationState(false, FirebaseConfig.isConfigured(context))
    }
    override fun showAttendanceRecorded() = poster.post(AttendanceNotification(type = AttendanceNotificationType.ATTENDANCE_RECORDED, title = "Attendance", body = "Attendance recorded successfully."))
    override fun showOutsideGeofence() = poster.post(AttendanceNotification(type = AttendanceNotificationType.OUTSIDE_GEOFENCE, title = "Attendance", body = "You are outside the assigned geofence."))
}

object FirebaseConfig {
    private fun hasClientSettings() =
        BuildConfig.FIREBASE_PROJECT_ID.isNotBlank() &&
            BuildConfig.FIREBASE_APPLICATION_ID.isNotBlank() &&
            BuildConfig.FIREBASE_API_KEY.isNotBlank() &&
            BuildConfig.FIREBASE_SENDER_ID.isNotBlank()

    fun isConfigured(context: Context) = hasClientSettings() && FirebaseApp.getApps(context).isNotEmpty()
    @Synchronized
    fun ensure(context: Context) {
        if (!hasClientSettings() || FirebaseApp.getApps(context).isNotEmpty()) return
        runCatching {
            FirebaseApp.initializeApp(
                context,
                FirebaseOptions.Builder()
                    .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                    .setApplicationId(BuildConfig.FIREBASE_APPLICATION_ID)
                    .setApiKey(BuildConfig.FIREBASE_API_KEY)
                    .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                    .build(),
            )
        }
    }
}

@HiltWorker class AttendanceRefreshWorker @AssistedInject constructor(@Assisted appContext: Context, @Assisted params: WorkerParameters, private val repo: AttendanceNotificationRepository, private val sessionBootstrapper: WorkerSessionBootstrapper) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result { sessionBootstrapper.restore() ?: return Result.success(); val plans = (repo.plans() as? com.geotrack.mobile.core.common.AppResult.Success)?.value ?: return Result.retry(); val wm = WorkManager.getInstance(applicationContext); wm.cancelAllWorkByTag("attendance-reminder"); plans.forEach { plan -> val delay = (plan.at.toEpochMilli() - Instant.now().toEpochMilli()).coerceAtLeast(0); wm.enqueue(OneTimeWorkRequestBuilder<AttendanceReminderWorker>().setInitialDelay(delay, TimeUnit.MILLISECONDS).addTag("attendance-reminder").setInputData(workDataOf("type" to plan.type.name, "date" to plan.workDate.toString())).build()) }; return Result.success() }
}

@HiltWorker class AttendanceReminderWorker @AssistedInject constructor(@Assisted appContext: Context, @Assisted params: WorkerParameters, private val repo: AttendanceNotificationRepository, private val poster: AttendanceNotificationPoster) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result { val type = runCatching { AttendanceNotificationType.valueOf(inputData.getString("type") ?: return Result.failure()) }.getOrNull() ?: return Result.failure(); val date = runCatching { LocalDate.parse(inputData.getString("date")) }.getOrNull() ?: return Result.failure(); when (val result = repo.resolve(type, date)) { is com.geotrack.mobile.core.common.AppResult.Success -> result.value?.let(poster::post); is com.geotrack.mobile.core.common.AppResult.Failure -> return Result.retry() }; return Result.success() }
}

@HiltWorker class PushTokenWorker @AssistedInject constructor(@Assisted appContext: Context, @Assisted params: WorkerParameters, private val repo: AttendanceNotificationRepository, private val sessionBootstrapper: WorkerSessionBootstrapper) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result { return try { if (sessionBootstrapper.restore() == null) return Result.success(); FirebaseConfig.ensure(applicationContext); val token = FirebaseMessaging.getInstance().token.await(); when (repo.registerPushToken(token)) { is com.geotrack.mobile.core.common.AppResult.Success -> Result.success(); else -> Result.retry() } } catch (_: Exception) { Result.retry() } }
}

@HiltWorker class FcmNotificationWorker @AssistedInject constructor(@Assisted appContext: Context, @Assisted params: WorkerParameters, private val repo: AttendanceNotificationRepository, private val poster: AttendanceNotificationPoster, private val clientHolder: SupabaseClientHolder) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val id = inputData.getString("notification_id") ?: return Result.failure()
        clientHolder.client?.auth?.awaitInitialization()
        return when (val n = repo.resolveServerNotification(id)) {
            is com.geotrack.mobile.core.common.AppResult.Success -> {
                n.value?.let { notification ->
                    poster.post(notification)
                    // A schedule mutation can invalidate already queued local reminders.
                    if (notification.type in setOf(
                            AttendanceNotificationType.SHIFT_CHANGED,
                            AttendanceNotificationType.WEEKLY_OFF_CHANGED,
                        )
                    ) {
                        WorkManager.getInstance(applicationContext).enqueueUniqueWork(
                            "attendance-refresh-now",
                            ExistingWorkPolicy.REPLACE,
                            OneTimeWorkRequestBuilder<AttendanceRefreshWorker>().build(),
                        )
                    }
                }
                Result.success()
            }
            is com.geotrack.mobile.core.common.AppResult.Failure -> Result.retry()
        }
    }
}
