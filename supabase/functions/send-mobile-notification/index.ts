import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.2';
import { importPKCS8, SignJWT } from 'npm:jose@6.1.0';

const allowedOrigins = new Set([
  'https://geotrack-fieldtrack-ksa.vercel.app',
  'http://localhost:5173',
]);

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  return {
    ...(origin && allowedOrigins.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

type NotificationRow = {
  id: string;
  organization_id: string;
  recipient_user_id: string;
};

const json = (request: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
  });

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
  if (!response.ok) throw new Error(`Firebase OAuth token request failed (${response.status})`);
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new Error('Firebase OAuth response did not contain an access token');
  return payload.access_token;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405);

  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return json(request, { error: 'Authentication required' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = defaultApiKey('SUPABASE_SECRET_KEYS') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = defaultApiKey('SUPABASE_PUBLISHABLE_KEYS') ?? Deno.env.get('SUPABASE_ANON_KEY');
  const projectId = Deno.env.get('FIREBASE_PROJECT_ID');
  if (!supabaseUrl || !serviceRoleKey || !anonKey || !projectId ||
      !Deno.env.get('FIREBASE_CLIENT_EMAIL') || !Deno.env.get('FIREBASE_PRIVATE_KEY')) {
    return json(request, { error: 'Push service is not configured' }, 503);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json(request, { error: 'Invalid session' }, 401);

  const body = await request.json().catch(() => null) as { notification_id?: string } | null;
  if (!body?.notification_id) return json(request, { error: 'notification_id is required' }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: notification, error: notificationError } = await admin
    .from('notifications')
    .select('id, organization_id, recipient_user_id')
    .eq('id', body.notification_id)
    .maybeSingle<NotificationRow>();
  if (notificationError) {
    console.error(JSON.stringify({ event: 'notification_lookup_failed', code: notificationError.code }));
    return json(request, { error: 'Unable to load notification' }, 500);
  }
  if (!notification) return json(request, { error: 'Notification not found' }, 404);

  // A sender must be the recipient or an active manager/admin in the same org.
  if (notification.recipient_user_id !== userData.user.id) {
    const { data: membership } = await admin
      .from('organization_memberships')
      .select('role_code')
      .eq('organization_id', notification.organization_id)
      .eq('user_id', userData.user.id)
      .eq('status', 'active')
      .in('role_code', ['manager', 'administrator'])
      .maybeSingle();
    if (!membership) return json(request, { error: 'Not allowed to dispatch this notification' }, 403);
  }

  const { data: tokens, error: tokenError } = await admin
    .from('mobile_push_tokens')
    .select('id, token')
    .eq('user_id', notification.recipient_user_id)
    .is('revoked_at', null);
  if (tokenError) {
    console.error(JSON.stringify({ event: 'push_token_lookup_failed', code: tokenError.code }));
    return json(request, { error: 'Unable to load push tokens' }, 500);
  }
  if (!tokens?.length) return json(request, { sent: 0 });

  let accessToken: string;
  try {
    accessToken = await firebaseAccessToken();
  } catch {
    console.error(JSON.stringify({ event: 'firebase_oauth_failed' }));
    return json(request, { error: 'Push delivery is temporarily unavailable' }, 502);
  }
  let sent = 0;
  let failed = 0;
  for (const tokenRow of tokens) {
    try {
      const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: tokenRow.token,
            data: { notification_id: notification.id },
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
        // Only a confirmed unregistered device token is safe to revoke.
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
  return json(request, { sent, failed }, sent === 0 && failed > 0 ? 502 : 200);
});
