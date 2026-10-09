package com.geotrack.mobile.location

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GeofencePolygonTest {

    @Test
    fun `parses a GeoJSON MultiPolygon as stored by the server`() {
        // {"type":"MultiPolygon","coordinates":[[[ [lng,lat], ... ]]]}
        val polygon = Json.parseToJsonElement(
            """
            {
              "type": "MultiPolygon",
              "coordinates": [[[
                [46.6753, 24.7136],
                [46.6760, 24.7136],
                [46.6760, 24.7140],
                [46.6753, 24.7140],
                [46.6753, 24.7136]
              ]]]
            }
            """.trimIndent(),
        )

        val points = flattenCoordinatePairs(polygon)

        assertEquals(5, points.size)
        assertEquals(46.6753 to 24.7136, points.first())
    }

    @Test
    fun `parses a bare coordinate array`() {
        val polygon = Json.parseToJsonElement("[[[46.1, 24.1],[46.2, 24.2]]]")
        assertEquals(2, flattenCoordinatePairs(polygon).size)
    }

    @Test
    fun `empty or non-coordinate json yields no points`() {
        assertTrue(flattenCoordinatePairs(Json.parseToJsonElement("{}")).isEmpty())
        assertTrue(flattenCoordinatePairs(Json.parseToJsonElement("{\"type\":\"MultiPolygon\"}")).isEmpty())
    }
}
