package com.geotrack.mobile.data.repository

import com.geotrack.mobile.core.common.AppError
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.data.remote.dto.AttendanceRecordDto
import com.geotrack.mobile.data.remote.dto.EmployeeProfileDto
import com.geotrack.mobile.data.remote.dto.OvertimeRecordDto
import com.geotrack.mobile.data.remote.dto.ProductivityRecordDto
import com.geotrack.mobile.data.remote.dto.ResolvedScheduleDto
import com.geotrack.mobile.data.remote.supabase.SupabaseClientHolder
import com.geotrack.mobile.domain.model.ManagerDashboard
import com.geotrack.mobile.domain.model.ManagerEmployeeRow
import com.geotrack.mobile.domain.model.ManagerMetrics
import com.geotrack.mobile.domain.repository.ManagerRepository
import io.github.jan.supabase.postgrest.postgrest
import java.time.LocalDate
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
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

            val schedules = employees.associate { employee ->
                employee.id to client.postgrest.rpc(
                    "resolve_employee_schedule",
                    buildJsonObject { put("p_employee_id", employee.id); put("p_start_date", date.toString()); put("p_end_date", date.toString()) },
                ).decodeList<ResolvedScheduleDto>().firstOrNull()
            }

            val attendance = client.postgrest["attendance_records"].select {
                filter {
                    eq("organization_id", organizationId)
                    eq("attendance_date", date.toString())
                }
            }.decodeList<AttendanceRecordDto>()
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
            val rows = employees.map { employee ->
                employeeRow(employee, schedules[employee.id], attendance, overtimeByAttendance, productivity, date)
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
        schedule: ResolvedScheduleDto?,
        attendance: List<AttendanceRecordDto>,
        overtimeByAttendance: Map<String, List<OvertimeRecordDto>>,
        productivity: List<ProductivityRecordDto>,
        date: LocalDate,
    ): ManagerEmployeeRow {
        // The standard assignment DTO is intentionally minimal. The employee_id is selected
        // separately so that this mapping remains safe if the shift relationship is absent.
        val employeeAttendance = attendance.firstOrNull { it.employeeId == employee.id }
        val status = when {
            schedule?.state == "leave" -> "On Leave"
            schedule?.state == "off" || schedule?.state == "holiday" || schedule?.state == "cancelled" -> "OFF Today"
            employeeAttendance?.status == "outside_geofence" -> "Geofence Exception"
            employeeAttendance?.status == "late" -> "Late"
            employeeAttendance?.status == "present" && employeeAttendance.checkInAt != null && employeeAttendance.checkOutAt == null -> "Currently Working"
            employeeAttendance?.status == "present" -> "Present"
            employeeAttendance?.status == "absent" -> "Absent"
            else -> "Not Checked In"
        }
        val currentlyWorking = employeeAttendance?.checkInAt != null && employeeAttendance.checkOutAt == null && schedule?.state == "working"
        val overtimeMinutes = employeeAttendance?.let { overtimeByAttendance[it.id].orEmpty().sumOf { row -> row.approvedMinutes ?: row.requestedMinutes } } ?: 0
        val employeeProductivity = productivity.filter { it.employeeId == employee.id && it.workDate == date.toString() }
        val productivityPercent = employeeProductivity.mapNotNull { it.productivityPercent }.average().takeIf { employeeProductivity.any { it.productivityPercent != null } }
        val shift = schedule?.shiftName?.let { "$it ${schedule.startTime}–${schedule.endTime}" } ?: "No shift assigned"
        return ManagerEmployeeRow(employee.id, employee.fullName, employee.employeeCode, status, shift, schedule?.reason ?: schedule?.source ?: "—", overtimeMinutes, productivityPercent, currentlyWorking)
    }
}
