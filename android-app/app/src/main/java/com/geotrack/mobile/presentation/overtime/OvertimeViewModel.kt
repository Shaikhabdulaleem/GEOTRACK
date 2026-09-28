package com.geotrack.mobile.presentation.overtime

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.model.OvertimeEntry
import com.geotrack.mobile.domain.model.OvertimeSummary
import com.geotrack.mobile.domain.repository.OvertimeRepository
import com.geotrack.mobile.domain.repository.SessionRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class OvertimeUiState(
    val isLoading: Boolean = true,
    val isSubmitting: Boolean = false,
    val entries: List<OvertimeEntry> = emptyList(),
    val today: OvertimeSummary = OvertimeSummary(),
    val thisWeek: OvertimeSummary = OvertimeSummary(),
    val thisMonth: OvertimeSummary = OvertimeSummary(),
    val explanationEntryId: String? = null,
    val explanationDraft: String = "",
    val errorMessage: String? = null,
    val successMessage: String? = null,
)

@HiltViewModel
class OvertimeViewModel @Inject constructor(
    private val sessions: SessionRepository,
    private val repository: OvertimeRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(OvertimeUiState())
    val uiState: StateFlow<OvertimeUiState> = _uiState.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            val context = sessions.organizationContext.firstOrNull()
            val employee = sessions.employeeProfile.firstOrNull()
            if (context == null || employee == null) {
                _uiState.update { it.copy(isLoading = false, errorMessage = "Session not found.") }
                return@launch
            }
            val today = LocalDate.now(ZoneId.of(context.organization.timezone))
            val monthStart = YearMonth.from(today).atDay(1)
            val weekStart = today.minusDays((today.dayOfWeek.value - 1).toLong())
            when (val result = repository.list(context.organization.id, employee.id, monthStart.minusDays(7), today)) {
                is AppResult.Success -> _uiState.update {
                    it.copy(
                        isLoading = false,
                        entries = result.value,
                        today = result.value.summary { date == today },
                        thisWeek = result.value.summary { date >= weekStart },
                        thisMonth = result.value.summary { date >= monthStart },
                    )
                }
                is AppResult.Failure -> _uiState.update { it.copy(isLoading = false, errorMessage = result.error.message) }
            }
        }
    }

    fun beginExplanation(entry: OvertimeEntry) {
        if (entry.status.name != "PENDING") return
        _uiState.update { it.copy(explanationEntryId = entry.id, explanationDraft = entry.explanation.orEmpty(), errorMessage = null, successMessage = null) }
    }

    fun dismissExplanation() { _uiState.update { it.copy(explanationEntryId = null, explanationDraft = "") } }
    fun updateExplanation(value: String) { _uiState.update { it.copy(explanationDraft = value.take(2000)) } }

    fun submitExplanation() {
        val id = _uiState.value.explanationEntryId ?: return
        val explanation = _uiState.value.explanationDraft.trim()
        if (explanation.isBlank()) {
            _uiState.update { it.copy(errorMessage = "Please enter an explanation.") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmitting = true, errorMessage = null) }
            when (val result = repository.requestExplanation(id, explanation)) {
                is AppResult.Success -> _uiState.update { state ->
                    state.copy(
                        isSubmitting = false,
                        explanationEntryId = null,
                        explanationDraft = "",
                        successMessage = "Explanation submitted for manager review.",
                        entries = state.entries.map { if (it.id == id) it.copy(explanation = explanation) else it },
                    )
                }
                is AppResult.Failure -> _uiState.update { it.copy(isSubmitting = false, errorMessage = result.error.message) }
            }
        }
    }

    fun clearMessages() { _uiState.update { it.copy(errorMessage = null, successMessage = null) } }

    private fun List<OvertimeEntry>.summary(predicate: OvertimeEntry.() -> Boolean): OvertimeSummary =
        filter(predicate).fold(OvertimeSummary()) { total, entry ->
            OvertimeSummary(total.calculatedMinutes + entry.calculatedOtMinutes, total.approvedMinutes + (entry.approvedOtMinutes ?: 0))
        }
}
