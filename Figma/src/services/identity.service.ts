import { getSupabaseClient } from '../lib/supabase';
import { executeQuery } from './database.service';
import { toAppError } from '../lib/errors';
import type { EmployeeProfileRow, ManagerProfileRow, ManagerScopeRow, OrganizationMembershipRow, UserRow } from '../types/database';

export const identityService = {
  async getProfile(userId: string): Promise<UserRow> {
    return executeQuery(
      getSupabaseClient().from('users').select('*').eq('id', userId).single(),
      'Unable to load the user profile.',
    );
  },

  async getMemberships(userId: string): Promise<OrganizationMembershipRow[]> {
    return executeQuery(
      getSupabaseClient()
        .from('organization_memberships')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: true }),
      'Unable to load organization memberships.',
    );
  },

  async getEmployeeProfile(userId: string, organizationId: string): Promise<EmployeeProfileRow | null> {
    const { data, error } = await getSupabaseClient()
      .from('employee_profiles')
      .select('*')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (error) throw toAppError(error, 'Unable to load the employee profile.');
    return data;
  },

  async getManagerProfile(userId: string, organizationId: string): Promise<ManagerProfileRow | null> {
    try {
      const { data, error } = await getSupabaseClient()
        .from('manager_profiles')
        .select('*')
        .eq('user_id', userId)
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (error) {
        // Gracefully handle unapplied migration or missing permissions in schema cache
        if (error.code === '42P01' || error.code === '42501' || error.message?.includes('schema cache')) {
          return null;
        }
        throw toAppError(error, 'Unable to load the manager profile.');
      }
      return data;
    } catch (caught: unknown) {
      const err = caught as { code?: string; message?: string };
      if (err?.code === '42P01' || err?.code === '42501' || err?.message?.includes('schema cache')) {
        return null;
      }
      throw caught;
    }
  },

  async getManagerScopes(userId: string, organizationId: string): Promise<ManagerScopeRow[]> {
    try {
      const { data, error } = await getSupabaseClient()
        .from('manager_scopes')
        .select('*')
        .eq('manager_user_id', userId)
        .eq('organization_id', organizationId);

      if (error) {
        // Gracefully handle unapplied migration or missing permissions in schema cache
        if (error.code === '42P01' || error.code === '42501' || error.message?.includes('schema cache')) {
          return [];
        }
        throw toAppError(error, 'Unable to load manager scopes.');
      }
      return data ?? [];
    } catch (caught: unknown) {
      const err = caught as { code?: string; message?: string };
      if (err?.code === '42P01' || err?.code === '42501' || err?.message?.includes('schema cache')) {
        return [];
      }
      throw caught;
    }
  },
};
