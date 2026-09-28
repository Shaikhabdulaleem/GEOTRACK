package com.geotrack.mobile.presentation.profile

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.outlined.Badge
import androidx.compose.material.icons.outlined.Business
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
fun ProfileScreen(
    onSignOut: () -> Unit,
    viewModel: ProfileViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    var showSignOutDialog by remember { mutableStateOf(false) }

    if (showSignOutDialog) {
        SignOutDialog(
            onConfirm = {
                showSignOutDialog = false
                onSignOut()
            },
            onDismiss = { showSignOutDialog = false },
        )
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(modifier = Modifier.height(24.dp))

        // ── Avatar ────────────────────────────────────────────────────────
        Surface(
            modifier = Modifier.size(80.dp),
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primaryContainer,
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    imageVector = Icons.Filled.Person,
                    contentDescription = null,
                    modifier = Modifier.size(48.dp),
                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        Text(
            text = uiState.displayName.ifBlank { "My Profile" },
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
        )

        if (uiState.roleLabel.isNotBlank()) {
            Text(
                text = uiState.roleLabel,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.primary,
            )
        }

        Spacer(modifier = Modifier.height(24.dp))

        // ── Info card ─────────────────────────────────────────────────────
        Card(modifier = Modifier.fillMaxWidth()) {
            Column {
                uiState.email?.let { email ->
                    ListItem(
                        headlineContent = { Text("Email") },
                        supportingContent = { Text(email) },
                        leadingContent = {
                            Icon(Icons.Outlined.Email, contentDescription = null)
                        },
                    )
                    HorizontalDivider()
                }

                uiState.employeeProfile?.let { emp ->
                    ListItem(
                        headlineContent = { Text("Employee ID") },
                        supportingContent = { Text(emp.id) },
                        leadingContent = {
                            Icon(Icons.Outlined.Badge, contentDescription = null)
                        },
                    )
                    HorizontalDivider()
                    ListItem(
                        headlineContent = { Text("Employee Code") },
                        supportingContent = { Text(emp.employeeCode) },
                        leadingContent = {
                            Icon(Icons.Outlined.Badge, contentDescription = null)
                        },
                    )
                    HorizontalDivider()
                    emp.jobTitle?.let { title ->
                        ListItem(
                            headlineContent = { Text("Job Title") },
                            supportingContent = { Text(title) },
                            leadingContent = {
                                Icon(Icons.Outlined.Business, contentDescription = null)
                            },
                        )
                    }
                }

                if (uiState.organizationName.isNotBlank()) {
                    HorizontalDivider()
                    ListItem(
                        headlineContent = { Text("Organization") },
                        supportingContent = { Text(uiState.organizationName) },
                        leadingContent = {
                            Icon(Icons.Outlined.Business, contentDescription = null)
                        },
                    )
                }
                uiState.departmentName?.let { department ->
                    HorizontalDivider()
                    ListItem(
                        headlineContent = { Text("Department") },
                        supportingContent = { Text(department) },
                        leadingContent = {
                            Icon(Icons.Outlined.Business, contentDescription = null)
                        },
                    )
                }
                uiState.assignedSiteName?.let { site ->
                    HorizontalDivider()
                    ListItem(
                        headlineContent = { Text("Assigned site") },
                        supportingContent = { Text(site) },
                        leadingContent = {
                            Icon(Icons.Outlined.Business, contentDescription = null)
                        },
                    )
                }
                uiState.assignedShiftName?.let { shift ->
                    HorizontalDivider()
                    ListItem(
                        headlineContent = { Text("Assigned shift") },
                        supportingContent = { Text(shift) },
                        leadingContent = {
                            Icon(Icons.Outlined.CalendarMonth, contentDescription = null)
                        },
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(32.dp))

        // ── Sign out ──────────────────────────────────────────────────────
        OutlinedButton(
            onClick = { showSignOutDialog = true },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Icon(
                imageVector = Icons.Outlined.Logout,
                contentDescription = null,
                modifier = Modifier.padding(end = 8.dp),
            )
            Text("Sign Out")
        }
    }
}

@Composable
private fun SignOutDialog(
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Sign Out") },
        text = { Text("Are you sure you want to sign out?") },
        confirmButton = {
            TextButton(onClick = onConfirm) { Text("Sign Out") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}
