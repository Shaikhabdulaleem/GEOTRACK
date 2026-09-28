package com.geotrack.mobile.core.common

sealed interface AppError {
    val message: String

    data class Configuration(override val message: String) : AppError
    data class Network(override val message: String, val cause: Throwable? = null) : AppError
    data class Unauthorized(override val message: String) : AppError
    data class Unknown(override val message: String, val cause: Throwable? = null) : AppError
}

sealed interface AppResult<out T> {
    data class Success<T>(val value: T) : AppResult<T>
    data class Failure(val error: AppError) : AppResult<Nothing>
}
