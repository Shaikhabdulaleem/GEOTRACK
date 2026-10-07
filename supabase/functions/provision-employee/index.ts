import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';

// This function is invoked from the admin web dashboard, so it must answer CORS
// preflight and echo an allowed origin. Mirrors send-mobile-notification: any
// GeoTrack Vercel host, local dev, plus optional ALLOWED_ORIGINS additions.
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

const json = (request: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders(request), 'content-type': 'application/json' },
});

/**
 * Trusted account-provisioning boundary for field staff who have no mailbox.
 *
 * Employees sign in with their Employee ID / Iqama + password through the
 * `employee-login` function, which resolves the identifier to the account's
 * email server-side. The email is therefore never shown to anyone and only has
 * to be unique, so we mint a synthetic `<employee_code>@geotrack.app` address
 * and a strong temporary password here.
 *
 * The service-role key exists only in Edge Function secrets. The browser sends
 * an employee id and receives the login identifier plus a ONE-TIME temporary
 * password that the administrator hands to the employee in person. No password
 * is ever stored in our tables.
 */

const SYNTHETIC_EMAIL_DOMAIN = Deno.env.get('SYNTHETIC_EMAIL_DOMAIN') ?? 'geotrack.app';

/** Cryptographically strong temporary password with mixed character classes. */
function generateTemporaryPassword(): string {
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // no I/O/L to avoid confusion when read aloud
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const pick = (set: string, n: number) => {
    const bytes = new Uint32Array(n);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => set[b % set.length]).join('');
  };
  // Guarantee at least one of each class, then fill to 14 chars and shuffle.
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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405);
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return json(request, { error: 'Authentication required' }, 401);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!url || !serviceRoleKey || !anonKey) return json(request, { error: 'Provisioning service is not configured' }, 503);

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: caller, error: callerError } = await userClient.auth.getUser();
  if (callerError || !caller.user) return json(request, { error: 'Invalid session' }, 401);

  const body = await request.json().catch(() => null) as { employee_id?: string } | null;
  const employeeId = body?.employee_id;
  if (!employeeId) return json(request, { error: 'An employee is required' }, 400);

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: employee, error: employeeError } = await admin
    .from('employee_profiles')
    .select('id, organization_id, user_id, employee_code')
    .eq('id', employeeId)
    .maybeSingle();
  if (employeeError) return json(request, { error: 'Unable to load employee' }, 500);
  if (!employee) return json(request, { error: 'Employee not found' }, 404);
  if (employee.user_id) return json(request, { error: 'Employee already has a login account' }, 409);
  if (!employee.employee_code) return json(request, { error: 'Employee is missing an Employee ID' }, 422);

  // Caller must be an active administrator of the employee's organization.
  const { data: membership } = await admin
    .from('organization_memberships')
    .select('role_code')
    .eq('organization_id', employee.organization_id)
    .eq('user_id', caller.user.id)
    .eq('status', 'active')
    .eq('role_code', 'administrator')
    .maybeSingle();
  if (!membership) return json(request, { error: 'Administrator access required' }, 403);

  const identifier = String(employee.employee_code);
  const email = `${identifier.toLowerCase()}@${SYNTHETIC_EMAIL_DOMAIN}`;
  const temporaryPassword = generateTemporaryPassword();

  // 1. Create the auth account (email auto-confirmed — there is no mailbox).
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { employee_id: employee.id, organization_id: employee.organization_id },
  });
  if (createError || !created.user) {
    console.error(JSON.stringify({ event: 'employee_create_failed', code: createError?.code }));
    const alreadyExists = createError?.code === 'email_exists' || createError?.status === 422;
    return json(request,
      { error: alreadyExists ? 'A login already exists for this Employee ID' : 'Unable to create the login account' },
      alreadyExists ? 409 : 502,
    );
  }

  // 2. Link the profile to the new account. The `is('user_id', null)` guard
  //    prevents a race from clobbering an account provisioned concurrently.
  const { data: linked, error: linkError } = await admin
    .from('employee_profiles')
    .update({ user_id: created.user.id })
    .eq('id', employee.id)
    .is('user_id', null)
    .select('id')
    .maybeSingle();
  if (linkError || !linked) {
    // Roll back the orphaned auth user so a retry can succeed cleanly.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    return json(request, { error: 'Unable to link the new account' }, 500);
  }

  // 3. Grant the employee membership role. The app denies access without an
  //    active membership, so a failure here must not be swallowed — otherwise
  //    we would hand out a password for an account that cannot sign in. The
  //    unique constraint is on (organization_id, user_id, role_code).
  const { error: membershipError } = await admin.from('organization_memberships').upsert(
    { organization_id: employee.organization_id, user_id: created.user.id, role_code: 'employee', status: 'active' },
    { onConflict: 'organization_id,user_id,role_code' },
  );
  if (membershipError) {
    // Roll back the auth account and profile link so a retry can succeed cleanly.
    await admin.from('employee_profiles').update({ user_id: null }).eq('id', employee.id).catch(() => undefined);
    await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    console.error(JSON.stringify({ event: 'employee_membership_failed', code: membershipError.code }));
    return json(request, { error: 'Unable to grant the employee access role' }, 500);
  }

  // 4. Best-effort audit trail. Failure here does not undo a working account.
  await admin.from('employee_account_invitations').insert({
    organization_id: employee.organization_id,
    employee_id: employee.id,
    invited_by: caller.user.id,
    requested_email: email,
    auth_user_id: created.user.id,
    status: 'sent',
  }).then(({ error }) => {
    if (error) console.warn(JSON.stringify({ event: 'invitation_audit_failed', code: error.code }));
  });

  // The temporary password is returned exactly once. The administrator must
  // deliver it to the employee; it cannot be retrieved again.
  return json(request, { identifier, email, temporary_password: temporaryPassword, status: 'created' });
});
