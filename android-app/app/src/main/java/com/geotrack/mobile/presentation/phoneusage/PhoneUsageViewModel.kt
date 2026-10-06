package com.geotrack.mobile.presentation.phoneusage

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.model.PhoneUsageDataStatus
import com.geotrack.mobile.domain.model.PhoneUsageSummary
import com.geotrack.mobile.domain.repository.PhoneUsageRepository
import com.geotrack.mobile.domain.repository.SessionRepository
import com.geotrack.mobile.phoneusage.PhoneUsageReader
import com.geotrack.mobile.notifications.AttendanceNotificationPoster
import com.geotrack.mobile.notifications.AttendanceNotificationType
import dagger.hilt.android.lifecycle.HiltViewModel
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class PhoneUsageUiState(
    val isLoading: Boolean = true,
    val permission: PhoneUsageDataStatus = PhoneUsageDataStatus.PERMISSION_NOT_GRANTED,
    val today: PhoneUsageSummary? = null,
    val history: List<PhoneUsageSummary> = emptyList(),
    val errorMessage: String? = null,
)

@HiltViewModel
class PhoneUsageViewModel @Inject constructor(
    private val sessions: SessionRepository,
    private val repository: PhoneUsageRepository,
    private val reader: PhoneUsageReader,
    private val notificationPoster: AttendanceNotificationPoster,
) : ViewModel() {
    private val _uiState = MutableStateFlow(PhoneUsageUiState())
    val uiState: StateFlow<PhoneUsageUiState> = _uiState.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            val permission = if (reader.hasUsageAccess()) PhoneUsageDataStatus.PERMISSION_GRANTED else PhoneUsageDataStatus.PERMISSION_NOT_GRANTED
            _uiState.update { it.copy(isLoading = true, permission = permission, errorMessage = null) }
            val context = sessions.organizationContext.firstOrNull()
            val employee = sessions.employeeProfile.firstOrNull()
            if (context == null || employee == null) {
                _uiState.update { it.copy(isLoading = false, errorMessage = "Session not found.") }
                return@launch
            }
            val today = LocalDate.now(ZoneId.of(context.organization.timezone))
            when (val result = repository.listOwn(context.organization.id, employee.id, today.minusDays(31), today)) {
                is AppResult.Success -> _uiState.update { it.copy(isLoading = false, today = result.value.firstOrNull { row -> row.date == today }, history = result.value) }
                is AppResult.Failure -> _uiState.update { it.copy(isLoading = false, errorMessage = result.error.message) }
            }
        }
    }

    fun usageAccessIntent() = reader.usageAccessSettingsIntent()

    fun testNotification(type: AttendanceNotificationType) = notificationPoster.postTest(type)
}
