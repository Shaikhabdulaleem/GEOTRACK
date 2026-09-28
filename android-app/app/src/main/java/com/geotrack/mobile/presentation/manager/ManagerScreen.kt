package com.geotrack.mobile.presentation.manager

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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.geotrack.mobile.domain.model.ManagerEmployeeRow
import com.geotrack.mobile.domain.model.ManagerMetrics
import java.time.format.DateTimeFormatter

@Composable
fun ManagerHomeScreen(viewModel: ManagerViewModel = hiltViewModel(), detailed: Boolean = false) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    if (state.isLoading) {
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center) { CircularProgressIndicator() }
        return
    }
    val dashboard = state.dashboard
    if (dashboard == null) {
        Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(state.errorMessage ?: "Unable to load manager data", color = MaterialTheme.colorScheme.error)
            Button(onClick = viewModel::refresh) { Text("Retry") }
        }
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text(if (detailed) "Team details" else "Today", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(dashboard.date.format(DateTimeFormatter.ofPattern("EEE, dd MMM yyyy")), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (!detailed) item { MetricsGrid(dashboard.metrics) }
        item { Text(if (detailed) "Employees, attendance, shifts, weekly offs, overtime and productivity" else "Team snapshot", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold) }
        if (dashboard.employees.isEmpty()) item { Text("No authorized employees found.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        items(dashboard.employees, key = { it.id }) { EmployeeCard(it) }
    }
}

@Composable
private fun MetricsGrid(metrics: ManagerMetrics) {
    val values = listOf(
        "Total Team" to metrics.totalTeam,
        "Present" to metrics.present,
        "Absent" to metrics.absent,
        "Late" to metrics.late,
        "On Leave" to metrics.onLeave,
        "OFF Today" to metrics.offToday,
        "Not Checked In" to metrics.notCheckedIn,
        "Currently Working" to metrics.currentlyWorking,
        "Overtime (min)" to metrics.overtime,
        "Geofence Exceptions" to metrics.geofenceExceptions,
    )
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        values.chunked(2).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { (label, value) ->
                    Card(Modifier.weight(1f), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                        Column(Modifier.padding(12.dp)) {
                            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(value.toString(), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        }
                    }
                }
                if (row.size == 1) androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun EmployeeCard(row: ManagerEmployeeRow) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column {
                    Text(row.name, fontWeight = FontWeight.Bold)
                    Text(row.employeeCode, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(row.attendanceStatus, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
            }
            Text("Shift: ${row.shift}", style = MaterialTheme.typography.bodySmall)
            Text("Weekly off: ${row.weeklyOff}  •  Overtime: ${row.overtimeMinutes} min", style = MaterialTheme.typography.bodySmall)
            Text("Productivity: ${row.productivityPercent?.let { "%.1f%%".format(it) } ?: "—"}", style = MaterialTheme.typography.bodySmall)
        }
    }
}
