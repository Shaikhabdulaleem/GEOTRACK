package com.geotrack.mobile.presentation.attendance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.model.DailyAttendance
import com.geotrack.mobile.domain.repository.AttendanceRepository
import com.geotrack.mobile.domain.repository.ScheduleRepository
import com.geotrack.mobile.domain.repository.SessionRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.time.ZoneId
import javax.inject.Inject

data class AttendanceDayDetail(
    val date: LocalDate,
    val isWorkingDay: Boolean,
    val shiftName: String?,
    val scheduledStart: String?,
    val scheduledEnd: String?,
    val checkIn: String?,
    val checkOut: String?,
    val workedHours: String,
    val overtimeHours: String,
    val lateMinutes: Int,
    val source: String?,
    val status: String // "Present", "Absent", "Late", "Off", "Leave", "Holiday"
)

data class WeeklyStats(
    val present: Int = 0,
    val absent: Int = 0,
    val late: Int = 0,
    val off: Int = 0,
    val leave: Int = 0,
    val overtime: Int = 0
)

data class MyAttendanceUiState(
    val isLoading: Boolean = true,
    val errorMessage: String? = null,
    val todayDetail: AttendanceDayDetail? = null,
    val weeklyStats: WeeklyStats = WeeklyStats(),
    val monthlyHistory: List<AttendanceDayDetail> = emptyList(),
    val selectedMonth: YearMonth = YearMonth.now(),
    val selectedDateDetail: AttendanceDayDetail? = null
)

@HiltViewModel
class MyAttendanceViewModel @Inject constructor(
    private val sessionRepository: SessionRepository,
    private val scheduleRepository: ScheduleRepository,
    private val attendanceRepository: AttendanceRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(MyAttendanceUiState())
    val uiState: StateFlow<MyAttendanceUiState> = _uiState.asStateFlow()

    init {
        loadMonthData(null)
    }

    fun onMonthSelected(month: YearMonth) {
        _uiState.update { it.copy(selectedMonth = month, isLoading = true) }
        loadMonthData(month)
    }

    fun onDateSelected(date: LocalDate) {
        val detail = _uiState.value.monthlyHistory.find { it.date == date }
        _uiState.update { it.copy(selectedDateDetail = detail) }
    }

    fun clearSelectedDate() {
        _uiState.update { it.copy(selectedDateDetail = null) }
    }

    fun clearError() {
        _uiState.update { it.copy(errorMessage = null) }
    }

    private fun loadMonthData(requestedMonth: YearMonth?) {
        viewModelScope.launch {
            val orgCtx = sessionRepository.organizationContext.firstOrNull()
            val profile = sessionRepository.employeeProfile.firstOrNull()

            if (orgCtx == null || profile == null) {
                _uiState.update { it.copy(isLoading = false, errorMessage = "Session not found") }
                return@launch
            }

            val zone = runCatching { ZoneId.of(orgCtx.organization.timezone) }.getOrDefault(ZoneId.of("UTC"))
            val month = requestedMonth ?: YearMonth.now(zone)

            val startDate = month.atDay(1)
            val endDate = month.atEndOfMonth()
            
            // Also need current week for Weekly Stats, even if it spans months. For simplicity, we just use the current month's week or fetch specifically.
            // Let's just fetch from Start of Month minus 7 days to End of Month.
            val fetchStart = startDate.minusDays(7)

            val scheduleResult = scheduleRepository.getScheduleWindow(
                orgCtx.organization.id,
                profile.id,
                fetchStart,
                endDate
            )

            val attendanceResult = attendanceRepository.getAttendanceWindow(
                orgCtx.organization.id,
                profile.id,
                fetchStart,
                endDate
            )

            if (scheduleResult is AppResult.Success && attendanceResult is AppResult.Success) {
                val schedules = scheduleResult.value
                val attendances = attendanceResult.value.associateBy { it.date }

                val details = schedules.map { sched ->
                    val att = attendances[sched.date]
                    val isWorking = sched.state == com.geotrack.mobile.domain.model.TodayScheduleState.WORKING_DAY
                    
                    var status = sched.state.name
                    if (isWorking) {
                        status = when {
                            att != null && att.status.equals("present", ignoreCase = true) -> "Present"
                            att != null && att.status.equals("late", ignoreCase = true) -> "Late"
                            sched.date.isBefore(LocalDate.now(zone)) && att == null -> "Absent"
                            else -> "Scheduled"
                        }
                    } else if (sched.state == com.geotrack.mobile.domain.model.TodayScheduleState.OFF_DAY) {
                        status = "Off"
                    } else if (sched.state == com.geotrack.mobile.domain.model.TodayScheduleState.LEAVE) {
                        status = "Leave"
                    } else if (sched.state == com.geotrack.mobile.domain.model.TodayScheduleState.HOLIDAY) {
                        status = "Holiday"
                    }

                    AttendanceDayDetail(
                        date = sched.date,
                        isWorkingDay = isWorking,
                        shiftName = sched.shiftName,
                        scheduledStart = sched.startTime,
                        scheduledEnd = sched.endTime,
                        checkIn = att?.checkInAt?.let { parseTime(it) },
                        checkOut = att?.checkOutAt?.let { parseTime(it) },
                        workedHours = formatMinutes(att?.workedMinutes ?: 0),
                        overtimeHours = formatMinutes(att?.overtimeMinutes ?: 0),
                        lateMinutes = att?.lateMinutes ?: 0,
                        source = att?.source,
                        status = status
                    )
                }

                val today = LocalDate.now(zone)
                val todayDetail = details.find { it.date == today }
                
                // Calculate this week (Monday to Sunday)
                val dayOfWeek = today.dayOfWeek.value
                val weekStart = today.minusDays(dayOfWeek.toLong() - 1)
                val weekEnd = weekStart.plusDays(6)
                
                val thisWeekDetails = details.filter { it.date in weekStart..weekEnd }
                val weeklyStats = WeeklyStats(
                    present = thisWeekDetails.count { it.status == "Present" },
                    absent = thisWeekDetails.count { it.status == "Absent" },
                    late = thisWeekDetails.count { it.status == "Late" },
                    off = thisWeekDetails.count { it.status == "Off" },
                    leave = thisWeekDetails.count { it.status == "Leave" },
                    overtime = thisWeekDetails.count { it.overtimeHours != "0h 0m" }
                )

                _uiState.update {
                    it.copy(
                        isLoading = false,
                        selectedMonth = month,
                        todayDetail = todayDetail,
                        weeklyStats = weeklyStats,
                        monthlyHistory = details.filter { d -> d.date.month == month.month && d.date.year == month.year }
                    )
                }

            } else {
                _uiState.update { it.copy(isLoading = false, errorMessage = "Failed to load attendance") }
            }
        }
    }

    private fun formatMinutes(minutes: Int): String {
        val h = minutes / 60
        val m = minutes % 60
        return "${h}h ${m}m"
    }

    private fun parseTime(isoString: String): String {
        return try {
            val zdt = java.time.ZonedDateTime.parse(isoString)
            zdt.format(DateTimeFormatter.ofPattern("hh:mm a"))
        } catch (e: Exception) {
            isoString
        }
    }
}
