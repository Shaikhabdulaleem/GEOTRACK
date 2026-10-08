import { getSupabaseClient } from '../lib/supabase';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { shiftService } from './shift.service';
import { pointInMultiPolygon, polygonCentroid } from '../lib/geo';
import type { GeofenceWithPolygon } from './geofence.service';

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

/** A single employee's live position for the dashboard workforce map. */
export interface WorkforcePosition {
  employeeId: string;
  name: string;
  /** Latitude (WGS84). */
  lat: number;
  /** Longitude (WGS84). */
  lng: number;
  /** True when the employee is inside their geofence. */
  inside: boolean;
  /** True when the position is the geofence centroid (no precise GPS recorded). */
  approximate: boolean;
  /** Attendance status, e.g. 'present' | 'late' | 'absent'. */
  status: string;
  geofenceId: string | null;
  geofenceName: string | null;
}

/** An employee currently outside their geofence past the org threshold. */
export interface GeofenceBreach {
  breachId: string;
  employeeId: string;
  employeeName: string;
  geofenceId: string | null;
  geofenceName: string | null;
  /** ISO timestamp the current continuous-outside streak began. */
  startedAt: string;
  /** ISO timestamp the breach was first raised. */
  detectedAt: string;
  /** ISO timestamp of the latest outside sample. */
  lastSeenOutsideAt: string;
  /** Live minutes continuously outside the geofence. */
  minutesOutside: number;
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

  /**
   * Real per-employee attendance for the dashboard "Live Attendance" widget.
   * Replaces the previous hardcoded "everyone present" placeholder: each row
   * reflects the employee's actual status, check-in time and shift for the date.
   */
  async getLiveAttendance(organizationId: string, filters: DashboardFilters) {
    const client = getSupabaseClient();

    let empQuery = client
      .from('employee_profiles')
      .select('id, full_name, department_id, employment_status')
      .eq('organization_id', organizationId);
    if (filters.branchId) empQuery = empQuery.eq('branch_id', filters.branchId);
    if (filters.departmentId) empQuery = empQuery.eq('department_id', filters.departmentId);
    if (filters.managerId) empQuery = empQuery.eq('manager_user_id', filters.managerId);
    if (filters.employeeId) empQuery = empQuery.eq('id', filters.employeeId);

    const { data: emps, error: empErr } = await empQuery;
    if (empErr) throw empErr;
    const active = (emps || []).filter(e => e.employment_status === 'active');
    const ids = active.map(e => e.id);
    if (ids.length === 0) return [] as Array<Record<string, unknown>>;

    const [{ data: depts }, { data: records }, { data: assignments }] = await Promise.all([
      client.from('departments').select('id, name').eq('organization_id', organizationId),
      client.from('attendance_records')
        .select('employee_id, status, check_in_at, check_out_at, geofence_validated')
        .eq('organization_id', organizationId)
        .eq('attendance_date', filters.date)
        .in('employee_id', ids),
      client.from('shift_assignments')
        .select('employee_id, shift_id, shift:shifts(name, crosses_midnight)')
        .eq('organization_id', organizationId)
        .eq('work_date', filters.date)
        .in('employee_id', ids),
    ]);

    const deptMap = new Map((depts || []).map((d: { id: string; name: string }) => [d.id, d.name]));
    const recMap = new Map((records || []).map((r: { employee_id: string }) => [r.employee_id, r]));
    const shiftMap = new Map(
      (assignments || []).map((a: { employee_id: string; shift_id: string | null; shift: { name: string; crosses_midnight: boolean } | null }) => [a.employee_id, a]),
    );

    const rows = active.map(e => {
      const r = recMap.get(e.id) as { status?: string; check_in_at?: string | null; check_out_at?: string | null; geofence_validated?: boolean } | undefined;
      const a = shiftMap.get(e.id) as { shift_id: string | null; shift: unknown } | undefined;
      // PostgREST embeds a to-one relation as an object, but can surface as an array.
      const shiftObj = Array.isArray(a?.shift) ? a?.shift[0] : a?.shift;
      const crossesMidnight = (shiftObj as { crosses_midnight?: boolean } | undefined)?.crosses_midnight;
      const shiftLabel = shiftObj ? (crossesMidnight ? 'Night' : 'Day') : null;
      return {
        id: e.id,
        name: e.full_name,
        dept: deptMap.get(e.department_id) || '—',
        shift: shiftLabel,
        shiftId: a?.shift_id ?? null,
        checkInAt: r?.check_in_at ?? null,
        attendance: r?.status ?? 'absent',
        inside: Boolean(r && r.check_in_at && !r.check_out_at && r.geofence_validated),
        location: '',
      };
    });

    const filtered = filters.shiftId ? rows.filter(row => row.shiftId === filters.shiftId) : rows;
    // Checked-in employees first, so the widget surfaces who is actually working.
    const rank = (s: string) => (s === 'present' || s === 'late' ? 0 : s === 'absent' ? 2 : 1);
    return filtered.sort((x, y) => rank(x.attendance) - rank(y.attendance));
  },

  /**
   * Live map positions for the dashboard "Geofence Workforce Map".
   *
   * One pin per employee who is currently on the map:
   *  - If a GPS-bearing `attendance_events` row exists for the day, the pin uses
   *    those exact coordinates and is coloured by inside/outside the geofence.
   *  - Otherwise, if the employee is checked in and geofence-validated, the pin is
   *    placed approximately at the centre of their assigned geofence (inside).
   *
   * `geofences` is passed in (already fetched by the caller) to avoid a second
   * round-trip and to share polygon rings for centroid/classification.
   */
  async getLiveWorkforcePositions(
    organizationId: string,
    filters: DashboardFilters,
    geofences: GeofenceWithPolygon[],
  ): Promise<WorkforcePosition[]> {
    const client = getSupabaseClient();

    // Resolve the active, filtered employee set (mirrors getLiveAttendance).
    let empQuery = client
      .from('employee_profiles')
      .select('id, full_name, employment_status')
      .eq('organization_id', organizationId);
    if (filters.branchId) empQuery = empQuery.eq('branch_id', filters.branchId);
    if (filters.departmentId) empQuery = empQuery.eq('department_id', filters.departmentId);
    if (filters.managerId) empQuery = empQuery.eq('manager_user_id', filters.managerId);
    if (filters.employeeId) empQuery = empQuery.eq('id', filters.employeeId);

    const { data: emps, error: empErr } = await empQuery;
    if (empErr) throw empErr;
    const active = (emps || []).filter(e => e.employment_status === 'active');
    const ids = active.map(e => e.id);
    if (ids.length === 0) return [];

    const [{ data: records }, { data: assignments }, { data: shiftAssignments }] = await Promise.all([
      client.from('attendance_records')
        .select('employee_id, status, check_in_at, check_out_at, geofence_validated')
        .eq('organization_id', organizationId)
        .eq('attendance_date', filters.date)
        .in('employee_id', ids),
      client.from('geofence_assignments')
        .select('employee_id, geofence_id')
        .eq('organization_id', organizationId)
        .is('effective_to', null)
        .in('employee_id', ids),
      filters.shiftId
        ? client.from('shift_assignments')
            .select('employee_id, shift_id')
            .eq('organization_id', organizationId)
            .eq('work_date', filters.date)
            .in('employee_id', ids)
        : Promise.resolve({ data: [] as Array<{ employee_id: string; shift_id: string | null }> }),
    ]);

    // Latest GPS event per employee for the day (best-effort; table may be empty).
    const latestEventByEmp = new Map<string, { lng: number; lat: number; inside: boolean | null; geofenceId: string | null }>();
    try {
      const { data: events } = await client
        .from('attendance_events')
        .select('employee_id, event_at, location_point, inside_geofence, geofence_id')
        .eq('organization_id', organizationId)
        .in('employee_id', ids)
        .not('location_point', 'is', null)
        .gte('event_at', `${filters.date}T00:00:00`)
        .lte('event_at', `${filters.date}T23:59:59.999`)
        .order('event_at', { ascending: false });
      for (const ev of (events || []) as Array<{ employee_id: string; location_point: { coordinates: [number, number] } | null; inside_geofence: boolean | null; geofence_id: string | null }>) {
        if (latestEventByEmp.has(ev.employee_id)) continue; // desc order → first seen is latest
        const coords = ev.location_point?.coordinates;
        if (!coords || coords.length < 2) continue;
        latestEventByEmp.set(ev.employee_id, {
          lng: coords[0], lat: coords[1], inside: ev.inside_geofence, geofenceId: ev.geofence_id,
        });
      }
    } catch (err) {
      logger.warn('attendance_events position query failed; using geofence-centroid fallback only.', { error: err });
    }

    const recMap = new Map((records || []).map((r: { employee_id: string }) => [r.employee_id, r]));
    const assignMap = new Map<string, string>();
    for (const a of (assignments || []) as Array<{ employee_id: string; geofence_id: string }>) {
      if (!assignMap.has(a.employee_id)) assignMap.set(a.employee_id, a.geofence_id);
    }
    const shiftSet = filters.shiftId
      ? new Set((shiftAssignments || []).filter(s => s.shift_id === filters.shiftId).map(s => s.employee_id))
      : null;
    const fenceById = new Map(geofences.map(g => [g.id, g]));

    const positions: WorkforcePosition[] = [];
    for (const e of active) {
      if (shiftSet && !shiftSet.has(e.id)) continue;
      const rec = recMap.get(e.id) as { status?: string; check_in_at?: string | null; check_out_at?: string | null; geofence_validated?: boolean } | undefined;
      const checkedIn = Boolean(rec && rec.check_in_at && !rec.check_out_at);
      const status = rec?.status ?? 'absent';

      const ev = latestEventByEmp.get(e.id);
      if (ev) {
        const assignedId = assignMap.get(e.id);
        const fence = (ev.geofenceId && fenceById.get(ev.geofenceId)) || (assignedId ? fenceById.get(assignedId) : undefined);
        let inside = ev.inside ?? false;
        if (ev.inside === null && fence?.activePolygon) {
          inside = pointInMultiPolygon([ev.lng, ev.lat], fence.activePolygon.polygon.coordinates);
        }
        positions.push({
          employeeId: e.id, name: e.full_name, lat: ev.lat, lng: ev.lng,
          inside, approximate: false, status,
          geofenceId: fence?.id ?? ev.geofenceId ?? null, geofenceName: fence?.name ?? null,
        });
        continue;
      }

      // Fallback: checked in & geofence-validated but no GPS → assigned-fence centroid.
      if (checkedIn && rec?.geofence_validated) {
        const fenceId = assignMap.get(e.id);
        const fence = fenceId ? fenceById.get(fenceId) : undefined;
        if (fence && fence.ring.length >= 3) {
          const [lng, lat] = polygonCentroid(fence.ring);
          positions.push({
            employeeId: e.id, name: e.full_name, lat, lng,
            inside: true, approximate: true, status,
            geofenceId: fence.id, geofenceName: fence.name,
          });
        }
      }
    }

    return positions;
  },

  /**
   * Employees currently in a sustained out-of-geofence breach (checked in but
   * continuously outside their fence past the org threshold). Backed by the
   * server-side detector; manager scoping is enforced in the RPC.
   */
  async getActiveGeofenceBreaches(organizationId: string): Promise<GeofenceBreach[]> {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('get_active_geofence_breaches', {
      p_organization_id: organizationId,
    });
    if (error) throw error;
    return ((data ?? []) as Array<{
      breach_id: string;
      employee_id: string;
      employee_name: string | null;
      geofence_id: string | null;
      geofence_name: string | null;
      started_at: string;
      detected_at: string;
      last_seen_outside_at: string;
      minutes_outside: number;
    }>).map(row => ({
      breachId: row.breach_id,
      employeeId: row.employee_id,
      employeeName: row.employee_name ?? 'Unknown employee',
      geofenceId: row.geofence_id,
      geofenceName: row.geofence_name,
      startedAt: row.started_at,
      detectedAt: row.detected_at,
      lastSeenOutsideAt: row.last_seen_outside_at,
      minutesOutside: row.minutes_outside,
    }));
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
