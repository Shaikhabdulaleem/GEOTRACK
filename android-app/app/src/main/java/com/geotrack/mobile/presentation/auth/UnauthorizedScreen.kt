package com.geotrack.mobile.presentation.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun UnauthorizedScreen(
    onSignOut: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
    ) {
        Text("Access unavailable", style = MaterialTheme.typography.headlineSmall)
        Text(
            "Your Supabase account is authenticated, but it has no active GeoTrack organization membership or supported role.",
            style = MaterialTheme.typography.bodyLarge,
        )
        Button(onClick = onSignOut) { Text("Sign out") }
    }
}
