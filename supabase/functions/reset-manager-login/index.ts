import { createClient } from 'npm:@supabase/supabase-js@2.57.2';

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

function generateTemporaryPassword(): string {
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const pick = (set: string, n: number) => {
    const bytes = new Uint32Array(n);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => set[b % set.length]).join('');
  };
  const base = pick(upper, 2) + pick(lower, 2) + pick(digits, 2) + pick(all, 8);
  const chars = base.split('');
  for (let i = chars.length - 1; i > 0; i--) {
    const r = new Uint32Array(1);
    crypto.getRandomValues(r);
    const j = r[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

interface ResetManagerPayload {
  manager_profile_id: string;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(request) });
  }
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405);

  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return json(request, { error: 'Authentication required' }, 401);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!url || !serviceRoleKey || !anonKey) {
    return json(request, { error: 'Reset service is not configured' }, 503);
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: caller, error: callerError } = await userClient.auth.getUser();
  if (callerError || !caller.user) return json(request, { error: 'Invalid session' }, 401);

  const body = (await request.json().catch(() => null)) as ResetManagerPayload | null;
  const profileId = body?.manager_profile_id;
  if (!profileId) return json(request, { error: 'A manager profile ID is required' }, 400);

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1. Fetch manager profile
  const { data: manager, error: managerError } = await admin
    .from('manager_profiles')
    .select('id, organization_id, user_id, manager_code, full_name, email, status')
    .eq('id', profileId)
    .maybeSingle();

  if (managerError || !manager) return json(request, { error: 'Manager profile not found' }, 404);
  if (!manager.user_id) return json(request, { error: 'Manager has no linked login account' }, 409);

  // 2. Verify caller is an active administrator in this organization
  const { data: callerMembership, error: membershipCheckErr } = await admin
    .from('organization_memberships')
    .select('role_code, status')
    .eq('organization_id', manager.organization_id)
    .eq('user_id', caller.user.id)
    .eq('status', 'active')
    .eq('role_code', 'administrator')
    .maybeSingle();

  if (membershipCheckErr || !callerMembership) {
    return json(request, { error: 'Administrator access required' }, 403);
  }

  const temporaryPassword = generateTemporaryPassword();

  // 3. Update Supabase Auth user password
  const { error: resetAuthError } = await admin.auth.admin.updateUserById(manager.user_id, {
    password: temporaryPassword,
  });

  if (resetAuthError) {
    return json(request, { error: 'Unable to reset auth password' }, 502);
  }

  // 4. Update manager_profiles must_change_password flag
  const { error: profileUpdateErr } = await admin
    .from('manager_profiles')
    .update({
      must_change_password: true,
      login_last_reset_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', manager.id);

  if (profileUpdateErr) {
    return json(request, { error: `Unable to update manager profile: ${profileUpdateErr.message}` }, 500);
  }

  // 5. Log activity in manager_activity_logs
  await admin.from('manager_activity_logs').insert({
    organization_id: manager.organization_id,
    manager_profile_id: manager.id,
    actor_user_id: caller.user.id,
    action: 'password_reset',
    details: { manager_code: manager.manager_code },
  });

  return json(request, {
    manager_code: manager.manager_code,
    temporary_password: temporaryPassword,
    status: 'reset',
  });
});
