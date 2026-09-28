package com.geotrack.mobile.presentation.attendance

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MyAttendanceScreen(
    viewModel: MyAttendanceViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("My Attendance") }
            )
        }
    ) { padding ->
        if (uiState.isLoading) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            return@Scaffold
        }

        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item {
                Text("TODAY", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                uiState.todayDetail?.let {
                    AttendanceDetailCard(it)
                } ?: Text("No schedule or attendance for today.")
            }

            item {
                Spacer(modifier = Modifier.height(8.dp))
                Text("THIS WEEK", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                WeeklyStatsCard(uiState.weeklyStats)
            }

            item {
                Spacer(modifier = Modifier.height(8.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = { viewModel.onMonthSelected(uiState.selectedMonth.minusMonths(1)) }) {
                        Icon(Icons.Default.ChevronLeft, "Previous Month")
                    }
                    Text(
                        uiState.selectedMonth.format(DateTimeFormatter.ofPattern("MMMM yyyy")),
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    IconButton(onClick = { viewModel.onMonthSelected(uiState.selectedMonth.plusMonths(1)) }) {
                        Icon(Icons.Default.ChevronRight, "Next Month")
                    }
                }
            }

            items(uiState.monthlyHistory) { detail ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { viewModel.onDateSelected(detail.date) },
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant
                    )
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column {
                            Text(
                                detail.date.format(DateTimeFormatter.ofPattern("MMM dd, yyyy")),
                                fontWeight = FontWeight.Bold
                            )
                            Text(detail.shiftName ?: "No Shift", style = MaterialTheme.typography.bodySmall)
                        }
                        Text(
                            detail.status,
                            color = when (detail.status) {
                                "Present" -> MaterialTheme.colorScheme.primary
                                "Absent", "Late" -> MaterialTheme.colorScheme.error
                                else -> MaterialTheme.colorScheme.onSurfaceVariant
                            },
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }
            }
        }
    }

    if (uiState.selectedDateDetail != null) {
        AlertDialog(
            onDismissRequest = { viewModel.clearSelectedDate() },
            title = { Text(uiState.selectedDateDetail!!.date.format(DateTimeFormatter.ofPattern("MMM dd, yyyy"))) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    val d = uiState.selectedDateDetail!!
                    DetailRow("Shift", d.shiftName ?: "None")
                    DetailRow("Scheduled", "${d.scheduledStart ?: "--"} to ${d.scheduledEnd ?: "--"}")
                    DetailRow("Check-in", d.checkIn ?: "--")
                    DetailRow("Check-out", d.checkOut ?: "--")
                    DetailRow("Worked", d.workedHours)
                    DetailRow("Overtime", d.overtimeHours)
                    DetailRow("Late Minutes", "${d.lateMinutes} mins")
                    DetailRow("Source", d.source ?: "--")
                    DetailRow("Status", d.status)
                }
            },
            confirmButton = {
                TextButton(onClick = { viewModel.clearSelectedDate() }) {
                    Text("Close")
                }
            }
        )
    }
}

@Composable
fun AttendanceDetailCard(detail: AttendanceDayDetail) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            DetailRow("Shift", detail.shiftName ?: "None")
            DetailRow("Check-in", detail.checkIn ?: "--")
            DetailRow("Check-out", detail.checkOut ?: "--")
            DetailRow("Worked Hours", detail.workedHours)
            DetailRow("Overtime", detail.overtimeHours)
            DetailRow("Status", detail.status)
        }
    }
}

@Composable
fun DetailRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, fontWeight = FontWeight.Medium)
    }
}

@Composable
fun WeeklyStatsCard(stats: WeeklyStats) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                StatItem("Present", stats.present.toString())
                StatItem("Absent", stats.absent.toString())
                StatItem("Late", stats.late.toString())
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                StatItem("Off", stats.off.toString())
                StatItem("Leave", stats.leave.toString())
                StatItem("Overtime", stats.overtime.toString())
            }
        }
    }
}

@Composable
fun StatItem(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
