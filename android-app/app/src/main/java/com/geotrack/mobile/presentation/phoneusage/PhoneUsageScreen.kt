package com.geotrack.mobile.presentation.phoneusage

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import com.geotrack.mobile.BuildConfig
import com.geotrack.mobile.notifications.AttendanceNotificationType
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.geotrack.mobile.domain.model.PhoneUsageDataStatus
import com.geotrack.mobile.domain.model.PhoneUsageSummary
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PhoneUsageScreen(viewModel: PhoneUsageViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val usageAccessLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) {
        // Android does not return the permission result. Re-read AppOps and
        // sync immediately when the employee comes back so the admin view no
        // longer shows the previous permission-not-granted server record.
        viewModel.syncAndRefresh()
    }
    val appDetailsLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { viewModel.refresh() }
    Scaffold(topBar = { TopAppBar(title = { Text("Device Usage") }) }) { padding ->
        if (state.isLoading) {
            Column(Modifier.fillMaxSize().padding(padding), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) { CircularProgressIndicator() }
            return@Scaffold
        }
        LazyColumn(Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                PermissionCard(
                    status = state.permission,
                    onGrant = { usageAccessLauncher.launch(viewModel.usageAccessIntent()) },
                    onOpenAppSettings = { appDetailsLauncher.launch(viewModel.appDetailsIntent()) },
                    onRefresh = viewModel::syncAndRefresh,
                )
            }
            item { Text("Today's Usage", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp)) }
            item { state.today?.let { UsageCard(it) } ?: Text("No data for today's scheduled shift.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            if (BuildConfig.DEBUG) {
                item { NotificationTestCard(onTest = viewModel::testNotification) }
            }
            item { Text("Recent Usage", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp)) }
            if (state.history.isEmpty()) item { Text("No usage data available.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(state.history, key = { it.date.toString() }) { UsageCard(it) }
            state.errorMessage?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
        }
    }
}

@Composable
private fun NotificationTestCard(onTest: (AttendanceNotificationType) -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Notification Test", fontWeight = FontWeight.Bold)
            Text(
                "Debug build only. Each button posts a real device notification without changing attendance or schedule data.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Button(onClick = { onTest(AttendanceNotificationType.NOT_CHECKED_IN) }, modifier = Modifier.fillMaxWidth()) {
                Text("Test Mark Attendance Reminder")
            }
            OutlinedButton(onClick = { onTest(AttendanceNotificationType.MISSED_ATTENDANCE) }, modifier = Modifier.fillMaxWidth()) {
                Text("Test Missed Attendance")
            }
            OutlinedButton(onClick = { onTest(AttendanceNotificationType.SHIFT_CHANGED) }, modifier = Modifier.fillMaxWidth()) {
                Text("Test Shift Change")
            }
        }
    }
}

@Composable
private fun PermissionCard(
    status: PhoneUsageDataStatus,
    onGrant: () -> Unit,
    onOpenAppSettings: () -> Unit,
    onRefresh: () -> Unit,
) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Device Usage Permission", fontWeight = FontWeight.Bold)
            when (status) {
                PhoneUsageDataStatus.PERMISSION_NOT_GRANTED -> {
                    Text("Permission required. Tap Access, then enable usage access for GeoTrack on the screen that opens.")
                    Button(onClick = onGrant, modifier = Modifier.fillMaxWidth()) { Text("Access") }
                    Text(
                        "If Access is disabled as a restricted setting, tap App settings, open the three-dot menu, choose Allow restricted settings, then return here.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    OutlinedButton(onClick = onOpenAppSettings, modifier = Modifier.fillMaxWidth()) {
                        Text("App settings")
                    }
                }
                PhoneUsageDataStatus.PERMISSION_GRANTED -> Text("Permission Granted. Only summarized foreground time overlapping scheduled shifts is measured.")
                PhoneUsageDataStatus.NO_DATA -> Text("No Data. Android returned no usage events for the scheduled shift.")
                PhoneUsageDataStatus.PARTIAL_DATA -> Text("Partial Data. Some of the scheduled shift is still in progress or usage events were incomplete.")
            }
            OutlinedButton(onClick = onRefresh) { Text("Sync now") }
        }
    }
}

@Composable
private fun UsageCard(summary: PhoneUsageSummary) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(summary.date.format(DateTimeFormatter.ofPattern("MMM d, yyyy")), fontWeight = FontWeight.Bold)
                Text(summary.status.label(), color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.Bold)
            }
            UsageRow("Shift Duration", formatMinutes(summary.totalShiftMinutes))
            UsageRow("Phone Usage", summary.phoneUsageMinutes?.let(::formatMinutes) ?: "—")
            UsageRow("Usage Percentage", summary.usagePercentage?.let { "%.1f%%".format(it) } ?: "—")
            summary.syncedAt?.let { UsageRow("Last Synced", it.toString()) }
        }
    }
}

@Composable
private fun UsageRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant); Text(value, fontWeight = FontWeight.Medium) }
}

private fun PhoneUsageDataStatus.label() = when (this) {
    PhoneUsageDataStatus.PERMISSION_GRANTED -> "Permission Granted"
    PhoneUsageDataStatus.PERMISSION_NOT_GRANTED -> "Permission Not Granted"
    PhoneUsageDataStatus.NO_DATA -> "No Data"
    PhoneUsageDataStatus.PARTIAL_DATA -> "Partial Data"
}

private fun formatMinutes(minutes: Int): String = "${minutes / 60}h ${minutes % 60}m"
