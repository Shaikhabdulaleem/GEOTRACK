package com.geotrack.mobile.core.designsystem

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val GeoTrackLightColors = lightColorScheme(
    primary = Color(0xFF2457A6),
    secondary = Color(0xFF4E607C),
    tertiary = Color(0xFF6C5676),
)

private val GeoTrackDarkColors = darkColorScheme(
    primary = Color(0xFFA9C7FF),
    secondary = Color(0xFFB8C7E4),
    tertiary = Color(0xFFDAB9DE),
)

@Composable
fun GeoTrackTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) GeoTrackDarkColors else GeoTrackLightColors,
        typography = androidx.compose.material3.Typography(),
        content = content,
    )
}
