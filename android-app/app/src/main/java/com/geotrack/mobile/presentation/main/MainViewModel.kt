package com.geotrack.mobile.presentation.main

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.core.config.SupabaseConfig
import com.geotrack.mobile.core.ui.UiState
import com.geotrack.mobile.domain.repository.AuthRepository
import com.geotrack.mobile.domain.repository.SessionRepository
import com.geotrack.mobile.domain.model.AppRole
import com.geotrack.mobile.domain.model.OrganizationContext
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import com.geotrack.mobile.notifications.NotificationCoordinator
import com.geotrack.mobile.database.GeoTrackDatabase
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class AppBootstrapState(
    val isSupabaseConfigured: Boolean,
    val isAuthenticated: Boolean,
    val isAuthorized: Boolean = false,
    val context: OrganizationContext? = null,
)

/**
 * Root ViewModel owned by [MainActivity].
 *
 * Responsibilities:
 * 1. Boot-strap: check whether a Supabase session already exists (restore).
 * 2. If authenticated, load the org/employee context via [SessionRepository].
 * 3. Expose [uiState] so [GeoTrackNavHost] can route to Login or Home.
 * 4. Coordinate sign-out across auth + session layers.
 */
@HiltViewModel
class MainViewModel @Inject constructor(
    private val config: SupabaseConfig,
    private val authRepository: AuthRepository,
    private val sessionRepository: SessionRepository,
    private val notificationCoordinator: NotificationCoordinator,
    private val database: GeoTrackDatabase,
) : ViewModel() {

    private val _uiState = MutableStateFlow<UiState<AppBootstrapState>>(UiState.Loading)
    val uiState: StateFlow<UiState<AppBootstrapState>> = _uiState.asStateFlow()

    init {
        restore()
        viewModelScope.launch {
            authRepository.session.collect { session ->
                if (session == null && _uiState.value is UiState.Success<*> &&
                    (_uiState.value as UiState.Success<AppBootstrapState>).value.isAuthenticated
                ) {
                    sessionRepository.clearContext()
                    database.clearUserData()
                    _uiState.value = UiState.Success(
                        AppBootstrapState(
                            isSupabaseConfigured = config.isConfigured,
                            isAuthenticated = false,
                        ),
                    )
                }
            }
        }
    }

    /** Called on app start and on the "Retry" button in the error screen. */
    fun restore() {
        _uiState.value = UiState.Loading
        viewModelScope.launch {
            when (val result = authRepository.restoreSession()) {
                is AppResult.Success -> {
                    val session = result.value
                    if (session == null) {
                        _uiState.value = UiState.Success(
                            AppBootstrapState(isSupabaseConfigured = config.isConfigured, isAuthenticated = false),
                        )
                    } else {
                        when (val contextResult = sessionRepository.loadContext(session.userId)) {
                            is AppResult.Success -> {
                                val context = contextResult.value
                                _uiState.value = UiState.Success(
                                    AppBootstrapState(
                                        isSupabaseConfigured = config.isConfigured,
                                        isAuthenticated = true,
                                        isAuthorized = context != null,
                                        context = context,
                                    ),
                                )
                                notificationCoordinator.onAuthenticated()
                            }
                            is AppResult.Failure -> {
                                if (contextResult.error is com.geotrack.mobile.core.common.AppError.Unauthorized) {
                                    _uiState.value = UiState.Success(
                                        AppBootstrapState(
                                            isSupabaseConfigured = config.isConfigured,
                                            isAuthenticated = true,
                                            isAuthorized = false,
                                        ),
                                    )
                                } else {
                                    _uiState.value = UiState.Error(contextResult.error)
                                }
                            }
                        }
                    }
                }

                is AppResult.Failure -> {
                    _uiState.value = UiState.Error(result.error)
                }
            }
        }
    }

    /** Signs the user out, clears session state, and resets the ui state for re-routing. */
    fun signOut() {
        viewModelScope.launch {
            authRepository.signOut()
            notificationCoordinator.onSignedOut()
            sessionRepository.clearContext()
            database.clearUserData()
            _uiState.value = UiState.Success(
                AppBootstrapState(
                    isSupabaseConfigured = config.isConfigured,
                    isAuthenticated = false,
                ),
            )
        }
    }
}
