package com.geotrack.mobile.presentation.overtime

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.geotrack.mobile.domain.model.OvertimeApprovalStatus
import com.geotrack.mobile.domain.model.OvertimeEntry
import com.geotrack.mobile.domain.model.OvertimeSummary
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OvertimeScreen(viewModel: OvertimeViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    Scaffold(topBar = { TopAppBar(title = { Text("Overtime") }) }) { padding ->
        if (state.isLoading) {
            Column(Modifier.fillMaxSize().padding(padding), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) { CircularProgressIndicator() }
            return@Scaffold
        }
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            state.errorMessage?.let { message ->
                item { Text(message, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }
            }
            state.successMessage?.let { message ->
                item { Text(message, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 8.dp)) }
            }
            item { SummaryCard("Today Overtime", state.today) }
            item { SummaryCard("This Week", state.thisWeek) }
            item { SummaryCard("This Month", state.thisMonth) }
            item { Text("Overtime Entries", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp)) }
            if (state.entries.isEmpty()) item { Text("No overtime entries found.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(state.entries, key = { it.id }) { entry -> OvertimeEntryCard(entry, onExplain = { viewModel.beginExplanation(entry) }) }
        }
    }

    state.explanationEntryId?.let { id ->
        val entry = state.entries.firstOrNull { it.id == id }
        AlertDialog(
            onDismissRequest = { if (!state.isSubmitting) viewModel.dismissExplanation() },
            title = { Text("Explain overtime") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Your calculated hours are read-only. Add an explanation for manager review.", style = MaterialTheme.typography.bodyMedium)
                    OutlinedTextField(
                        value = state.explanationDraft,
                        onValueChange = viewModel::updateExplanation,
                        enabled = !state.isSubmitting,
                        label = { Text("Explanation") },
                        minLines = 4,
                        supportingText = { Text("${state.explanationDraft.length}/2000") },
                    )
                    entry?.let { Text("Calculated OT: ${formatMinutes(it.calculatedOtMinutes)}", style = MaterialTheme.typography.bodySmall) }
                }
            },
            dismissButton = { TextButton(enabled = !state.isSubmitting, onClick = viewModel::dismissExplanation) { Text("Cancel") } },
            confirmButton = { Button(enabled = !state.isSubmitting, onClick = viewModel::submitExplanation) { Text(if (state.isSubmitting) "Submitting…" else "Submit") } },
        )
    }
}

@Composable
private fun SummaryCard(title: String, summary: OvertimeSummary) {
    Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Column { Text(title, fontWeight = FontWeight.Bold); Text("Calculated OT", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            Column(horizontalAlignment = Alignment.End) {
                Text(formatMinutes(summary.calculatedMinutes), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("Approved: ${formatMinutes(summary.approvedMinutes)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun OvertimeEntryCard(entry: OvertimeEntry, onExplain: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(entry.date.format(DateTimeFormatter.ofPattern("MMM d, yyyy")), fontWeight = FontWeight.Bold)
                StatusText(entry.status)
            }
            OvertimeRow("Scheduled Hours", formatMinutes(entry.scheduledMinutes))
            OvertimeRow("Worked Hours", formatMinutes(entry.workedMinutes))
            OvertimeRow("Calculated OT", formatMinutes(entry.calculatedOtMinutes))
            OvertimeRow("Approved OT", entry.approvedOtMinutes?.let(::formatMinutes) ?: "—")
            entry.explanation?.takeIf { it.isNotBlank() }?.let { OvertimeRow("Explanation", it) }
            if (entry.status == OvertimeApprovalStatus.PENDING) {
                OutlinedButton(onClick = onExplain, modifier = Modifier.fillMaxWidth()) { Text(if (entry.explanation.isNullOrBlank()) "Add explanation" else "Update explanation") }
            }
        }
    }
}

@Composable
private fun OvertimeRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun StatusText(status: OvertimeApprovalStatus) {
    val color = when (status) {
        OvertimeApprovalStatus.PENDING -> Color(0xFFB7791F)
        OvertimeApprovalStatus.APPROVED -> MaterialTheme.colorScheme.primary
        OvertimeApprovalStatus.REJECTED -> MaterialTheme.colorScheme.error
    }
    Text(status.name.lowercase().replaceFirstChar { it.uppercase() }, color = color, fontWeight = FontWeight.Bold)
}

private fun formatMinutes(minutes: Int): String = "${minutes / 60}h ${minutes % 60}m"
