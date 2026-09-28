package com.geotrack.mobile.data.repository

import com.geotrack.mobile.core.common.AppError
import com.geotrack.mobile.core.common.AppResult
import com.geotrack.mobile.data.remote.dto.EmployeeProfileDto
import com.geotrack.mobile.data.remote.dto.BranchDto
import com.geotrack.mobile.data.remote.dto.DepartmentDto
import com.geotrack.mobile.data.remote.dto.OrganizationMembershipDto
import com.geotrack.mobile.data.remote.dto.OrganizationDto
import com.geotrack.mobile.data.remote.dto.ShiftAssignmentDto
import com.geotrack.mobile.data.remote.dto.ShiftDto
import com.geotrack.mobile.data.remote.dto.UserProfileDto
import com.geotrack.mobile.data.remote.supabase.SupabaseClientHolder
import com.geotrack.mobile.domain.model.AppRole
import com.geotrack.mobile.domain.model.AssignedShiftInfo
import com.geotrack.mobile.domain.model.AssignedSiteInfo
import com.geotrack.mobile.domain.model.DepartmentInfo
import com.geotrack.mobile.domain.model.EmployeeProfileInfo
import com.geotrack.mobile.domain.model.OrganizationInfo
import com.geotrack.mobile.domain.model.OrganizationContext
import com.geotrack.mobile.domain.model.OrganizationMembership
import com.geotrack.mobile.domain.model.UserProfile
import com.geotrack.mobile.domain.repository.SessionRepository
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.exceptions.RestException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Loads and holds the current user's organization context + employee profile
 * after a successful authentication. Data is kept in-memory; cleared on sign-out.
 */
@Singleton
class SupabaseSessionRepository @Inject constructor(
    private val clientHolder: SupabaseClientHolder,
) : SessionRepository {

    private val _organizationContext = MutableStateFlow<OrganizationContext?>(null)
    override val organizationContext: Flow<OrganizationContext?> = _organizationContext

    private val _employeeProfile = MutableStateFlow<EmployeeProfileInfo?>(null)
    override val employeeProfile: Flow<EmployeeProfileInfo?> = _employeeProfile

    // ── Context loading ───────────────────────────────────────────────────

    override suspend fun loadContext(userId: String): AppResult<OrganizationContext?> {
        val client = clientHolder.client
            ?: return AppResult.Failure(AppError.Configuration("Supabase is not configured."))

        return try {
            // 1. Resolve the user's active organization memberships
            val memberships = client
                .from("organization_memberships")
                .select {
                    filter {
                        eq("user_id", userId)
                        eq("status", "active")
                    }
                    order("created_at", io.github.jan.supabase.postgrest.query.Order.ASCENDING)
                }
                .decodeList<OrganizationMembershipDto>()

            val membershipDto = memberships.firstOrNull()
                ?: return AppResult.Success(null) // No active organization membership

            val role = membershipDto.roleCode.toAppRoleOrNull()
                ?: return AppResult.Failure(
                    AppError.Unauthorized("This account has an unsupported organization role."),
                )

            // RLS controls whether this organization row is visible to the user.
            val organization = client
                .from("organizations")
                .select {
                    filter { eq("id", membershipDto.organizationId) }
                    limit(1)
                }
                .decodeList<OrganizationDto>()
                .firstOrNull()
                ?: return AppResult.Failure(
                    AppError.Unauthorized("Your organization access is no longer active."),
                )

            // 2. Resolve the user profile (display name, email)
            val userProfileDto = client
                .from("users")
                .select {
                    filter { eq("id", userId) }
                    limit(1)
                }
                .decodeList<UserProfileDto>()
                .firstOrNull()

            // 3. Resolve the employee profile for this org (may be null for admins)
            val employeeProfileDto = client
                .from("employee_profiles")
                .select {
                    filter {
                        eq("user_id", userId)
                        eq("organization_id", membershipDto.organizationId)
                    }
                    limit(1)
                }
                .decodeList<EmployeeProfileDto>()
                .firstOrNull()

            val branch = employeeProfileDto?.let {
                client
                    .from("branches")
                    .select {
                        filter { eq("id", it.branchId) }
                        limit(1)
                    }
                    .decodeList<BranchDto>()
                    .firstOrNull()
            }

            val department = employeeProfileDto?.let {
                client
                    .from("departments")
                    .select {
                        filter {
                            eq("id", it.departmentId)
                            eq("organization_id", membershipDto.organizationId)
                        }
                        limit(1)
                    }
                    .decodeList<DepartmentDto>()
                    .firstOrNull()
            }

            val assignedShift = employeeProfileDto?.let { employee ->
                val today = runCatching {
                    java.time.LocalDate.now(java.time.ZoneId.of(organization.timezone)).toString()
                }.getOrElse { java.time.LocalDate.now(java.time.ZoneOffset.UTC).toString() }
                val assignment = client
                    .from("shift_assignments")
                    .select {
                        filter {
                            eq("organization_id", membershipDto.organizationId)
                            eq("employee_id", employee.id)
                            eq("status", "scheduled")
                            gte("work_date", today)
                        }
                        order("work_date", io.github.jan.supabase.postgrest.query.Order.ASCENDING)
                        limit(1)
                    }
                    .decodeList<ShiftAssignmentDto>()
                    .firstOrNull()

                val shift = assignment?.shiftId?.let { shiftId ->
                    client
                        .from("shifts")
                        .select {
                            filter {
                                eq("id", shiftId)
                                eq("organization_id", membershipDto.organizationId)
                            }
                            limit(1)
                        }
                        .decodeList<ShiftDto>()
                        .firstOrNull()
                }

                if (assignment != null && shift != null) {
                    AssignedShiftInfo(
                        id = shift.id,
                        assignmentId = assignment.id,
                        workDate = assignment.workDate,
                        name = shift.name,
                        startTime = shift.startTime,
                        endTime = shift.endTime,
                        crossesMidnight = shift.crossesMidnight,
                    )
                } else {
                    null
                }
            }

            // 4. Map DTOs → domain models
            val domainMembership = OrganizationMembership(
                id = membershipDto.id,
                organizationId = membershipDto.organizationId,
                role = role,
                isActive = true,
            )

            val domainProfile = userProfileDto?.let {
                UserProfile(
                    id = it.id,
                    displayName = it.displayName,
                    email = it.email,
                )
            }

            val context = OrganizationContext(
                membership = domainMembership,
                profile = domainProfile,
                organization = OrganizationInfo(
                    id = organization.id,
                    name = organization.name,
                    slug = organization.slug,
                    timezone = organization.timezone,
                ),
                department = department?.let {
                    DepartmentInfo(id = it.id, name = it.name, branchId = it.branchId)
                },
                assignedSite = branch?.let {
                    AssignedSiteInfo(
                        id = it.id,
                        name = it.name,
                        address = it.address,
                        timezone = it.timezone,
                    )
                },
                assignedShift = assignedShift,
            )

            _organizationContext.value = context

            _employeeProfile.value = null
            if (employeeProfileDto != null) {
                _employeeProfile.value = EmployeeProfileInfo(
                    id = employeeProfileDto.id,
                    fullName = employeeProfileDto.fullName,
                    employeeCode = employeeProfileDto.employeeCode,
                    branchId = employeeProfileDto.branchId,
                    departmentId = employeeProfileDto.departmentId,
                    jobTitle = employeeProfileDto.jobTitle,
                    employmentStatus = employeeProfileDto.employmentStatus,
                )
            }

            AppResult.Success(context)
        } catch (e: RestException) {
            AppResult.Failure(
                AppError.Unauthorized(
                    "Your account is not authorized to read its GeoTrack organization context.",
                ),
            )
        } catch (e: Exception) {
            AppResult.Failure(
                AppError.Network(e.message ?: "Failed to load organization context.", e),
            )
        }
    }

    // ── Clear on sign-out ─────────────────────────────────────────────────

    override fun clearContext() {
        _organizationContext.value = null
        _employeeProfile.value = null
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private fun String.toAppRoleOrNull(): AppRole? = when (lowercase()) {
        "employee", "labour" -> AppRole.EMPLOYEE
        "manager" -> AppRole.MANAGER
        "administrator", "admin" -> AppRole.ADMINISTRATOR
        else -> null
    }
}
