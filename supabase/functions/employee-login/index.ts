import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';

/**
 * Employee sign-in by Employee ID or Iqama number.
 *
 * Field employees (e.g. mailroom / 3PL staff) do not have personal mailboxes,
 * so they authenticate with their employee code or iqama number instead of an
 * email. This function is the ONLY place the identifier -> account mapping is
 * resolved, and it runs with the service-role key server-side:
 *
 *  - The browser/app sends only { identifier, password } and receives only a
 *    Supabase session on success. The account email is never returned, so this
 *    is not the enumeration oracle that the removed resolve_login_email was.
 *  - A non-existent identifier and a wrong password are indistinguishable
 *    (identical 401), and a dummy password check equalises timing.
 *
 * Deploy with verify_jwt = false: this is a pre-authentication endpoint.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const INVALID = () => json({ error: 'The employee ID/iqama or password is incorrect.' }, 401);

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!url || !serviceRoleKey || !anonKey) return json({ error: 'Login service is not configured' }, 503);

  const body = await request.json().catch(() => null) as { identifier?: string; password?: string } | null;
  const identifier = body?.identifier?.trim();
  const password = body?.password;
  // Employee codes and iqama numbers are strictly alphanumeric. Enforcing that
  // also makes the identifier safe to place in a PostgREST filter below (no
  // wildcards, commas, or parentheses that could alter the query).
  if (!identifier || !password || identifier.length > 64 || password.length > 256 ||
      !/^[A-Za-z0-9]+$/.test(identifier)) {
    return INVALID();
  }

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Resolve the identifier to exactly one linked account. employee_code is
  // matched case-insensitively; iqama_number is matched exactly.
  const { data: matches, error: lookupError } = await admin
    .from('employee_profiles')
    .select('user_id, employee_code, iqama_number')
    .or(`employee_code.ilike.${identifier},iqama_number.eq.${identifier}`)
    .limit(2);

  let email: string | null = null;
  if (!lookupError && matches && matches.length === 1 && matches[0].user_id) {
    const { data: userResult } = await admin.auth.admin.getUserById(matches[0].user_id as string);
    email = userResult?.user?.email ?? null;
  }

  if (!email) {
    // Equalise timing with the success path so a missing identifier cannot be
    // distinguished from a wrong password, then fail generically.
    await anon.auth.signInWithPassword({ email: 'nobody@invalid.local', password }).catch(() => undefined);
    return INVALID();
  }

  const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email, password });
  if (signInError || !signIn.session) return INVALID();

  const s = signIn.session;
  return json({
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    token_type: s.token_type,
    expires_in: s.expires_in,
    expires_at: s.expires_at,
    user: { id: signIn.user?.id },
  });
});
