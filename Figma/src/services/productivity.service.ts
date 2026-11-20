import { getSupabaseClient } from '../lib/supabase';
import { executeQuery } from './database.service';
import { isEmployeeActiveOnDate } from '../lib/employee-status';
export { isEmployeeActiveOnDate };
import type {
  AttendanceRecordRow,
  DepartmentRow,
  EmployeeProfileRow,
  Json,
  MailroomActivityRow,
  MailroomClientActivityRow,
  MailroomClientRow,
  MailroomDailyDspAllocationRow,
  MailroomDailyEntryRow,
  MailroomDailyEntryStatus,
  MailroomDailyShipmentRow,
  MailroomDailyTurnaroundMetricRow,
  MailroomDspPartnerRow,
  MailroomEmployeeSettingsRow,
  MailroomProductivitySettingsRow,
  OvertimeRecordRow,
  ProductivityRecordRow,
  ResolvedScheduleRow,
  TablesInsert,
  TablesUpdate,
} from '../types/database';

export interface ProductivityQuery {
  organizationId: string;
  employeeId?: string;
  shiftAssignmentId?: string;
  fromDate?: string;
  toDate?: string;
}

export interface MailroomDailyClientInput {
  client_id: string;
  received_units: number;
  processed_units: number;
  backlog_released_units?: number;
  batch_closed_units?: number;
  return_units?: number;
}

export interface MailroomDailyDspInput {
  client_id: string;
  partner_id: string;
  allocated_units: number;
}

export interface MailroomDailyInput {
  workDate: string;
  status: MailroomDailyEntryStatus;
  clients: MailroomDailyClientInput[];
  returnsReceived: number;
  returnsProcessed: number;
  dspAllocations: MailroomDailyDspInput[];
  notes: string;
  turnaroundMetrics?: MailroomTurnaroundMetricInput[];
}

export interface MailroomTurnaroundMetricInput {
  client_id: string;
  warehouse_code: string;
  total_minutes: number;
  shipment_count: number;
}

export interface MailroomWorkspace {
  settings: MailroomProductivitySettingsRow;
  clients: MailroomClientRow[];
  activities: MailroomActivityRow[];
  mappings: MailroomClientActivityRow[];
  shipments: MailroomDailyShipmentRow[];
  employees: EmployeeProfileRow[];
  employeeSettings: MailroomEmployeeSettingsRow[];
  schedules: Record<string, ResolvedScheduleRow[]>;
  attendance: AttendanceRecordRow[];
  dailyEntries: MailroomDailyEntryRow[];
  dspPartners: MailroomDspPartnerRow[];
  dspAllocations: MailroomDailyDspAllocationRow[];
  turnaroundMetrics: MailroomDailyTurnaroundMetricRow[];
  overtimeRecords: OvertimeRecordRow[];
}

export interface MailroomActivityCapacity {
  id: string;
  name: string;
  volume: number;
  rate: number;
  laborHours: number;
  averageEmployees: number;
  peakEmployees: number;
}

export interface MailroomDayCapacity {
  date: string;
  received: number;
  processed: number;
  returnsReceived: number;
  returnsProcessed: number;
  dspAllocated: number;
  status: 'draft' | 'finalized' | 'missing';
  requiredHours: number;
  requiredFte: number;
  regularCapacityHours: number;
  gapHours: number;
  additional3pl: number;
  overtimeCapacityHours: number;
  overtimeRecommendedHours: number;
  overtimeRecommendedCost: number;
  actualOvertimeHours: number;
  actualOvertimeCost: number;
  overtimeCostSaved: number;
  uncoveredHours: number;
  scheduledDlp: number;
}

export interface MailroomClientSummary {
  id: string;
  name: string;
  received: number;
  validated: number;
  processed: number;
  returns: number;
  unprocessedBacklog: number;
}

export interface MailroomOvertimeAllocation {
  employeeId: string;
  employeeName: string;
  hours: number;
}

export interface MailroomEmployeeOvertimeSummary {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  laborClass: string;
  employmentSource: string;
  approvedHours: number;
  hourlyCost: number;
  totalCost: number;
  daysCount: number;
}

export interface MailroomOperationalModel {
  fromDate: string;
  toDate: string;
  totalReceived: number;
  totalValidated: number;
  totalProcessed: number;
  totalReturnsReceived: number;
  totalReturnsProcessed: number;
  totalDspAllocated: number;
  totalRequiredHours: number;
  totalRegularCapacityHours: number;
  averageRequiredFte: number;
  absenceReserveFte: number;
  totalPlannedFte: number;
  peakRequiredFte: number;
  peakAdditional3pl: number;
  overtimeRecommendedHours: number;
  overtimeRecommendedCost: number;
  actualOvertimeHours: number;
  actualOvertimeCost: number;
  overtimeCostSaved: number;
  uncoveredHours: number;
  shortageHours: number;
  surplusHours: number;
  peakSurplusFte: number;
  ownDlp: number;
  threePlDlp: number;
  nonDlp: number;
  days: MailroomDayCapacity[];
  clients: MailroomClientSummary[];
  activities: MailroomActivityCapacity[];
  overtimeAllocations: MailroomOvertimeAllocation[];
  approvedOvertimeByEmployee: MailroomEmployeeOvertimeSummary[];
  draftDates: string[];
}

export interface MailroomDayPreview {
  requiredHours: number;
  requiredEmployees: number;
  regularCapacityHours: number;
  shortageHours: number;
  overtimeHours: number;
  overtimeCost: number;
  uncoveredHours: number;
  additionalEmployees: number;
  dspAllocated: number;
  activities: MailroomActivityCapacity[];
  approvedOvertimeHours: number;
  approvedOvertimeCost: number;
}

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeMailroomCode(value: string): string {
  const code = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!code) throw new Error('Enter a code containing at least one letter or number.');
  return code;
}

export function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function startOfSundayWeek(value: string): string {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() - date.getDay());
  return isoDate(date);
}

export function addDays(value: string, days: number): string {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

export function dateRange(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  for (let cursor = fromDate; cursor <= toDate; cursor = addDays(cursor, 1)) dates.push(cursor);
  return dates;
}

function shiftHours(schedule: ResolvedScheduleRow): number {
  if (schedule.state !== 'working' || !schedule.start_time || !schedule.end_time) return 0;
  const minutes = (value: string) => {
    const [hours, mins] = value.split(':').map(Number);
    return hours * 60 + mins;
  };
  let duration = minutes(schedule.end_time) - minutes(schedule.start_time);
  if (schedule.crosses_midnight || duration <= 0) duration += 24 * 60;
  return Math.max(0, duration - (schedule.break_minutes ?? 0)) / 60;
}

export interface EmployeeApprovedOvertimeResult {
  approvedMinutes: number;
  requestedMinutes: number;
  status: 'approved' | 'pending' | 'rejected' | 'none';
}

export function getApprovedOvertimeMinutes(
  employeeId: string,
  workDate: string,
  attendance: AttendanceRecordRow[],
  overtimeRecords: OvertimeRecordRow[],
): EmployeeApprovedOvertimeResult {
  const dayAttendance = (attendance ?? []).filter(a => a.employee_id === employeeId && a.attendance_date === workDate);
  const dayAttendanceIds = new Set(dayAttendance.map(a => a.id));

  const dayOtRecords = (overtimeRecords ?? []).filter(
    r => r.employee_id === employeeId && dayAttendanceIds.has(r.attendance_record_id)
  );

  let approvedMinutes = 0;
  let requestedMinutes = 0;
  let hasPending = false;
  let hasRejected = false;
  let hasApproved = false;

  dayOtRecords.forEach(r => {
    requestedMinutes += r.requested_minutes ?? 0;
    if (r.status === 'approved') {
      hasApproved = true;
      approvedMinutes += (r.approved_minutes ?? r.requested_minutes ?? 0);
    } else if (r.status === 'pending') {
      hasPending = true;
    } else if (r.status === 'rejected') {
      hasRejected = true;
    }
  });

  if (!hasApproved && !hasPending && !hasRejected) {
    dayAttendance.forEach(a => {
      if (a.overtime_minutes > 0) {
        requestedMinutes += a.overtime_minutes;
        if (a.approval_status === 'approved') {
          hasApproved = true;
          approvedMinutes += a.overtime_minutes;
        } else if (a.approval_status === 'pending') {
          hasPending = true;
        }
      }
    });
  }

  const status: 'approved' | 'pending' | 'rejected' | 'none' =
    hasApproved ? 'approved' : hasPending ? 'pending' : hasRejected ? 'rejected' : 'none';

  return { approvedMinutes, requestedMinutes, status };
}

export function getDepartmentBaseOtRate(settings: {
  overtime_hourly_cost: number;
  overtime_hourly_cost_own?: number;
  overtime_hourly_cost_3pl?: number;
}): number {
  return settings.overtime_hourly_cost_own || settings.overtime_hourly_cost || settings.overtime_hourly_cost_3pl || 0;
}

export function getEmployeeOtRate(
  setting: { labor_class?: string; employment_source?: 'own' | '3pl' | string; overtime_hourly_cost?: number | null } | null | undefined,
  settings: { overtime_hourly_cost: number; overtime_hourly_cost_own?: number; overtime_hourly_cost_3pl?: number },
): number {
  if (setting?.overtime_hourly_cost !== null && setting?.overtime_hourly_cost !== undefined && Number(setting.overtime_hourly_cost) > 0) {
    return Number(setting.overtime_hourly_cost);
  }
  const is3pl = setting?.employment_source === '3pl';
  const specificRate = is3pl ? settings.overtime_hourly_cost_3pl : settings.overtime_hourly_cost_own;
  if (specificRate !== undefined && specificRate !== null && Number(specificRate) > 0) {
    return Number(specificRate);
  }
  return settings.overtime_hourly_cost ?? 0;
}

export function buildMailroomOperationalModel(
  workspace: MailroomWorkspace,
  fromDate: string,
  toDate: string,
  today: string,
): MailroomOperationalModel {
  const dates = dateRange(fromDate, toDate);
  const entryByDate = new Map(workspace.dailyEntries.map(entry => [entry.work_date, entry]));
  const finalizedEntries = workspace.dailyEntries.filter(entry => entry.status === 'finalized');
  const finalizedEntryIds = new Set(finalizedEntries.map(entry => entry.id));
  const finalizedDates = new Set(finalizedEntries.map(entry => entry.work_date));
  const selected = workspace.shipments.filter(row => row.work_date >= fromDate && row.work_date <= toDate && finalizedDates.has(row.work_date));
  const shipmentByClientDate = new Map(workspace.shipments.map(row => [`${row.client_id}:${row.work_date}`, row]));
  const activityById = new Map(workspace.activities.map(activity => [activity.id, activity]));
  const employeeSettingById = new Map(workspace.employeeSettings.map(setting => [setting.employee_id, setting]));
  const employeeById = new Map(workspace.employees.map(employee => [employee.id, employee]));
  const dspByEntry = new Map<string, number>();
  workspace.dspAllocations.forEach(allocation => {
    if (!finalizedEntryIds.has(allocation.daily_entry_id)) return;
    dspByEntry.set(allocation.daily_entry_id, (dspByEntry.get(allocation.daily_entry_id) ?? 0) + allocation.allocated_units);
  });
  const attendanceByEmployeeDate = new Map<string, AttendanceRecordRow[]>();
  workspace.attendance.forEach(row => {
    const key = `${row.employee_id}:${row.attendance_date}`;
    attendanceByEmployeeDate.set(key, [...(attendanceByEmployeeDate.get(key) ?? []), row]);
  });

  const defaultEmployeeSetting = (employee: EmployeeProfileRow) => {
    const direct = /labou?r|worker|operation assistant/i.test(employee.job_title ?? '');
    return {
      labor_class: direct ? 'dlp' : 'non_dlp',
      employment_source: /^3PL/i.test(employee.employee_code) ? '3pl' : 'own',
      overtime_eligible: direct,
      max_overtime_hours_override: null,
      overtime_hourly_cost: null,
    } as const;
  };
  const settingFor = (employee: EmployeeProfileRow) => employeeSettingById.get(employee.id) ?? defaultEmployeeSetting(employee);

  const activityTotals = new Map<string, { volume: number; hours: number; peakHours: number }>();
  const requiredByDate = new Map<string, number>();
  dates.forEach(date => {
    const entry = entryByDate.get(date);
    if (!entry || entry.status !== 'finalized') return;
    const dailyActivity = new Map<string, { volume: number; hours: number }>();
    workspace.mappings.forEach(mapping => {
      const activity = activityById.get(mapping.activity_id);
      if (!activity || activity.status !== 'active' || activity.volume_source !== 'client_mapping') return;
      const row = shipmentByClientDate.get(`${mapping.client_id}:${date}`);
      if (!row) return;
      const units = mapping.volume_driver === 'received'
        ? row.received_units
        : row.processed_units;
      const drivenVolume = units * mapping.workload_multiplier;
      const hours = drivenVolume / activity.units_per_labor_hour;
      const current = dailyActivity.get(activity.id) ?? { volume: 0, hours: 0 };
      current.volume += drivenVolume;
      current.hours += hours;
      dailyActivity.set(activity.id, current);
    });
    workspace.activities.forEach(activity => {
      if (activity.status !== 'active' || activity.volume_source === 'client_mapping') return;
      const volume = activity.volume_source === 'dsp_allocated'
        ? (dspByEntry.get(entry.id) ?? 0)
        : entry.returns_received;
      dailyActivity.set(activity.id, { volume, hours: volume / activity.units_per_labor_hour });
    });
    dailyActivity.forEach((daily, activityId) => {
      const aggregate = activityTotals.get(activityId) ?? { volume: 0, hours: 0, peakHours: 0 };
      aggregate.volume += daily.volume;
      aggregate.hours += daily.hours;
      aggregate.peakHours = Math.max(aggregate.peakHours, daily.hours);
      activityTotals.set(activityId, aggregate);
      requiredByDate.set(date, (requiredByDate.get(date) ?? 0) + daily.hours);
    });
  });

  const allocationTotals = new Map<string, number>();
  const days = dates.map(date => {
    const dayRows = selected.filter(row => row.work_date === date);
    let regularCapacityHours = 0;
    let overtimeCapacityHours = 0;
    let scheduledDlp = 0;
    const eligible: Array<{ id: string; cap: number }> = [];
    workspace.employees.forEach(employee => {
      if (!isEmployeeActiveOnDate(employee, date)) return;
      const setting = settingFor(employee);
      if (setting.labor_class !== 'dlp') return;
      const schedule = workspace.schedules[employee.id]?.find(row => row.work_date === date);
      if (!schedule || schedule.state !== 'working') return;
      scheduledDlp += 1;
      const scheduledHours = shiftHours(schedule) * (1 - workspace.settings.planned_absence_percent / 100);
      if (date < today) {
        const records = attendanceByEmployeeDate.get(`${employee.id}:${date}`) ?? [];
        const workedHours = records.reduce((sum, row) => sum + Math.max(0, row.worked_minutes - row.overtime_minutes) / 60, 0);
        // If employee was absent on that day, scheduled labor must still be counted on that day
        regularCapacityHours += workedHours > 0 ? workedHours : scheduledHours;
      } else {
        regularCapacityHours += scheduledHours;
      }
      if (setting.overtime_eligible) {
        const cap = setting.max_overtime_hours_override ?? workspace.settings.max_overtime_hours_per_day;
        overtimeCapacityHours += cap;
        eligible.push({ id: employee.id, cap });
      }
    });

    const entry = entryByDate.get(date);
    const isFinalized = entry?.status === 'finalized';
    const status: MailroomDayCapacity['status'] = entry?.status ?? 'missing';
    const requiredHours = isFinalized ? (requiredByDate.get(date) ?? 0) : 0;
    const gapHours = Math.max(0, requiredHours - regularCapacityHours);
    let remaining = Math.min(gapHours, overtimeCapacityHours);
    eligible.sort((a, b) => (allocationTotals.get(a.id) ?? 0) - (allocationTotals.get(b.id) ?? 0) || a.id.localeCompare(b.id));
    eligible.forEach(item => {
      const assigned = Math.min(item.cap, remaining);
      if (assigned > 0) allocationTotals.set(item.id, (allocationTotals.get(item.id) ?? 0) + assigned);
      remaining -= assigned;
    });
    const overtimeRecommendedHours = Math.min(gapHours, overtimeCapacityHours);
    const baseOtRate = getDepartmentBaseOtRate(workspace.settings);
    const overtimeRecommendedCost = overtimeRecommendedHours * baseOtRate;
    let dayApprovedOtHours = 0;
    let dayApprovedOtCost = 0;
    workspace.employees.forEach(employee => {
      const setting = settingFor(employee);
      if (setting.labor_class !== 'dlp') return;
      const { approvedMinutes, requestedMinutes } = getApprovedOvertimeMinutes(employee.id, date, workspace.attendance, workspace.overtimeRecords ?? []);
      const effectiveMinutes = approvedMinutes > 0 ? approvedMinutes : requestedMinutes;
      const hours = effectiveMinutes / 60;
      if (hours > 0) {
        const isActive = isEmployeeActiveOnDate(employee, date);
        const hasAttendance = workspace.attendance.some(a => a.employee_id === employee.id && a.attendance_date === date);
        if (isActive || hasAttendance) {
          const rate = getEmployeeOtRate(setting, workspace.settings);
          dayApprovedOtHours += hours;
          dayApprovedOtCost += hours * rate;
        }
      }
    });
    const actualOvertimeHours = dayApprovedOtHours;
    const actualOvertimeCost = dayApprovedOtCost;
    return {
      date,
      received: dayRows.reduce((sum, row) => sum + row.received_units, 0),
      processed: dayRows.reduce((sum, row) => sum + row.processed_units, 0),
      returnsReceived: isFinalized ? (entry?.returns_received ?? 0) : 0,
      returnsProcessed: isFinalized ? (entry?.returns_processed ?? 0) : 0,
      dspAllocated: isFinalized && entry ? (dspByEntry.get(entry.id) ?? 0) : 0,
      status,
      requiredHours,
      requiredFte: requiredHours / workspace.settings.standard_hours_per_day,
      regularCapacityHours,
      gapHours,
      additional3pl: Math.ceil(Math.max(0, gapHours - overtimeCapacityHours) / workspace.settings.standard_hours_per_day),
      overtimeCapacityHours,
      overtimeRecommendedHours,
      overtimeRecommendedCost,
      actualOvertimeHours,
      actualOvertimeCost,
      overtimeCostSaved: Math.max(0, overtimeRecommendedHours - actualOvertimeHours) * baseOtRate,
      uncoveredHours: Math.max(0, gapHours - overtimeCapacityHours),
      scheduledDlp,
    };
  });

  const clients = workspace.clients.filter(client => client.status === 'active').map(client => {
    const rowsThroughEnd = workspace.shipments.filter(row => row.client_id === client.id && row.work_date <= toDate && finalizedDates.has(row.work_date));
    const periodRows = rowsThroughEnd.filter(row => row.work_date >= fromDate);
    return {
      id: client.id,
      name: client.name,
      received: periodRows.reduce((sum, row) => sum + row.received_units, 0),
      validated: periodRows.reduce((sum, row) => sum + row.processed_units, 0),
      processed: periodRows.reduce((sum, row) => sum + row.processed_units, 0),
      returns: periodRows.reduce((sum, row) => sum + (row.returns_received ?? 0), 0),
      unprocessedBacklog: client.opening_unprocessed_units + rowsThroughEnd.reduce(
        (sum, row) => sum + row.received_units - row.backlog_released_units - row.batch_closed_units,
        0,
      ),
    };
  });

  const finalizedDayCount = Math.max(1, dates.filter(date => entryByDate.get(date)?.status === 'finalized').length);
  const activities = workspace.activities.filter(activity => activity.status === 'active').map(activity => {
    const totals = activityTotals.get(activity.id) ?? { volume: 0, hours: 0, peakHours: 0 };
    return {
      id: activity.id,
      name: activity.name,
      volume: totals.volume,
      rate: activity.units_per_labor_hour,
      laborHours: totals.hours,
      averageEmployees: totals.hours / (finalizedDayCount * workspace.settings.standard_hours_per_day),
      peakEmployees: totals.peakHours / workspace.settings.standard_hours_per_day,
    };
  }).filter(activity => activity.volume > 0).sort((a, b) => b.laborHours - a.laborHours);

  const activeInPeriod = workspace.employees.filter(employee => dates.some(d => isEmployeeActiveOnDate(employee, d)));
  const ownDlp = activeInPeriod.filter(employee => { const s = settingFor(employee); return s.labor_class === 'dlp' && s.employment_source === 'own'; }).length;
  const threePlDlp = activeInPeriod.filter(employee => { const s = settingFor(employee); return s.labor_class === 'dlp' && s.employment_source === '3pl'; }).length;
  const nonDlp = activeInPeriod.length - ownDlp - threePlDlp;
  const totalRequiredHours = days.reduce((sum, day) => sum + day.requiredHours, 0);
  const officialDays = days.filter(day => day.status === 'finalized');
  const averageRequiredFte = totalRequiredHours / (Math.max(1, officialDays.length) * workspace.settings.standard_hours_per_day);
  const absenceFactor = Math.max(0.01, 1 - workspace.settings.planned_absence_percent / 100);
  const overtimeAllocations = [...allocationTotals.entries()].map(([employeeId, hours]) => ({
    employeeId,
    employeeName: employeeById.get(employeeId)?.full_name ?? 'Unknown employee',
    hours,
  })).sort((a, b) => b.hours - a.hours);

  const employeeOtMap = new Map<string, MailroomEmployeeOvertimeSummary>();
  const baseOtRate = getDepartmentBaseOtRate(workspace.settings);
  officialDays.forEach(day => {
    workspace.employees.forEach(employee => {
      const setting = settingFor(employee);
      if (setting.labor_class !== 'dlp') return;
      const { approvedMinutes, requestedMinutes } = getApprovedOvertimeMinutes(employee.id, day.date, workspace.attendance, workspace.overtimeRecords ?? []);
      const effectiveMinutes = approvedMinutes > 0 ? approvedMinutes : requestedMinutes;
      const hours = effectiveMinutes / 60;
      if (hours > 0) {
        const isActive = isEmployeeActiveOnDate(employee, day.date);
        const hasAttendance = workspace.attendance.some(a => a.employee_id === employee.id && a.attendance_date === day.date);
        if (isActive || hasAttendance) {
          const rate = getEmployeeOtRate(setting, workspace.settings);
          const current = employeeOtMap.get(employee.id) ?? {
            employeeId: employee.id,
            employeeName: employee.full_name,
            employeeCode: employee.employee_code,
            laborClass: setting.labor_class,
            employmentSource: setting.employment_source,
            approvedHours: 0,
            hourlyCost: rate,
            totalCost: 0,
            daysCount: 0,
          };
          current.approvedHours += hours;
          current.totalCost += hours * rate;
          current.daysCount += 1;
          employeeOtMap.set(employee.id, current);
        }
      }
    });
  });
  const approvedOvertimeByEmployee = [...employeeOtMap.values()].sort((a, b) => b.approvedHours - a.approvedHours);

  return {
    fromDate,
    toDate,
    totalReceived: selected.reduce((sum, row) => sum + row.received_units, 0),
    totalValidated: selected.reduce((sum, row) => sum + row.processed_units, 0),
    totalProcessed: selected.reduce((sum, row) => sum + row.processed_units, 0),
    totalReturnsReceived: officialDays.reduce((sum, day) => sum + day.returnsReceived, 0),
    totalReturnsProcessed: officialDays.reduce((sum, day) => sum + day.returnsProcessed, 0),
    totalDspAllocated: officialDays.reduce((sum, day) => sum + day.dspAllocated, 0),
    totalRequiredHours,
    totalRegularCapacityHours: officialDays.reduce((sum, day) => sum + day.regularCapacityHours, 0),
    averageRequiredFte,
    absenceReserveFte: averageRequiredFte / absenceFactor - averageRequiredFte,
    totalPlannedFte: averageRequiredFte / absenceFactor,
    peakRequiredFte: Math.max(0, ...officialDays.map(day => day.requiredFte)),
    peakAdditional3pl: Math.max(0, ...officialDays.map(day => day.additional3pl)),
    overtimeRecommendedHours: officialDays.reduce((sum, day) => sum + day.overtimeRecommendedHours, 0),
    overtimeRecommendedCost: officialDays.reduce((sum, day) => sum + day.overtimeRecommendedCost, 0),
    actualOvertimeHours: officialDays.reduce((sum, day) => sum + day.actualOvertimeHours, 0),
    actualOvertimeCost: officialDays.reduce((sum, day) => sum + day.actualOvertimeCost, 0),
    overtimeCostSaved: Math.max(0, officialDays.reduce((sum, day) => sum + day.overtimeRecommendedHours - day.actualOvertimeHours, 0)) * baseOtRate,
    uncoveredHours: officialDays.reduce((sum, day) => sum + day.uncoveredHours, 0),
    shortageHours: officialDays.reduce((sum, day) => sum + day.gapHours, 0),
    surplusHours: officialDays.reduce((sum, day) => sum + Math.max(0, day.regularCapacityHours - day.requiredHours), 0),
    peakSurplusFte: Math.max(0, ...officialDays.map(day => Math.max(0, day.regularCapacityHours - day.requiredHours) / workspace.settings.standard_hours_per_day)),
    ownDlp,
    threePlDlp,
    nonDlp,
    days,
    clients,
    activities,
    overtimeAllocations,
    approvedOvertimeByEmployee,
    draftDates: dates.filter(date => entryByDate.get(date)?.status === 'draft'),
  };
}

export function buildMailroomDayPreview(
  workspace: MailroomWorkspace,
  workDate: string,
  clientInputs: MailroomDailyClientInput[],
  returnsReceived: number,
  dspAllocated: number,
  today: string,
): MailroomDayPreview {
  const inputByClient = new Map(clientInputs.map(input => [input.client_id, input]));
  const activityById = new Map(workspace.activities.map(activity => [activity.id, activity]));
  const demand = new Map<string, { volume: number; hours: number }>();
  workspace.mappings.forEach(mapping => {
    const activity = activityById.get(mapping.activity_id);
    const input = inputByClient.get(mapping.client_id);
    if (!activity || !input || activity.status !== 'active' || activity.volume_source !== 'client_mapping') return;
    const units = mapping.volume_driver === 'received' ? input.received_units : input.processed_units;
    const volume = units * mapping.workload_multiplier;
    const current = demand.get(activity.id) ?? { volume: 0, hours: 0 };
    current.volume += volume;
    current.hours += volume / activity.units_per_labor_hour;
    demand.set(activity.id, current);
  });
  workspace.activities.forEach(activity => {
    if (activity.status !== 'active' || activity.volume_source === 'client_mapping') return;
    const volume = activity.volume_source === 'dsp_allocated' ? dspAllocated : returnsReceived;
    demand.set(activity.id, { volume, hours: volume / activity.units_per_labor_hour });
  });
  const activities = workspace.activities.filter(activity => activity.status === 'active').map(activity => {
    const row = demand.get(activity.id) ?? { volume: 0, hours: 0 };
    const employees = row.hours / workspace.settings.standard_hours_per_day;
    return { id: activity.id, name: activity.name, volume: row.volume, rate: activity.units_per_labor_hour, laborHours: row.hours, averageEmployees: employees, peakEmployees: employees };
  }).filter(activity => activity.volume > 0).sort((a, b) => b.laborHours - a.laborHours);
  const requiredHours = activities.reduce((sum, activity) => sum + activity.laborHours, 0);
  const employeeSettingById = new Map(workspace.employeeSettings.map(setting => [setting.employee_id, setting]));
  let regularCapacityHours = 0;
  let overtimeCapacityHours = 0;
  workspace.employees.forEach(employee => {
    if (!isEmployeeActiveOnDate(employee, workDate)) return;
    const setting = employeeSettingById.get(employee.id);
    if (setting?.labor_class !== 'dlp') return;
    const schedule = workspace.schedules[employee.id]?.find(row => row.work_date === workDate);
    if (!schedule || schedule.state !== 'working') return;
    const attendance = workspace.attendance.filter(row => row.employee_id === employee.id && row.attendance_date === workDate);
    const scheduledHours = shiftHours(schedule) * (1 - workspace.settings.planned_absence_percent / 100);
    const workedHours = attendance.reduce((sum, row) => sum + Math.max(0, row.worked_minutes - row.overtime_minutes) / 60, 0);
    regularCapacityHours += workDate < today
      ? (workedHours > 0 ? workedHours : scheduledHours)
      : scheduledHours;
    if (setting.overtime_eligible) overtimeCapacityHours += setting.max_overtime_hours_override ?? workspace.settings.max_overtime_hours_per_day;
  });
  const shortageHours = Math.max(0, requiredHours - regularCapacityHours);
  const overtimeHours = Math.min(shortageHours, overtimeCapacityHours);
  const uncoveredHours = Math.max(0, shortageHours - overtimeHours);
  const baseOtRate = getDepartmentBaseOtRate(workspace.settings);
  const overtimeCost = overtimeHours * baseOtRate;
  let approvedOvertimeHours = 0;
  let approvedOvertimeCost = 0;
  workspace.employees.forEach(employee => {
    const setting = employeeSettingById.get(employee.id);
    if (setting?.labor_class !== 'dlp') return;
    const { approvedMinutes, requestedMinutes } = getApprovedOvertimeMinutes(employee.id, workDate, workspace.attendance, workspace.overtimeRecords ?? []);
    const effectiveMinutes = approvedMinutes > 0 ? approvedMinutes : requestedMinutes;
    const hours = effectiveMinutes / 60;
    if (hours > 0) {
      const isActive = isEmployeeActiveOnDate(employee, workDate);
      const hasAttendance = workspace.attendance.some(a => a.employee_id === employee.id && a.attendance_date === workDate);
      if (isActive || hasAttendance) {
        const rate = getEmployeeOtRate(setting, workspace.settings);
        approvedOvertimeHours += hours;
        approvedOvertimeCost += hours * rate;
      }
    }
  });
  return {
    requiredHours,
    requiredEmployees: requiredHours / workspace.settings.standard_hours_per_day,
    regularCapacityHours,
    shortageHours,
    overtimeHours,
    overtimeCost,
    uncoveredHours,
    additionalEmployees: Math.ceil(uncoveredHours / workspace.settings.standard_hours_per_day),
    dspAllocated,
    activities,
    approvedOvertimeHours,
    approvedOvertimeCost,
  };
}

export const productivityService = {
  async initializeMailroom(organizationId: string): Promise<Json> {
    return executeQuery(
      getSupabaseClient().rpc('initialize_mailroom_productivity', { p_organization_id: organizationId }),
      'Unable to initialize Mailroom productivity.',
    );
  },

  async saveMailroomDay(organizationId: string, input: MailroomDailyInput): Promise<Json> {
    const result = await executeQuery(
      getSupabaseClient().rpc('save_mailroom_productivity_day', {
        p_organization_id: organizationId,
        p_work_date: input.workDate,
        p_status: input.status,
        p_clients: input.clients.map(client => ({
          ...client,
          backlog_released_units: client.backlog_released_units ?? client.processed_units,
          batch_closed_units: client.batch_closed_units ?? 0,
        })) as unknown as Json,
        p_returns_received: input.returnsReceived,
        p_returns_processed: input.returnsProcessed,
        p_dsp_allocations: input.dspAllocations as unknown as Json,
        p_notes: input.notes,
      }),
      'Unable to save the Mailroom daily entry.',
    );
    await this.saveMailroomClientReturns(organizationId, [input]);
    return result;
  },

  async saveMailroomMonth(organizationId: string, inputs: MailroomDailyInput[]): Promise<Json> {
    const result = await executeQuery(
      getSupabaseClient().rpc('save_mailroom_productivity_month', {
        p_organization_id: organizationId,
        p_days: inputs.map(input => ({
          work_date: input.workDate,
          status: input.status,
          clients: input.clients.map(client => ({
            ...client,
            backlog_released_units: client.backlog_released_units ?? client.processed_units,
            batch_closed_units: client.batch_closed_units ?? 0,
          })),
          returns_received: input.returnsReceived,
          returns_processed: input.returnsProcessed,
          dsp_allocations: input.dspAllocations,
          notes: input.notes,
        })) as unknown as Json,
      }),
      'Unable to save the Mailroom monthly import.',
    );
    await this.saveMailroomClientReturns(organizationId, inputs);
    return result;
  },

  async saveMailroomClientReturns(organizationId: string, inputs: MailroomDailyInput[]): Promise<number> {
    const rows = inputs.flatMap(input => input.clients.map(client => ({
      client_id: client.client_id,
      work_date: input.workDate,
      return_units: client.return_units ?? 0,
    })));
    if (rows.length === 0) return 0;
    return executeQuery(
      getSupabaseClient().rpc('save_mailroom_client_returns', {
        p_organization_id: organizationId,
        p_rows: rows as unknown as Json,
      }),
      'Unable to save client-wise Mailroom returns.',
    );
  },

  async saveMailroomTurnaroundMetrics(organizationId: string, inputs: MailroomDailyInput[]): Promise<number> {
    const rows = inputs.flatMap(input => (input.turnaroundMetrics ?? []).map(metric => ({
      ...metric,
      work_date: input.workDate,
    })));
    if (rows.length === 0) return 0;
    return executeQuery(
      getSupabaseClient().rpc('save_mailroom_turnaround_metrics', {
        p_organization_id: organizationId,
        p_rows: rows as unknown as Json,
      }),
      'Unable to save Mailroom turnaround metrics.',
    );
  },

  async loadMailroomWorkspace(organizationId: string, fromDate: string, toDate: string): Promise<MailroomWorkspace | null> {
    const client = getSupabaseClient();
    const departmentRows = await executeQuery<DepartmentRow[]>(
      client.from('departments').select('*').eq('organization_id', organizationId).ilike('name', 'Mailroom').eq('status', 'active').limit(1),
      'Unable to find the Mailroom department.',
    );
    const department = departmentRows[0];
    if (!department) return null;

    const [settingsRows, clients, activities, mappings, shipments, employees, employeeSettings, attendance, dailyEntries, dspPartners, dspAllocations, turnaroundMetrics, overtimeRecords] = await Promise.all([
      executeQuery(client.from('mailroom_productivity_settings').select('*').eq('organization_id', organizationId).limit(1), 'Unable to load Mailroom settings.'),
      executeQuery(client.from('mailroom_clients').select('*').eq('organization_id', organizationId).order('sort_order'), 'Unable to load Mailroom clients.'),
      executeQuery(client.from('mailroom_activities').select('*').eq('organization_id', organizationId).order('sort_order'), 'Unable to load Mailroom activities.'),
      executeQuery(client.from('mailroom_client_activities').select('*').eq('organization_id', organizationId), 'Unable to load Mailroom workflows.'),
      executeQuery(client.from('mailroom_daily_shipments').select('*').eq('organization_id', organizationId).lte('work_date', toDate).order('work_date'), 'Unable to load Mailroom shipment entries.'),
      executeQuery(client.from('employee_profiles').select('*').eq('organization_id', organizationId).eq('branch_id', department.branch_id).eq('department_id', department.id).order('full_name'), 'Unable to load Mailroom employees.'),
      executeQuery(client.from('mailroom_employee_settings').select('*').eq('organization_id', organizationId), 'Unable to load Mailroom workforce settings.'),
      executeQuery(client.from('attendance_records').select('*').eq('organization_id', organizationId).gte('attendance_date', fromDate).lte('attendance_date', toDate), 'Unable to load Mailroom attendance.'),
      executeQuery(client.from('mailroom_daily_entries').select('*').eq('organization_id', organizationId).lte('work_date', toDate).order('work_date'), 'Unable to load Mailroom daily entries.'),
      executeQuery(client.from('mailroom_dsp_partners').select('*').eq('organization_id', organizationId).order('sort_order'), 'Unable to load DSP partners.'),
      executeQuery(client.from('mailroom_daily_dsp_allocations').select('*').eq('organization_id', organizationId), 'Unable to load DSP allocations.'),
      executeQuery(client.from('mailroom_daily_turnaround_metrics').select('*').eq('organization_id', organizationId).gte('work_date', fromDate).lte('work_date', toDate), 'Unable to load turnaround metrics.'),
      executeQuery(client.from('overtime_records').select('*').eq('organization_id', organizationId), 'Unable to load Overtime records.'),
    ]);
    const settings = settingsRows[0];
    if (!settings) return null;
    if (typeof window !== 'undefined') {
      const localOwn = localStorage.getItem(`mailroom_ot_rate_own_${organizationId}`);
      const local3pl = localStorage.getItem(`mailroom_ot_rate_3pl_${organizationId}`);
      settings.overtime_hourly_cost_own = (settings.overtime_hourly_cost_own != null && Number(settings.overtime_hourly_cost_own) > 0)
        ? Number(settings.overtime_hourly_cost_own)
        : (localOwn != null && localOwn !== '' ? Number(localOwn) : (settings.overtime_hourly_cost ?? 0));
      settings.overtime_hourly_cost_3pl = (settings.overtime_hourly_cost_3pl != null && Number(settings.overtime_hourly_cost_3pl) > 0)
        ? Number(settings.overtime_hourly_cost_3pl)
        : (local3pl != null && local3pl !== '' ? Number(local3pl) : (settings.overtime_hourly_cost ?? 0));
      employeeSettings.forEach(s => {
        if (s.overtime_hourly_cost == null) {
          const stored = localStorage.getItem(`mailroom_emp_ot_${s.id}`);
          if (stored != null && stored !== '') s.overtime_hourly_cost = Number(stored);
        }
      });
      employees.forEach(emp => {
        if (!emp.status_effective_date) {
          const stored = localStorage.getItem(`emp_status_date_${emp.id}`);
          if (stored) {
            emp.status_effective_date = stored;
          } else if (emp.employment_status === 'active') {
            emp.status_effective_date = emp.joining_date || emp.created_at?.slice(0, 10) || null;
          }
        }
      });
    }
    const schedules = Object.fromEntries(await Promise.all(employees.map(async employee => [
      employee.id,
      await executeQuery(client.rpc('resolve_employee_schedule', { p_employee_id: employee.id, p_start_date: fromDate, p_end_date: toDate }), 'Unable to resolve Mailroom schedules.'),
    ])));
    return { settings, clients, activities, mappings, shipments, employees, employeeSettings, schedules, attendance, dailyEntries, dspPartners, dspAllocations, turnaroundMetrics, overtimeRecords };
  },

  async updateMailroomSettings(id: string, updates: Record<string, unknown>) {
    const client = getSupabaseClient();
    try {
      return await executeQuery(
        client.from('mailroom_productivity_settings').update(updates as any).eq('id', id).select('*').single(),
        'Unable to update Mailroom planning settings.'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('overtime_hourly_cost_own') || msg.includes('overtime_hourly_cost_3pl') || msg.includes('schema cache')) {
        const fallbackRate = Number(updates.overtime_hourly_cost_own ?? updates.overtime_hourly_cost_3pl ?? updates.overtime_hourly_cost);
        const strippedUpdates = { ...updates };
        delete strippedUpdates.overtime_hourly_cost_own;
        delete strippedUpdates.overtime_hourly_cost_3pl;
        if (Number.isFinite(fallbackRate) && fallbackRate >= 0) {
          strippedUpdates.overtime_hourly_cost = fallbackRate;
        }
        if (Object.keys(strippedUpdates).length > 0) {
          return await executeQuery(
            client.from('mailroom_productivity_settings').update(strippedUpdates as any).eq('id', id).select('*').single(),
            'Unable to update Mailroom planning settings.'
          );
        }
        return {} as any;
      }
      throw err;
    }
  },

  async updateMailroomActivity(id: string, updates: TablesUpdate<'mailroom_activities'>) {
    return executeQuery(getSupabaseClient().from('mailroom_activities').update(updates).eq('id', id).select('*').single(), 'Unable to update the productivity activity.');
  },

  async updateMailroomEmployee(id: string, updates: Record<string, unknown>) {
    const client = getSupabaseClient();
    try {
      return await executeQuery(
        client.from('mailroom_employee_settings').update(updates as any).eq('id', id).select('*').single(),
        'Unable to update the labor classification.'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('overtime_hourly_cost') || msg.includes('schema cache')) {
        if (typeof window !== 'undefined' && 'overtime_hourly_cost' in updates) {
          localStorage.setItem(`mailroom_emp_ot_${id}`, String(updates.overtime_hourly_cost ?? ''));
        }
        const stripped = { ...updates };
        delete stripped.overtime_hourly_cost;
        if (Object.keys(stripped).length > 0) {
          return await executeQuery(
            client.from('mailroom_employee_settings').update(stripped as any).eq('id', id).select('*').single(),
            'Unable to update the labor classification.'
          );
        }
        return {} as any;
      }
      throw err;
    }
  },

  async updateMailroomClient(id: string, updates: TablesUpdate<'mailroom_clients'>) {
    return executeQuery(getSupabaseClient().from('mailroom_clients').update(updates).eq('id', id).select('*').single(), 'Unable to update the Mailroom client.');
  },

  async createDspPartner(input: { organizationId: string; branchId: string; code: string; name: string }): Promise<MailroomDspPartnerRow> {
    const name = input.name.trim();
    if (!name) throw new Error('Enter a DSP partner name.');
    return executeQuery(
      getSupabaseClient().from('mailroom_dsp_partners').insert({
        organization_id: input.organizationId,
        branch_id: input.branchId,
        code: normalizeMailroomCode(input.code),
        name,
      }).select('*').single(),
      'Unable to create the DSP partner.',
    );
  },

  async updateDspPartner(id: string, updates: TablesUpdate<'mailroom_dsp_partners'>) {
    return executeQuery(getSupabaseClient().from('mailroom_dsp_partners').update(updates).eq('id', id).select('*').single(), 'Unable to update the DSP partner.');
  },

  async createMailroomClient(input: {
    organizationId: string;
    branchId: string;
    code: string;
    name: string;
    processingMode: 'immediate' | 'validation_gated';
    templateClientId: string;
  }): Promise<MailroomClientRow> {
    const client = getSupabaseClient();
    const name = input.name.trim();
    if (!name) throw new Error('Enter a Mailroom client name.');
    const created = await executeQuery<MailroomClientRow>(
      client.from('mailroom_clients').insert({
        organization_id: input.organizationId,
        branch_id: input.branchId,
        code: normalizeMailroomCode(input.code),
        name,
        processing_mode: input.processingMode,
        sort_order: 100,
      }).select('*').single(),
      'Unable to create the Mailroom client.',
    );
    const templateMappings = await executeQuery(
      client.from('mailroom_client_activities').select('*').eq('client_id', input.templateClientId),
      'Unable to load the selected workflow template.',
    );
    if (templateMappings.length) {
      await executeQuery(
        client.from('mailroom_client_activities').insert(templateMappings.map(mapping => ({
          organization_id: input.organizationId,
          branch_id: input.branchId,
          client_id: created.id,
          activity_id: mapping.activity_id,
          volume_driver: mapping.volume_driver,
          workload_multiplier: mapping.workload_multiplier,
        }))),
        'The client was created, but its productivity workflow could not be copied.',
      );
    }
    return created;
  },
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
