import { getSupabaseClient } from '../lib/supabase';
import { executeQuery } from './database.service';
import type { BranchRow, DepartmentRow, TablesInsert, TablesUpdate } from '../types/database';

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
};
