package com.geotrack.mobile.location

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
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.core.session.WorkerSessionBootstrapper
import com.geotrack.mobile.domain.repository.AttendanceRepository
import com.geotrack.mobile.domain.repository.ScheduleRepository
import com.geotrack.mobile.domain.repository.SessionRepository
import com.geotrack.mobile.notifications.NotificationCoordinator
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.flow.firstOrNull
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.TimeUnit

/**
 * Periodic safety net for automatic check-in that a one-shot geofence ENTER
 * cannot cover:
 *  - the employee was **already inside** when the shift started (no new ENTER);
 *  - an ENTER broadcast was dropped (Doze, "while in use" permission, OEM kill).
 *
 * It only ever *checks in* — never checks out — so it can't wrongly close a
 * session, and it never check-ins before the shift actually starts. The server
 * still validates the polygon, so an attempt from outside is safely rejected.
 * Breach heartbeats stay in [LocationHeartbeatWorker]; this worker does not
 * touch them.
 */
object AutoAttendanceScheduler {
    private const val UNIQUE_NOW = "auto-attendance-now"
    private const val UNIQUE_PERIODIC = "auto-attendance"

    fun enqueue(context: Context) {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            UNIQUE_NOW,
            ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<AutoAttendanceWorker>().setConstraints(constraints).build(),
        )
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            UNIQUE_PERIODIC,
            ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<AutoAttendanceWorker>(15, TimeUnit.MINUTES).setConstraints(constraints).build(),
        )
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_NOW)
        WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_PERIODIC)
    }
}

@HiltWorker
class AutoAttendanceWorker @AssistedInject constructor(
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
        val orgCtx = sessionBootstrapper.restore() ?: return Result.success()
        val profile = sessionRepository.employeeProfile.firstOrNull() ?: return Result.success()

        val zone = runCatching { ZoneId.of(orgCtx.organization.timezone) }.getOrDefault(ZoneId.of("UTC"))
        val now = Instant.now()
        val today = LocalDate.now(zone)

        val windowResult = scheduleRepository.getScheduleWindow(
            orgCtx.organization.id, profile.id, today.minusDays(1), today.plusDays(1),
        )
        if (windowResult !is AppResult.Success) return Result.success()

        val resolved = AutoAttendance.resolveShiftForInstant(now, zone, windowResult.value) ?: return Result.success()
        // Only reconcile once the shift has actually started; before then the
        // pre-shift reminder is the right signal, not an early check-in.
        if (now.isBefore(resolved.start)) return Result.success()

        val workDate = resolved.workDate
        val attendance = attendanceRepository.getAttendanceForDate(orgCtx.organization.id, profile.id, workDate)
        val record = (attendance as? AppResult.Success)?.value
        if (record?.checkInAt != null) return Result.success() // already checked in (or completed)

        val location = locationTracker.getCurrentLocation() ?: return Result.success()
        val result = attendanceRepository.checkIn(
            organizationId = orgCtx.organization.id,
            employeeId = profile.id,
            latitude = location.latitude,
            longitude = location.longitude,
            accuracyMeters = location.accuracyMeters,
            isMock = location.isMock,
            isAuto = true,
        )
        when (result) {
            is AppResult.Success -> {
                diagnostics.record(GeofenceDiagnostics.Stage.SERVER, ok = true, message = "Reconciled auto check-in for $workDate (already inside).")
                notificationCoordinator.showAttendanceRecorded()
            }
            is AppResult.Failure ->
                // An "outside geofence" rejection here is expected and benign:
                // the employee simply isn't on site yet. Record quietly.
                diagnostics.record(GeofenceDiagnostics.Stage.SERVER, ok = false, message = "Reconcile check-in not applied: ${result.error.message}")
        }
        return Result.success()
    }
}
