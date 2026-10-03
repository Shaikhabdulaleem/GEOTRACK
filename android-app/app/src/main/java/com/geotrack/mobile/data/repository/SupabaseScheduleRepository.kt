package com.geotrack.mobile.data.repository

import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.data.remote.dto.ResolvedScheduleDto
import com.geotrack.mobile.data.remote.supabase.SupabaseClientHolder
import com.geotrack.mobile.database.CachedScheduleEntity
import com.geotrack.mobile.database.GeoTrackDatabase
import com.geotrack.mobile.domain.model.DailySchedule
import com.geotrack.mobile.domain.model.TodaySchedule
import com.geotrack.mobile.domain.model.TodayScheduleState
import com.geotrack.mobile.domain.repository.ScheduleRepository
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.LocalDate
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SupabaseScheduleRepository @Inject constructor(
    private val clientHolder: SupabaseClientHolder,
    private val database: GeoTrackDatabase,
) : ScheduleRepository {
    override suspend fun getTodaySchedule(organizationId: String, employeeId: String, today: LocalDate): AppResult<TodaySchedule> {
        return when (val window = getScheduleWindow(organizationId, employeeId, today, today.plusDays(30))) {
            is AppResult.Failure -> window
            is AppResult.Success -> {
                val current = window.value.firstOrNull()
                    ?: return AppResult.Failure(com.geotrack.mobile.core.common.AppError.Unknown("No schedule returned"))
                AppResult.Success(TodaySchedule(
                    today = current,
                    nextWorkingDay = window.value.drop(1).firstOrNull { it.state == TodayScheduleState.WORKING_DAY },
                    nextOffDay = window.value.drop(1).firstOrNull { it.state == TodayScheduleState.OFF_DAY },
                ))
            }
        }
    }

    override suspend fun getScheduleWindow(organizationId: String, employeeId: String, startDate: LocalDate, endDate: LocalDate): AppResult<List<DailySchedule>> {
        val client = clientHolder.client ?: return AppResult.Failure(com.geotrack.mobile.core.common.AppError.Configuration("Supabase not configured"))
        return try {
            val rows = client.postgrest.rpc(
                function = "resolve_employee_schedule",
                parameters = buildJsonObject { put("p_employee_id", employeeId); put("p_start_date", startDate.toString()); put("p_end_date", endDate.toString()) },
            ).decodeList<ResolvedScheduleDto>().map { it.toDomain() }
            database.workforceCacheDao().upsertSchedules(rows.map { row -> CachedScheduleEntity(employeeId, row.date.toString(), row.state.name, row.shiftAssignmentId, row.shiftName, row.startTime, row.endTime, row.crossesMidnight, System.currentTimeMillis()) })
            AppResult.Success(rows)
        } catch (error: Exception) {
            val cached = database.workforceCacheDao().schedules(employeeId, startDate.toString(), endDate.toString())
            if (cached.isEmpty()) AppResult.Failure(com.geotrack.mobile.core.common.AppError.Unknown(error.message ?: "Unable to resolve schedule", error))
            else AppResult.Success(cached.map { row -> DailySchedule(
                date = LocalDate.parse(row.workDate),
                state = runCatching { TodayScheduleState.valueOf(row.state) }.getOrDefault(TodayScheduleState.UNASSIGNED),
                shiftAssignmentId = row.assignmentId,
                shiftName = row.shiftName,
                startTime = row.startTime,
                endTime = row.endTime,
                crossesMidnight = row.crossesMidnight,
                source = "offline_cache",
            ) })
        }
    }

    private fun ResolvedScheduleDto.toDomain() = DailySchedule(
        date = LocalDate.parse(workDate),
        state = when (state) {
            "working" -> TodayScheduleState.WORKING_DAY
            "off" -> TodayScheduleState.OFF_DAY
            "leave" -> TodayScheduleState.LEAVE
            "holiday" -> TodayScheduleState.HOLIDAY
            "cancelled" -> TodayScheduleState.CANCELLED
            else -> TodayScheduleState.UNASSIGNED
        },
        shiftAssignmentId = shiftAssignmentId,
        recurringScheduleId = recurringScheduleId,
        shiftId = shiftId,
        shiftName = shiftName,
        startTime = startTime,
        endTime = endTime,
        crossesMidnight = crossesMidnight,
        reason = reason,
        source = source,
        breakMinutes = breakMinutes,
    )
}
