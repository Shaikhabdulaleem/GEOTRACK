package com.geotrack.mobile.presentation.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.model.TodayScheduleState
import com.geotrack.mobile.domain.repository.AttendanceRepository
import com.geotrack.mobile.domain.repository.ScheduleRepository
import com.geotrack.mobile.domain.repository.SessionRepository
import com.geotrack.mobile.location.LocationTracker
import com.geotrack.mobile.notifications.NotificationCoordinator
import dagger.hilt.android.lifecycle.HiltViewModel
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class DashboardUiState(
    val isLoading: Boolean = true,
    val isCheckingIn: Boolean = false,
    val greeting: String = "Good day",
    val employeeName: String? = null,
    
    // Schedule state
    val scheduleState: TodayScheduleState = TodayScheduleState.WORKING_DAY,
    val shiftName: String? = null,
    val shiftStartTime: String? = null,
    val shiftEndTime: String? = null,
    val reason: String? = null,
    
    val nextWorkingDate: String? = null,
    val nextShiftName: String? = null,
    val nextOffDate: String? = null,

    // Attendance stats
    val isCheckedIn: Boolean = false,
    val checkInTimeStr: String? = null,
    val currentTime: String = "",
    val todayWorkedDisplay: String = "0h 0m",
    val todayOvertimeDisplay: String = "0h 0m",
    val isInsideGeofence: Boolean = false,
    
    val errorMessage: String? = null,
    val successMessage: String? = null,
    
    // Device Status
    val hasForegroundLocation: Boolean = false,
    val hasBackgroundLocation: Boolean = false,
    val isGpsEnabled: Boolean = false,
    
    // Derived
    val isAttendanceAllowed: Boolean = true,
    val syncStatus: String? = null
)

@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val sessionRepository: SessionRepository,
    private val scheduleRepository: ScheduleRepository,
    private val attendanceRepository: AttendanceRepository,
    private val locationTracker: LocationTracker,
    private val deviceStatusTracker: com.geotrack.mobile.location.DeviceStatusTracker,
    private val notificationCoordinator: NotificationCoordinator,
) : ViewModel() {

    private val _internalState = MutableStateFlow(DashboardUiState(currentTime = formattedTime()))
    
    val uiState: StateFlow<DashboardUiState> = combine(
        _internalState,
        deviceStatusTracker.statusFlow
    ) { state, status ->
        state.copy(
            hasForegroundLocation = status.hasForegroundLocation,
            hasBackgroundLocation = status.hasBackgroundLocation,
            isGpsEnabled = status.isGpsEnabled
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = _internalState.value.copy(
            hasForegroundLocation = deviceStatusTracker.getCurrentStatus().hasForegroundLocation,
            hasBackgroundLocation = deviceStatusTracker.getCurrentStatus().hasBackgroundLocation,
            isGpsEnabled = deviceStatusTracker.getCurrentStatus().isGpsEnabled
        )
    )

    init {
        // Tick the clock every minute
        viewModelScope.launch {
            while (true) {
                delay(60_000L)
                _internalState.update { it.copy(currentTime = formattedTime()) }
            }
        }
        
        loadData()
    }
    
    private fun loadData() {
        viewModelScope.launch {
            val ctx = sessionRepository.organizationContext.first()
            val profile = sessionRepository.employeeProfile.first()
            
            if (ctx == null || profile == null) {
                _internalState.update { it.copy(isLoading = false) }
                return@launch
            }
            
            _internalState.update { it.copy(employeeName = profile.fullName, greeting = greeting()) }
            
            val zone = runCatching { ZoneId.of(ctx.organization.timezone) }.getOrDefault(ZoneId.of("UTC"))
            val today = LocalDate.now(zone)
            val yesterday = today.minusDays(1)
            val nowTime = LocalTime.now(zone)

            val schedResult = scheduleRepository.getTodaySchedule(ctx.organization.id, profile.id, today)

            // A night shift that began yesterday and crosses midnight is still the
            // active shift in the early-morning hours, so after midnight it — not
            // today's not-yet-started shift — is what the employee must check in
            // against. The server applies the same rule in process_attendance_event.
            val yesterdayActive = runCatching {
                (scheduleRepository.getScheduleWindow(ctx.organization.id, profile.id, yesterday, yesterday)
                    as? AppResult.Success)?.value?.firstOrNull()
            }.getOrNull()?.takeIf { y ->
                y.state == TodayScheduleState.WORKING_DAY && y.crossesMidnight &&
                    y.endTime?.let { et -> runCatching { nowTime <= LocalTime.parse(et) }.getOrDefault(false) } == true
            }

            val activeShift = yesterdayActive ?: (schedResult as? AppResult.Success)?.value?.today
            val attendanceDate = activeShift?.date ?: today
            val attResult = attendanceRepository.getAttendanceForDate(ctx.organization.id, profile.id, attendanceDate)

            _internalState.update { current ->
                var newState = current.copy(isLoading = false)

                if (activeShift != null) {
                    newState = newState.copy(
                        scheduleState = activeShift.state,
                        shiftName = activeShift.shiftName,
                        shiftStartTime = activeShift.startTime,
                        shiftEndTime = activeShift.endTime,
                        reason = activeShift.reason,
                        // Allow attendance whenever a real shift is scheduled for the
                        // active working day. Recurring schedules carry no dated
                        // shiftAssignmentId, so gate on shiftId (the server creates the
                        // dated assignment on first check-in for recurring shifts).
                        isAttendanceAllowed = activeShift.state == TodayScheduleState.WORKING_DAY && activeShift.shiftId != null
                    )
                }

                if (schedResult is AppResult.Success) {
                    val data = schedResult.value
                    newState = newState.copy(
                        nextWorkingDate = data.nextWorkingDay?.date?.toString(),
                        nextShiftName = data.nextWorkingDay?.shiftName,
                        nextOffDate = data.nextOffDay?.date?.toString(),
                    )
                }
                
                if (attResult is AppResult.Success) {
                    val data = attResult.value
                    if (data != null) {
                        val isCheckedIn = data.checkInAt != null && data.checkOutAt == null
                        
                        val checkInTime = data.checkInAt?.let { ts ->
                            try {
                                val t = java.time.ZonedDateTime.parse(ts)
                                t.withZoneSameInstant(zone).format(DateTimeFormatter.ofPattern("hh:mm a"))
                            } catch(e:Exception) { ts }
                        }
                        
                        val hours = data.workedMinutes / 60
                        val mins = data.workedMinutes % 60
                        
                        val otHours = data.overtimeMinutes / 60
                        val otMins = data.overtimeMinutes % 60

                        newState = newState.copy(
                            isCheckedIn = isCheckedIn,
                            checkInTimeStr = checkInTime,
                            todayWorkedDisplay = "${hours}h ${mins}m",
                            todayOvertimeDisplay = "${otHours}h ${otMins}m",
                            isInsideGeofence = data.geofenceValidated,
                            syncStatus = attendanceRepository.latestLocalSyncStatus(profile.id)
                        )
                    }
                } else {
                    newState = newState.copy(syncStatus = attendanceRepository.latestLocalSyncStatus(profile.id))
                }
                newState
            }
        }
    }

    fun onCheckIn() {
        performAttendance(isCheckIn = true)
    }

    fun onCheckOut() {
        performAttendance(isCheckIn = false)
    }
    
    private fun performAttendance(isCheckIn: Boolean) {
        viewModelScope.launch {
            val state = _internalState.value
            
            val devStatus = deviceStatusTracker.getCurrentStatus()
            if (!devStatus.hasForegroundLocation) {
                _internalState.update { it.copy(errorMessage = "Location permission is required for attendance.") }
                return@launch
            }
            if (!devStatus.isGpsEnabled) {
                _internalState.update { it.copy(errorMessage = "Please enable GPS/Location Services to check in.") }
                return@launch
            }
            
            if (state.scheduleState != TodayScheduleState.WORKING_DAY || !state.isAttendanceAllowed) {
                _internalState.update { it.copy(errorMessage = "Attendance is unavailable because no active shift is assigned today.") }
                return@launch
            }
            if (isCheckIn && state.isCheckedIn) {
                _internalState.update { it.copy(errorMessage = "Already checked in at ${state.checkInTimeStr}.") }
                return@launch
            }
            
            _internalState.update { it.copy(isCheckingIn = true, errorMessage = null, successMessage = null) }
            
            val ctx = sessionRepository.organizationContext.first()
            val profile = sessionRepository.employeeProfile.first()
            if (ctx == null || profile == null) {
                _internalState.update { it.copy(isCheckingIn = false, errorMessage = "Session error") }
                return@launch
            }
            
            val loc = locationTracker.getCurrentLocation()
            if (loc == null) {
                _internalState.update { it.copy(isCheckingIn = false, errorMessage = "Could not get location. Ensure GPS is enabled.") }
                return@launch
            }
            
            if (loc.accuracyMeters > 100) {
                _internalState.update { it.copy(isCheckingIn = false, errorMessage = "Location accuracy is too low. Please try again.") }
                return@launch
            }
            
            val result = if (isCheckIn) {
                attendanceRepository.checkIn(ctx.organization.id, profile.id, loc.latitude, loc.longitude, loc.accuracyMeters, loc.isMock)
            } else {
                attendanceRepository.checkOut(ctx.organization.id, profile.id, loc.latitude, loc.longitude, loc.accuracyMeters, loc.isMock)
            }
            
            if (result is AppResult.Success) {
                notificationCoordinator.showAttendanceRecorded()
                val syncStat = attendanceRepository.latestLocalSyncStatus(profile.id)
                val action = if (isCheckIn) "checked in" else "checked out"
                val suffix = if (syncStat == "PENDING_SYNC") " (Pending Sync)" else ""
                _internalState.update {
                    it.copy(
                        isCheckingIn = false,
                        successMessage = "Successfully $action$suffix."
                    )
                }
                loadData() // reload fresh stats
            } else if (result is AppResult.Failure) {
                if (result.error.message.contains("geofence", ignoreCase = true)) {
                    notificationCoordinator.showOutsideGeofence()
                }
                _internalState.update { it.copy(errorMessage = result.error.message, isCheckingIn = false) }
            }
        }
    }

    fun clearMessages() {
        _internalState.update { it.copy(errorMessage = null, successMessage = null) }
    }

    private companion object {
        private val timeFormatter = DateTimeFormatter.ofPattern("hh:mm a")

        fun formattedTime(): String = LocalDateTime.now().format(timeFormatter)

        fun greeting(): String = when (LocalDateTime.now().hour) {
            in 5..11 -> "Good morning"
            in 12..16 -> "Good afternoon"
            else -> "Good evening"
        }
    }
}
