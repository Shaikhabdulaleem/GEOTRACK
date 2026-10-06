package com.geotrack.mobile.domain.repository

import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.model.AuthSession
import kotlinx.coroutines.flow.Flow

interface AuthRepository {
    val session: Flow<AuthSession?>

    suspend fun restoreSession(): AppResult<AuthSession?>

    /** Authenticates with Supabase using email + password and persists the session. */
    suspend fun signIn(email: String, password: String): AppResult<AuthSession>

    /**
     * Authenticates an employee by Employee ID or Iqama number via the
     * employee-login Edge Function, then persists the returned session.
     * Field employees have no mailbox, so they do not sign in by email.
     */
    suspend fun signInWithIdentifier(identifier: String, password: String): AppResult<AuthSession>

    /** Sends a generic recovery message through Supabase Auth. */
    suspend fun requestPasswordReset(email: String): AppResult<Unit>

    suspend fun signOut(): AppResult<Unit>
}
