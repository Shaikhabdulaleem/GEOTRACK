package com.geotrack.mobile.location

import android.content.Context
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
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.geotrack.mobile.database.GeoTrackDatabase
import com.geotrack.mobile.database.OfflineAttendanceEventEntity
import com.geotrack.mobile.data.remote.supabase.SupabaseClientHolder
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
            OneTimeWorkRequestBuilder<OfflineAttendanceSyncWorker>().setConstraints(constraints).build(),
        )
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            UNIQUE_PERIODIC,
            ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<OfflineAttendanceSyncWorker>(15, TimeUnit.MINUTES).setConstraints(constraints).build(),
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
    @SerialName("event_id") val eventId: String? = null,
    @SerialName("validation_status") val validationStatus: String? = null,
    val error: String? = null,
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
        if (client.auth.currentSessionOrNull() == null) {
            database.offlineAttendanceDao().pending().forEach { event ->
                database.offlineAttendanceDao().updateStatus(event.localEventId, "SYNC_FAILED", event.retryCount + 1, "Session expired", null, System.currentTimeMillis())
            }
            return Result.success()
        }
        val events = database.offlineAttendanceDao().pending()
        var transientFailure = false
        for (event in events) {
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
                }).decodeSingle<OfflineSyncResponse>()
                val synced = response.status !in setOf("SYNC_FAILED", "rejected", "error", "failed")
                database.offlineAttendanceDao().updateStatus(
                    event.localEventId,
                    if (synced) "SYNCED" else "SYNC_FAILED",
                    event.retryCount + 1,
                    response.error,
                    response.eventId,
                    System.currentTimeMillis(),
                )
            } catch (error: Exception) {
                // Do not retry authorization/validation failures forever.  A
                // retry is useful only when the transport is currently down;
                // permanent failures remain visible as SYNC_FAILED.
                if (applicationContext.hasNetworkConnection()) {
                    database.offlineAttendanceDao().updateStatus(
                        event.localEventId,
                        "SYNC_FAILED",
                        event.retryCount + 1,
                        error.message,
                        null,
                        System.currentTimeMillis(),
                    )
                    continue
                }
                transientFailure = true
                database.offlineAttendanceDao().updateStatus(
                    event.localEventId,
                    "SYNC_FAILED",
                    event.retryCount + 1,
                    error.message,
                    null,
                    System.currentTimeMillis(),
                )
            }
        }
        return if (transientFailure) Result.retry() else Result.success()
    }
}
