package com.geotrack.mobile.phoneusage

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.model.TodayScheduleState
import com.geotrack.mobile.domain.repository.PhoneUsageRepository
import com.geotrack.mobile.domain.repository.PhoneUsageSyncInput
import com.geotrack.mobile.domain.repository.ScheduleRepository
import com.geotrack.mobile.domain.repository.SessionRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.firstOrNull
import com.geotrack.mobile.core.session.WorkerSessionBootstrapper

@Singleton
class PhoneUsageScheduler @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    fun onAuthenticated() {
        val manager = WorkManager.getInstance(context)
        manager.enqueueUniqueWork("phone-usage-sync-now", ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<PhoneUsageSyncWorker>().build())
        manager.enqueueUniquePeriodicWork("phone-usage-sync", ExistingPeriodicWorkPolicy.UPDATE, PeriodicWorkRequestBuilder<PhoneUsageSyncWorker>(6, TimeUnit.HOURS).build())
    }

    fun onSignedOut() {
        WorkManager.getInstance(context).apply {
            cancelUniqueWork("phone-usage-sync-now")
            cancelUniqueWork("phone-usage-sync")
        }
    }
}

@HiltWorker
class PhoneUsageSyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val sessions: SessionRepository,
    private val schedules: ScheduleRepository,
    private val reader: PhoneUsageReader,
    private val repository: PhoneUsageRepository,
    private val sessionBootstrapper: WorkerSessionBootstrapper,
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val context = sessionBootstrapper.restore() ?: return Result.success()
        val employee = sessions.employeeProfile.firstOrNull() ?: return Result.success()
        val zone = runCatching { ZoneId.of(context.organization.timezone) }.getOrDefault(ZoneId.systemDefault())
        val today = LocalDate.now(zone)
        val scheduleResult = schedules.getScheduleWindow(context.organization.id, employee.id, today.minusDays(1), today)
        val scheduleList = (scheduleResult as? AppResult.Success)?.value ?: return Result.retry()
        val deviceId = applicationContext.getSharedPreferences("phone-usage", Context.MODE_PRIVATE)
            .getString("device_id", null) ?: UUID.randomUUID().toString().also {
                applicationContext.getSharedPreferences("phone-usage", Context.MODE_PRIVATE).edit().putString("device_id", it).apply()
            }
        var hadFailure = false
        scheduleList.filter { it.state == TodayScheduleState.WORKING_DAY && !it.shiftName.isNullOrBlank() && !it.startTime.isNullOrBlank() && !it.endTime.isNullOrBlank() }.forEach { schedule ->
            val start = parse(schedule.date, schedule.startTime!!, zone)
            var end = parse(schedule.date, schedule.endTime!!, zone)
            if (schedule.crossesMidnight || !end.isAfter(start)) end = end.plusDays(1)
            val measurement = reader.measure(start.toInstant(), end.toInstant())
            val shiftMinutes = Duration.between(start, end).toMinutes().toInt().coerceAtLeast(0)
            val usage = measurement.phoneUsageMinutes
            val percentage = usage?.let { if (shiftMinutes > 0) (it.toDouble() / shiftMinutes * 100.0).coerceIn(0.0, 100.0) else 0.0 }
            val result = repository.sync(
                PhoneUsageSyncInput(
                    organizationId = context.organization.id,
                    employeeId = employee.id,
                    deviceId = deviceId,
                    date = schedule.date,
                    shiftAssignmentId = schedule.shiftAssignmentId,
                    totalShiftMinutes = shiftMinutes,
                    phoneUsageMinutes = usage,
                    usagePercentage = percentage,
                    status = measurement.status.name.lowercase(),
                    consentVersion = "usage_access_v1",
                ),
            )
            if (result is AppResult.Failure) hadFailure = true
        }
        return if (hadFailure) Result.retry() else Result.success()
    }

    private fun parse(date: LocalDate, value: String, zone: ZoneId) =
        java.time.ZonedDateTime.of(date, LocalTime.parse(value.take(8)), zone)
}
