package com.geotrack.mobile.presentation.manager

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.model.ManagerDashboard
import com.geotrack.mobile.domain.repository.ManagerRepository
import com.geotrack.mobile.domain.repository.SessionRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import java.time.LocalDate
import java.time.ZoneId
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ManagerUiState(
    val isLoading: Boolean = true,
    val dashboard: ManagerDashboard? = null,
    val errorMessage: String? = null,
)

@HiltViewModel
class ManagerViewModel @Inject constructor(
    private val sessions: SessionRepository,
    private val repository: ManagerRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(ManagerUiState())
    val uiState: StateFlow<ManagerUiState> = _uiState.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            val context = sessions.organizationContext.firstOrNull()
            if (context == null) {
                _uiState.update { it.copy(isLoading = false, errorMessage = "Manager session not found.") }
                return@launch
            }
            val today = LocalDate.now(ZoneId.of(context.organization.timezone))
            when (val result = repository.getDashboard(context.organization.id, today)) {
                is AppResult.Success -> _uiState.update { it.copy(isLoading = false, dashboard = result.value) }
                is AppResult.Failure -> _uiState.update { it.copy(isLoading = false, errorMessage = result.error.message) }
            }
        }
    }
}
