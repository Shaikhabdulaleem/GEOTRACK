import type { AuthError, PostgrestError } from '@supabase/supabase-js';

export type AppErrorCode =
  | 'CONFIGURATION_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'DATABASE_ERROR'
  | 'NETWORK_ERROR'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'UNKNOWN_ERROR';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly cause?: unknown;
  readonly details?: string;

  constructor(code: AppErrorCode, message: string, options?: { cause?: unknown; details?: string }) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.cause = options?.cause;
    this.details = options?.details;
  }
}

type ErrorLike = Partial<AuthError & PostgrestError> & {
  message?: string;
  status?: number;
  name?: string;
};

export function toAppError(error: unknown, fallbackMessage = 'An unexpected error occurred.'): AppError {
  if (error instanceof AppError) return error;

  const candidate = error as ErrorLike | null;
  const message = candidate?.message || fallbackMessage;
  const status = candidate?.status;
  const postgresCode = candidate?.code;

  if (status === 401) {
    return new AppError('AUTHENTICATION_ERROR', message, { cause: error });
  }

  if (status === 403 || postgresCode === '42501') {
    return new AppError('AUTHORIZATION_ERROR', 'You do not have permission to perform this action.', {
      cause: error,
      details: candidate?.details,
    });
  }

  if (postgresCode === 'PGRST116') {
    return new AppError('NOT_FOUND', 'The requested record was not found.', { cause: error });
  }

  if (typeof postgresCode === 'string') {
    return new AppError('DATABASE_ERROR', message, { cause: error, details: candidate?.details });
  }

  if (error instanceof TypeError && /fetch|network/i.test(message)) {
    return new AppError('NETWORK_ERROR', 'Unable to reach the service. Check your connection and try again.', {
      cause: error,
    });
  }

  return new AppError('UNKNOWN_ERROR', message, { cause: error });
}

export function getErrorMessage(error: unknown, fallbackMessage = 'An unexpected error occurred.'): string {
  return toAppError(error, fallbackMessage).message;
}
