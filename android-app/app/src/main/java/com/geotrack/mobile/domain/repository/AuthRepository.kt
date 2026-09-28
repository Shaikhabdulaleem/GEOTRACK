package com.geotrack.mobile.domain.repository

import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.model.AuthSession
import kotlinx.coroutines.flow.Flow

interface AuthRepository {
    val session: Flow<AuthSession?>

    suspend fun restoreSession(): AppResult<AuthSession?>

    /** Authenticates with Supabase using email + password and persists the session. */
    suspend fun signIn(email: String, password: String): AppResult<AuthSession>

    suspend fun signOut(): AppResult<Unit>
}
