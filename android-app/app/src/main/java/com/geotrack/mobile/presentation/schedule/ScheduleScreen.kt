package com.geotrack.mobile.presentation.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.geotrack.mobile.domain.model.DailySchedule
import com.geotrack.mobile.domain.model.TodayScheduleState
import java.time.LocalDate
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScheduleScreen(
    viewModel: ScheduleViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    // Re-fetch whenever the screen returns to the foreground so a shift/off
    // change made in the dashboard shows up without restarting the app (e.g.
    // right after the employee taps the push notification). The very first
    // resume is skipped because init already loaded.
    var firstResume by remember { mutableStateOf(true) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        if (firstResume) firstResume = false else viewModel.refresh()
    }

    if (uiState.isLoading) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }

    PullToRefreshBox(
        isRefreshing = uiState.isRefreshing,
        onRefresh = viewModel::refresh,
        modifier = Modifier.fillMaxSize()
    ) {
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        item {
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = "My Schedule",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.height(8.dp))
        }

        // Highlights Card
        item {
            HighlightsCard(uiState)
        }
        
        // Monthly Stats
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                StatBox(
                    modifier = Modifier.weight(1f),
                    label = "Working Days",
                    value = "${uiState.monthlyWorkingDays}",
                    subtitle = "in ${uiState.currentMonth}"
                )
                StatBox(
                    modifier = Modifier.weight(1f),
                    label = "Off Days",
                    value = "${uiState.monthlyOffDays}",
                    subtitle = "in ${uiState.currentMonth}"
                )
            }
        }
        
        item {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "${uiState.currentMonth} Schedule",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold
            )
        }

        // List of days
        items(uiState.monthSchedules, key = { it.date.toString() }) { daily ->
            DailyScheduleRow(daily)
        }
        
        item {
            Spacer(modifier = Modifier.height(16.dp))
        }
    }
    }
}

@Composable
private fun HighlightsCard(uiState: ScheduleUiState) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            uiState.today?.let { today ->
                val todayText = when (today.state) {
                    TodayScheduleState.WORKING_DAY -> "Working Tonight/Today: ${today.shiftName ?: "Assigned"}"
                    TodayScheduleState.OFF_DAY -> "You are OFF today"
                    TodayScheduleState.LEAVE -> "You are on LEAVE today"
                    TodayScheduleState.HOLIDAY -> "Today is a HOLIDAY"
                    TodayScheduleState.CANCELLED -> "Today's shift is cancelled"
                    TodayScheduleState.UNASSIGNED -> "No shift assigned today"
                }
                Text(
                    text = todayText,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
                Spacer(modifier = Modifier.height(8.dp))
            }
            
            uiState.nextWorkingDay?.let { nextWork ->
                Text(
                    text = "Next Working Day: ${nextWork.date.format(dateFormatter)}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
                Text(
                    text = "Shift: ${nextWork.shiftName ?: "Assigned"} (${nextWork.startTime ?: "--"} - ${nextWork.endTime ?: "--"})",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
                Spacer(modifier = Modifier.height(4.dp))
            }
            
            uiState.nextOffDay?.let { nextOff ->
                Text(
                    text = "Next Off Day: ${nextOff.date.format(dateFormatter)}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
        }
    }
}

@Composable
private fun StatBox(
    label: String,
    value: String,
    subtitle: String,
    modifier: Modifier = Modifier
) {
    Card(modifier = modifier) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(
                text = value,
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary
            )
            Text(
                text = label,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun DailyScheduleRow(daily: DailySchedule) {
    val isToday = daily.date == LocalDate.now()
    val bgColor = if (isToday) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface
    
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = bgColor)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Date column
            Column(
                modifier = Modifier.width(60.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Text(
                    text = daily.date.dayOfWeek.name.take(3),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    text = "${daily.date.dayOfMonth}",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
            }
            
            Spacer(modifier = Modifier.width(16.dp))
            
            // Details column
            Column(modifier = Modifier.weight(1f)) {
                val stateText = when (daily.state) {
                    TodayScheduleState.WORKING_DAY -> "WORKING"
                    TodayScheduleState.OFF_DAY -> "OFF"
                    TodayScheduleState.LEAVE -> "LEAVE"
                    TodayScheduleState.HOLIDAY -> "HOLIDAY"
                    TodayScheduleState.CANCELLED -> "CANCELLED"
                    TodayScheduleState.UNASSIGNED -> "UNASSIGNED"
                }
                
                val stateColor = when (daily.state) {
                    TodayScheduleState.WORKING_DAY -> MaterialTheme.colorScheme.primary
                    TodayScheduleState.OFF_DAY -> MaterialTheme.colorScheme.error
                    TodayScheduleState.LEAVE -> MaterialTheme.colorScheme.tertiary
                    TodayScheduleState.HOLIDAY -> MaterialTheme.colorScheme.secondary
                    TodayScheduleState.CANCELLED -> MaterialTheme.colorScheme.error
                    TodayScheduleState.UNASSIGNED -> MaterialTheme.colorScheme.onSurfaceVariant
                }
                
                Text(
                    text = stateText,
                    style = MaterialTheme.typography.labelSmall,
                    color = stateColor,
                    fontWeight = FontWeight.Bold
                )
                
                if (daily.state == TodayScheduleState.WORKING_DAY) {
                    Text(
                        text = daily.shiftName ?: "Assigned",
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Medium
                    )
                    Text(
                        text = "${daily.startTime ?: "--"} - ${daily.endTime ?: "--"}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                } else {
                    daily.reason?.let {
                        Text(
                            text = it,
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
            
            if (isToday) {
                Text(
                    text = "TODAY",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier
                        .background(MaterialTheme.colorScheme.primaryContainer, shape = MaterialTheme.shapes.small)
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                )
            }
        }
    }
}

private val dateFormatter = DateTimeFormatter.ofPattern("EEE, MMM d")
