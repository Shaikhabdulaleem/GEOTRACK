package com.geotrack.mobile.presentation.productivity

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
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
import com.geotrack.mobile.domain.model.ProductivityRecord
import com.geotrack.mobile.domain.model.ProductivitySummary
import com.geotrack.mobile.domain.model.ProductivityTrend
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProductivityScreen(viewModel: ProductivityViewModel = hiltViewModel()) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    Scaffold(topBar = { TopAppBar(title = { Text("Productivity") }) }) { padding ->
        if (state.isLoading) {
            Column(Modifier.fillMaxSize().padding(padding), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) { CircularProgressIndicator() }
            return@Scaffold
        }
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            state.errorMessage?.let { item { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) } }
            item { ProductivitySummaryCard("Today's Productivity", state.today) }
            item { ProductivitySummaryCard("Weekly Productivity", state.weekly) }
            item { ProductivitySummaryCard("Monthly Productivity", state.monthly) }
            item { Text("Trend", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp)) }
            if (state.trend.isEmpty()) item { Text("No productivity records found.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(state.trend) { record -> ProductivityTrendRow(record) }
        }
    }
}

@Composable
private fun ProductivitySummaryCard(title: String, summary: ProductivitySummary) {
    Card(modifier = Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                TrendText(summary.trend)
            }
            MetricRow("Target", summary.target.toString())
            MetricRow("Completed", summary.completed.toString())
            MetricRow("Productive Hours", String.format("%.1fh", summary.productiveHours))
            MetricRow("Productivity %", summary.productivityPercent?.let { "${it.roundToInt()}%" } ?: "—")
        }
    }
}

@Composable
private fun ProductivityTrendRow(record: ProductivityRecord) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column {
                Text(record.date.format(DateTimeFormatter.ofPattern("MMM d, yyyy")), fontWeight = FontWeight.Bold)
                Text("${record.completed} / ${record.target} completed", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(record.productivityPercent?.let { "${it.roundToInt()}%" } ?: "—", fontWeight = FontWeight.Bold)
                Text(String.format("%.1fh productive", record.productiveHours), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun MetricRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun TrendText(trend: ProductivityTrend) {
    val (label, color) = when (trend) {
        ProductivityTrend.UP -> "↑ Improving" to MaterialTheme.colorScheme.primary
        ProductivityTrend.DOWN -> "↓ Declining" to MaterialTheme.colorScheme.error
        ProductivityTrend.STABLE -> "→ Stable" to Color(0xFFB7791F)
        ProductivityTrend.NOT_AVAILABLE -> "—" to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Text(label, color = color, fontWeight = FontWeight.Bold)
}

private fun Double.roundToInt(): Int = kotlin.math.round(this).toInt()
