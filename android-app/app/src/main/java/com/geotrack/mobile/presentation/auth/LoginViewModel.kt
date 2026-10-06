package com.geotrack.mobile.presentation.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.repository.AuthRepository
import com.geotrack.mobile.domain.repository.SessionRepository
import com.geotrack.mobile.domain.model.AppRole
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import com.geotrack.mobile.notifications.NotificationCoordinator
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class LoginUiState(
    val identifier: String = "",
    val password: String = "",
    val passwordVisible: Boolean = false,
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
)

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val sessionRepository: SessionRepository,
    private val notificationCoordinator: NotificationCoordinator,
) : ViewModel() {

    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    /**
     * One-shot event channel: emits [Unit] when the user has successfully signed in.
     * The screen collects this and navigates to Home.
     */
    private val _navigateToHome = Channel<AppRole>(capacity = Channel.BUFFERED)
    val navigateToHome = _navigateToHome.receiveAsFlow()

    private val _navigateToUnauthorized = Channel<Unit>(capacity = Channel.BUFFERED)
    val navigateToUnauthorized = _navigateToUnauthorized.receiveAsFlow()

    fun onIdentifierChange(value: String) {
        _uiState.update { it.copy(identifier = value, errorMessage = null) }
    }

    fun onPasswordChange(value: String) {
        _uiState.update { it.copy(password = value, errorMessage = null) }
    }

    fun onTogglePasswordVisibility() {
        _uiState.update { it.copy(passwordVisible = !it.passwordVisible) }
    }

    fun signIn() {
        val state = _uiState.value
        if (state.identifier.isBlank()) {
            _uiState.update { it.copy(errorMessage = "Employee ID or Iqama number is required.") }
            return
        }
        if (state.password.isEmpty()) {
            _uiState.update { it.copy(errorMessage = "Password is required.") }
            return
        }

        _uiState.update { it.copy(isLoading = true, errorMessage = null) }

        viewModelScope.launch {
            when (val result = authRepository.signInWithIdentifier(state.identifier, state.password)) {
                is AppResult.Success -> {
                    when (val contextResult = sessionRepository.loadContext(result.value.userId)) {
                        is AppResult.Success -> {
                            val context = contextResult.value
                            if (context == null) {
                                _uiState.update {
                                    it.copy(isLoading = false, errorMessage = "Your account is not assigned to an active organization.")
                                }
                                _navigateToUnauthorized.send(Unit)
                            } else {
                                notificationCoordinator.onAuthenticated()
                                _uiState.update { it.copy(isLoading = false) }
                                _navigateToHome.send(context.membership.role)
                            }
                        }
                        is AppResult.Failure -> {
                            _uiState.update {
                                it.copy(isLoading = false, errorMessage = contextResult.error.message)
                            }
                            if (contextResult.error is com.geotrack.mobile.core.common.AppError.Unauthorized) {
                                _navigateToUnauthorized.send(Unit)
                            }
                        }
                    }
                }
                is AppResult.Failure -> {
                    _uiState.update {
                        it.copy(isLoading = false, errorMessage = "The employee ID/iqama number or password is incorrect. Please try again later.")
                    }
                }
            }
        }
    }
}
