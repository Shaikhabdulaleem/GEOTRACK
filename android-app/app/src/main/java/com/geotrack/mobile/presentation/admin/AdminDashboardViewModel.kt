package com.geotrack.mobile.presentation.admin

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.repository.AdminRepository
import com.geotrack.mobile.domain.repository.SessionRepository
import com.geotrack.mobile.domain.repository.SystemSummary
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AdminDashboardUiState(
    val isLoading: Boolean = true,
    val summary: SystemSummary? = null,
    val errorMessage: String? = null
)

@HiltViewModel
class AdminDashboardViewModel @Inject constructor(
    private val sessionRepository: SessionRepository,
    private val adminRepository: AdminRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(AdminDashboardUiState())
    val uiState: StateFlow<AdminDashboardUiState> = _uiState.asStateFlow()

    init {
        loadSummary()
    }

    fun loadSummary() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            val orgCtx = sessionRepository.organizationContext.firstOrNull()
            
            if (orgCtx == null) {
                _uiState.update { it.copy(isLoading = false, errorMessage = "Session not found") }
                return@launch
            }

            when (val result = adminRepository.getSystemSummary(orgCtx.organization.id)) {
                is AppResult.Success -> {
                    _uiState.update { it.copy(isLoading = false, summary = result.value) }
                }
                is AppResult.Failure -> {
                    _uiState.update { it.copy(isLoading = false, errorMessage = result.error.message) }
                }
            }
        }
    }
}
