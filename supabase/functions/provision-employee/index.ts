import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

/**
 * Trusted account-provisioning boundary. The browser only sends an employee
 * id and work email; the service-role key exists exclusively in Edge Function
 * secrets and is never returned to Web or Android clients.
 */
Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Authentication required' }, 401);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!url || !serviceRoleKey || !anonKey) return json({ error: 'Provisioning service is not configured' }, 503);

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: caller, error: callerError } = await userClient.auth.getUser();
  if (callerError || !caller.user) return json({ error: 'Invalid session' }, 401);

  const body = await request.json().catch(() => null) as { employee_id?: string; email?: string } | null;
  const employeeId = body?.employee_id;
  const email = body?.email?.trim().toLowerCase();
  if (!employeeId || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'Employee and work email are required' }, 400);
  }

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: employee, error: employeeError } = await admin
    .from('employee_profiles')
    .select('id, organization_id, user_id')
    .eq('id', employeeId)
    .maybeSingle();
  if (employeeError) return json({ error: 'Unable to load employee' }, 500);
  if (!employee || employee.user_id) return json({ error: 'Employee is already provisioned or not found' }, 409);

  const { data: membership } = await admin
    .from('organization_memberships')
    .select('role_code')
    .eq('organization_id', employee.organization_id)
    .eq('user_id', caller.user.id)
    .eq('status', 'active')
    .eq('role_code', 'administrator')
    .maybeSingle();
  if (!membership) return json({ error: 'Administrator access required' }, 403);

  const { data: invitation, error: invitationError } = await admin
    .from('employee_account_invitations')
    .insert({ organization_id: employee.organization_id, employee_id: employee.id, invited_by: caller.user.id, requested_email: email, status: 'pending' })
    .select('*')
    .single();
  if (invitationError) return json({ error: 'An invitation is already pending' }, 409);

  const { data: invited, error: authError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { employee_id: employee.id, organization_id: employee.organization_id },
  });
  if (authError || !invited.user) {
    await admin.from('employee_account_invitations').update({ status: 'failed' }).eq('id', invitation.id);
    console.error(JSON.stringify({ event: 'employee_invite_failed', code: authError?.code }));
    return json({ error: 'Unable to send the account invitation' }, 502);
  }

  const { error: linkError } = await admin
    .from('employee_profiles')
    .update({ user_id: invited.user.id })
    .eq('id', employee.id)
    .is('user_id', null);
  if (linkError) {
    await admin.from('employee_account_invitations').update({ status: 'failed' }).eq('id', invitation.id);
    return json({ error: 'Unable to link the invited account' }, 500);
  }
  await admin.from('organization_memberships').upsert(
    { organization_id: employee.organization_id, user_id: invited.user.id, role_code: 'employee', status: 'active' },
    { onConflict: 'organization_id,user_id' },
  );
  const { data: result } = await admin
    .from('employee_account_invitations')
    .update({ auth_user_id: invited.user.id, status: 'sent' })
    .eq('id', invitation.id)
    .select('*')
    .single();
  return json(result ?? { ...invitation, auth_user_id: invited.user.id, status: 'sent' });
});
