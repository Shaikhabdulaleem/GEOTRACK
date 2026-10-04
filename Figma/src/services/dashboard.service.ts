import { getSupabaseClient } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { shiftService } from './shift.service';

export interface DashboardFilters {
  date: string;
  branchId?: string;
  departmentId?: string;
  shiftId?: string;
  managerId?: string;
  employeeId?: string;
}

export interface DashboardGeofencePoint {
  id: string;
  name: string;
  color: string;
  polygon: Array<[number, number]>;
  present: number;
  employees: number;
}

interface LegacyShiftAssignment {
  employee_id: string;
  shift_id: string | null;
  status: string;
  shift: { id: string; crosses_midnight: boolean } | null;
}

function isMissingScheduleResolver(error: unknown): boolean {
  if (!(error instanceof AppError)) return false;
  const cause = error.cause as { code?: string; message?: string } | undefined;
  return cause?.code === 'PGRST202'
    && cause.message?.includes('resolve_employee_schedule') === true;
}

export const dashboardService = {
  /**
   * Efficiently aggregates dashboard KPIs using targeted SELECTs.
   * Avoids loading full tables by selecting only necessary columns.
   */
  async getMetrics(organizationId: string, filters: DashboardFilters) {
    const client = getSupabaseClient();
    
    // Base employee query (filtering by branch, dept, manager, employee)
    let empQuery = client
      .from('employee_profiles')
      .select('id, employment_status')
      .eq('organization_id', organizationId);
      
    if (filters.branchId) empQuery = empQuery.eq('branch_id', filters.branchId);
    if (filters.departmentId) empQuery = empQuery.eq('department_id', filters.departmentId);
    if (filters.managerId) empQuery = empQuery.eq('manager_user_id', filters.managerId);
    if (filters.employeeId) empQuery = empQuery.eq('id', filters.employeeId);
    
    const { data: emps, error: empErr } = await empQuery;
    if (empErr) throw empErr;
    
    const activeEmps = (emps || []).filter(e => e.employment_status === 'active');
    const validEmpIds = activeEmps.map(e => e.id);
    
    const totalEmployees = validEmpIds.length;
    
    // If no employees match filters, return zeros
    if (totalEmployees === 0) {
      return this.emptyMetrics();
    }
    
    // Batch fetch attendance for filtered employees
    const batchSize = 100;
    const allAttendance: Array<{
      employee_id: string;
      status: string;
      worked_minutes: number | null;
      overtime_minutes: number | null;
      shift_assignment_id: string | null;
      check_out_at: string | null;
    }> = [];
    
    // Only select required columns to minimize payload
    for (let i = 0; i < validEmpIds.length; i += batchSize) {
      const batchIds = validEmpIds.slice(i, i + batchSize);
      let attQuery = client
        .from('attendance_records')
        .select('employee_id, status, worked_minutes, overtime_minutes, shift_assignment_id, check_out_at')
        .eq('organization_id', organizationId)
        .eq('attendance_date', filters.date)
        .in('employee_id', batchIds);
        
      const { data: batchAtt, error: attendanceError } = await attQuery;
      if (attendanceError) throw attendanceError;
      if (batchAtt) allAttendance.push(...batchAtt);
    }
    
    let presentCount = 0;
    let absentCount = 0;
    let lateCount = 0;
    let missingCount = 0;
    let currentlyWorkingCount = 0; // Present but no checkout yet
    
    let totalWorkedMins = 0;
    let totalOvertimeMins = 0;
    
    allAttendance.forEach(a => {
      totalWorkedMins += (a.worked_minutes || 0);
      totalOvertimeMins += (a.overtime_minutes || 0);
      
      switch (a.status) {
        case 'present':
          presentCount++;
          if (!a.check_out_at) currentlyWorkingCount++;
          break;
        case 'late':
          lateCount++;
          presentCount++;
          if (!a.check_out_at) currentlyWorkingCount++;
          break;
        case 'absent': absentCount++; break;
        case 'missing_check_in': 
        case 'missing_check_out':
          missingCount++; break;
      }
    });

    // Shift counts (requires joining assignments + shifts)
    let dayShiftCount = 0;
    let nightShiftCount = 0;
    
    try {
      const schedules = await Promise.all(
        validEmpIds.map(employeeId => shiftService.resolveSchedule(employeeId, filters.date, filters.date)),
      );
      schedules.flat().forEach(row => {
        if (row.state !== 'working' || (filters.shiftId && row.shift_id !== filters.shiftId)) return;
        if (row.crosses_midnight) nightShiftCount++;
        else dayShiftCount++;
      });
    } catch (error) {
      if (!isMissingScheduleResolver(error)) throw error;

      // Compatibility path for deployments where the recurring-schedule
      // migration has not reached the database yet. Explicit assignments are
      // still useful dashboard data, and one missing RPC must not blank every
      // KPI on the page.
      logger.warn('Schedule resolver is unavailable; using explicit shift assignments for dashboard counts.', {
        error,
      });
      const assignments: LegacyShiftAssignment[] = [];
      for (let i = 0; i < validEmpIds.length; i += batchSize) {
        const batchIds = validEmpIds.slice(i, i + batchSize);
        const { data, error: assignmentError } = await client
          .from('shift_assignments')
          .select('employee_id, shift_id, status, shift:shifts(id, crosses_midnight)')
          .eq('organization_id', organizationId)
          .eq('work_date', filters.date)
          .eq('status', 'scheduled')
          .in('employee_id', batchIds);
        if (assignmentError) throw assignmentError;
        assignments.push(...((data ?? []) as unknown as LegacyShiftAssignment[]));
      }
      assignments.forEach(assignment => {
        if (!assignment.shift || (filters.shiftId && assignment.shift_id !== filters.shiftId)) return;
        if (assignment.shift.crosses_midnight) nightShiftCount++;
        else dayShiftCount++;
      });
    }
    
    // Pending Approvals (Overtime + Manual)
    const [otReqs, manualReqs] = await Promise.all([
      client.from('overtime_records').select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('status', 'pending'),
      client.from('manual_attendance_requests').select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('status', 'pending')
    ]);
    
    const pendingApprovals = (otReqs.count || 0) + (manualReqs.count || 0);
    
    // Geofence Violations
    let geofenceViolations = 0;
    for (let i = 0; i < validEmpIds.length; i += batchSize) {
      const batchIds = validEmpIds.slice(i, i + batchSize);
      const { count } = await client
        .from('attendance_events')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .gte('event_at', `${filters.date}T00:00:00Z`)
        .lte('event_at', `${filters.date}T23:59:59Z`)
        .in('employee_id', batchIds)
        .eq('inside_geofence', false);
      if (count) geofenceViolations += count;
    }

    // Mock trend data for now if we don't have historical data aggregated, but make it empty to show we removed hardcoded mocks
    // In a real app, you'd aggregate the last 7 days from attendance_records.
    const attendanceTrend: any[] = [];
    const otTrend: any[] = [];
    const productivityTrend: any[] = [];
    const geofencesData: DashboardGeofencePoint[] = [];
    
    return {
      totalEmployees,
      presentCount,
      absentCount,
      lateCount,
      missingCount,
      currentlyWorkingCount,
      dayShiftCount,
      nightShiftCount,
      totalWorkingHours: +(totalWorkedMins / 60).toFixed(1),
      totalOvertimeHours: +(totalOvertimeMins / 60).toFixed(1),
      pendingApprovals,
      geofenceViolations,
      validEmpIds, // Pass this for downstream productivity filtering
      attendanceTrend,
      otTrend,
      productivityTrend,
      geofencesData
    };
  },

  emptyMetrics() {
    return {
      totalEmployees: 0,
      presentCount: 0,
      absentCount: 0,
      lateCount: 0,
      missingCount: 0,
      currentlyWorkingCount: 0,
      dayShiftCount: 0,
      nightShiftCount: 0,
      totalWorkingHours: 0,
      totalOvertimeHours: 0,
      pendingApprovals: 0,
      geofenceViolations: 0,
      validEmpIds: [],
      attendanceTrend: [],
      otTrend: [],
      productivityTrend: [],
      geofencesData: [] as DashboardGeofencePoint[]
    };
  },

  async getLookups(organizationId: string) {
    const client = getSupabaseClient();
    const [br, dep, sh] = await Promise.all([
      client.from('branches').select('id, name').eq('organization_id', organizationId),
      client.from('departments').select('id, name').eq('organization_id', organizationId),
      client.from('shifts').select('id, name').eq('organization_id', organizationId)
    ]);
    return {
      branches: (br.data || []) as {id: string, name: string}[],
      departments: (dep.data || []) as {id: string, name: string}[],
      shifts: (sh.data || []) as {id: string, name: string}[]
    };
  }
};
