package com.geotrack.mobile.domain.model

import java.time.LocalDate

enum class TodayScheduleState {
    WORKING_DAY,
    OFF_DAY,
    LEAVE,
    HOLIDAY
}

data class DailySchedule(
    val date: LocalDate,
    val state: TodayScheduleState,
    val shiftAssignmentId: String? = null,
    val shiftName: String? = null,
    val startTime: String? = null,
    val endTime: String? = null,
    val crossesMidnight: Boolean = false,
    val reason: String? = null
)

data class TodaySchedule(
    val today: DailySchedule,
    val nextWorkingDay: DailySchedule?,
    val nextOffDay: DailySchedule?
)
