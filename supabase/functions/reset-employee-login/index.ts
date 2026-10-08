import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';

// Resets an existing field-employee login to a NEW one-time temporary password.
//
// This is the "employee forgot their password" path: a manager (scoped) or
// administrator issues a fresh temporary password, which is shown exactly once
// to hand over. The old password is never revealed (Supabase stores only a
// hash); the account is forced to change the new temporary password on next
// sign-in via employee_profiles.must_change_password. Mirrors provision-employee
// for CORS, auth, and scope handling.

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

/** Cryptographically strong temporary password with mixed character classes. */
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

type ManagedEmployee = {
  id: string;
  organization_id: string;
  branch_id: string | null;
  department_id: string | null;
  manager_user_id: string | null;
};

/** Active administrator of the org, or a manager whose scope covers the employee. */
async function callerCanManageEmployee(
  admin: ReturnType<typeof createClient>,
  callerId: string,
  employee: ManagedEmployee,
): Promise<boolean> {
  const { data: membership } = await admin
    .from('organization_memberships')
    .select('role_code')
    .eq('organization_id', employee.organization_id)
    .eq('user_id', callerId)
    .eq('status', 'active')
    .in('role_code', ['manager', 'administrator'])
    .maybeSingle();
  if (!membership) return false;
  if (membership.role_code === 'administrator') return true;
  if (employee.manager_user_id && employee.manager_user_id === callerId) return true;

  const { data: scopes } = await admin
    .from('manager_scopes')
    .select('employee_id, branch_id, department_id')
    .eq('organization_id', employee.organization_id)
    .eq('manager_user_id', callerId);
  return (scopes ?? []).some((scope) =>
    (scope.employee_id === null || scope.employee_id === employee.id) &&
    (scope.branch_id === null || scope.branch_id === employee.branch_id) &&
    (scope.department_id === null || scope.department_id === employee.department_id),
  );
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405);
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return json(request, { error: 'Authentication required' }, 401);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!url || !serviceRoleKey || !anonKey) return json(request, { error: 'Reset service is not configured' }, 503);

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
    .select('id, organization_id, user_id, employee_code, branch_id, department_id, manager_user_id')
    .eq('id', employeeId)
    .maybeSingle();
  if (employeeError) return json(request, { error: 'Unable to load employee' }, 500);
  if (!employee) return json(request, { error: 'Employee not found' }, 404);
  if (!employee.user_id) return json(request, { error: 'This employee has no login to reset yet' }, 409);
  if (!employee.employee_code) return json(request, { error: 'Employee is missing an Employee ID' }, 422);

  const allowed = await callerCanManageEmployee(admin, caller.user.id, employee as ManagedEmployee);
  if (!allowed) return json(request, { error: 'You do not have access to manage this employee' }, 403);

  const identifier = String(employee.employee_code);
  const temporaryPassword = generateTemporaryPassword();

  // 1. Set the new temporary password on the auth account.
  const { error: updateError } = await admin.auth.admin.updateUserById(employee.user_id, {
    password: temporaryPassword,
  });
  if (updateError) {
    console.error(JSON.stringify({ event: 'employee_password_reset_failed', code: updateError.code }));
    return json(request, { error: 'Unable to reset the password' }, 502);
  }

  // 2. Force a change on next sign-in and record when it was issued.
  const { error: flagError } = await admin
    .from('employee_profiles')
    .update({ must_change_password: true, login_last_reset_at: new Date().toISOString() })
    .eq('id', employee.id);
  if (flagError) {
    console.warn(JSON.stringify({ event: 'employee_reset_flag_failed', code: flagError.code }));
  }

  // The reset itself is recorded by login_last_reset_at on the profile above.
  // The temporary password is returned exactly once.
  return json(request, { identifier, temporary_password: temporaryPassword, status: 'reset' });
});
