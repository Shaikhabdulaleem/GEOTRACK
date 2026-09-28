package com.geotrack.mobile.core.ui

import com.geotrack.mobile.core.common.AppError

sealed interface UiState<out T> {
    data object Loading : UiState<Nothing>
    data class Success<T>(val value: T) : UiState<T>
    data class Error(val error: AppError) : UiState<Nothing>
}

data class UiEvent(val message: String)
