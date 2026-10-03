package com.geotrack.mobile.domain.model

import java.time.LocalDate

enum class TodayScheduleState {
    WORKING_DAY,
    OFF_DAY,
    LEAVE,
    HOLIDAY,
    CANCELLED,
    UNASSIGNED
}

data class DailySchedule(
    val date: LocalDate,
    val state: TodayScheduleState,
    val shiftAssignmentId: String? = null,
    val recurringScheduleId: String? = null,
    val shiftId: String? = null,
    val shiftName: String? = null,
    val startTime: String? = null,
    val endTime: String? = null,
    val crossesMidnight: Boolean = false,
    val reason: String? = null,
    val source: String = "unassigned",
    val breakMinutes: Int? = null,
)

data class TodaySchedule(
    val today: DailySchedule,
    val nextWorkingDay: DailySchedule?,
    val nextOffDay: DailySchedule?
)

data class RecurringSchedule(
    val id: String,
    val employeeId: String,
    val effectiveFrom: LocalDate,
    val effectiveTo: LocalDate?,
    val rules: List<RecurringWeekdayRule>,
)

data class RecurringWeekdayRule(
    /** PostgreSQL weekday: Sunday=0 through Saturday=6. */
    val weekday: Int,
    val shiftId: String?,
    val isOff: Boolean,
)
