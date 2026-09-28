package com.geotrack.mobile.data.remote.dto

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class ProcessAttendanceArgs(
    val p_employee_id: String,
    val p_geofence_id: String?,
    val p_action_type: String, // 'check_in' or 'check_out'
    val p_is_auto: Boolean,
    val p_latitude: Double,
    val p_longitude: Double,
    val p_accuracy_meters: Float,
    val p_is_mock_location: Boolean,
    val p_idempotency_key: String,
    val p_device_info: JsonElement
)

@Serializable
data class ProcessAttendanceResponse(
    val attendance_record_id: String?,
    val event_id: String,
    val status: String,
    val inside_geofence: Boolean,
    val validation_status: String
)
