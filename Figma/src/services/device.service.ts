import { getSupabaseClient } from '../lib/supabase';
import { toAppError } from '../lib/errors';
import type { EmployeeDeviceRow, PhoneUsageRecordRow } from '../types/database';

export type DeviceReviewRecord = Pick<
  EmployeeDeviceRow,
  'id' | 'employee_id' | 'device_identifier_hash' | 'platform' | 'model' | 'os_version' | 'app_version' | 'integrity_status' | 'registered_at' | 'last_seen_at' | 'revoked_at'
>;

export interface DeviceApprovalItem {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  currentDevice: DeviceReviewRecord;
  previousDevice: DeviceReviewRecord | null;
}

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
  async listApprovalQueue(organizationId: string): Promise<DeviceApprovalItem[]> {
    const client = getSupabaseClient();
    const [devicesResult, employeesResult] = await Promise.all([
      client
        .from('employee_devices')
        .select('id, employee_id, device_identifier_hash, platform, model, os_version, app_version, integrity_status, registered_at, last_seen_at, revoked_at')
        .eq('organization_id', organizationId)
        .order('last_seen_at', { ascending: false, nullsFirst: false }),
      client
        .from('employee_profiles')
        .select('id, employee_code, full_name')
        .eq('organization_id', organizationId),
    ]);

    if (devicesResult.error) throw toAppError(devicesResult.error, 'Unable to load attendance devices.');
    if (employeesResult.error) throw toAppError(employeesResult.error, 'Unable to load employee details.');

    const employees = new Map((employeesResult.data ?? []).map(employee => [employee.id, employee]));
    const devices = devicesResult.data ?? [];
    return devices
      .filter(device => device.integrity_status === 'suspected' && !device.revoked_at)
      .map(currentDevice => {
        const employee = employees.get(currentDevice.employee_id);
        if (!employee) return null;
        const previousDevice = devices.find(device =>
          device.employee_id === currentDevice.employee_id
          && device.id !== currentDevice.id
          && device.integrity_status === 'valid'
          && !device.revoked_at
        ) ?? devices.find(device =>
          device.employee_id === currentDevice.employee_id
          && device.id !== currentDevice.id
        ) ?? null;
        return {
          employeeId: employee.id,
          employeeCode: employee.employee_code,
          employeeName: employee.full_name,
          currentDevice,
          previousDevice,
        };
      })
      .filter((item): item is DeviceApprovalItem => item !== null);
  },

  async reviewEnrollment(deviceId: string, decision: 'approve' | 'reject', reason: string | null): Promise<EmployeeDeviceRow> {
    const { data, error } = await getSupabaseClient().rpc('review_employee_device_enrollment', {
      p_device_id: deviceId,
      p_decision: decision,
      p_reason: reason,
    });
    if (error) throw toAppError(error, `Unable to ${decision} the device.`);
    return data;
  },

  /**
   * Endpoint designed for native Mobile Agents (Android UsageStatsManager / iOS MDM) 
   * to securely push phone usage telemetry to the backend.
   */
  async ingestTelemetry(payload: DeviceTelemetryPayload): Promise<PhoneUsageRecordRow> {
    void payload;
    throw new Error(
      'Direct browser telemetry ingestion is disabled. Approved native devices must use upsert_phone_usage_summary.',
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
      .select('*, total_shift_minutes, usage_percentage, synced_at, shift_assignment_id, data_status')
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
      const hasMeasuredData = usage.data_status === 'available' || usage.data_status === 'partial';
      const usagePercent = hasMeasuredData
        ? (usage.usage_percentage ?? (workedMins > 0
          ? Math.min(100, Math.round((usage.within_shift_minutes / workedMins) * 100))
          : null))
        : null;

      return {
        ...usage,
        worked_minutes: workedMins,
        usage_percent: usagePercent,
        telemetry_available: hasMeasuredData,
        telemetry_status: usage.data_status,
        evidence_classification: 'employee_device_reported',
      };
    });

    // Sort by highest usage first
    return aggregated.sort((a, b) => b.within_shift_minutes - a.within_shift_minutes);
  },

  async getWeeklyAverages(organizationId: string, endDate: string, employeeIds?: string[]): Promise<Array<{ day: string; avg: number }>> {
    const end = new Date(`${endDate}T00:00:00Z`);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 6);
    const fromDate = start.toISOString().slice(0, 10);

    let query = getSupabaseClient()
      .from('phone_usage_records')
      .select('work_date, within_shift_minutes, usage_percentage')
      .eq('organization_id', organizationId)
      .gte('work_date', fromDate)
      .lte('work_date', endDate)
      .order('work_date');
    if (employeeIds?.length) query = query.in('employee_id', employeeIds);
    const result = employeeIds && employeeIds.length === 0 ? { data: [], error: null } : await query;
    if (result.error) throw result.error;

    const byDate = new Map<string, number[]>();
    for (const row of result.data ?? []) {
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
