package com.geotrack.mobile.core.designsystem

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.geotrack.mobile.R

// DM Sans, bundled as a variable font (res/font/dm_sans.ttf) so it renders
// offline with no runtime download.
@OptIn(ExperimentalTextApi::class)
private fun dmSans(weight: FontWeight) = Font(
    resId = R.font.dm_sans,
    weight = weight,
    variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)),
)

private val DmSans = FontFamily(
    dmSans(FontWeight.Normal),
    dmSans(FontWeight.Medium),
    dmSans(FontWeight.SemiBold),
    dmSans(FontWeight.Bold),
)

// GeoTrack dark teal identity (matches the Figma design). Single dark theme —
// the system light/dark setting is intentionally ignored.
private val GeoTrackDarkColors = darkColorScheme(
    primary = Color(0xFF18B79D),
    onPrimary = Color(0xFF06241F),
    primaryContainer = Color(0xFF16332D),
    onPrimaryContainer = Color(0xFF6EE3CF),
    secondary = Color(0xFF27D3B6),
    onSecondary = Color(0xFF06241F),
    secondaryContainer = Color(0xFF13343C),
    onSecondaryContainer = Color(0xFF8BC1FF),
    tertiary = Color(0xFFF3BB68),
    onTertiary = Color(0xFF2A1A06),
    tertiaryContainer = Color(0xFF3A2E17),
    onTertiaryContainer = Color(0xFFF3BB68),
    error = Color(0xFFFF8178),
    onError = Color(0xFF2A0D0B),
    errorContainer = Color(0xFF3A1A18),
    onErrorContainer = Color(0xFFFFB4AE),
    background = Color(0xFF081820),
    onBackground = Color(0xFFF1F7F8),
    surface = Color(0xFF152A34),
    onSurface = Color(0xFFF1F7F8),
    surfaceVariant = Color(0xFF152A34),
    onSurfaceVariant = Color(0xFF8DA1AA),
    surfaceContainerLowest = Color(0xFF0B1F28),
    surfaceContainerLow = Color(0xFF10242E),
    surfaceContainer = Color(0xFF152A34),
    surfaceContainerHigh = Color(0xFF193038),
    surfaceContainerHighest = Color(0xFF1E3540),
    outline = Color(0xFF243B45),
    outlineVariant = Color(0xFF1C2E36),
)

private val GeoTrackShapes = Shapes(
    extraSmall = RoundedCornerShape(9.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(18.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

private val GeoTrackTypography = Typography(
    displayMedium = TextStyle(fontFamily = DmSans, fontWeight = FontWeight.Bold, fontSize = 40.sp, letterSpacing = (-1).sp),
    headlineMedium = TextStyle(fontFamily = DmSans, fontWeight = FontWeight.Bold, fontSize = 24.sp, letterSpacing = (-0.5).sp),
    headlineSmall = TextStyle(fontFamily = DmSans, fontWeight = FontWeight.Bold, fontSize = 20.sp, letterSpacing = (-0.3).sp),
    titleLarge = TextStyle(fontFamily = DmSans, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, letterSpacing = (-0.2).sp),
    titleMedium = TextStyle(fontFamily = DmSans, fontWeight = FontWeight.SemiBold, fontSize = 15.sp),
    titleSmall = TextStyle(fontFamily = DmSans, fontWeight = FontWeight.Bold, fontSize = 12.sp, letterSpacing = 0.8.sp),
    bodyLarge = TextStyle(fontFamily = DmSans, fontWeight = FontWeight.Normal, fontSize = 15.sp),
    bodyMedium = TextStyle(fontFamily = DmSans, fontWeight = FontWeight.Normal, fontSize = 13.sp),
    bodySmall = TextStyle(fontFamily = DmSans, fontWeight = FontWeight.Normal, fontSize = 12.sp),
    labelLarge = TextStyle(fontFamily = DmSans, fontWeight = FontWeight.SemiBold, fontSize = 14.sp),
    labelMedium = TextStyle(fontFamily = DmSans, fontWeight = FontWeight.Medium, fontSize = 12.sp),
    labelSmall = TextStyle(fontFamily = DmSans, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 0.8.sp),
)

@Composable
fun GeoTrackTheme(
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = GeoTrackDarkColors,
        typography = GeoTrackTypography,
        shapes = GeoTrackShapes,
        content = content,
    )
}
