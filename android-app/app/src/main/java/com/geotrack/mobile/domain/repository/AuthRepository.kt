package com.geotrack.mobile.domain.repository

import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.model.AuthSession
import kotlinx.coroutines.flow.Flow

interface AuthRepository {
    val session: Flow<AuthSession?>

    suspend fun restoreSession(): AppResult<AuthSession?>

    /** Authenticates with Supabase using email + password and persists the session. */
    suspend fun signIn(email: String, password: String): AppResult<AuthSession>

    /** Sends a generic recovery message through Supabase Auth. */
    suspend fun requestPasswordReset(email: String): AppResult<Unit>

    suspend fun signOut(): AppResult<Unit>
}
