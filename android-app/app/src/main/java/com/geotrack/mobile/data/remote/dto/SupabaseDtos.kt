package com.geotrack.mobile.data.remote.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Data-transfer objects matching the Supabase PostgREST JSON column names exactly.
 * These are internal to the data layer; domain models are separate.
 */

@Serializable
data class OrganizationMembershipDto(
    val id: String,
    @SerialName("organization_id") val organizationId: String,
    @SerialName("user_id") val userId: String,
    @SerialName("role_code") val roleCode: String, // "employee" | "manager" | "administrator"
    val status: String,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
)

@Serializable
data class UserProfileDto(
    val id: String,
    @SerialName("display_name") val displayName: String,
    val email: String? = null,
    val phone: String? = null,
    @SerialName("avatar_path") val avatarPath: String? = null,
    val locale: String = "en",
    val timezone: String = "UTC",
    @SerialName("is_active") val isActive: Boolean = true,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
)

@Serializable
data class EmployeeProfileDto(
    val id: String,
    @SerialName("organization_id") val organizationId: String,
    @SerialName("user_id") val userId: String? = null,
    @SerialName("employee_code") val employeeCode: String,
    @SerialName("iqama_number") val iqamaNumber: String,
    @SerialName("full_name") val fullName: String,
    @SerialName("mobile_number") val mobileNumber: String? = null,
    @SerialName("branch_id") val branchId: String,
    @SerialName("department_id") val departmentId: String,
    @SerialName("job_title") val jobTitle: String? = null,
    @SerialName("manager_user_id") val managerUserId: String? = null,
    @SerialName("joining_date") val joiningDate: String? = null,
    @SerialName("employment_status") val employmentStatus: String,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
)

@Serializable
data class OrganizationDto(
    val id: String,
    val name: String,
    val slug: String,
    val timezone: String,
    val status: String,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
)

@Serializable
data class BranchDto(
    val id: String,
    val name: String,
    val address: String? = null,
    val timezone: String = "UTC",
)

@Serializable
data class DepartmentDto(
    val id: String,
    @SerialName("branch_id") val branchId: String,
    val name: String,
)

@Serializable
data class ShiftAssignmentDto(
    val id: String,
    @SerialName("shift_id") val shiftId: String? = null,
    @SerialName("work_date") val workDate: String,
    val status: String,
)

@Serializable
data class ShiftDto(
    val id: String,
    val name: String,
    @SerialName("start_time") val startTime: String,
    @SerialName("end_time") val endTime: String,
    @SerialName("crosses_midnight") val crossesMidnight: Boolean,
    @SerialName("break_minutes") val breakMinutes: Int = 0,
)
