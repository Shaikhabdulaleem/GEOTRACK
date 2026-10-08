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
import com.geotrack.mobile.domain.model.TodayScheduleState
import com.geotrack.mobile.domain.repository.AttendanceRepository
import com.geotrack.mobile.domain.repository.ScheduleRepository
import com.geotrack.mobile.domain.repository.SessionRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.flow.firstOrNull
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.TimeUnit

/**
 * Periodic in-shift location heartbeat. While an employee has an open
 * attendance session, this posts a classified location sample every ~15 minutes
 * (WorkManager's minimum periodic interval) so the server-side detector can
 * catch sustained out-of-geofence breaches that the one-shot geofence EXIT would
 * otherwise miss (undelivered transitions, "while-in-use" permission, standing
 * just outside). It never checks the employee in or out — that stays with the
 * geofence transitions and the attendance engine.
 */
object LocationHeartbeatScheduler {
    private const val UNIQUE_NOW = "location-heartbeat-now"
    private const val UNIQUE_PERIODIC = "location-heartbeat"

    fun enqueue(context: Context) {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            UNIQUE_NOW,
            ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<LocationHeartbeatWorker>().setConstraints(constraints).build(),
        )
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            UNIQUE_PERIODIC,
            ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<LocationHeartbeatWorker>(15, TimeUnit.MINUTES).setConstraints(constraints).build(),
        )
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_NOW)
        WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_PERIODIC)
    }
}

@HiltWorker
class LocationHeartbeatWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted workerParams: WorkerParameters,
    private val sessionRepository: SessionRepository,
    private val scheduleRepository: ScheduleRepository,
    private val attendanceRepository: AttendanceRepository,
    private val locationTracker: LocationTracker,
    private val sessionBootstrapper: WorkerSessionBootstrapper,
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result {
        val orgCtx = sessionBootstrapper.restore() ?: return Result.success()
        val profile = sessionRepository.employeeProfile.firstOrNull() ?: return Result.success()

        val zone = runCatching { ZoneId.of(orgCtx.organization.timezone) }.getOrDefault(ZoneId.of("UTC"))
        val today = LocalDate.now(zone)

        // Only track on a working day with an open session (checked in, not out).
        val scheduleResult = scheduleRepository.getTodaySchedule(orgCtx.organization.id, profile.id, today)
        if (scheduleResult !is AppResult.Success) return Result.success()
        if (scheduleResult.value.today.state != TodayScheduleState.WORKING_DAY) return Result.success()

        val attendanceResult = attendanceRepository.getAttendanceForDate(orgCtx.organization.id, profile.id, today)
        val checkedIn = attendanceResult is AppResult.Success &&
            attendanceResult.value?.checkInAt != null &&
            attendanceResult.value?.checkOutAt == null
        if (!checkedIn) return Result.success()

        // A missing fix this cycle is fine; the next heartbeat will try again.
        val location = locationTracker.getCurrentLocation() ?: return Result.success()

        attendanceRepository.recordLocationPing(
            organizationId = orgCtx.organization.id,
            employeeId = profile.id,
            latitude = location.latitude,
            longitude = location.longitude,
            accuracyMeters = location.accuracyMeters,
            isMock = location.isMock,
        )
        return Result.success()
    }
}
