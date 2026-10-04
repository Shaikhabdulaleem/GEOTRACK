export interface PublicEnvironment {
  supabaseUrl: string | null;
  supabasePublishableKey: string | null;
  isSupabaseConfigured: boolean;
  mapboxToken: string | null;
  appEnv: 'development' | 'staging' | 'production';
  appMode: 'live' | 'demo';
  appUrl: string | null;
}

function normalize(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function isValidSupabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function parseAppEnv(value: string | undefined): PublicEnvironment['appEnv'] {
  if (value === 'staging' || value === 'production') return value;
  return 'development';
}

function parseAppMode(value: string | undefined): PublicEnvironment['appMode'] {
  return value === 'demo' ? 'demo' : 'live';
}

function isBrowserSafeKey(value: string): boolean {
  const normalized = value.toLowerCase();
  if (/(service[_-]?role|secret|sb_secret_)/i.test(normalized)) return false;

  // Legacy Supabase anon keys are JWTs. Reject a JWT that explicitly carries
  // a privileged role, even if it does not use the newer key prefix.
  try {
    const payload = value.split('.')[1];
    if (!payload) return true;
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return decoded?.role !== 'service_role';
  } catch {
    return true;
  }
}

const supabaseUrl = normalize(import.meta.env.VITE_SUPABASE_URL);
const supabasePublishableKey = normalize(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
const mapboxToken = normalize(import.meta.env.VITE_MAPBOX_TOKEN);
const appEnv = parseAppEnv(import.meta.env.VITE_APP_ENV);
const appMode = parseAppMode(import.meta.env.VITE_APP_MODE);
const appUrl = normalize(import.meta.env.VITE_APP_URL);

if (supabaseUrl && !isValidSupabaseUrl(supabaseUrl)) {
  throw new Error('VITE_SUPABASE_URL must use HTTPS, except for a local Supabase development URL.');
}

if (supabasePublishableKey && !isBrowserSafeKey(supabasePublishableKey)) {
  throw new Error('A Supabase secret key must never be exposed through a VITE_* environment variable.');
}

if (appUrl) {
  try {
    const parsed = new URL(appUrl);
    if (parsed.protocol !== 'https:' && appEnv !== 'development') {
      throw new Error('VITE_APP_URL must use HTTPS outside local development.');
    }
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('VITE_APP_URL must be an origin without a path, query, or hash.');
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('VITE_APP_URL')) throw error;
    throw new Error('VITE_APP_URL must be a valid application origin.');
  }
}

if (appEnv !== 'development' && appMode === 'demo') {
  throw new Error('Demo mode cannot be enabled in staging or production.');
}

if (appEnv !== 'development' && (!supabaseUrl || !supabasePublishableKey)) {
  throw new Error('Supabase must be configured outside local development; mock data is disabled.');
}

export const publicEnvironment: Readonly<PublicEnvironment> = Object.freeze({
  supabaseUrl,
  supabasePublishableKey,
  isSupabaseConfigured: Boolean(supabaseUrl && supabasePublishableKey),
  mapboxToken,
  appEnv,
  appMode,
  appUrl,
});

/**
 * Supabase Auth redirect targets must be allow-listed in the Supabase
 * dashboard. Keeping this in one place prevents localhost or preview URLs
 * from leaking into password-reset links in staging/production.
 */
export function getAuthRedirectUrl(path = '/reset-password'): string {
  const origin = publicEnvironment.appUrl ?? window.location.origin;
  return new URL(path.startsWith('/') ? path : `/${path}`, `${origin}/`).toString();
}
