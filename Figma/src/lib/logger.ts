type LogContext = Record<string, unknown>;

function sanitize(value: unknown): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (typeof value === 'string') return value.slice(0, 500);
  return value;
}

function write(level: 'info' | 'warn' | 'error', message: string, context?: LogContext): void {
  const payload = JSON.stringify({
    app: 'geotrack-web',
    level,
    message,
    ...(context ? Object.fromEntries(Object.entries(context).map(([key, value]) => [key, sanitize(value)])) : {}),
    timestamp: new Date().toISOString(),
  });

  // Structured browser logs are useful in Vercel/Sentry session replay while
  // avoiding accidental dumps of Supabase responses or auth tokens.
  if (level === 'error') console.error(payload);
  else if (level === 'warn') console.warn(payload);
  else if (import.meta.env.DEV) console.info(payload);
}

export const logger = {
  info: (message: string, context?: LogContext) => write('info', message, context),
  warn: (message: string, context?: LogContext) => write('warn', message, context),
  error: (message: string, error?: unknown, context?: LogContext) => write('error', message, { ...context, error }),
};
