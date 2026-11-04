package com.geotrack.mobile.data.repository

import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.data.remote.dto.AttendanceRecordDto
import com.geotrack.mobile.data.remote.dto.ProcessAttendanceArgs
import com.geotrack.mobile.data.remote.dto.ProcessAttendanceResponse
import com.geotrack.mobile.data.remote.supabase.SupabaseClientHolder
import com.geotrack.mobile.database.GeoTrackDatabase
import com.geotrack.mobile.database.OfflineAttendanceEventEntity
import com.geotrack.mobile.database.CachedAttendanceEntity
import com.geotrack.mobile.domain.model.DailyAttendance
import com.geotrack.mobile.domain.model.AttendanceLocationResult
import com.geotrack.mobile.domain.repository.AttendanceRepository
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.rpc
import java.time.LocalDate
import java.util.UUID
import java.time.Instant
import android.content.Context
import android.provider.Settings
import java.security.MessageDigest
import com.geotrack.mobile.location.OfflineAttendanceSyncScheduler
import com.geotrack.mobile.location.hasNetworkConnection
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Singleton
class SupabaseAttendanceRepository @Inject constructor(
    private val clientHolder: SupabaseClientHolder,
    private val database: GeoTrackDatabase,
    @ApplicationContext private val appContext: Context,
) : AttendanceRepository {

    /**
     * Stable, privacy-preserving device identifier for anti-fraud device
     * binding: SHA-256 of the app-scoped ANDROID_ID (survives app reinstall on
     * the same device, unlike a random UUID). The server stores only this hash.
     */
    @Suppress("HardwareIds")
    private fun deviceHash(): String {
        val androidId = Settings.Secure.getString(appContext.contentResolver, Settings.Secure.ANDROID_ID)
            ?: "unknown"
        val digest = MessageDigest.getInstance("SHA-256").digest("geotrack-device:$androidId".toByteArray())
        return digest.joinToString("") { "%02x".format(it) }
    }

    override suspend fun latestLocalSyncStatus(employeeId: String): String? =
        database.offlineAttendanceDao().forEmployee(employeeId).firstOrNull()?.syncStatus

    override suspend fun recordLocationPing(
        organizationId: String,
        employeeId: String,
        latitude: Double,
        longitude: Double,
        accuracyMeters: Float,
        isMock: Boolean
    ): AppResult<Boolean> = when (val result = recordAttendanceLocation(
        organizationId = organizationId,
        employeeId = employeeId,
        latitude = latitude,
        longitude = longitude,
        accuracyMeters = accuracyMeters,
        isMock = isMock,
        observedAt = Instant.now(),
        idempotencyKey = UUID.randomUUID().toString(),
        sampleSource = "heartbeat",
    )) {
        is AppResult.Success -> AppResult.Success(result.value.outcome != "ignored_no_open_session")
        is AppResult.Failure -> result
    }

    override suspend fun recordAttendanceLocation(
        organizationId: String,
        employeeId: String,
        latitude: Double,
        longitude: Double,
        accuracyMeters: Float,
        isMock: Boolean,
        observedAt: Instant,
        idempotencyKey: String,
        sampleSource: String,
    ): AppResult<AttendanceLocationResult> {
        val client = clientHolder.client
            ?: return AppResult.Failure(com.geotrack.mobile.core.common.AppError.Configuration("Supabase not configured"))
        val online = appContext.hasNetworkConnection()
        val geofence = resolveGeofence(client, organizationId, employeeId, online)
            ?: return AppResult.Failure(com.geotrack.mobile.core.common.AppError.Unknown("No active work location is assigned for this employee."))
        accuracyFailure(accuracyMeters, geofence.requiredAccuracyMeters)?.let { return it }

        if (!online) {
            enqueueOfflineLocation(
                organizationId, employeeId, idempotencyKey, observedAt,
                latitude, longitude, accuracyMeters, isMock, geofence.id,
            )
            return AppResult.Success(AttendanceLocationResult(outcome = "queued_offline", reason = "offline"))
        }

        return try {
            val response = client.postgrest.rpc("record_attendance_location", buildJsonObject {
                put("p_employee_id", employeeId)
                put("p_geofence_id", geofence.id)
                put("p_latitude", latitude)
                put("p_longitude", longitude)
                put("p_accuracy_meters", accuracyMeters.toDouble())
                put("p_is_mock", isMock)
                put("p_observed_at", observedAt.toString())
                put("p_idempotency_key", idempotencyKey)
                put("p_device_hash", deviceHash())
                put("p_sample_source", sampleSource)
            }).decodeList<RecordAttendanceLocationResponse>().firstOrNull()
                ?: return AppResult.Failure(com.geotrack.mobile.core.common.AppError.Network("Location server returned no result"))

            when (response.outcome) {
                "device_blocked" -> AppResult.Failure(com.geotrack.mobile.core.common.AppError.Unknown("This device isn't registered for your account. Ask your administrator to reset your device."))
                "rejected" -> AppResult.Failure(com.geotrack.mobile.core.common.AppError.Unknown(
                    when (response.reason) {
                        "mock_location" -> "Mock locations cannot be used for attendance."
                        "low_accuracy" -> "Location accuracy is too low. Please try again."
                        else -> response.reason ?: "Location was rejected."
                    },
                ))
                else -> AppResult.Success(
                    AttendanceLocationResult(
                        locationEventId = response.locationEventId,
                        attendanceRecordId = response.attendanceRecordId,
                        insideGeofence = response.insideGeofence,
                        position = response.position,
                        outcome = response.outcome,
                        checkoutAt = response.checkoutAt,
                        overtimeMinutes = response.overtimeMinutes,
                        reason = response.reason,
                    ),
                )
            }
        } catch (e: Exception) {
            if (!appContext.hasNetworkConnection()) {
                enqueueOfflineLocation(
                    organizationId, employeeId, idempotencyKey, observedAt,
                    latitude, longitude, accuracyMeters, isMock, geofence.id,
                )
                AppResult.Success(AttendanceLocationResult(outcome = "queued_offline", reason = "offline"))
            } else {
                AppResult.Failure(com.geotrack.mobile.core.common.AppError.Unknown(e.message ?: "Unable to record location", e))
            }
        }
    }

    override suspend fun getAttendanceForDate(
        organizationId: String,
        employeeId: String,
        date: LocalDate
    ): AppResult<DailyAttendance?> {
        val window = getAttendanceWindow(organizationId, employeeId, date, date)
        if (window is AppResult.Success) {
            return AppResult.Success(window.value.firstOrNull())
        }
        return AppResult.Failure(com.geotrack.mobile.core.common.AppError.Unknown("Failed to fetch"))
    }

    override suspend fun getAttendanceWindow(
        organizationId: String,
        employeeId: String,
        startDate: LocalDate,
        endDate: LocalDate
    ): AppResult<List<DailyAttendance>> {
        val client = clientHolder.client ?: return AppResult.Failure(com.geotrack.mobile.core.common.AppError.Configuration("Supabase not configured"))
        
        return try {
            val records = client.postgrest["attendance_records"]
                .select {
                    filter {
                        eq("organization_id", organizationId)
                        eq("employee_id", employeeId)
                        gte("attendance_date", startDate.toString())
                        lte("attendance_date", endDate.toString())
                    }
                }.decodeList<AttendanceRecordDto>()
                
            val result = records.map { record ->
                DailyAttendance(
                    date = LocalDate.parse(record.attendanceDate),
                    checkInAt = record.checkInAt,
                    checkOutAt = record.checkOutAt,
                    status = record.status,
                    source = record.source,
                    workedMinutes = record.workedMinutes,
                    overtimeMinutes = record.overtimeMinutes,
                    lateMinutes = record.lateMinutes,
                    geofenceValidated = record.geofenceValidated
                )
            }
            database.workforceCacheDao().upsertAttendance(result.map { row -> CachedAttendanceEntity(employeeId, row.date.toString(), 1, row.status, row.checkInAt, row.checkOutAt, row.workedMinutes, row.overtimeMinutes, "SYNCED", System.currentTimeMillis()) })
            AppResult.Success(result)
        } catch (e: Exception) {
            val cached = database.workforceCacheDao().recentAttendance(employeeId, 90)
                .filter { it.attendanceDate >= startDate.toString() && it.attendanceDate <= endDate.toString() }
            if (cached.isNotEmpty()) {
                AppResult.Success(cached.map { row -> DailyAttendance(LocalDate.parse(row.attendanceDate), row.checkInAt, row.checkOutAt, row.status, "offline_cache", row.workedMinutes, row.overtimeMinutes, 0, true) })
            } else AppResult.Failure(com.geotrack.mobile.core.common.AppError.Unknown(e.message ?: "Unknown", e))
        }
    }

    override suspend fun checkIn(
        organizationId: String,
        employeeId: String,
        latitude: Double,
        longitude: Double,
        accuracyMeters: Float,
        isMock: Boolean,
        isAuto: Boolean
    ): AppResult<Unit> = processEvent(
        organizationId, employeeId, "check_in", latitude, longitude, accuracyMeters, isMock, isAuto
    )

    override suspend fun checkOut(
        organizationId: String,
        employeeId: String,
        latitude: Double,
        longitude: Double,
        accuracyMeters: Float,
        isMock: Boolean,
        isAuto: Boolean
    ): AppResult<Unit> = processEvent(
        organizationId, employeeId, "check_out", latitude, longitude, accuracyMeters, isMock, isAuto
    )

    private suspend fun processEvent(
        organizationId: String,
        employeeId: String,
        actionType: String,
        latitude: Double,
        longitude: Double,
        accuracyMeters: Float,
        isMock: Boolean,
        isAuto: Boolean
    ): AppResult<Unit> {
        val client = clientHolder.client ?: return AppResult.Failure(com.geotrack.mobile.core.common.AppError.Configuration("Supabase not configured"))
        // Every attempt uses a fresh idempotency key so a transient failure or a
        // prior "outside geofence" rejection never blocks a later valid attempt.
        // Duplicate attendance is prevented server-side (a per-employee advisory
        // lock + the unique attendance record) and by the caller's pre-read.
        val localEventId = UUID.randomUUID()
        val eventTime = Instant.now()
        val online = appContext.hasNetworkConnection()
        // The server validates the polygon identified by p_geofence_id. Passing
        // null makes the RPC deterministically reject every attendance attempt;
        // resolve the employee's active assignment before calling it.
        val geofence = resolveGeofence(client, organizationId, employeeId, online)
        if (geofence == null) {
            if (!online) {
                return AppResult.Failure(com.geotrack.mobile.core.common.AppError.Network("Offline attendance is unavailable until a work location has been synced."))
            }
            return AppResult.Failure(com.geotrack.mobile.core.common.AppError.Unknown("No active work location is assigned for this employee."))
        }
        accuracyFailure(accuracyMeters, geofence.requiredAccuracyMeters)?.let { return it }
        if (!online) {
            if (database.offlineAttendanceDao().pendingAction(employeeId, actionType) != null) return AppResult.Success(Unit)
            enqueueOffline(organizationId, employeeId, actionType, localEventId, eventTime, latitude, longitude, accuracyMeters, isMock, geofence.id)
            return AppResult.Success(Unit)
        }
        return try {
            val args = ProcessAttendanceArgs(
                p_employee_id = employeeId,
                p_geofence_id = geofence.id,
                p_action_type = actionType,
                p_is_auto = isAuto,
                p_latitude = latitude,
                p_longitude = longitude,
                p_accuracy_meters = accuracyMeters,
                p_is_mock_location = isMock,
                p_idempotency_key = localEventId.toString(),
                p_device_info = buildJsonObject {
                    put("platform", "android")
                },
                p_device_hash = deviceHash()
            )
            
            val response = client.postgrest.rpc("process_attendance_event", args).decodeList<ProcessAttendanceResponse>()
            val first = response.firstOrNull()
                ?: return AppResult.Failure(com.geotrack.mobile.core.common.AppError.Network("Attendance server returned no validation result"))
            
            if (first?.status == "device_blocked") {
                 return AppResult.Failure(com.geotrack.mobile.core.common.AppError.Unknown("This device isn't registered for your account. Ask your administrator to reset your device."))
            }
            if (first?.status == "rejected" || first?.status == "error" || first?.status == "failed") {
                 return AppResult.Failure(com.geotrack.mobile.core.common.AppError.Unknown(first.validation_status))
            }
            if (first?.inside_geofence == false) {
                 return AppResult.Failure(com.geotrack.mobile.core.common.AppError.Unknown("You are outside your assigned work location."))
            }
            database.offlineAttendanceDao().upsert(OfflineAttendanceEventEntity(localEventId.toString(), organizationId, employeeId, actionType, eventTime.toEpochMilli(), eventTime.toString(), latitude, longitude, accuracyMeters, isMock, geofence.id, first.validation_status, "SYNCED", 0, null, first.event_id, System.currentTimeMillis()))
            AppResult.Success(Unit)
        } catch (e: Exception) {
            if (!appContext.hasNetworkConnection()) {
                enqueueOffline(organizationId, employeeId, actionType, localEventId, eventTime, latitude, longitude, accuracyMeters, isMock, geofence.id)
                return AppResult.Success(Unit)
            }
            val msg = e.message ?: "Unknown"
            if (msg.contains("Already checked in")) {
                AppResult.Failure(com.geotrack.mobile.core.common.AppError.Unknown("Already checked in today."))
            } else if (msg.contains("not registered for your account")) {
                AppResult.Failure(com.geotrack.mobile.core.common.AppError.Unknown("This device isn't registered for your account. Ask your administrator to reset your device."))
            } else if (msg.contains("low_accuracy")) {
                AppResult.Failure(com.geotrack.mobile.core.common.AppError.Unknown("Location accuracy is too low. Please try again."))
            } else {
                AppResult.Failure(com.geotrack.mobile.core.common.AppError.Unknown(msg, e))
            }
        }
    }

    private suspend fun enqueueOffline(
        organizationId: String,
        employeeId: String,
        actionType: String,
        localEventId: UUID,
        eventTime: Instant,
        latitude: Double,
        longitude: Double,
        accuracyMeters: Float,
        isMock: Boolean,
        geofenceId: String,
    ) {
        database.offlineAttendanceDao().upsert(OfflineAttendanceEventEntity(
            localEventId = localEventId.toString(),
            organizationId = organizationId,
            employeeId = employeeId,
            actionType = actionType,
            deviceTimestampEpochMillis = eventTime.toEpochMilli(),
            originalEventTime = eventTime.toString(),
            latitude = latitude,
            longitude = longitude,
            accuracyMeters = accuracyMeters,
            isMockLocation = isMock,
            geofenceId = geofenceId,
            geofenceValidation = "pending_server_validation",
            syncStatus = "PENDING_SYNC",
            updatedAtEpochMillis = System.currentTimeMillis(),
        ))
        OfflineAttendanceSyncScheduler.enqueue(appContext)
    }

    private suspend fun enqueueOfflineLocation(
        organizationId: String,
        employeeId: String,
        idempotencyKey: String,
        observedAt: Instant,
        latitude: Double,
        longitude: Double,
        accuracyMeters: Float,
        isMock: Boolean,
        geofenceId: String,
    ) {
        // Keep one rolling offline precision sample. While the employee remains
        // inside it is refreshed; once they leave, the latest outside point and
        // its original timestamp are retained for authoritative server replay.
        val pending = database.offlineAttendanceDao().pendingAction(employeeId, "geofence_exit")
        val localEventId = pending?.localEventId ?: idempotencyKey
        database.offlineAttendanceDao().upsert(
            OfflineAttendanceEventEntity(
                localEventId = localEventId,
                organizationId = organizationId,
                employeeId = employeeId,
                actionType = "geofence_exit",
                deviceTimestampEpochMillis = observedAt.toEpochMilli(),
                originalEventTime = observedAt.toString(),
                latitude = latitude,
                longitude = longitude,
                accuracyMeters = accuracyMeters,
                isMockLocation = isMock,
                geofenceId = geofenceId,
                geofenceValidation = "pending_server_validation",
                syncStatus = "PENDING_SYNC",
                retryCount = pending?.retryCount ?: 0,
                updatedAtEpochMillis = System.currentTimeMillis(),
            ),
        )
        OfflineAttendanceSyncScheduler.enqueue(appContext)
    }

    private suspend fun resolveGeofence(
        client: io.github.jan.supabase.SupabaseClient,
        organizationId: String,
        employeeId: String,
        allowRemote: Boolean,
    ): ActiveGeofence? {
        val remoteId = if (allowRemote) runCatching {
            client.postgrest["geofence_assignments"].select {
                filter {
                    eq("organization_id", organizationId)
                    eq("employee_id", employeeId)
                }
            }.decodeList<GeofenceAssignmentDto>()
                .filter { assignment ->
                    val today = LocalDate.now().toString()
                    (assignment.effectiveFrom == null || assignment.effectiveFrom <= today) &&
                        (assignment.effectiveTo == null || assignment.effectiveTo >= today)
                }
                .maxByOrNull { it.effectiveFrom ?: "0000-01-01" }
                ?.geofenceId
        }.getOrNull() else null
        if (remoteId != null) {
            val settings = runCatching {
                client.postgrest["geofences"].select {
                    filter {
                        eq("organization_id", organizationId)
                        eq("id", remoteId)
                    }
                }.decodeList<GeofenceSettingsDto>().firstOrNull()
            }.getOrNull()
            if (settings != null) {
                if (settings.status != "active") return null
                return ActiveGeofence(settings.id, settings.requiredAccuracyMeters.coerceAtLeast(1))
            }
        }

        val today = LocalDate.now().toString()
        return database.workforceCacheDao().geofences(employeeId)
            .filter { (it.effectiveFrom == null || it.effectiveFrom <= today) && (it.effectiveTo == null || it.effectiveTo >= today) }
            .maxByOrNull { it.effectiveFrom ?: "0000-01-01" }
            ?.let { ActiveGeofence(it.geofenceId, it.requiredAccuracyMeters.coerceAtLeast(1)) }
    }

    private fun accuracyFailure(actualMeters: Float, requiredMeters: Int): AppResult.Failure? {
        if (actualMeters.isFinite() && actualMeters <= requiredMeters) return null
        val actual = if (actualMeters.isFinite()) actualMeters.toInt().coerceAtLeast(0).toString() else "unknown"
        return AppResult.Failure(
            com.geotrack.mobile.core.common.AppError.Unknown(
                "Location accuracy is $actual m; $requiredMeters m or better is required. " +
                    "Wait for a stronger GPS signal and try again.",
            ),
        )
    }
}

@Serializable
private data class RecordAttendanceLocationResponse(
    @SerialName("location_event_id") val locationEventId: String? = null,
    @SerialName("attendance_record_id") val attendanceRecordId: String? = null,
    @SerialName("inside_geofence") val insideGeofence: Boolean? = null,
    @SerialName("classified_position") val position: String = "unknown",
    val outcome: String,
    @SerialName("checkout_at") val checkoutAt: String? = null,
    @SerialName("overtime_minutes") val overtimeMinutes: Int = 0,
    val reason: String? = null,
)

@Serializable
private data class GeofenceAssignmentDto(
    @SerialName("geofence_id") val geofenceId: String,
    @SerialName("effective_from") val effectiveFrom: String? = null,
    @SerialName("effective_to") val effectiveTo: String? = null,
)

private data class ActiveGeofence(
    val id: String,
    val requiredAccuracyMeters: Int,
)

@Serializable
private data class GeofenceSettingsDto(
    val id: String,
    val status: String,
    @SerialName("required_accuracy_meters") val requiredAccuracyMeters: Int = 50,
)
