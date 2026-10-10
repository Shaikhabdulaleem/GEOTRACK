package com.geotrack.mobile.presentation.schedule

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.geotrack.mobile.domain.model.DailySchedule
import com.geotrack.mobile.domain.model.TodayScheduleState
import java.time.LocalDate

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScheduleScreen(
    viewModel: ScheduleViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    // Re-fetch whenever the screen returns to the foreground so a shift/off
    // change made in the dashboard shows up without restarting the app. The
    // very first resume is skipped because init already loaded.
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
        modifier = Modifier.fillMaxSize(),
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(horizontal = 18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item {
                Spacer(Modifier.height(16.dp))
                Text("WORK SCHEDULE", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
                Text("My Schedule", style = MaterialTheme.typography.headlineMedium)
                Text(uiState.currentMonth, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            // Week strip
            item { WeekStrip(uiState.monthSchedules) }

            // Monthly stats
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    StatBox(Modifier.weight(1f), "${uiState.monthlyWorkingDays}", "Working days", uiState.currentMonth)
                    StatBox(Modifier.weight(1f), "${uiState.monthlyOffDays}", "Off days", uiState.currentMonth)
                }
            }

            // Upcoming shifts
            val upcoming = uiState.monthSchedules.filter {
                it.state == TodayScheduleState.WORKING_DAY && !it.date.isBefore(LocalDate.now())
            }.take(4)
            if (upcoming.isNotEmpty()) {
                item { Text("Upcoming shifts", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 4.dp)) }
                items(upcoming, key = { "up-${it.date}" }) { ShiftCard(it) }
            }

            // Full month
            item { Text("${uiState.currentMonth} overview", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 4.dp)) }
            items(uiState.monthSchedules, key = { it.date.toString() }) { DayRow(it) }

            item { Spacer(Modifier.height(16.dp)) }
        }
    }
}

@Composable
private fun WeekStrip(days: List<DailySchedule>) {
    val today = LocalDate.now()
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(days, key = { "w-${it.date}" }) { d ->
            val isToday = d.date == today
            Column(
                modifier = Modifier
                    .width(52.dp)
                    .clip(MaterialTheme.shapes.medium)
                    .background(if (isToday) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surface)
                    .padding(vertical = 10.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    d.date.dayOfWeek.name.take(3),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (isToday) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    "${d.date.dayOfMonth}",
                    style = MaterialTheme.typography.titleMedium,
                    color = if (isToday) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                )
                Box(Modifier.size(6.dp).clip(CircleShape).background(if (isToday) MaterialTheme.colorScheme.onPrimary else stateColor(d.state)))
            }
        }
    }
}

@Composable
private fun StatBox(modifier: Modifier, value: String, label: String, subtitle: String) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = MaterialTheme.shapes.medium,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(value, style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.primary)
            Text(label, style = MaterialTheme.typography.titleSmall)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ShiftCard(daily: DailySchedule) {
    val isToday = daily.date == LocalDate.now()
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = MaterialTheme.shapes.medium,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            DateTile(daily, highlighted = isToday)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(daily.shiftName ?: "Assigned shift", style = MaterialTheme.typography.titleMedium)
                Text(
                    "${daily.startTime.toClock()} – ${daily.endTime.toClock()}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                if (isToday) "In progress" else "Upcoming",
                style = MaterialTheme.typography.labelSmall,
                color = if (isToday) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun DayRow(daily: DailySchedule) {
    val isToday = daily.date == LocalDate.now()
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (isToday) MaterialTheme.colorScheme.surfaceContainerHigh else MaterialTheme.colorScheme.surface,
        ),
        shape = MaterialTheme.shapes.medium,
        border = BorderStroke(1.dp, if (isToday) MaterialTheme.colorScheme.primary.copy(alpha = 0.5f) else MaterialTheme.colorScheme.outline),
    ) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            DateTile(daily, highlighted = isToday)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(stateLabel(daily.state), style = MaterialTheme.typography.labelSmall, color = stateColor(daily.state))
                if (daily.state == TodayScheduleState.WORKING_DAY) {
                    Text(daily.shiftName ?: "Assigned", style = MaterialTheme.typography.titleMedium)
                    Text("${daily.startTime.toClock()} – ${daily.endTime.toClock()}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    daily.reason?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
            if (isToday) {
                Text(
                    "TODAY",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier
                        .clip(MaterialTheme.shapes.small)
                        .background(MaterialTheme.colorScheme.primaryContainer)
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                )
            }
        }
    }
}

@Composable
private fun DateTile(daily: DailySchedule, highlighted: Boolean) {
    Column(
        modifier = Modifier
            .width(46.dp)
            .clip(MaterialTheme.shapes.small)
            .background(if (highlighted) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerLowest)
            .padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            daily.date.dayOfWeek.name.take(3),
            style = MaterialTheme.typography.labelSmall,
            color = if (highlighted) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            "${daily.date.dayOfMonth}",
            style = MaterialTheme.typography.titleLarge,
            color = if (highlighted) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface,
        )
    }
}

// OFF/UNASSIGNED are neutral (grey); WORKING is teal; LEAVE/HOLIDAY/CANCELLED
// are amber warnings. Red is reserved for serious errors elsewhere.
@Composable
private fun stateColor(state: TodayScheduleState): Color = when (state) {
    TodayScheduleState.WORKING_DAY -> MaterialTheme.colorScheme.primary
    TodayScheduleState.LEAVE, TodayScheduleState.HOLIDAY, TodayScheduleState.CANCELLED -> MaterialTheme.colorScheme.tertiary
    TodayScheduleState.OFF_DAY, TodayScheduleState.UNASSIGNED -> MaterialTheme.colorScheme.onSurfaceVariant
}

// "09:00:00" -> "9:00 AM"; leaves anything unparseable (or null) as a dash.
private fun String?.toClock(): String = this?.let {
    runCatching {
        java.time.LocalTime.parse(it.take(8))
            .format(java.time.format.DateTimeFormatter.ofPattern("h:mm a"))
    }.getOrDefault(it)
} ?: "--"

private fun stateLabel(state: TodayScheduleState): String = when (state) {
    TodayScheduleState.WORKING_DAY -> "WORKING"
    TodayScheduleState.OFF_DAY -> "OFF"
    TodayScheduleState.LEAVE -> "LEAVE"
    TodayScheduleState.HOLIDAY -> "HOLIDAY"
    TodayScheduleState.CANCELLED -> "CANCELLED"
    TodayScheduleState.UNASSIGNED -> "UNASSIGNED"
}
