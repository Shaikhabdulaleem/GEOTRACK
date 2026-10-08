// Scheduled push dispatcher for geofence-breach alerts.
//
// The SQL detector (private.detect_geofence_breaches) opens breaches, inserts a
// notification per manager, and enqueues one geofence_breach_alerts row each.
// This function drains that queue and sends an FCM data message per recipient
// device, exactly like send-mobile-notification but server-initiated: there is
// no end-user session, so it authenticates the caller by a shared secret and
// uses the service role to read tokens.
//
// Schedule it every few minutes (Supabase Dashboard > Edge Functions > Schedule,
// or pg_cron + pg_net), sending `Authorization: Bearer <SCHEDULE_SECRET>`.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { importPKCS8, SignJWT } from 'npm:jose@6.1.0';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function defaultApiKey(environmentName: string): string | undefined {
  const value = Deno.env.get(environmentName);
  if (!value) return undefined;
  try {
    const keys = JSON.parse(value) as Record<string, unknown>;
    return typeof keys.default === 'string' ? keys.default : undefined;
  } catch {
    return undefined;
  }
}

async function firebaseAccessToken(): Promise<string> {
  const email = Deno.env.get('FIREBASE_CLIENT_EMAIL');
  const privateKey = Deno.env.get('FIREBASE_PRIVATE_KEY')?.replaceAll('\\n', '\n');
  if (!email || !privateKey) throw new Error('Firebase service-account secrets are not configured');

  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(privateKey, 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new Error('Firebase OAuth response did not contain an access token');
  return payload.access_token;
}

type ClaimedAlert = {
  alert_id: string;
  notification_id: string | null;
  recipient_user_id: string;
};

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Caller auth: a shared schedule secret, or the project's service role key.
  const scheduleSecret = Deno.env.get('SCHEDULE_SECRET');
  const serviceRoleKey = defaultApiKey('SUPABASE_SECRET_KEYS') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const projectId = Deno.env.get('FIREBASE_PROJECT_ID');

  const authorization = request.headers.get('Authorization');
  const presented = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
  const allowed = [scheduleSecret, serviceRoleKey].filter((value): value is string => !!value);
  if (!presented || !allowed.includes(presented)) return json({ error: 'Unauthorized' }, 401);

  if (!supabaseUrl || !serviceRoleKey || !projectId ||
      !Deno.env.get('FIREBASE_CLIENT_EMAIL') || !Deno.env.get('FIREBASE_PRIVATE_KEY')) {
    return json({ error: 'Push service is not configured' }, 503);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const { data: claimed, error: claimError } = await admin.rpc('claim_breach_push_batch', { p_limit: 200 });
  if (claimError) {
    console.error(JSON.stringify({ event: 'claim_failed', code: claimError.code }));
    return json({ error: 'Unable to claim breach alerts' }, 500);
  }
  const alerts = (claimed ?? []) as ClaimedAlert[];
  if (alerts.length === 0) return json({ sent: 0, failed: 0, recipients: 0 });

  // One FCM OAuth token for the whole batch.
  let accessToken: string;
  try {
    accessToken = await firebaseAccessToken();
  } catch {
    console.error(JSON.stringify({ event: 'firebase_oauth_failed' }));
    return json({ error: 'Push delivery is temporarily unavailable' }, 502);
  }

  let sent = 0;
  let failed = 0;
  for (const alert of alerts) {
    const { data: tokens, error: tokenError } = await admin
      .from('mobile_push_tokens')
      .select('id, token')
      .eq('user_id', alert.recipient_user_id)
      .is('revoked_at', null);
    if (tokenError || !tokens?.length) continue;

    for (const tokenRow of tokens) {
      try {
        const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: tokenRow.token,
              data: {
                type: 'geofence_breach',
                ...(alert.notification_id ? { notification_id: alert.notification_id } : {}),
              },
              android: { priority: 'HIGH' },
            },
          }),
        });
        if (response.ok) {
          sent += 1;
          continue;
        }
        const result = await response.json().catch(() => null) as {
          error?: { details?: Array<{ errorCode?: string }> };
        } | null;
        const errorCode = result?.error?.details?.find((detail) => detail.errorCode)?.errorCode;
        if (errorCode === 'UNREGISTERED') {
          await admin.from('mobile_push_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', tokenRow.id);
        } else {
          failed += 1;
          console.warn(JSON.stringify({ event: 'fcm_send_failed', status: response.status, code: errorCode }));
        }
      } catch {
        failed += 1;
        console.warn(JSON.stringify({ event: 'fcm_network_failed' }));
      }
    }
  }

  return json({ sent, failed, recipients: alerts.length }, sent === 0 && failed > 0 ? 502 : 200);
});
