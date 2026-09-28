import { getSupabaseClient } from '../lib/supabase';
import { executeQuery } from './database.service';
import type { ProductivityRecordRow, TablesInsert, TablesUpdate } from '../types/database';

export interface ProductivityQuery {
  organizationId: string;
  employeeId?: string;
  shiftAssignmentId?: string;
  fromDate?: string;
  toDate?: string;
}

export const productivityService = {
  /**
   * List productivity records for an organization, optionally filtered by employee or date range.
   */
  async list(queryInput: ProductivityQuery): Promise<ProductivityRecordRow[]> {
    let query = getSupabaseClient()
      .from('productivity_records')
      .select('*')
      .eq('organization_id', queryInput.organizationId)
      .order('work_date', { ascending: false });

    if (queryInput.employeeId) query = query.eq('employee_id', queryInput.employeeId);
    if (queryInput.shiftAssignmentId) query = query.eq('shift_assignment_id', queryInput.shiftAssignmentId);
    if (queryInput.fromDate) query = query.gte('work_date', queryInput.fromDate);
    if (queryInput.toDate) query = query.lte('work_date', queryInput.toDate);

    return executeQuery(query, 'Unable to load productivity records.');
  },

  /**
   * Create or update a productivity record for a specific employee and shift/date.
   * Calculates the productivity percentage automatically if target_units > 0.
   */
  async logProductivity(input: TablesInsert<'productivity_records'>): Promise<ProductivityRecordRow> {
    const target = (input.target_units as number) || 0;
    const actual = (input.actual_units as number) || 0;

    const productivityPercent = target > 0 
      ? Math.round((actual / target) * 100) 
      : null;

    const payload = {
      ...input,
      productivity_percent: productivityPercent,
    };

    return executeQuery(
      getSupabaseClient()
        .from('productivity_records')
        .insert(payload)
        .select('*')
        .single(),
      'Unable to log productivity record.'
    );
  },

  /**
   * Update an existing productivity record (e.g. manager adds notes or adjusts actual_units).
   */
  async updateProductivity(
    id: string, 
    updates: TablesUpdate<'productivity_records'>
  ): Promise<ProductivityRecordRow> {
    
    // If actual_units or target_units are updated, we need to recalculate the percentage if possible,
    // but the safest way is to fetch the current record first to do the math if both aren't provided.
    // However, if the frontend sends both or we just let DB handle it, we'll try to calculate if we have them.
    let productivityPercent = updates.productivity_percent;
    if (updates.target_units !== undefined && updates.actual_units !== undefined) {
       productivityPercent = (updates.target_units || 0) > 0 
        ? Math.round(((updates.actual_units as number) / (updates.target_units as number)) * 100)
        : null;
    }

    const payload = {
      ...updates,
      ...(productivityPercent !== undefined ? { productivity_percent: productivityPercent } : {})
    };

    return executeQuery(
      getSupabaseClient()
        .from('productivity_records')
        .update(payload)
        .eq('id', id)
        .select('*')
        .single(),
      'Unable to update productivity record.'
    );
  },

  /**
   * Calculates the overall aggregated productivity metrics (e.g. for a dashboard).
   */
  async getDashboardMetrics(organizationId: string, fromDate: string, toDate: string) {
    const records = await this.list({ organizationId, fromDate, toDate });
    
    let totalTarget = 0;
    let totalActual = 0;
    
    const byEmployee: Record<string, { target: number, actual: number, count: number }> = {};
    const byShift: Record<string, { target: number, actual: number, count: number }> = {};

    records.forEach(r => {
      totalTarget += r.target_units || 0;
      totalActual += r.actual_units || 0;

      // By Employee
      if (!byEmployee[r.employee_id]) byEmployee[r.employee_id] = { target: 0, actual: 0, count: 0 };
      byEmployee[r.employee_id].target += r.target_units || 0;
      byEmployee[r.employee_id].actual += r.actual_units || 0;
      byEmployee[r.employee_id].count += 1;

      // By Shift
      const shiftKey = r.shift_assignment_id || 'unassigned';
      if (!byShift[shiftKey]) byShift[shiftKey] = { target: 0, actual: 0, count: 0 };
      byShift[shiftKey].target += r.target_units || 0;
      byShift[shiftKey].actual += r.actual_units || 0;
      byShift[shiftKey].count += 1;
    });

    const averageProductivity = totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : 0;

    return {
      averageProductivity,
      totalRecords: records.length,
      byEmployee,
      byShift,
      raw: records
    };
  }
};
