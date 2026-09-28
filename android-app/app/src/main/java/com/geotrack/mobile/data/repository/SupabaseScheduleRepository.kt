package com.geotrack.mobile.data.repository

import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.data.remote.dto.HolidayDto
import com.geotrack.mobile.data.remote.dto.LeaveRequestDto
import com.geotrack.mobile.data.remote.dto.ShiftAssignmentWithShiftDto
import com.geotrack.mobile.data.remote.dto.WeeklyOffDto
import com.geotrack.mobile.data.remote.supabase.SupabaseClientHolder
import com.geotrack.mobile.database.GeoTrackDatabase
import com.geotrack.mobile.database.CachedScheduleEntity
import com.geotrack.mobile.domain.model.DailySchedule
import com.geotrack.mobile.domain.model.TodaySchedule
import com.geotrack.mobile.domain.model.TodayScheduleState
import com.geotrack.mobile.domain.repository.ScheduleRepository
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SupabaseScheduleRepository @Inject constructor(
    private val clientHolder: SupabaseClientHolder,
    private val database: GeoTrackDatabase,
) : ScheduleRepository {

    override suspend fun getTodaySchedule(
        organizationId: String,
        employeeId: String,
        today: LocalDate
    ): AppResult<TodaySchedule> {
        val endWindow = today.plusDays(30)
        
        return when (val windowResult = getScheduleWindow(organizationId, employeeId, today, endWindow)) {
            is AppResult.Success -> {
                val scheduleList = windowResult.value
                if (scheduleList.isEmpty()) {
                    return AppResult.Failure(com.geotrack.mobile.core.common.AppError.Unknown("No schedule returned"))
                }
                
                val todaySchedule = scheduleList.first()
                val nextWorkingDay = scheduleList.drop(1).firstOrNull { it.state == TodayScheduleState.WORKING_DAY }
                val nextOffDay = scheduleList.drop(1).firstOrNull { it.state == TodayScheduleState.OFF_DAY }
                
                AppResult.Success(TodaySchedule(todaySchedule, nextWorkingDay, nextOffDay))
            }
            is AppResult.Failure -> windowResult
        }
    }

    override suspend fun getScheduleWindow(
        organizationId: String,
        employeeId: String,
        startDate: LocalDate,
        endDate: LocalDate
    ): AppResult<List<DailySchedule>> {
        val client = clientHolder.client ?: return AppResult.Failure(com.geotrack.mobile.core.common.AppError.Configuration("Supabase not configured"))
        
        return try {
            // 1. Fetch shift assignments
            val assignments = client.postgrest["shift_assignments"]
                .select(columns = Columns.raw("*, shift:shifts(*)")) {
                    filter {
                        eq("organization_id", organizationId)
                        eq("employee_id", employeeId)
                        gte("work_date", startDate.toString())
                        lte("work_date", endDate.toString())
                    }
                }.decodeList<ShiftAssignmentWithShiftDto>()
                
            // 2. Fetch holidays
            val holidays = client.postgrest["holidays"]
                .select {
                    filter {
                        eq("organization_id", organizationId)
                        gte("holiday_date", startDate.toString())
                        lte("holiday_date", endDate.toString())
                    }
                }.decodeList<HolidayDto>()
                
            // 3. Fetch leave requests
            val leaves = client.postgrest["leave_requests"]
                .select {
                    filter {
                        eq("organization_id", organizationId)
                        eq("employee_id", employeeId)
                        eq("status", "approved")
                        lte("from_date", endDate.toString())
                        gte("to_date", startDate.toString())
                    }
                }.decodeList<LeaveRequestDto>()
                
            // 4. Fetch weekly offs
            val weeklyOffs = client.postgrest["weekly_offs"]
                .select {
                    filter {
                        eq("organization_id", organizationId)
                        eq("employee_id", employeeId)
                    }
                }.decodeList<WeeklyOffDto>()
                
            val daysCount = ChronoUnit.DAYS.between(startDate, endDate).toInt()
                
            // Calculate daily state for each day in window
            val scheduleList = (0..daysCount).map { daysOffset ->
                val date = startDate.plusDays(daysOffset.toLong())
                val dateStr = date.toString()
                
                // Is Leave?
                val leave = leaves.firstOrNull { dateStr >= it.fromDate && dateStr <= it.toDate }
                if (leave != null) {
                    return@map DailySchedule(date, TodayScheduleState.LEAVE, reason = leave.leaveType)
                }

                // A holiday is organization-wide and takes precedence over a
                // normal assignment. A temporary assignment can still
                // intentionally override a weekly-off rule below.
                val holiday = holidays.firstOrNull { it.holidayDate == dateStr }
                if (holiday != null) {
                    return@map DailySchedule(date, TodayScheduleState.HOLIDAY, reason = holiday.name)
                }
                
                // Has shift assignment?
                val assignment = assignments.firstOrNull { it.workDate == dateStr }
                if (assignment != null) {
                    if (assignment.status == "off") {
                        return@map DailySchedule(date, TodayScheduleState.OFF_DAY)
                    }
                    if (assignment.status == "scheduled") {
                        return@map DailySchedule(
                            date = date,
                            state = TodayScheduleState.WORKING_DAY,
                            shiftAssignmentId = assignment.id,
                            shiftName = assignment.shift?.name,
                            startTime = assignment.shift?.startTime,
                            endTime = assignment.shift?.endTime,
                            crossesMidnight = assignment.shift?.crossesMidnight ?: false,
                        )
                    }
                }
                
                // Is Weekly Off?
                val weekday = date.dayOfWeek.value - 1 // 0=Monday, 6=Sunday
                val isWeeklyOff = weeklyOffs.any { off ->
                    off.weekday == weekday &&
                        (off.effectiveFrom == null || dateStr >= off.effectiveFrom) &&
                        (off.effectiveTo == null || dateStr <= off.effectiveTo)
                }
                if (isWeeklyOff) {
                    return@map DailySchedule(date, TodayScheduleState.OFF_DAY)
                }
                
                // Default to working day if no specific schedule
                DailySchedule(date, TodayScheduleState.WORKING_DAY, shiftName = "No Shift Assigned")
            }
            
            database.workforceCacheDao().upsertSchedules(scheduleList.map { row -> CachedScheduleEntity(employeeId, row.date.toString(), row.state.name, row.shiftAssignmentId, row.shiftName, row.startTime, row.endTime, row.crossesMidnight, System.currentTimeMillis()) })
            AppResult.Success(scheduleList)
            
        } catch (e: Exception) {
            val cached = database.workforceCacheDao().schedules(employeeId, startDate.toString(), endDate.toString())
            if (cached.isNotEmpty()) {
                AppResult.Success(cached.map { row -> DailySchedule(LocalDate.parse(row.workDate), runCatching { TodayScheduleState.valueOf(row.state) }.getOrDefault(TodayScheduleState.WORKING_DAY), row.assignmentId, row.shiftName, row.startTime, row.endTime, row.crossesMidnight) })
            } else AppResult.Failure(com.geotrack.mobile.core.common.AppError.Unknown(e.message ?: "Unknown", e))
        }
    }
}
