package com.geotrack.mobile.data.repository

import com.geotrack.mobile.core.common.AppError
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.data.remote.supabase.SupabaseClientHolder
import com.geotrack.mobile.domain.model.AuthSession
import com.geotrack.mobile.domain.repository.AuthRepository
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.SignOutScope
import io.github.jan.supabase.auth.status.RefreshFailureCause
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.exceptions.RestException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Concrete authentication boundary backed by Supabase Auth.
 *
 * Design rules enforced here:
 * - The Supabase client is never exposed to any ViewModel or UI layer.
 * - Session tokens never leave this class; callers only receive [AuthSession]
 *   (a domain model carrying only the userId and a presence flag).
 * - All errors are translated to [AppError] subtypes.
 */
@Singleton
class SupabaseAuthRepository @Inject constructor(
    private val clientHolder: SupabaseClientHolder,
) : AuthRepository {

    private val _session = MutableStateFlow<AuthSession?>(null)
    override val session: Flow<AuthSession?> = _session
    private val observerScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    init {
        clientHolder.client?.let { client ->
            observerScope.launch {
                client.auth.sessionStatus.collectLatest { status ->
                    when (status) {
                        is SessionStatus.Authenticated -> {
                            _session.value = AuthSession(
                                userId = status.session.user?.id ?: return@collectLatest,
                                accessTokenPresent = true,
                            )
                        }
                        is SessionStatus.NotAuthenticated -> _session.value = null
                        is SessionStatus.RefreshFailure -> {
                            // A network outage is recoverable; invalid refresh/session
                            // failures are treated as an expired session.
                            if (status.cause !is RefreshFailureCause.NetworkError) {
                                _session.value = null
                            }
                        }
                        is SessionStatus.Initializing -> Unit
                    }
                }
            }
        }
    }

    // ── Session restoration ───────────────────────────────────────────────

    override suspend fun restoreSession(): AppResult<AuthSession?> {
        if (!clientHolder.config.isConfigured) {
            return AppResult.Failure(
                AppError.Configuration(
                    "Supabase is not configured. " +
                        "Provide SUPABASE_URL and SUPABASE_ANON_KEY at build time.",
                ),
            )
        }

        return try {
            val client = requireNotNull(clientHolder.client)
            // currentSessionOrNull() checks the in-memory + persisted Supabase session.
            client.auth.awaitInitialization()
            val sbSession = client.auth.currentSessionOrNull()
            if (sbSession != null) {
                val userId = sbSession.user?.id
                    ?: return AppResult.Success(null)
                val authSession = AuthSession(userId = userId, accessTokenPresent = true)
                _session.value = authSession
                AppResult.Success(authSession)
            } else {
                AppResult.Success(null)
            }
        } catch (e: RestException) {
            // Invalid/expired persisted sessions are treated as signed out.
            AppResult.Success(null)
        } catch (e: Exception) {
            AppResult.Failure(AppError.Network(e.message ?: "Unable to restore the session.", e))
        }
    }

    // ── Sign in ───────────────────────────────────────────────────────────

    override suspend fun signIn(email: String, password: String): AppResult<AuthSession> {
        if (!clientHolder.config.isConfigured) {
            return AppResult.Failure(
                AppError.Configuration("Supabase is not configured."),
            )
        }

        return try {
            val client = requireNotNull(clientHolder.client)
            client.auth.signInWith(Email) {
                this.email = email.trim()
                this.password = password
            }
            val sbSession = client.auth.currentSessionOrNull()
                ?: return AppResult.Failure(
                    AppError.Unauthorized("Authentication completed without a session."),
                )
            val userId = sbSession.user?.id
                ?: return AppResult.Failure(AppError.Unauthorized("User not found in session."))
            val authSession = AuthSession(userId = userId, accessTokenPresent = true)
            _session.value = authSession
            AppResult.Success(authSession)
        } catch (e: RestException) {
            AppResult.Failure(
                AppError.Unauthorized(
                    when {
                        e.message?.contains("Invalid login credentials", ignoreCase = true) == true ->
                            "Invalid email or password."
                        e.message?.contains("Email not confirmed", ignoreCase = true) == true ->
                            "Please confirm your email address before signing in."
                        else -> e.message ?: "Sign in failed."
                    },
                ),
            )
        } catch (e: Exception) {
            AppResult.Failure(AppError.Network(e.message ?: "Network error.", e))
        }
    }

    // ── Sign out ──────────────────────────────────────────────────────────

    override suspend fun signOut(): AppResult<Unit> {
        return try {
            clientHolder.client?.auth?.signOut(SignOutScope.LOCAL)
            _session.value = null
            AppResult.Success(Unit)
        } catch (e: Exception) {
            // Always clear local session even if the remote call fails.
            _session.value = null
            AppResult.Success(Unit)
        }
    }
}
