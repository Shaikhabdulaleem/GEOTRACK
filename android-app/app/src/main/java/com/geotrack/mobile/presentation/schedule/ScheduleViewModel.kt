package com.geotrack.mobile.presentation.schedule

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.model.DailySchedule
import com.geotrack.mobile.domain.model.TodayScheduleState
import com.geotrack.mobile.domain.repository.ScheduleRepository
import com.geotrack.mobile.domain.repository.SessionRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ScheduleUiState(
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,

    val today: DailySchedule? = null,
    val nextWorkingDay: DailySchedule? = null,
    val nextOffDay: DailySchedule? = null,
    
    val currentMonth: String = "",
    val monthlyWorkingDays: Int = 0,
    val monthlyOffDays: Int = 0,
    
    // All days in the current month to show in the list/calendar
    val monthSchedules: List<DailySchedule> = emptyList()
)

@HiltViewModel
class ScheduleViewModel @Inject constructor(
    private val sessionRepository: SessionRepository,
    private val scheduleRepository: ScheduleRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ScheduleUiState())
    val uiState: StateFlow<ScheduleUiState> = _uiState.asStateFlow()

    init {
        loadSchedule()
    }

    /**
     * Re-fetch the schedule. Called on screen resume (so a shift/off change made
     * in the dashboard is shown as soon as the employee opens the screen, e.g.
     * after tapping the push notification) and on manual pull-to-refresh.
     */
    fun refresh() = loadSchedule(isManual = true)

    private fun loadSchedule(isManual: Boolean = false) {
        viewModelScope.launch {
            _uiState.update { if (isManual) it.copy(isRefreshing = true) else it }
            val ctx = sessionRepository.organizationContext.first()
            val profile = sessionRepository.employeeProfile.first()

            if (ctx == null || profile == null) {
                _uiState.update { it.copy(isLoading = false, isRefreshing = false) }
                return@launch
            }
            
            val zone = runCatching { ZoneId.of(ctx.organization.timezone) }.getOrDefault(ZoneId.of("UTC"))
            val today = LocalDate.now(zone)
            
            // We need:
            // 1. Current month data (for the list and stats)
            // 2. Data from today onwards (for Today, Next Working, Next Off)
            
            val monthStart = YearMonth.from(today).atDay(1)
            val monthEnd = YearMonth.from(today).atEndOfMonth()
            
            // We fetch from monthStart up to today + 30 days to cover both requirements
            val fetchEnd = if (today.plusDays(30) > monthEnd) today.plusDays(30) else monthEnd
            
            val result = scheduleRepository.getScheduleWindow(ctx.organization.id, profile.id, monthStart, fetchEnd)
            
            if (result is AppResult.Success) {
                val allDays = result.value
                
                // Month data
                val monthDays = allDays.filter { it.date.month == today.month && it.date.year == today.year }
                val workingCount = monthDays.count { it.state == TodayScheduleState.WORKING_DAY }
                val offCount = monthDays.count { it.state != TodayScheduleState.WORKING_DAY }
                
                // Future data
                val futureDays = allDays.filter { !it.date.isBefore(today) }
                val todaySched = futureDays.firstOrNull { it.date == today }
                val nextWorking = futureDays.drop(1).firstOrNull { it.state == TodayScheduleState.WORKING_DAY }
                val nextOff = futureDays.drop(1).firstOrNull { it.state == TodayScheduleState.OFF_DAY }
                
                _uiState.update { state ->
                    state.copy(
                        isLoading = false,
                        isRefreshing = false,
                        today = todaySched,
                        nextWorkingDay = nextWorking,
                        nextOffDay = nextOff,
                        currentMonth = today.month.name,
                        monthlyWorkingDays = workingCount,
                        monthlyOffDays = offCount,
                        monthSchedules = monthDays
                    )
                }
            } else {
                _uiState.update { it.copy(isLoading = false, isRefreshing = false) }
            }
        }
    }
}
