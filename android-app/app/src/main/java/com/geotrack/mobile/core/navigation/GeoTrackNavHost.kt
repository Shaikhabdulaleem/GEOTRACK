package com.geotrack.mobile.core.navigation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.geotrack.mobile.core.ui.UiState
import com.geotrack.mobile.presentation.auth.LoginScreen
import com.geotrack.mobile.presentation.auth.UnauthorizedScreen
import com.geotrack.mobile.presentation.home.HomeScreen
import com.geotrack.mobile.presentation.main.AppBootstrapState
import com.geotrack.mobile.presentation.main.MainViewModel
import com.geotrack.mobile.domain.model.AppRole

/**
 * Root navigation host.
 *
 * Routing logic:
 * 1. App opens at [Destinations.FOUNDATION] (splash / loading screen).
 * 2. [MainViewModel.restore] checks for an existing Supabase session.
 *    - Session found  → navigate to the role-specific home (pop splash)
 *    - No session     → navigate to [Destinations.LOGIN] (pop splash)
 *    - Error          → stay on splash with error + retry button
 * 3. After login → the role-specific home (pop login)
 * 4. After sign-out → [Destinations.LOGIN] (pop home)
 */
@Composable
fun GeoTrackNavHost(viewModel: MainViewModel) {
    val navController = rememberNavController()
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    // Session expiry can happen while a role shell is already on screen.  The
    // bootstrap destination is no longer composed then, so route globally on
    // auth-state changes and remove protected destinations from the back stack.
    LaunchedEffect(uiState) {
        val success = uiState as? UiState.Success ?: return@LaunchedEffect
        val destination = navController.currentDestination?.route
        when {
            !success.value.isAuthenticated && destination != Destinations.LOGIN -> {
                navController.navigate(Destinations.LOGIN) {
                    popUpTo(0) { inclusive = true }
                    launchSingleTop = true
                }
            }
            success.value.isAuthenticated && !success.value.isAuthorized && destination != Destinations.UNAUTHORIZED -> {
                navController.navigate(Destinations.UNAUTHORIZED) {
                    popUpTo(0) { inclusive = true }
                    launchSingleTop = true
                }
            }
        }
    }

    NavHost(
        navController = navController,
        startDestination = Destinations.FOUNDATION,
    ) {
        // ── Splash / Bootstrap ────────────────────────────────────────────
        composable(Destinations.FOUNDATION) {
            BootstrapRoute(
                uiState = uiState,
                onRetry = viewModel::restore,
                onAuthenticated = { role ->
                    navController.navigate(role.destination()) {
                        popUpTo(Destinations.FOUNDATION) { inclusive = true }
                    }
                },
                onUnauthenticated = {
                    navController.navigate(Destinations.LOGIN) {
                        popUpTo(Destinations.FOUNDATION) { inclusive = true }
                    }
                },
                onUnauthorized = {
                    navController.navigate(Destinations.UNAUTHORIZED) {
                        popUpTo(Destinations.FOUNDATION) { inclusive = true }
                    }
                },
            )
        }

        // ── Login ─────────────────────────────────────────────────────────
        composable(Destinations.LOGIN) {
            LoginScreen(
                onLoginSuccess = { role ->
                    navController.navigate(role.destination()) {
                        popUpTo(Destinations.LOGIN) { inclusive = true }
                    }
                },
                onUnauthorized = {
                    navController.navigate(Destinations.UNAUTHORIZED) {
                        popUpTo(Destinations.LOGIN) { inclusive = true }
                    }
                },
            )
        }

        composable(Destinations.UNAUTHORIZED) {
            UnauthorizedScreen(
                onSignOut = {
                    viewModel.signOut()
                    navController.navigate(Destinations.LOGIN) {
                        popUpTo(Destinations.UNAUTHORIZED) { inclusive = true }
                    }
                },
            )
        }

        // ── Role-specific authenticated shells ───────────────────────────
        composable(Destinations.EMPLOYEE_HOME) {
            RoleHomeRoute(AppRole.EMPLOYEE, viewModel, navController)
        }
        composable(Destinations.MANAGER_HOME) {
            RoleHomeRoute(AppRole.MANAGER, viewModel, navController)
        }
        composable(Destinations.ADMIN_HOME) {
            RoleHomeRoute(AppRole.ADMINISTRATOR, viewModel, navController)
        }
    }
}

// ── Bootstrap / Splash screen ─────────────────────────────────────────────────

@Composable
private fun BootstrapRoute(
    uiState: UiState<AppBootstrapState>,
    onRetry: () -> Unit,
    onAuthenticated: (AppRole) -> Unit,
    onUnauthenticated: () -> Unit,
    onUnauthorized: () -> Unit,
) {
    // Navigate as soon as the state resolves
    LaunchedEffect(uiState) {
        when (uiState) {
            is UiState.Success -> {
                when {
                    !uiState.value.isAuthenticated -> onUnauthenticated()
                    !uiState.value.isAuthorized -> onUnauthorized()
                    else -> onAuthenticated(uiState.value.context!!.membership.role)
                }
            }
            else -> Unit // Stay on splash while loading or on error
        }
    }

    Scaffold { paddingValues ->
        when (uiState) {
            UiState.Loading -> CenteredContent(modifier = Modifier.padding(paddingValues)) {
                CircularProgressIndicator()
                Text(text = "Loading GeoTrack…", style = MaterialTheme.typography.bodyLarge)
            }

            is UiState.Error -> CenteredContent(modifier = Modifier.padding(paddingValues)) {
                Text(
                    text = "Configuration required",
                    style = MaterialTheme.typography.headlineSmall,
                )
                Text(
                    text = uiState.error.message,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(horizontal = 24.dp),
                )
                Button(onClick = onRetry) { Text("Retry") }
            }

            is UiState.Success -> {
                // Navigation happens via LaunchedEffect above; show a brief spinner
                // while compose processes the navigation event.
                CenteredContent(modifier = Modifier.padding(paddingValues)) {
                    CircularProgressIndicator()
                }
            }
        }
    }
}

@Composable
private fun RoleHomeRoute(
    role: AppRole,
    viewModel: MainViewModel,
    navController: androidx.navigation.NavHostController,
) {
    if (Build.VERSION.SDK_INT >= 33) {
        val context = LocalContext.current
        val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
        LaunchedEffect(Unit) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
    HomeScreen(
        role = role,
        onSignOut = {
            viewModel.signOut()
            navController.navigate(Destinations.LOGIN) {
                popUpTo(role.destination()) { inclusive = true }
            }
        },
    )
}

private fun AppRole.destination(): String = when (this) {
    AppRole.EMPLOYEE -> Destinations.EMPLOYEE_HOME
    AppRole.MANAGER -> Destinations.MANAGER_HOME
    AppRole.ADMINISTRATOR -> Destinations.ADMIN_HOME
}

@Composable
private fun CenteredContent(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
    ) {
        content()
    }
}
