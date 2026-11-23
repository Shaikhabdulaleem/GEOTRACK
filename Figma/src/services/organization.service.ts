import { getSupabaseClient } from '../lib/supabase';
import { executeQuery } from './database.service';
import type {
  BranchRow,
  DepartmentRow,
  ManagerActivityHistoryItem,
  MembershipStatus,
  OrganizationManagerItem,
  OrganizationRow,
  TablesInsert,
  TablesUpdate,
} from '../types/database';

export interface SiteInput {
  organization_id: string;
  name: string;
  code: string;
  timezone: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  create_geofence?: boolean;
  geofence_radius_meters?: number;
}

export const organizationService = {
  async listSites(organizationId: string): Promise<BranchRow[]> {
    return executeQuery(getSupabaseClient().from('branches').select('*').eq('organization_id', organizationId).order('name'), 'Unable to load sites.');
  },
  async getAttendancePolicy(organizationId: string): Promise<number> {
    const row = await executeQuery<OrganizationRow>(
      getSupabaseClient().from('organizations').select('*').eq('id', organizationId).single(),
      'Unable to load the attendance policy.',
    );
    return row.auto_checkout_grace_minutes;
  },
  async updateAttendancePolicy(organizationId: string, graceMinutes: number): Promise<number> {
    return executeQuery<number>(getSupabaseClient().rpc('update_attendance_policy', {
      p_organization_id: organizationId,
      p_auto_checkout_grace_minutes: graceMinutes,
    }), 'Unable to update the attendance policy.');
  },
  async createSite(input: SiteInput): Promise<BranchRow> {
    return executeQuery(getSupabaseClient().rpc('create_site', {
      p_organization_id: input.organization_id,
      p_name: input.name,
      p_code: input.code,
      p_timezone: input.timezone,
      p_address: input.address,
      p_latitude: input.latitude,
      p_longitude: input.longitude,
      p_create_geofence: input.create_geofence ?? false,
      p_geofence_radius_meters: input.geofence_radius_meters ?? 30,
    }), 'Unable to create the site.');
  },
  async updateSite(id: string, input: TablesUpdate<'branches'>): Promise<BranchRow> {
    return executeQuery(getSupabaseClient().from('branches').update(input).eq('id', id).select('*').single(), 'Unable to update the site.');
  },
  async listDepartments(organizationId: string): Promise<DepartmentRow[]> {
    return executeQuery(getSupabaseClient().from('departments').select('*').eq('organization_id', organizationId).order('name'), 'Unable to load departments.');
  },
  async createDepartment(input: TablesInsert<'departments'>): Promise<DepartmentRow> {
    return executeQuery(getSupabaseClient().from('departments').insert(input).select('*').single(), 'Unable to create the department.');
  },
  async updateDepartment(id: string, input: TablesUpdate<'departments'>): Promise<DepartmentRow> {
    return executeQuery(getSupabaseClient().from('departments').update(input).eq('id', id).select('*').single(), 'Unable to update the department.');
  },

  async listManagers(organizationId: string): Promise<OrganizationManagerItem[]> {
    const client = getSupabaseClient();
    try {
      return await executeQuery<OrganizationManagerItem[]>(
        client.rpc('list_organization_managers', { p_organization_id: organizationId }),
        'Unable to load organization managers.',
      );
    } catch (caught: unknown) {
      const err = caught as { code?: string; message?: string };
      if (err?.code === 'PGRST202' || err?.message?.includes('schema cache') || err?.code === '42883') {
        const [profiles, scopes, departments] = await Promise.all([
          executeQuery(
            client.from('manager_profiles').select('*').eq('organization_id', organizationId).order('created_at', { ascending: false }),
            'Unable to load manager profiles.',
          ),
          executeQuery(
            client.from('manager_scopes').select('*').eq('organization_id', organizationId),
            'Unable to load manager scopes.',
          ),
          executeQuery(
            client.from('departments').select('*').eq('organization_id', organizationId),
            'Unable to load departments.',
          ),
        ]);
        const deptMap = new Map(departments.map(d => [d.id, d]));
        return profiles.map(mp => {
          const userScopes = scopes.filter(s => s.manager_user_id === mp.user_id && s.department_id);
          const deptIds = userScopes.map(s => s.department_id as string);
          const deptNames = deptIds.map(id => deptMap.get(id)?.name || 'Unknown department');
          const primaryDept = departments.find(d => d.manager_user_id === mp.user_id) ?? null;
          return {
            id: mp.id,
            organization_id: mp.organization_id,
            user_id: mp.user_id,
            manager_code: mp.manager_code,
            full_name: mp.full_name,
            email: mp.email,
            phone: mp.phone,
            status: mp.status,
            must_change_password: mp.must_change_password,
            login_last_reset_at: mp.login_last_reset_at,
            created_at: mp.created_at,
            updated_at: mp.updated_at,
            assigned_department_ids: deptIds,
            assigned_department_names: deptNames,
            primary_department_id: primaryDept?.id ?? null,
            primary_department_name: primaryDept?.name ?? null,
          };
        });
      }
      throw caught;
    }
  },

  async updateManagerStatus(organizationId: string, managerProfileId: string, newStatus: MembershipStatus): Promise<void> {
    const client = getSupabaseClient();
    await executeQuery(
      client.rpc('admin_update_manager_status', {
        p_organization_id: organizationId,
        p_manager_profile_id: managerProfileId,
        p_new_status: newStatus,
      }),
      'Unable to update manager status.',
    );
  },

  async assignManagerDepartments(
    organizationId: string,
    managerUserId: string,
    departmentIds: string[],
    primaryDepartmentId?: string | null,
  ): Promise<void> {
    const client = getSupabaseClient();
    await executeQuery(
      client.rpc('admin_assign_manager_departments', {
        p_organization_id: organizationId,
        p_manager_user_id: managerUserId,
        p_department_ids: departmentIds,
        p_primary_department_id: primaryDepartmentId || null,
      }),
      'Unable to update manager department assignments.',
    );
  },

  async setDepartmentPrimaryManager(
    organizationId: string,
    departmentId: string,
    managerUserId: string | null,
  ): Promise<void> {
    const client = getSupabaseClient();
    await executeQuery(
      client.rpc('admin_set_department_primary_manager', {
        p_organization_id: organizationId,
        p_department_id: departmentId,
        p_manager_user_id: managerUserId || null,
      }),
      'Unable to set the department primary manager.',
    );
  },

  async getManagerActivityHistory(organizationId: string, managerProfileId: string): Promise<ManagerActivityHistoryItem[]> {
    const client = getSupabaseClient();
    return await executeQuery<ManagerActivityHistoryItem[]>(
      client.rpc('get_manager_activity_history', {
        p_organization_id: organizationId,
        p_manager_profile_id: managerProfileId,
      }),
      'Unable to load manager activity history.',
    );
  },
};
