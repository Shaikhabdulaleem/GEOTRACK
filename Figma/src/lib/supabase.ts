import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicEnvironment } from './env';
import { AppError } from './errors';
import type { Database } from '../types/database';

let browserClient: SupabaseClient<Database> | null = null;

export function isSupabaseConfigured(): boolean {
  return publicEnvironment.isSupabaseConfigured;
}

export function getSupabaseClient(): SupabaseClient<Database> {
  if (!publicEnvironment.supabaseUrl || !publicEnvironment.supabasePublishableKey) {
    throw new AppError(
      'CONFIGURATION_ERROR',
      'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env.local.',
    );
  }

  if (!browserClient) {
    browserClient = createClient<Database>(
      publicEnvironment.supabaseUrl,
      publicEnvironment.supabasePublishableKey,
      {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: true,
          persistSession: true,
          storageKey: 'geotrack.auth',
        },
        global: {
          headers: {
            'X-Client-Info': 'geotrack-web/1.0.0',
          },
        },
      },
    );
  }

  return browserClient;
}
