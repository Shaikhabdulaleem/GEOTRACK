package com.geotrack.mobile.presentation.profile

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.geotrack.mobile.domain.model.AppRole
import com.geotrack.mobile.domain.model.EmployeeProfileInfo
import com.geotrack.mobile.domain.repository.SessionRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

data class ProfileUiState(
    val displayName: String = "",
    val email: String? = null,
    val roleLabel: String = "",
    val employeeProfile: EmployeeProfileInfo? = null,
    val organizationName: String = "",
    val departmentName: String? = null,
    val assignedSiteName: String? = null,
    val assignedShiftName: String? = null,
)

@HiltViewModel
class ProfileViewModel @Inject constructor(
    sessionRepository: SessionRepository,
) : ViewModel() {

    val uiState: StateFlow<ProfileUiState> = combine(
        sessionRepository.organizationContext,
        sessionRepository.employeeProfile,
    ) { context, empProfile ->
        ProfileUiState(
            displayName = context?.profile?.displayName ?: "",
            email = context?.profile?.email,
            roleLabel = context?.membership?.role?.label() ?: "",
            employeeProfile = empProfile,
            organizationName = context?.organization?.name ?: "",
            departmentName = context?.department?.name,
            assignedSiteName = context?.assignedSite?.name,
            assignedShiftName = context?.assignedShift?.let {
                "${it.name} (${it.startTime}–${it.endTime})"
            },
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = ProfileUiState(),
    )

    private fun AppRole.label(): String = when (this) {
        AppRole.EMPLOYEE -> "Employee"
        AppRole.MANAGER -> "Manager"
        AppRole.ADMINISTRATOR -> "Administrator"
    }
}
