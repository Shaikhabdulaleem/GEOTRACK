package com.geotrack.mobile.domain.model

enum class AppRole {
    EMPLOYEE,
    MANAGER,
    ADMINISTRATOR,
}

data class UserProfile(
    val id: String,
    val displayName: String,
    val email: String?,
)

data class OrganizationMembership(
    val id: String,
    val organizationId: String,
    val role: AppRole,
    val isActive: Boolean,
)

data class AuthSession(
    val userId: String,
    val accessTokenPresent: Boolean,
)

data class OrganizationContext(
    val membership: OrganizationMembership,
    val profile: UserProfile?,
    val organization: OrganizationInfo,
    val department: DepartmentInfo?,
    val assignedSite: AssignedSiteInfo?,
    val assignedShift: AssignedShiftInfo?,
)

data class OrganizationInfo(
    val id: String,
    val name: String,
    val slug: String,
    val timezone: String,
)

data class DepartmentInfo(
    val id: String,
    val name: String,
    val branchId: String,
)

data class AssignedSiteInfo(
    val id: String,
    val name: String,
    val address: String?,
    val timezone: String,
)

data class AssignedShiftInfo(
    val id: String,
    val assignmentId: String,
    val workDate: String,
    val name: String,
    val startTime: String,
    val endTime: String,
    val crossesMidnight: Boolean,
)

/**
 * Lightweight employee profile used by mobile features (attendance, schedule, etc.).
 * Populated after a successful login by [SessionRepository].
 */
data class EmployeeProfileInfo(
    val id: String,
    val fullName: String,
    val employeeCode: String,
    val branchId: String,
    val departmentId: String,
    val jobTitle: String?,
    val employmentStatus: String,
)
