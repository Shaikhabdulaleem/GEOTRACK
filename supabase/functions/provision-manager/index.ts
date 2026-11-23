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

const SYNTHETIC_EMAIL_DOMAIN = Deno.env.get('SYNTHETIC_EMAIL_DOMAIN') ?? 'geotrack.app';

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

interface ProvisionManagerPayload {
  organization_id: string;
  manager_code: string;
  full_name: string;
  email?: string;
  phone?: string;
  department_ids?: string[];
  primary_department_id?: string;
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
    return json(request, { error: 'Provisioning service is not configured' }, 503);
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: caller, error: callerError } = await userClient.auth.getUser();
  if (callerError || !caller.user) return json(request, { error: 'Invalid session' }, 401);

  const body = (await request.json().catch(() => null)) as ProvisionManagerPayload | null;
  const orgId = body?.organization_id;
  const rawCode = body?.manager_code?.trim().toUpperCase();
  const rawName = body?.full_name?.trim();
  const rawEmail = body?.email?.trim();
  const rawPhone = body?.phone?.trim();
  const deptIds = body?.department_ids ?? [];
  const primaryDeptId = body?.primary_department_id;

  if (!orgId || !rawCode || !rawName) {
    return json(request, { error: 'Organization ID, Manager ID, and Full Name are required' }, 400);
  }

  if (!/^[A-Za-z0-9_-]{2,32}$/.test(rawCode)) {
    return json(request, { error: 'Manager ID must be 2-32 alphanumeric characters, hyphens or underscores' }, 422);
  }

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1. Verify caller is an active administrator in this organization
  const { data: callerMembership, error: membershipCheckErr } = await admin
    .from('organization_memberships')
    .select('role_code, status')
    .eq('organization_id', orgId)
    .eq('user_id', caller.user.id)
    .eq('status', 'active')
    .eq('role_code', 'administrator')
    .maybeSingle();

  if (membershipCheckErr || !callerMembership) {
    return json(request, { error: 'Administrator access required' }, 403);
  }

  // 2. Check if manager_code is already taken in this org
  const { data: existingCode } = await admin
    .from('manager_profiles')
    .select('id')
    .eq('organization_id', orgId)
    .ilike('manager_code', rawCode)
    .maybeSingle();

  if (existingCode) {
    return json(request, { error: `Manager ID '${rawCode}' is already in use in this organization` }, 409);
  }

  const sanitizedCode = rawCode.toLowerCase().replace(/[^a-z0-9]/g, '');
  const orgSlug = orgId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  const email = rawEmail || `${sanitizedCode}.${orgSlug}@${SYNTHETIC_EMAIL_DOMAIN}`;
  const temporaryPassword = generateTemporaryPassword();

  // 3. Create auth user in Supabase Auth
  const { data: createdAuth, error: createAuthError } = await admin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: {
      full_name: rawName,
      display_name: rawName,
      manager_code: rawCode,
      organization_id: orgId,
    },
  });

  if (createAuthError || !createdAuth.user) {
    const isConflict = createAuthError?.code === 'email_exists' || createAuthError?.status === 422;
    return json(
      request,
      { error: isConflict ? 'An account with this email already exists' : 'Unable to create auth account' },
      isConflict ? 409 : 502,
    );
  }

  const newUserId = createdAuth.user.id;

  const rollback = async () => {
    if (primaryDeptId) {
      await admin
        .from('departments')
        .update({ manager_user_id: null, updated_at: new Date().toISOString() })
        .eq('id', primaryDeptId)
        .eq('manager_user_id', newUserId)
        .catch(() => undefined);
    }
    await admin
      .from('manager_scopes')
      .delete()
      .eq('organization_id', orgId)
      .eq('manager_user_id', newUserId)
      .catch(() => undefined);
    await admin
      .from('organization_memberships')
      .delete()
      .eq('organization_id', orgId)
      .eq('user_id', newUserId)
      .catch(() => undefined);
    await admin.from('manager_profiles').delete().eq('organization_id', orgId).eq('user_id', newUserId).catch(() => undefined);
    await admin.auth.admin.deleteUser(newUserId).catch(() => undefined);
  };

  // 4. Create manager_profiles record
  const { data: profile, error: profileError } = await admin
    .from('manager_profiles')
    .insert({
      organization_id: orgId,
      user_id: newUserId,
      manager_code: rawCode,
      full_name: rawName,
      email: rawEmail || null,
      phone: rawPhone || null,
      status: 'active',
      must_change_password: true,
      login_last_reset_at: new Date().toISOString(),
      created_by: caller.user.id,
    })
    .select('*')
    .single();

  if (profileError || !profile) {
    console.error('provision-manager: profileError:', profileError);
    await admin.auth.admin.deleteUser(newUserId).catch(() => undefined);
    return json(
      request,
      { error: profileError?.message ? `Unable to save manager profile: ${profileError.message}` : 'Unable to save manager profile' },
      500,
    );
  }

  // 5. Grant manager role membership
  const { error: memberError } = await admin.from('organization_memberships').upsert(
    {
      organization_id: orgId,
      user_id: newUserId,
      role_code: 'manager',
      status: 'active',
    },
    { onConflict: 'organization_id,user_id,role_code' },
  );

  if (memberError) {
    console.error('provision-manager: memberError:', memberError);
    await rollback();
    return json(
      request,
      { error: memberError?.message ? `Unable to assign manager membership role: ${memberError.message}` : 'Unable to assign manager membership role' },
      500,
    );
  }

  // 6. Assign department scopes in manager_scopes
  if (deptIds.length > 0) {
    const { data: deptRows, error: deptFetchErr } = await admin
      .from('departments')
      .select('id, branch_id')
      .eq('organization_id', orgId)
      .in('id', deptIds);

    if (deptFetchErr || !deptRows || deptRows.length !== deptIds.length) {
      await rollback();
      return json(request, { error: 'One or more assigned departments do not exist in this organization' }, 400);
    }

    const scopeRows = deptRows.map((d) => ({
      organization_id: orgId,
      manager_user_id: newUserId,
      department_id: d.id,
      branch_id: d.branch_id,
    }));
    const { error: scopeErr } = await admin.from('manager_scopes').insert(scopeRows);
    if (scopeErr) {
      console.error('provision-manager: scopeErr:', scopeErr);
      await rollback();
      return json(
        request,
        { error: `Unable to assign manager department scopes: ${scopeErr.message}` },
        500,
      );
    }
  }

  // 7. If primary department specified, set manager_user_id on department
  if (primaryDeptId) {
    const { error: primaryErr } = await admin
      .from('departments')
      .update({ manager_user_id: newUserId, updated_at: new Date().toISOString() })
      .eq('id', primaryDeptId)
      .eq('organization_id', orgId);

    if (primaryErr) {
      console.error('provision-manager: primaryErr:', primaryErr);
      await rollback();
      return json(
        request,
        { error: `Unable to set primary department: ${primaryErr.message}` },
        500,
      );
    }
  }

  // 8. Log creation in manager_activity_logs
  const { error: logErr } = await admin.from('manager_activity_logs').insert({
    organization_id: orgId,
    manager_profile_id: profile.id,
    actor_user_id: caller.user.id,
    action: 'created',
    details: {
      manager_code: rawCode,
      full_name: rawName,
      department_ids: deptIds,
      primary_department_id: primaryDeptId ?? null,
    },
  });

  if (logErr) {
    console.error('provision-manager: logErr:', logErr);
    await rollback();
    return json(
      request,
      { error: `Unable to record manager audit log: ${logErr.message}` },
      500,
    );
  }

  return json(request, {
    manager_id: profile.id,
    user_id: newUserId,
    manager_code: rawCode,
    full_name: rawName,
    email,
    temporary_password: temporaryPassword,
    status: 'created',
  });
});
