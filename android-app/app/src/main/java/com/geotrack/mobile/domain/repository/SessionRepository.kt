package com.geotrack.mobile.domain.repository

import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.domain.model.EmployeeProfileInfo
import com.geotrack.mobile.domain.model.OrganizationContext
import kotlinx.coroutines.flow.Flow

/**
 * Holds the authenticated user's organization context and employee profile.
 * Populated after a successful sign-in or session restore.
 * All mobile feature repositories depend on this for org/employee scoping.
 */
interface SessionRepository {

    /** Emits the current organization context (null when not authenticated). */
    val organizationContext: Flow<OrganizationContext?>

    /**
     * Emits the employee profile if the authenticated user has one.
     * Null for administrator users who have no employee record.
     */
    val employeeProfile: Flow<EmployeeProfileInfo?>

    /**
     * Queries Supabase for the user's active membership and employee profile,
     * populates the in-memory flows, and returns the context.
     *
     * Call this immediately after a successful [AuthRepository.signIn] or
     * after [AuthRepository.restoreSession] returns an authenticated session.
     */
    suspend fun loadContext(userId: String): AppResult<OrganizationContext?>

    /** Clears all cached context. Call on sign-out. */
    fun clearContext()
}
