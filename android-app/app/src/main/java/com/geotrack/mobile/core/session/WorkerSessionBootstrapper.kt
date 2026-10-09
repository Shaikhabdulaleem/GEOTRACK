package com.geotrack.mobile.core.session

import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.model.OrganizationContext
import com.geotrack.mobile.domain.repository.AuthRepository
import com.geotrack.mobile.domain.repository.SessionRepository
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.firstOrNull

/** Restores the persisted Supabase session/context for WorkManager processes. */
@Singleton
class WorkerSessionBootstrapper @Inject constructor(
    private val auth: AuthRepository,
    private val sessions: SessionRepository,
) {
    suspend fun restore(): OrganizationContext? {
        // Reuse the in-memory context only when the employee profile is also
        // loaded — the auto-attendance workers read the profile immediately
        // after restoring, and a warm process can hold the context with the
        // profile flow still empty.
        val cached = sessions.organizationContext.firstOrNull()
        if (cached != null && sessions.employeeProfile.firstOrNull() != null) return cached

        val session = when (val result = auth.restoreSession()) {
            is AppResult.Success -> result.value
            is AppResult.Failure -> return cached
        } ?: return cached
        return when (val result = sessions.loadContext(session.userId)) {
            is AppResult.Success -> result.value ?: cached
            is AppResult.Failure -> cached
        }
    }
}
