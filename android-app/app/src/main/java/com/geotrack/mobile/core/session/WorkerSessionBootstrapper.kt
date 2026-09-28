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
        sessions.organizationContext.firstOrNull()?.let { return it }
        val session = when (val result = auth.restoreSession()) {
            is AppResult.Success -> result.value
            is AppResult.Failure -> return null
        } ?: return null
        return when (val result = sessions.loadContext(session.userId)) {
            is AppResult.Success -> result.value
            is AppResult.Failure -> null
        }
    }
}
