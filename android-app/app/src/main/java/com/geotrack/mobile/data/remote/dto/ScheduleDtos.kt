package com.geotrack.mobile.data.remote.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ShiftAssignmentWithShiftDto(
    val id: String,
    @SerialName("employee_id") val employeeId: String? = null,
    @SerialName("shift_id") val shiftId: String? = null,
    @SerialName("work_date") val workDate: String,
    val status: String,
    val shift: ShiftDto? = null
)

@Serializable
data class HolidayDto(
    val id: String,
    @SerialName("holiday_date") val holidayDate: String,
    val name: String,
)

@Serializable
data class LeaveRequestDto(
    val id: String,
    @SerialName("employee_id") val employeeId: String? = null,
    @SerialName("leave_type") val leaveType: String,
    @SerialName("from_date") val fromDate: String,
    @SerialName("to_date") val toDate: String,
    val status: String,
)

@Serializable
data class WeeklyOffDto(
    val id: String,
    @SerialName("employee_id") val employeeId: String? = null,
    @SerialName("effective_from") val effectiveFrom: String? = null,
    @SerialName("effective_to") val effectiveTo: String? = null,
    val weekday: Int,
)

@Serializable
data class ResolvedScheduleDto(
    @SerialName("work_date") val workDate: String,
    val state: String,
    val source: String,
    @SerialName("shift_assignment_id") val shiftAssignmentId: String? = null,
    @SerialName("recurring_schedule_id") val recurringScheduleId: String? = null,
    @SerialName("shift_id") val shiftId: String? = null,
    @SerialName("shift_name") val shiftName: String? = null,
    @SerialName("start_time") val startTime: String? = null,
    @SerialName("end_time") val endTime: String? = null,
    @SerialName("break_minutes") val breakMinutes: Int? = null,
    @SerialName("crosses_midnight") val crossesMidnight: Boolean = false,
    val reason: String? = null,
)

@Serializable
data class ResolveScheduleArgs(
    @SerialName("p_employee_id") val employeeId: String,
    @SerialName("p_start_date") val startDate: String,
    @SerialName("p_end_date") val endDate: String,
)

@Serializable
data class RecurringScheduleDto(
    val id: String,
    @SerialName("organization_id") val organizationId: String,
    @SerialName("employee_id") val employeeId: String,
    @SerialName("effective_from") val effectiveFrom: String,
    @SerialName("effective_to") val effectiveTo: String? = null,
    val status: String,
)

@Serializable
data class RecurringScheduleRuleDto(
    val id: String,
    @SerialName("schedule_id") val scheduleId: String,
    val weekday: Int,
    @SerialName("shift_id") val shiftId: String? = null,
    @SerialName("is_off") val isOff: Boolean,
)
