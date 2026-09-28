package com.geotrack.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.hilt.navigation.compose.hiltViewModel
import com.geotrack.mobile.core.designsystem.GeoTrackTheme
import com.geotrack.mobile.core.navigation.GeoTrackNavHost
import com.geotrack.mobile.presentation.main.MainViewModel
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            GeoTrackTheme {
                val viewModel: MainViewModel = hiltViewModel()
                GeoTrackNavHost(viewModel = viewModel)
            }
        }
    }
}
