package com.geotrack.mobile.core.designsystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.geotrack.mobile.R

/**
 * GeoTrack brand mark: a teal gradient squircle holding a dark location pin.
 * Shared by in-app headers and the push notification banner.
 */
@Composable
fun GeoBrandMark(modifier: Modifier = Modifier, size: Int = 42) {
    Box(
        modifier = modifier
            .size(size.dp)
            .background(
                brush = Brush.linearGradient(
                    listOf(Color(0xFF27D3B6), Color(0xFF72EAD5)),
                ),
                shape = RoundedCornerShape((size * 0.32f).dp),
            ),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painter = painterResource(R.drawable.ic_geo_pin),
            contentDescription = null,
            tint = Color(0xFF06241F),
            modifier = Modifier.size((size * 0.62f).dp),
        )
    }
}

/** Brand mark plus the "GeoTrack" wordmark, for screen headers. */
@Composable
fun GeoWordmark(modifier: Modifier = Modifier) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = modifier) {
        GeoBrandMark(size = 40)
        Text(
            text = buildAnnotatedString {
                append("Geo")
                withStyle(SpanStyle(color = MaterialTheme.colorScheme.primary)) { append("Track") }
            },
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(start = 9.dp),
        )
    }
}
