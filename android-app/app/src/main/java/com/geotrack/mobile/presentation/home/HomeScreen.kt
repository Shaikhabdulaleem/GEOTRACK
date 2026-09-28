package com.geotrack.mobile.presentation.home

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material.icons.filled.Smartphone
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material.icons.outlined.TrendingUp
import androidx.compose.material.icons.outlined.Smartphone
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.geotrack.mobile.presentation.dashboard.DashboardScreen
import com.geotrack.mobile.presentation.notifications.NotificationsScreen
import com.geotrack.mobile.presentation.profile.ProfileScreen
import com.geotrack.mobile.presentation.schedule.ScheduleScreen
import com.geotrack.mobile.presentation.overtime.OvertimeScreen
import com.geotrack.mobile.presentation.productivity.ProductivityScreen
import com.geotrack.mobile.presentation.phoneusage.PhoneUsageScreen
import com.geotrack.mobile.domain.model.AppRole
import com.geotrack.mobile.presentation.manager.ManagerHomeScreen

private enum class HomeTab(
    val route: String,
    val label: String,
    val selectedIcon: ImageVector,
    val unselectedIcon: ImageVector,
) {
    DASHBOARD(
        route = "home/dashboard",
        label = "Dashboard",
        selectedIcon = Icons.Filled.Home,
        unselectedIcon = Icons.Outlined.Home,
    ),
    SCHEDULE(
        route = "home/schedule",
        label = "Schedule",
        selectedIcon = Icons.Filled.CalendarMonth,
        unselectedIcon = Icons.Outlined.CalendarMonth,
    ),
    NOTIFICATIONS(
        route = "home/notifications",
        label = "Notifications",
        selectedIcon = Icons.Filled.Notifications,
        unselectedIcon = Icons.Outlined.Notifications,
    ),
    OVERTIME(
        route = "home/overtime",
        label = "Overtime",
        selectedIcon = Icons.Filled.Timer,
        unselectedIcon = Icons.Outlined.Timer,
    ),
    PRODUCTIVITY(
        route = "home/productivity",
        label = "Productivity",
        selectedIcon = Icons.Filled.TrendingUp,
        unselectedIcon = Icons.Outlined.TrendingUp,
    ),
    PHONE_USAGE(
        route = "home/phone-usage",
        label = "Phone Usage",
        selectedIcon = Icons.Filled.Smartphone,
        unselectedIcon = Icons.Outlined.Smartphone,
    ),
    TEAM(
        route = "home/team",
        label = "Team",
        selectedIcon = Icons.Filled.Group,
        unselectedIcon = Icons.Outlined.Group,
    ),
    PROFILE(
        route = "home/profile",
        label = "Profile",
        selectedIcon = Icons.Filled.Person,
        unselectedIcon = Icons.Outlined.Person,
    ),
}

/**
 * Authenticated shell.
 *
 * Hosts a bottom-navigation bar with four tabs (Dashboard, Schedule, Notifications, Profile)
 * each backed by its own nested composable. Uses a separate inner [NavHost] so that the
 * outer [GeoTrackNavHost] stays unaware of tab routing details.
 *
 * @param onSignOut Callback invoked when the user confirms sign-out. The caller
 *   ([GeoTrackNavHost]) is responsible for clearing auth state and navigating to Login.
 */
@Composable
@OptIn(ExperimentalMaterial3Api::class)
fun HomeScreen(
    role: AppRole,
    onSignOut: () -> Unit,
) {
    val innerNavController = rememberNavController()
    val tabs = HomeTab.entries.filter {
        when (role) {
            AppRole.EMPLOYEE -> it != HomeTab.TEAM
            AppRole.MANAGER -> it == HomeTab.DASHBOARD || it == HomeTab.TEAM || it == HomeTab.NOTIFICATIONS || it == HomeTab.PROFILE
            AppRole.ADMINISTRATOR -> it == HomeTab.DASHBOARD || it == HomeTab.NOTIFICATIONS || it == HomeTab.PROFILE
        }
    }

    Scaffold(
        topBar = {
            androidx.compose.material3.TopAppBar(
                title = { Text(role.homeTitle()) },
            )
        },
        bottomBar = {
            NavigationBar {
                val navBackStackEntry by innerNavController.currentBackStackEntryAsState()
                val currentDestination = navBackStackEntry?.destination

                tabs.forEach { tab ->
                    val selected = currentDestination?.hierarchy
                        ?.any { it.route == tab.route } == true

                    NavigationBarItem(
                        selected = selected,
                        onClick = {
                            innerNavController.navigate(tab.route) {
                                // Pop up to the start destination to avoid a growing back stack
                                popUpTo(innerNavController.graph.findStartDestination().id) {
                                    saveState = true
                                }
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = {
                            Icon(
                                imageVector = if (selected) tab.selectedIcon else tab.unselectedIcon,
                                contentDescription = tab.label,
                            )
                        },
                        label = { Text(tab.label) },
                    )
                }
            }
        },
    ) { innerPadding ->
        NavHost(
            navController = innerNavController,
            startDestination = HomeTab.DASHBOARD.route,
            modifier = Modifier.padding(innerPadding),
        ) {
            composable(HomeTab.DASHBOARD.route) {
                if (role == AppRole.EMPLOYEE) DashboardScreen() else if (role == AppRole.MANAGER) ManagerHomeScreen() else com.geotrack.mobile.presentation.admin.AdminDashboardScreen()
            }
            composable(HomeTab.SCHEDULE.route) { ScheduleScreen() }
            composable(HomeTab.NOTIFICATIONS.route) { NotificationsScreen() }
            composable(HomeTab.OVERTIME.route) { if (role == AppRole.EMPLOYEE) OvertimeScreen() }
            composable(HomeTab.PRODUCTIVITY.route) { if (role == AppRole.EMPLOYEE) ProductivityScreen() }
            composable(HomeTab.PHONE_USAGE.route) { if (role == AppRole.EMPLOYEE) PhoneUsageScreen() }
            composable(HomeTab.TEAM.route) { if (role == AppRole.MANAGER) ManagerHomeScreen(detailed = true) }
            composable(HomeTab.PROFILE.route) { ProfileScreen(onSignOut = onSignOut) }
        }
    }
}

@Composable
private fun RoleOverviewScreen(role: AppRole) {
    androidx.compose.foundation.layout.Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = role.homeTitle(),
            style = androidx.compose.material3.MaterialTheme.typography.headlineSmall,
        )
        Text(
            text = when (role) {
                AppRole.MANAGER -> "Team attendance, approvals, schedules, and reports will appear here."
                AppRole.ADMINISTRATOR -> "Organization administration, workforce controls, and reports will appear here."
                AppRole.EMPLOYEE -> "Your attendance and schedule will appear here."
            },
            style = androidx.compose.material3.MaterialTheme.typography.bodyLarge,
        )
        Text(
            text = "The active Supabase membership and RLS policies determine what data is available.",
            style = androidx.compose.material3.MaterialTheme.typography.bodyMedium,
            color = androidx.compose.material3.MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private fun AppRole.homeTitle(): String = when (this) {
    AppRole.EMPLOYEE -> "Employee Home"
    AppRole.MANAGER -> "Manager Home"
    AppRole.ADMINISTRATOR -> "Admin Home"
}
