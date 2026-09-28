package com.geotrack.mobile.domain.model

import java.time.LocalDate

data class ManagerDashboard(
    val date: LocalDate,
    val metrics: ManagerMetrics,
    val employees: List<ManagerEmployeeRow>,
)

data class ManagerMetrics(
    val totalTeam: Int = 0,
    val present: Int = 0,
    val absent: Int = 0,
    val late: Int = 0,
    val onLeave: Int = 0,
    val offToday: Int = 0,
    val notCheckedIn: Int = 0,
    val currentlyWorking: Int = 0,
    val overtime: Int = 0,
    val geofenceExceptions: Int = 0,
)

data class ManagerEmployeeRow(
    val id: String,
    val name: String,
    val employeeCode: String,
    val attendanceStatus: String,
    val shift: String,
    val weeklyOff: String,
    val overtimeMinutes: Int,
    val productivityPercent: Double?,
    val currentlyWorking: Boolean = false,
)
