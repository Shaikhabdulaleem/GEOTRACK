package com.geotrack.mobile.data.remote.dto

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AttendanceRpcDtosTest {

    @Test
    fun `blocked device response accepts null identifiers`() {
        val response = Json.decodeFromString<ProcessAttendanceResponse>(
            """{
                "attendance_record_id": null,
                "event_id": null,
                "status": "device_blocked",
                "inside_geofence": false,
                "validation_status": "device_blocked"
            }""".trimIndent(),
        )

        assertNull(response.attendance_record_id)
        assertNull(response.event_id)
        assertEquals("device_blocked", response.status)
    }
}
