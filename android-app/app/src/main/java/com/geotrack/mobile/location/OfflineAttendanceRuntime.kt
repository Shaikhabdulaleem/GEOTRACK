package com.geotrack.mobile.location

import android.content.Context
import android.util.Log
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.hilt.work.HiltWorker
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.BackoffPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.geotrack.mobile.database.GeoTrackDatabase
import com.geotrack.mobile.database.OfflineAttendanceEventEntity
import com.geotrack.mobile.data.remote.supabase.SupabaseClientHolder
import com.geotrack.mobile.core.security.DeviceIdentity
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.rpc
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.util.concurrent.TimeUnit
import io.github.jan.supabase.auth.auth

object OfflineAttendanceSyncScheduler {
    private const val UNIQUE_NOW = "offline-attendance-sync-now"
    private const val UNIQUE_PERIODIC = "offline-attendance-sync"

    fun enqueue(context: Context) {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            UNIQUE_NOW,
            ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<OfflineAttendanceSyncWorker>()
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build(),
        )
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            UNIQUE_PERIODIC,
            ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<OfflineAttendanceSyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build(),
        )
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_NOW)
        WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_PERIODIC)
    }
}

fun Context.hasNetworkConnection(): Boolean {
    val manager = getSystemService(ConnectivityManager::class.java) ?: return false
    val network = manager.activeNetwork ?: return false
    val capabilities = manager.getNetworkCapabilities(network) ?: return false
    return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
        capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
}

@Serializable
private data class OfflineSyncResponse(
    val status: String? = null,
    val outcome: String? = null,
    @SerialName("event_id") val eventId: String? = null,
    @SerialName("location_event_id") val locationEventId: String? = null,
    @SerialName("validation_status") val validationStatus: String? = null,
    val reason: String? = null,
    val error: String? = null,
    @SerialName("failure_class") val failureClass: String? = null,
    val retryable: Boolean? = null,
)

@HiltWorker
class OfflineAttendanceSyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted workerParams: WorkerParameters,
    private val database: GeoTrackDatabase,
    private val clientHolder: SupabaseClientHolder,
) : CoroutineWorker(appContext, workerParams) {
    override suspend fun doWork(): Result {
        val client = clientHolder.client ?: return Result.retry()
        client.auth.awaitInitialization()
        val now = System.currentTimeMillis()
        if (client.auth.currentSessionOrNull() == null) {
            database.offlineAttendanceDao()
                .readyForSync(now, OfflineSyncPolicy.MAX_RETRIES)
                .forEach { event ->
                database.offlineAttendanceDao().updateStatus(
                    localEventId = event.localEventId,
                    status = "REAUTHENTICATION_REQUIRED",
                    retryCount = event.retryCount,
                    error = "Sign in again to sync this attendance event",
                    serverEventId = event.serverEventId,
                    updatedAt = now,
                    nextAttemptAt = 0,
                    lastAttemptAt = event.lastAttemptAtEpochMillis,
                    failureClass = "reauthentication",
                )
            }
            return Result.success()
        }
        val events = database.offlineAttendanceDao()
            .readyForSync(now, OfflineSyncPolicy.MAX_RETRIES)
        var transientFailure = false
        for (event in events) {
            val attemptAt = System.currentTimeMillis()
            val nextRetryCount = event.retryCount + 1
            try {
                val response = client.postgrest.rpc("sync_offline_attendance_event", buildJsonObject {
                    put("p_local_event_id", event.localEventId)
                    put("p_organization_id", event.organizationId)
                    put("p_employee_id", event.employeeId)
                    put("p_action_type", event.actionType)
                    put("p_geofence_id", event.geofenceId)
                    put("p_device_timestamp", Instant.ofEpochMilli(event.deviceTimestampEpochMillis).toString())
                    put("p_original_event_time", event.originalEventTime)
                    put("p_latitude", event.latitude)
                    put("p_longitude", event.longitude)
                    put("p_accuracy_meters", event.accuracyMeters)
                    put("p_is_mock_location", event.isMockLocation)
                    put("p_geofence_validation", event.geofenceValidation)
                    put("p_device_hash", DeviceIdentity.hash(applicationContext))
                }).decodeSingle<OfflineSyncResponse>()
                val disposition = OfflineSyncPolicy.classify(
                    response.status,
                    response.outcome,
                    response.failureClass,
                    response.retryable,
                )
                val exhausted = disposition == OfflineSyncPolicy.Disposition.RETRYABLE &&
                    nextRetryCount >= OfflineSyncPolicy.MAX_RETRIES
                val status = when {
                    exhausted -> "REQUIRES_REVIEW"
                    disposition == OfflineSyncPolicy.Disposition.SYNCED -> "SYNCED"
                    disposition == OfflineSyncPolicy.Disposition.RETRYABLE -> "RETRYABLE_FAILURE"
                    disposition == OfflineSyncPolicy.Disposition.REAUTHENTICATION -> "REAUTHENTICATION_REQUIRED"
                    disposition == OfflineSyncPolicy.Disposition.REVIEW_REQUIRED -> "REQUIRES_REVIEW"
                    else -> "PERMANENT_FAILURE"
                }
                val shouldRetry = status == "RETRYABLE_FAILURE"
                transientFailure = transientFailure || shouldRetry
                database.offlineAttendanceDao().updateStatus(
                    localEventId = event.localEventId,
                    status = status,
                    retryCount = nextRetryCount,
                    error = response.error ?: if (status == "SYNCED") null else response.reason,
                    serverEventId = response.locationEventId ?: response.eventId,
                    updatedAt = System.currentTimeMillis(),
                    nextAttemptAt = if (shouldRetry) {
                        OfflineSyncPolicy.nextAttemptAt(attemptAt, nextRetryCount)
                    } else 0,
                    lastAttemptAt = attemptAt,
                    failureClass = if (exhausted) "retry_exhausted" else response.failureClass,
                )
                if (status == "REQUIRES_REVIEW" || status == "PERMANENT_FAILURE") {
                    Log.w(TAG, "Offline attendance ${event.localEventId} requires review: ${response.reason ?: response.error}")
                }
            } catch (error: Exception) {
                val sessionExpired = client.auth.currentSessionOrNull() == null
                val exhausted = !sessionExpired && nextRetryCount >= OfflineSyncPolicy.MAX_RETRIES
                val status = when {
                    sessionExpired -> "REAUTHENTICATION_REQUIRED"
                    exhausted -> "REQUIRES_REVIEW"
                    else -> "RETRYABLE_FAILURE"
                }
                transientFailure = transientFailure || status == "RETRYABLE_FAILURE"
                database.offlineAttendanceDao().updateStatus(
                    localEventId = event.localEventId,
                    status = status,
                    retryCount = if (sessionExpired) event.retryCount else nextRetryCount,
                    error = error.message,
                    serverEventId = event.serverEventId,
                    updatedAt = System.currentTimeMillis(),
                    nextAttemptAt = if (status == "RETRYABLE_FAILURE") {
                        OfflineSyncPolicy.nextAttemptAt(attemptAt, nextRetryCount)
                    } else 0,
                    lastAttemptAt = attemptAt,
                    failureClass = when {
                        sessionExpired -> "reauthentication"
                        exhausted -> "retry_exhausted"
                        else -> "retryable"
                    },
                )
                if (nextRetryCount >= 3) {
                    Log.w(TAG, "Repeated offline attendance sync failure (${nextRetryCount}/${OfflineSyncPolicy.MAX_RETRIES})", error)
                }
            }
        }
        return if (transientFailure) Result.retry() else Result.success()
    }

    private companion object {
        const val TAG = "OfflineAttendanceSync"
    }
}
