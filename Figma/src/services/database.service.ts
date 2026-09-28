import type { PostgrestError } from '@supabase/supabase-js';
import { getSupabaseClient } from '../lib/supabase';
import { toAppError } from '../lib/errors';

export abstract class DatabaseService {
  protected readonly client = getSupabaseClient();

  protected unwrap<T>(result: { data: T | null; error: PostgrestError | null }, fallbackMessage: string): T {
    if (result.error) throw toAppError(result.error, fallbackMessage);
    if (result.data === null) throw toAppError(null, fallbackMessage);
    return result.data;
  }
}

export async function executeQuery<T>(
  query: PromiseLike<{ data: T | null; error: PostgrestError | null }>,
  fallbackMessage: string,
): Promise<T> {
  const result = await query;
  if (result.error) throw toAppError(result.error, fallbackMessage);
  if (result.data === null) throw toAppError(null, fallbackMessage);
  return result.data;
}
