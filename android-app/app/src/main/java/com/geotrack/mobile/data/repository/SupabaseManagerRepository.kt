package com.geotrack.mobile.data.repository

import com.geotrack.mobile.core.common.AppError
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.data.remote.dto.AttendanceRecordDto
import com.geotrack.mobile.data.remote.dto.EmployeeProfileDto
import com.geotrack.mobile.data.remote.dto.LeaveRequestDto
import com.geotrack.mobile.data.remote.dto.OvertimeRecordDto
import com.geotrack.mobile.data.remote.dto.ProductivityRecordDto
import com.geotrack.mobile.data.remote.dto.ShiftAssignmentWithShiftDto
import com.geotrack.mobile.data.remote.dto.WeeklyOffDto
import com.geotrack.mobile.data.remote.supabase.SupabaseClientHolder
import com.geotrack.mobile.domain.model.ManagerDashboard
import com.geotrack.mobile.domain.model.ManagerEmployeeRow
import com.geotrack.mobile.domain.model.ManagerMetrics
import com.geotrack.mobile.domain.repository.ManagerRepository
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import java.time.LocalDate
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SupabaseManagerRepository @Inject constructor(
    private val clientHolder: SupabaseClientHolder,
) : ManagerRepository {
    override suspend fun getDashboard(organizationId: String, date: LocalDate): AppResult<ManagerDashboard> {
        val client = clientHolder.client
            ?: return AppResult.Failure(AppError.Configuration("Supabase not configured"))

        return try {
            // RLS is the authoritative scope. This query never asks the client to decide
            // which employees a manager may see.
            val employees = client.postgrest["employee_profiles"].select {
                filter {
                    eq("organization_id", organizationId)
                    neq("employment_status", "terminated")
                }
            }.decodeList<EmployeeProfileDto>()
            if (employees.isEmpty()) {
                return AppResult.Success(ManagerDashboard(date, ManagerMetrics(), emptyList()))
            }

            val employeeIds = employees.map { it.id }
            val assignments = client.postgrest["shift_assignments"].select(
                columns = Columns.raw("*, shift:shifts(*)"),
            ) {
                filter {
                    eq("organization_id", organizationId)
                    eq("work_date", date.toString())
                }
            }.decodeList<ShiftAssignmentWithShiftDto>()

            val attendance = client.postgrest["attendance_records"].select {
                filter {
                    eq("organization_id", organizationId)
                    eq("attendance_date", date.toString())
                }
            }.decodeList<AttendanceRecordDto>()
            val attendanceByEmployee = attendance.associateBy { it.id }
            val attendanceIds = attendance.map { it.id }

            val overtime = if (attendanceIds.isEmpty()) emptyList() else client.postgrest["overtime_records"].select {
                filter {
                    eq("organization_id", organizationId)
                }
            }.decodeList<OvertimeRecordDto>()
            val overtimeByAttendance = overtime.groupBy { it.attendanceRecordId }

            val productivity = client.postgrest["productivity_records"].select {
                filter {
                    eq("organization_id", organizationId)
                    eq("work_date", date.toString())
                }
            }.decodeList<ProductivityRecordDto>()
            val weeklyOffs = client.postgrest["weekly_offs"].select {
                filter {
                    eq("organization_id", organizationId)
                }
            }.decodeList<WeeklyOffDto>()
            val leaves = client.postgrest["leave_requests"].select {
                filter {
                    eq("organization_id", organizationId)
                    eq("status", "approved")
                    lte("from_date", date.toString())
                    gte("to_date", date.toString())
                }
            }.decodeList<LeaveRequestDto>()

            val rows = employees.map { employee ->
                employeeRow(employee, assignments, attendance, overtimeByAttendance, weeklyOffs, leaves, productivity, date)
            }
            val metrics = ManagerMetrics(
                totalTeam = rows.size,
                present = rows.count { it.attendanceStatus == "Present" },
                absent = rows.count { it.attendanceStatus == "Absent" },
                late = rows.count { it.attendanceStatus == "Late" },
                onLeave = rows.count { it.attendanceStatus == "On Leave" },
                offToday = rows.count { it.attendanceStatus == "OFF Today" },
                notCheckedIn = rows.count { it.attendanceStatus == "Not Checked In" },
                currentlyWorking = rows.count { it.currentlyWorking },
                overtime = rows.sumOf { it.overtimeMinutes },
                geofenceExceptions = rows.count { it.attendanceStatus == "Geofence Exception" },
            )
            AppResult.Success(ManagerDashboard(date, metrics, rows))
        } catch (e: Exception) {
            AppResult.Failure(AppError.Unknown(e.message ?: "Unable to load manager dashboard", e))
        }
    }

    private fun employeeRow(
        employee: EmployeeProfileDto,
        assignments: List<ShiftAssignmentWithShiftDto>,
        attendance: List<AttendanceRecordDto>,
        overtimeByAttendance: Map<String, List<OvertimeRecordDto>>,
        weeklyOffs: List<WeeklyOffDto>,
        leaves: List<LeaveRequestDto>,
        productivity: List<ProductivityRecordDto>,
        date: LocalDate,
    ): ManagerEmployeeRow {
        // The standard assignment DTO is intentionally minimal. The employee_id is selected
        // separately so that this mapping remains safe if the shift relationship is absent.
        val assignment = assignments.firstOrNull { it.employeeId == employee.id }
        val employeeAttendance = attendance.firstOrNull { it.employeeId == employee.id }
        val leave = leaves.firstOrNull { it.employeeId == employee.id && it.fromDate <= date.toString() && it.toDate >= date.toString() }
        val weekday = date.dayOfWeek.value - 1
        val weeklyOff = weeklyOffs.firstOrNull { it.employeeId == employee.id && it.weekday == weekday && (it.effectiveFrom == null || it.effectiveFrom <= date.toString()) && (it.effectiveTo == null || it.effectiveTo >= date.toString()) }
        val status = when {
            leave != null -> "On Leave"
            assignment?.status == "off" || weeklyOff != null -> "OFF Today"
            employeeAttendance?.status == "outside_geofence" -> "Geofence Exception"
            employeeAttendance?.status == "late" -> "Late"
            employeeAttendance?.status == "present" && employeeAttendance.checkInAt != null && employeeAttendance.checkOutAt == null -> "Currently Working"
            employeeAttendance?.status == "present" -> "Present"
            employeeAttendance?.status == "absent" -> "Absent"
            else -> "Not Checked In"
        }
        val currentlyWorking = employeeAttendance?.checkInAt != null && employeeAttendance.checkOutAt == null && leave == null && assignment?.status != "off" && weeklyOff == null
        val overtimeMinutes = employeeAttendance?.let { overtimeByAttendance[it.id].orEmpty().sumOf { row -> row.approvedMinutes ?: row.requestedMinutes } } ?: 0
        val employeeProductivity = productivity.filter { it.employeeId == employee.id && it.workDate == date.toString() }
        val productivityPercent = employeeProductivity.mapNotNull { it.productivityPercent }.average().takeIf { employeeProductivity.any { it.productivityPercent != null } }
        val shift = assignment?.shift?.let { "${it.name} ${it.startTime}–${it.endTime}" } ?: "No shift assigned"
        return ManagerEmployeeRow(employee.id, employee.fullName, employee.employeeCode, status, shift, weeklyOff?.weekday?.let { "Weekly off" } ?: "—", overtimeMinutes, productivityPercent, currentlyWorking)
    }
}
