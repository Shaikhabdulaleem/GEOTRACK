import { getSupabaseClient } from '../lib/supabase';
import { executeQuery } from './database.service';
import { toAppError } from '../lib/errors';
import type { EmployeeProfileRow, OrganizationMembershipRow, UserRow } from '../types/database';

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
};
