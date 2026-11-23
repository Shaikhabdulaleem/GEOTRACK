import { createClient } from 'npm:@supabase/supabase-js@2.57.2';

/**
 * Manager sign-in by Manager ID or email.
 *
 * Resolves the Manager ID to the linked Supabase account server-side without
 * exposing credentials or email enumeration.
 * Pre-authentication endpoint: deploy with verify_jwt = false.
 */

const staticAllowedOrigins = new Set(
  [
    'https://geotrack-fieldtrack-ksa.vercel.app',
    'https://geotrack-git-main-fieldtrack-ksa.vercel.app',
    'http://localhost:5173',
    'http://localhost:8443',
    ...(Deno.env.get('ALLOWED_ORIGINS')?.split(',') ?? []),
  ]
    .map((value) => value.trim())
    .filter((value) => value.length > 0),
);
const geotrackVercelOrigin = /^https:\/\/geotrack[a-z0-9-]*\.vercel\.app$/;

function isAllowedOrigin(origin: string | null): origin is string {
  return !!origin && (staticAllowedOrigins.has(origin) || geotrackVercelOrigin.test(origin));
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  return {
    ...(isAllowedOrigin(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

const json = (request: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'content-type': 'application/json' },
  });

const INVALID = (request: Request) =>
  json(request, { error: 'The Manager ID or password is incorrect.' }, 401);

const SUSPENDED = (request: Request) =>
  json(request, { error: 'This manager account is suspended. Please contact your administrator.' }, 403);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(request) });
  }
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!url || !serviceRoleKey || !anonKey) {
    return json(request, { error: 'Login service is not configured' }, 503);
  }

  const body = (await request.json().catch(() => null)) as { identifier?: string; password?: string } | null;
  const identifier = body?.identifier?.trim();
  const password = body?.password;

  if (
    !identifier ||
    !password ||
    identifier.length > 64 ||
    password.length > 256 ||
    !/^[A-Za-z0-9_-]+$/.test(identifier)
  ) {
    return INVALID(request);
  }

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1. Resolve manager_code in manager_profiles
  const { data: managers, error: lookupError } = await admin
    .from('manager_profiles')
    .select('id, user_id, manager_code, status')
    .ilike('manager_code', identifier)
    .limit(2);

  let userId: string | null = null;
  let isSuspended = false;

  if (!lookupError && managers && managers.length === 1) {
    if (managers[0].status === 'suspended') {
      isSuspended = true;
    } else if (managers[0].status === 'active' && managers[0].user_id) {
      userId = managers[0].user_id;
    } else if (managers[0].status !== 'active') {
      return INVALID(request);
    }
  }

  // 2. Fallback check for employee_profiles if not found in manager_profiles
  if (!userId && !isSuspended) {
    const { data: emps } = await admin
      .from('employee_profiles')
      .select('user_id, employment_status')
      .or(`employee_code.ilike.${identifier},iqama_number.eq.${identifier}`)
      .limit(2);
    if (emps && emps.length === 1 && emps[0].user_id && emps[0].employment_status === 'active') {
      userId = emps[0].user_id;
    }
  }

  if (isSuspended) {
    return SUSPENDED(request);
  }

  let email: string | null = null;
  if (userId) {
    const { data: userResult } = await admin.auth.admin.getUserById(userId);
    email = userResult?.user?.email ?? null;
  }

  if (!email) {
    // Equalise timing with dummy authentication
    await anon.auth.signInWithPassword({ email: 'nobody@invalid.local', password }).catch(() => undefined);
    return INVALID(request);
  }

  const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session) {
    return INVALID(request);
  }

  const s = signIn.session;
  return json(request, {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    token_type: s.token_type,
    expires_in: s.expires_in,
    expires_at: s.expires_at,
    user: { id: signIn.user?.id },
  });
});
