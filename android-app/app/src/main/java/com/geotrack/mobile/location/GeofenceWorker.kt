package com.geotrack.mobile.location

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.model.TodayScheduleState
import com.geotrack.mobile.domain.repository.AttendanceRepository
import com.geotrack.mobile.domain.repository.ScheduleRepository
import com.geotrack.mobile.domain.repository.SessionRepository
import com.google.android.gms.location.Geofence
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.flow.firstOrNull
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import com.geotrack.mobile.notifications.NotificationCoordinator
import com.geotrack.mobile.core.session.WorkerSessionBootstrapper

@HiltWorker
class GeofenceWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted workerParams: WorkerParameters,
    private val sessionRepository: SessionRepository,
    private val scheduleRepository: ScheduleRepository,
    private val attendanceRepository: AttendanceRepository,
    private val locationTracker: LocationTracker,
    private val notificationCoordinator: NotificationCoordinator,
    private val sessionBootstrapper: WorkerSessionBootstrapper,
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result {
        val transitionType = inputData.getInt("transitionType", -1)
        if (transitionType == -1) return Result.success()

        val isEnter = transitionType == Geofence.GEOFENCE_TRANSITION_ENTER
        val isExit = transitionType == Geofence.GEOFENCE_TRANSITION_EXIT

        val orgCtx = sessionBootstrapper.restore() ?: return Result.success()
        val profile = sessionRepository.employeeProfile.firstOrNull() ?: return Result.success()

        val zone = runCatching { ZoneId.of(orgCtx.organization.timezone) }.getOrDefault(ZoneId.of("UTC"))
        val today = LocalDate.now(zone)
        val scheduleResult = scheduleRepository.getTodaySchedule(orgCtx.organization.id, profile.id, today)
        if (scheduleResult !is AppResult.Success) return Result.success()
        
        // 1. Verify employee schedule
        if (scheduleResult.value.today.state != TodayScheduleState.WORKING_DAY) {
            // Not a working day, don't check in
            return Result.success()
        }

        val attendanceResult = attendanceRepository.getAttendanceForDate(orgCtx.organization.id, profile.id, today)
        var isCheckedIn = false
        if (attendanceResult is AppResult.Success) {
            val data = attendanceResult.value
            if (data != null && data.checkInAt != null && data.checkOutAt == null) {
                isCheckedIn = true
            }
        }

        // 2. Determine behavior
        if (isEnter && isCheckedIn) {
            // Already checked in, ignore ENTER
            return Result.success()
        }
        if (isExit && !isCheckedIn) {
            // Not checked in, ignore EXIT
            return Result.success()
        }

        // 3. Verify GPS
        val location = locationTracker.getCurrentLocation() ?: return Result.retry() // Retry if location failed
        
        // 4. Point-in-polygon & Mark attendance
        // Calling checkIn(isAuto = true) leverages Supabase process_attendance_event
        // which natively evaluates the assigned polygon (PostGIS) against the provided lat/lng.
        // It ONLY inserts attendance if inside_geofence is true (or rejects the call), fulfilling the constraint:
        // "Only mark attendance after polygon validation succeeds" and "Store an audit trail".
        val result = if (isEnter) {
            attendanceRepository.checkIn(
                organizationId = orgCtx.organization.id,
                employeeId = profile.id,
                latitude = location.latitude,
                longitude = location.longitude,
                accuracyMeters = location.accuracyMeters,
                isMock = location.isMock,
                isAuto = true
            )
        } else {
            attendanceRepository.checkOut(
                organizationId = orgCtx.organization.id,
                employeeId = profile.id,
                latitude = location.latitude,
                longitude = location.longitude,
                accuracyMeters = location.accuracyMeters,
                isMock = location.isMock,
                isAuto = true
            )
        }

        return if (result is AppResult.Success) {
            if (isEnter) notificationCoordinator.showAttendanceRecorded()
            Result.success()
        } else {
            if (isExit && result is AppResult.Failure && result.error.message.contains("geofence", ignoreCase = true)) notificationCoordinator.showOutsideGeofence()
            // Depending on if the rejection was network error vs polygon validation failure.
            // If polygon validation fails (outside polygon), don't retry, just end.
            Result.success()
        }
    }
}
