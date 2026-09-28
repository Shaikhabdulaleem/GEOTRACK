import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase';
import { toAppError } from '../lib/errors';

export interface ConnectionCheck {
  configured: boolean;
  authReachable: boolean;
  databaseReachable: boolean;
}

export async function checkSupabaseConnection(): Promise<ConnectionCheck> {
  if (!isSupabaseConfigured()) {
    return { configured: false, authReachable: false, databaseReachable: false };
  }

  const client = getSupabaseClient();
  const { error: authError } = await client.auth.getSession();
  if (authError) throw toAppError(authError, 'Unable to reach Supabase Auth.');

  const { error: databaseError } = await client
    .from('organizations')
    .select('id', { count: 'exact', head: true });

  if (databaseError) throw toAppError(databaseError, 'Unable to reach the Supabase Data API.');

  return { configured: true, authReachable: true, databaseReachable: true };
}
