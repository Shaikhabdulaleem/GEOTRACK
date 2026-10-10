package com.geotrack.mobile.presentation.dashboard

import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.geotrack.mobile.core.designsystem.GeoBrandMark
import com.geotrack.mobile.domain.model.TodayScheduleState
import java.time.LocalTime
import java.time.format.DateTimeFormatter

@Composable
fun DashboardScreen(
    viewModel: DashboardViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val context = LocalContext.current

    val reqPermissions = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { _ -> }

    // Re-fetch today's schedule/attendance when the screen returns to the
    // foreground, so dashboard-side changes appear without an app restart. The
    // first resume is skipped because init already loaded.
    var firstResume by remember { mutableStateOf(true) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        if (firstResume) firstResume = false else viewModel.refresh()
    }

    LaunchedEffect(uiState.errorMessage, uiState.successMessage) {
        if (uiState.errorMessage != null) {
            snackbarHostState.showSnackbar(uiState.errorMessage!!)
            viewModel.clearMessages()
        }
        if (uiState.successMessage != null) {
            snackbarHostState.showSnackbar(uiState.successMessage!!)
            viewModel.clearMessages()
        }
    }

    if (uiState.isLoading) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            DashboardHeader(greeting = uiState.greeting, name = uiState.employeeName ?: "")

            ScheduleBanner(uiState)

            // Surface any permission/system blockers for automatic attendance.
            AttendanceSetupBanner()

            if (uiState.scheduleState == TodayScheduleState.WORKING_DAY) {
                AttendanceCard(uiState, viewModel, reqPermissions, context)
            }

            TodaySummary(uiState)

            Spacer(Modifier.height(8.dp))
        }

        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp),
        )
    }
}

@Composable
private fun DashboardHeader(greeting: String, name: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        GeoBrandMark(size = 44)
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = greeting.uppercase(),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
            Text(
                text = name,
                style = MaterialTheme.typography.headlineMedium,
                maxLines = 1,
            )
        }
        if (name.isNotBlank()) {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = name.initials(),
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            }
        }
    }
}

private fun String.initials(): String =
    trim().split(" ").filter { it.isNotBlank() }.take(2)
        .joinToString("") { it.first().uppercase() }

@Composable
private fun ScheduleBanner(uiState: DashboardUiState) {
    val isWorking = uiState.scheduleState == TodayScheduleState.WORKING_DAY
    val accent = if (isWorking) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = MaterialTheme.shapes.large,
        border = cardBorder(),
    ) {
        Row(
            modifier = Modifier.padding(18.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(MaterialTheme.shapes.small)
                    .background(accent.copy(alpha = 0.14f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (isWorking) Icons.Outlined.WorkOutline else Icons.Outlined.EventBusy,
                    contentDescription = null,
                    tint = accent,
                )
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    text = if (isWorking) "WORKING TODAY" else "OFF TODAY",
                    style = MaterialTheme.typography.titleSmall,
                    color = accent,
                )
                if (isWorking) {
                    Text(uiState.shiftName ?: "No Shift Assigned", style = MaterialTheme.typography.titleMedium)
                    val start = uiState.shiftStartTime?.toDisplayTime().orEmpty()
                    val end = uiState.shiftEndTime?.toDisplayTime().orEmpty()
                    if (start.isNotBlank() && end.isNotBlank()) {
                        Text("$start – $end", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                } else {
                    Text(uiState.reason ?: "Scheduled OFF", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "Next working day: ${uiState.nextWorkingDate ?: "Unknown"}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

private fun String.toDisplayTime(): String = runCatching {
    LocalTime.parse(take(8)).format(DateTimeFormatter.ofPattern("h:mm a"))
}.getOrDefault(this)

@Composable
private fun AttendanceCard(
    uiState: DashboardUiState,
    viewModel: DashboardViewModel,
    reqPerms: androidx.activity.result.ActivityResultLauncher<Array<String>>,
    context: Context,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = MaterialTheme.shapes.large,
        border = cardBorder(),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            // Status chip + shield
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                        Box(
                            Modifier.size(8.dp).clip(CircleShape)
                                .background(if (uiState.isCheckedIn) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant)
                        )
                        Text(
                            if (uiState.isCheckedIn) "Checked in" else "Ready to check in",
                            style = MaterialTheme.typography.titleSmall,
                            color = if (uiState.isCheckedIn) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        if (uiState.isCheckedIn) "Have a productive day" else "You're at work",
                        style = MaterialTheme.typography.titleLarge,
                    )
                }
                Box(
                    Modifier.size(40.dp).clip(MaterialTheme.shapes.small)
                        .background(MaterialTheme.colorScheme.primaryContainer),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Outlined.VerifiedUser, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimaryContainer)
                }
            }

            GeofencePreview(uiState)

            // Clock + action
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Bottom,
            ) {
                Text(
                    if (uiState.isCheckedIn) "Checked in at ${uiState.checkInTimeStr ?: "--"}" else "Current time",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(uiState.currentTime, style = MaterialTheme.typography.titleLarge)
            }

            when {
                !uiState.isAttendanceAllowed -> {
                    Text(
                        "No active shift is assigned for today.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                !uiState.hasForegroundLocation || !uiState.isGpsEnabled -> {
                    Button(
                        onClick = {
                            if (!uiState.hasForegroundLocation) {
                                reqPerms.launch(arrayOf(
                                    android.Manifest.permission.ACCESS_FINE_LOCATION,
                                    android.Manifest.permission.ACCESS_COARSE_LOCATION,
                                ))
                            } else {
                                context.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
                            }
                        },
                        modifier = Modifier.fillMaxWidth().height(54.dp),
                        shape = MaterialTheme.shapes.medium,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.tertiary,
                            contentColor = MaterialTheme.colorScheme.onTertiary,
                        ),
                    ) {
                        Text(
                            if (!uiState.hasForegroundLocation) "ALLOW LOCATION TO CHECK IN" else "ENABLE GPS TO CHECK IN",
                            fontSize = 15.sp, fontWeight = FontWeight.Bold,
                        )
                    }
                }
                else -> {
                    Button(
                        onClick = { if (uiState.isCheckedIn) viewModel.onCheckOut() else viewModel.onCheckIn() },
                        modifier = Modifier.fillMaxWidth().height(54.dp),
                        shape = MaterialTheme.shapes.medium,
                        enabled = !uiState.isCheckingIn,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (uiState.isCheckedIn) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.primary,
                            contentColor = MaterialTheme.colorScheme.onPrimary,
                        ),
                    ) {
                        if (uiState.isCheckingIn) {
                            CircularProgressIndicator(modifier = Modifier.size(22.dp), color = MaterialTheme.colorScheme.onPrimary)
                        } else {
                            Icon(
                                if (uiState.isCheckedIn) Icons.Outlined.Logout else Icons.Outlined.Login,
                                contentDescription = null,
                            )
                            Spacer(Modifier.width(10.dp))
                            Text(if (uiState.isCheckedIn) "CHECK OUT" else "CHECK IN", fontSize = 16.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }

            if (uiState.syncStatus == "PENDING_SYNC" || uiState.syncStatus == "SYNC_FAILED") {
                val color = if (uiState.syncStatus == "SYNC_FAILED") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.tertiary
                val text = if (uiState.syncStatus == "SYNC_FAILED") "Failed to sync attendance" else "Attendance pending sync (offline)"
                Text(text = text, color = color, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun GeofencePreview(uiState: DashboardUiState) {
    // Inside the zone is the only "good" (teal) state. Outside the zone, or a
    // missing permission / GPS, is an amber warning — never red. Red is for
    // serious errors only (e.g. a failed sync).
    val accent = when {
        uiState.hasForegroundLocation && uiState.isGpsEnabled && uiState.isInsideGeofence -> MaterialTheme.colorScheme.secondary
        else -> MaterialTheme.colorScheme.tertiary
    }
    val label = when {
        !uiState.hasForegroundLocation -> "Location permission needed"
        !uiState.isGpsEnabled -> "GPS is off"
        uiState.isInsideGeofence -> "Inside work zone"
        else -> "Outside work zone"
    }
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(132.dp)
            .clip(MaterialTheme.shapes.medium)
            .background(MaterialTheme.colorScheme.surfaceContainerLowest),
        contentAlignment = Alignment.Center,
    ) {
        // Geofence ring
        Box(
            modifier = Modifier
                .size(78.dp)
                .clip(CircleShape)
                .background(accent.copy(alpha = 0.12f))
                .border(1.5.dp, accent.copy(alpha = 0.5f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Box(
                modifier = Modifier.size(34.dp).clip(CircleShape).background(accent),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Outlined.Place, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(18.dp))
            }
        }
        Row(
            modifier = Modifier.align(Alignment.BottomStart).padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Box(Modifier.size(6.dp).clip(CircleShape).background(accent))
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurface)
        }
    }
}

@Composable
private fun TodaySummary(uiState: DashboardUiState) {
    val insideZone = uiState.hasForegroundLocation && uiState.isGpsEnabled && uiState.isInsideGeofence
    val locLabel = when {
        !uiState.hasForegroundLocation -> "No permission"
        !uiState.isGpsEnabled -> "GPS off"
        uiState.isInsideGeofence -> "Inside zone"
        else -> "Outside zone"
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Today", style = MaterialTheme.typography.titleLarge)
        SummaryCard(
            left = SummaryItem("Worked today", uiState.todayWorkedDisplay, Icons.Outlined.Schedule),
            right = SummaryItem("Overtime", uiState.todayOvertimeDisplay, Icons.Outlined.Timer),
        )
        SummaryCard(
            left = SummaryItem("Next day off", uiState.nextOffDate ?: "--", Icons.Outlined.EventBusy),
            right = SummaryItem("Location", locLabel, if (insideZone) Icons.Outlined.LocationOn else Icons.Outlined.LocationOff, warn = !insideZone),
        )
    }
}

private data class SummaryItem(val label: String, val value: String, val icon: ImageVector, val warn: Boolean = false)

@Composable
private fun SummaryCard(left: SummaryItem, right: SummaryItem) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = MaterialTheme.shapes.medium,
        border = cardBorder(),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SummaryCell(left, Modifier.weight(1f))
            Box(Modifier.width(1.dp).height(36.dp).background(MaterialTheme.colorScheme.outline))
            SummaryCell(right, Modifier.weight(1f).padding(start = 15.dp))
        }
    }
}

@Composable
private fun SummaryCell(item: SummaryItem, modifier: Modifier = Modifier) {
    val tint = if (item.warn) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.primary
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(
            Modifier.size(36.dp).clip(MaterialTheme.shapes.small).background(tint.copy(alpha = 0.13f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(item.icon, contentDescription = null, tint = tint, modifier = Modifier.size(19.dp))
        }
        Column {
            Text(item.value, style = MaterialTheme.typography.titleMedium, maxLines = 1)
            Text(item.label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun cardBorder() = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline)
