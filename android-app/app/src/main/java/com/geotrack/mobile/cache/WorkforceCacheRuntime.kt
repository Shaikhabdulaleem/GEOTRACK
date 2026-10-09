package com.geotrack.mobile.cache

import android.content.Context
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
import com.geotrack.mobile.database.CachedAttendanceEntity
import com.geotrack.mobile.database.CachedEmployeeProfileEntity
import com.geotrack.mobile.database.CachedGeofenceEntity
import com.geotrack.mobile.database.CachedNotificationEntity
import com.geotrack.mobile.database.CachedScheduleEntity
import com.geotrack.mobile.database.GeoTrackDatabase
import com.geotrack.mobile.data.remote.dto.ServerNotificationDto
import com.geotrack.mobile.data.remote.supabase.SupabaseClientHolder
import com.geotrack.mobile.domain.repository.AttendanceRepository
import com.geotrack.mobile.domain.repository.ScheduleRepository
import com.geotrack.mobile.domain.repository.SessionRepository
import com.geotrack.mobile.location.GeofenceManager
import com.geotrack.mobile.core.session.WorkerSessionBootstrapper
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.coroutines.flow.firstOrNull
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.TimeUnit

object WorkforceCacheScheduler {
    fun enqueue(context: Context) {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        WorkManager.getInstance(context).enqueueUniqueWork("workforce-cache-refresh-now", ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<WorkforceCacheSyncWorker>().setConstraints(constraints).build())
        WorkManager.getInstance(context).enqueueUniquePeriodicWork("workforce-cache-refresh", ExistingPeriodicWorkPolicy.UPDATE, PeriodicWorkRequestBuilder<WorkforceCacheSyncWorker>(6, TimeUnit.HOURS).setConstraints(constraints).build())
    }
    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork("workforce-cache-refresh-now")
        WorkManager.getInstance(context).cancelUniqueWork("workforce-cache-refresh")
    }
}

@Serializable private data class GeofenceAssignmentCacheDto(
    @SerialName("geofence_id") val geofenceId: String,
    @SerialName("effective_from") val effectiveFrom: String? = null,
    @SerialName("effective_to") val effectiveTo: String? = null,
)
@Serializable private data class GeofenceCacheDto(val id: String, val name: String)
@Serializable private data class PolygonCacheDto(@SerialName("polygon") val polygon: JsonElement)

@HiltWorker
class WorkforceCacheSyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted workerParams: WorkerParameters,
    private val sessions: SessionRepository,
    private val schedules: ScheduleRepository,
    private val attendance: AttendanceRepository,
    private val holder: SupabaseClientHolder,
    private val database: GeoTrackDatabase,
    private val geofenceManager: GeofenceManager,
    private val sessionBootstrapper: WorkerSessionBootstrapper,
) : CoroutineWorker(appContext, workerParams) {
    override suspend fun doWork(): Result {
        val context = sessionBootstrapper.restore() ?: return Result.success()
        val employee = sessions.employeeProfile.firstOrNull() ?: return Result.success()
        val zone = ZoneId.of(context.organization.timezone)
        val today = LocalDate.now(zone)
        val now = System.currentTimeMillis()
        val cache = database.workforceCacheDao()
        cache.upsertEmployee(CachedEmployeeProfileEntity(context.organization.id, employee.id, employee.fullName, employee.employeeCode, employee.branchId, employee.departmentId, employee.employmentStatus, now))

        val scheduleResult = schedules.getScheduleWindow(context.organization.id, employee.id, today, today.plusDays(14))
        if (scheduleResult is com.geotrack.mobile.core.common.AppResult.Success) {
            cache.upsertSchedules(scheduleResult.value.map { row -> CachedScheduleEntity(employee.id, row.date.toString(), row.state.name, row.shiftAssignmentId, row.shiftName, row.startTime, row.endTime, row.crossesMidnight, now) })
        }
        val attendanceResult = attendance.getAttendanceWindow(context.organization.id, employee.id, today.minusDays(30), today)
        if (attendanceResult is com.geotrack.mobile.core.common.AppResult.Success) {
            cache.upsertAttendance(attendanceResult.value.map { row -> CachedAttendanceEntity(employee.id, row.date.toString(), 1, row.status, row.checkInAt, row.checkOutAt, row.workedMinutes, row.overtimeMinutes, "SYNCED", now) })
        }
        val client = holder.client ?: return Result.success()
        runCatching {
            val userId = context.profile?.id ?: return@runCatching
            val notifications = client.postgrest["notifications"].select { filter { eq("recipient_user_id", userId) } }.decodeList<ServerNotificationDto>()
            cache.upsertNotifications(notifications.map { CachedNotificationEntity(it.id, userId, it.title, it.body, it.notificationType, it.readAt, it.createdAt, now) })
        }
        runCatching {
            val assignments = client.postgrest["geofence_assignments"].select { filter { eq("organization_id", context.organization.id); eq("employee_id", employee.id) } }.decodeList<GeofenceAssignmentCacheDto>()
            assignments.forEach { assignment ->
                val fence = client.postgrest["geofences"].select { filter { eq("id", assignment.geofenceId) } }.decodeList<GeofenceCacheDto>().firstOrNull() ?: return@forEach
                val polygon = client.postgrest["geofence_polygons"].select(columns = Columns.raw("polygon")) { filter { eq("geofence_id", assignment.geofenceId); eq("is_active", true) } }.decodeList<PolygonCacheDto>().firstOrNull()
                val polygonJson = polygon?.polygon?.toString() ?: "{}"
                cache.upsertGeofence(CachedGeofenceEntity(employee.id, fence.id, fence.name, polygonJson, assignment.effectiveFrom, assignment.effectiveTo, now))
                if (polygon != null) {
                    runCatching { geofenceManager.addGeofenceFromGeoJson(fence.id, polygon.polygon, fence.name) }
                }
            }
        }
        return Result.success()
    }
}
