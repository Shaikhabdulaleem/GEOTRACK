import { getSupabaseClient } from '../lib/supabase';
import { executeQuery } from './database.service';
import type { PhoneUsageRecordRow, TablesInsert } from '../types/database';

export interface DeviceTelemetryPayload {
  organizationId: string;
  employeeId: string;
  deviceId: string;
  workDate: string;
  totalActiveMinutes: number;
  inShiftActiveMinutes: number;
  consentVersion: string;
}

export const deviceService = {
  /**
   * Endpoint designed for native Mobile Agents (Android UsageStatsManager / iOS MDM) 
   * to securely push phone usage telemetry to the backend.
   */
  async ingestTelemetry(payload: DeviceTelemetryPayload): Promise<PhoneUsageRecordRow> {
    const record: TablesInsert<'phone_usage_records'> = {
      organization_id: payload.organizationId,
      employee_id: payload.employeeId,
      device_id: payload.deviceId,
      work_date: payload.workDate,
      active_minutes: payload.totalActiveMinutes,
      within_shift_minutes: payload.inShiftActiveMinutes,
      consent_version: payload.consentVersion,
      source: 'native_mobile_agent'
    };

    // Upsert telemetry per employee per date
    return executeQuery(
      getSupabaseClient()
        .from('phone_usage_records')
        .upsert(record, { onConflict: 'employee_id,work_date' })
        .select('*')
        .single(),
      'Unable to ingest device telemetry.'
    );
  },

  /**
   * Aggregates phone usage metrics against actual worked hours from attendance records.
   * Designed for the Dashboard to display percentage of shift spent on phone.
   */
  async getDashboardUsage(organizationId: string, workDate: string) {
    const client = getSupabaseClient();
    
    // 1. Get phone usage records
    const { data: usageData, error: usageErr } = await client
      .from('phone_usage_records')
      .select('*, total_shift_minutes, usage_percentage, synced_at, shift_assignment_id')
      .eq('organization_id', organizationId)
      .eq('work_date', workDate);
      
    if (usageErr) throw usageErr;

    // 2. Get attendance records to calculate percentage of worked hours
    const { data: attData, error: attErr } = await client
      .from('attendance_records')
      .select('employee_id, worked_minutes')
      .eq('organization_id', organizationId)
      .eq('attendance_date', workDate);

    if (attErr) throw attErr;

    const attendanceMap = new Map(attData.map(a => [a.employee_id, a.worked_minutes || 0]));

    const aggregated = (usageData || []).map(usage => {
      const workedMins = attendanceMap.get(usage.employee_id) || 0;
      const usagePercent = usage.usage_percentage ?? (workedMins > 0
        ? Math.min(100, Math.round((usage.within_shift_minutes / workedMins) * 100))
        : 0);

      return {
        ...usage,
        worked_minutes: workedMins,
        usage_percent: usagePercent
      };
    });

    // Sort by highest usage first
    return aggregated.sort((a, b) => b.within_shift_minutes - a.within_shift_minutes);
  },

  async getWeeklyAverages(organizationId: string, endDate: string): Promise<Array<{ day: string; avg: number }>> {
    const end = new Date(`${endDate}T00:00:00Z`);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 6);
    const fromDate = start.toISOString().slice(0, 10);

    const { data, error } = await getSupabaseClient()
      .from('phone_usage_records')
      .select('work_date, within_shift_minutes, usage_percentage')
      .eq('organization_id', organizationId)
      .gte('work_date', fromDate)
      .lte('work_date', endDate)
      .order('work_date');
    if (error) throw error;

    const byDate = new Map<string, number[]>();
    for (const row of data ?? []) {
      const values = byDate.get(row.work_date) ?? [];
      if (row.usage_percentage !== null && row.usage_percentage !== undefined) {
        values.push(row.usage_percentage);
      }
      byDate.set(row.work_date, values);
    }

    return Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + offset);
      const key = date.toISOString().slice(0, 10);
      const values = byDate.get(key) ?? [];
      return {
        day: new Intl.DateTimeFormat('en', { weekday: 'short', timeZone: 'UTC' }).format(date),
        avg: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0,
      };
    });
  }
};
