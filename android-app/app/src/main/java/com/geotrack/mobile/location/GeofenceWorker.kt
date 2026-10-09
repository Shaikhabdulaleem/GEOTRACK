package com.geotrack.mobile.location

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.repository.AttendanceRepository
import com.geotrack.mobile.domain.repository.ScheduleRepository
import com.geotrack.mobile.domain.repository.SessionRepository
import com.google.android.gms.location.Geofence
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.flow.firstOrNull
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import com.geotrack.mobile.notifications.NotificationCoordinator
import com.geotrack.mobile.core.session.WorkerSessionBootstrapper

/**
 * Handles a single geofence ENTER/EXIT by validating against the server and
 * marking attendance. The server's PostGIS polygon check stays authoritative;
 * this worker only decides *whether* to attempt a check-in/out and how to react
 * to the outcome. See [AutoAttendanceWorker] for the already-inside and
 * missed-transition cases that a one-shot transition cannot cover.
 */
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
    private val diagnostics: GeofenceDiagnostics,
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result {
        val transitionType = inputData.getInt("transitionType", -1)
        if (transitionType == -1) return Result.success()
        val isEnter = transitionType == Geofence.GEOFENCE_TRANSITION_ENTER

        val orgCtx = sessionBootstrapper.restore()
        val profile = orgCtx?.let { sessionRepository.employeeProfile.firstOrNull() }
        if (orgCtx == null || profile == null) {
            // No usable session yet. Retry only while a cold/offline process may
            // still warm up; a genuinely signed-out device must not spin.
            return if (applicationContext.hasNetworkConnection() && runAttemptCount < MAX_ATTEMPTS) {
                diagnostics.record(GeofenceDiagnostics.Stage.WORKER, ok = false, message = "Session not ready; will retry.")
                Result.retry()
            } else {
                diagnostics.record(GeofenceDiagnostics.Stage.WORKER, ok = false, message = "No active session; skipping auto attendance.")
                Result.success()
            }
        }

        val zone = runCatching { ZoneId.of(orgCtx.organization.timezone) }.getOrDefault(ZoneId.of("UTC"))
        val now = Instant.now()
        val today = LocalDate.now(zone)

        // A window around 'now' so an overnight shift that began yesterday is
        // considered — not just today's calendar date.
        val windowResult = scheduleRepository.getScheduleWindow(
            orgCtx.organization.id, profile.id, today.minusDays(1), today.plusDays(1),
        )
        if (windowResult !is AppResult.Success) {
            diagnostics.record(GeofenceDiagnostics.Stage.WORKER, ok = false, message = "Could not load schedule; will retry.")
            return retryIfPossible()
        }

        val resolved = if (isEnter) {
            AutoAttendance.resolveShiftForInstant(now, zone, windowResult.value)
        } else {
            AutoAttendance.resolveOpenShiftForInstant(now, zone, windowResult.value)
        }
        if (resolved == null) {
            diagnostics.record(
                GeofenceDiagnostics.Stage.WORKER,
                ok = true,
                message = "${label(isEnter)} outside any assigned shift window; ignored.",
            )
            return Result.success()
        }
        val workDate = resolved.workDate

        val attendanceResult = attendanceRepository.getAttendanceForDate(orgCtx.organization.id, profile.id, workDate)
        val isCheckedIn = attendanceResult is AppResult.Success &&
            attendanceResult.value?.checkInAt != null &&
            attendanceResult.value?.checkOutAt == null

        if (isEnter && isCheckedIn) {
            diagnostics.record(GeofenceDiagnostics.Stage.WORKER, ok = true, message = "Already checked in for $workDate; ENTER ignored.")
            return Result.success()
        }
        if (!isEnter && !isCheckedIn) {
            diagnostics.record(GeofenceDiagnostics.Stage.WORKER, ok = true, message = "No open session for $workDate; EXIT ignored.")
            return Result.success()
        }

        val location = locationTracker.getCurrentLocation()
        if (location == null) {
            diagnostics.record(GeofenceDiagnostics.Stage.WORKER, ok = false, message = "No GPS fix for ${label(isEnter)}; will retry.")
            return retryIfPossible()
        }

        val actionType = if (isEnter) "check_in" else "check_out"
        val result = if (isEnter) {
            attendanceRepository.checkIn(
                organizationId = orgCtx.organization.id,
                employeeId = profile.id,
                latitude = location.latitude,
                longitude = location.longitude,
                accuracyMeters = location.accuracyMeters,
                isMock = location.isMock,
                isAuto = true,
            )
        } else {
            attendanceRepository.checkOut(
                organizationId = orgCtx.organization.id,
                employeeId = profile.id,
                latitude = location.latitude,
                longitude = location.longitude,
                accuracyMeters = location.accuracyMeters,
                isMock = location.isMock,
                isAuto = true,
            )
        }

        return when (result) {
            is AppResult.Success -> {
                diagnostics.record(GeofenceDiagnostics.Stage.SERVER, ok = true, message = "Auto ${actionType.replace('_', ' ')} recorded for $workDate.")
                if (isEnter) notificationCoordinator.showAttendanceRecorded()
                Result.success()
            }
            is AppResult.Failure -> when (AutoAttendance.classifyFailure(result.error)) {
                AutoAttendance.RetryDecision.DONE -> {
                    diagnostics.record(GeofenceDiagnostics.Stage.SERVER, ok = false, message = "Rejected (permanent): ${result.error.message}")
                    if (!isEnter && result.error.message.contains("outside", ignoreCase = true)) {
                        notificationCoordinator.showOutsideGeofence()
                    }
                    Result.success()
                }
                AutoAttendance.RetryDecision.RETRY -> {
                    diagnostics.record(GeofenceDiagnostics.Stage.SERVER, ok = false, message = "Transient failure: ${result.error.message}")
                    retryIfPossible()
                }
            }
        }
    }

    private fun retryIfPossible(): Result =
        if (runAttemptCount < MAX_ATTEMPTS) Result.retry() else Result.success()

    private fun label(isEnter: Boolean) = if (isEnter) "ENTER" else "EXIT"

    private companion object {
        const val MAX_ATTEMPTS = 5
    }
}
