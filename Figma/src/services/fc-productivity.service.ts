import { getSupabaseClient } from '../lib/supabase';
import { executeQuery } from './database.service';
import { shiftService } from './shift.service';
import { transferService } from './transfer.service';
import type { OffDayCompensationRecord } from '../lib/employee-status';
import type {
  AttendanceRecordRow, DepartmentRow, EmployeeProfileRow, EmployeeTransferItem, FcDailyPackerMetricRow, FcDailySellerMetricRow,
  FcPackerMappingRow, FcProductivityWeekRow, FcWeeklyAdhocTaskRow,
  FcWeeklyCapacityMetricRow, FcWeeklySellerSupplementRow, FcActivityStandardRow,
  FcDailyManpowerProductivityRow, FcSettingsRow, FcEmployeeSettingsRow, FcClientRow, FcDailyClientVolumeRow,
  OvertimeRecordRow, Json, ResolvedScheduleRow,
} from '../types/database';
import type { FcImportPreview } from '../lib/fc-orders-import';
import type { FcOperationalImportPreview } from '../lib/fc-operational-import';

export interface FcSellerSupplementInput {
  seller_name: string;
  purchase_order_units: number;
  return_order_units: number;
  return_orders: number;
}

export interface FcCapacityMetricInput {
  capacity_bins: number; utilized_bins: number; capacity_pallets: number; utilized_pallets: number;
  capacity_units: number; utilized_units: number; capacity_cbm: number; utilized_cbm: number;
}

export interface FcAdhocTaskInput { seller_name: string; task_name: string; usage: number }
export type FcDailyPackerMetric = FcDailyPackerMetricRow;
export type FcDailySellerMetric = FcDailySellerMetricRow;
export type FcWeekSupplement = FcSellerSupplementInput;
export type FcCapacityMetric = FcCapacityMetricInput;
export type FcAdhocTask = FcAdhocTaskInput;
export type FcEmployeeOption = Pick<
  EmployeeProfileRow,
  'id' | 'organization_id' | 'employee_code' | 'full_name' | 'branch_id' | 'department_id' | 'employment_status' | 'job_title'
> & {
  joining_date?: string | null;
  status_effective_date?: string | null;
  created_at?: string;
};
export interface FcWorkforceDay {
  workDate: string;
  ownDlp: number;
  contractDlp: number;
  nonDlp: number;
  presentDlp: number;
  absentDlp: number;
  availableLaborHours: number;
  activeRosterDlp: number;
  source: 'shift_schedule' | 'active_roster';
}
export interface FcWorkspace {
  department: DepartmentRow;
  week: FcProductivityWeekRow | null;
  packers: FcDailyPackerMetricRow[];
  sellers: FcDailySellerMetricRow[];
  mappings: FcPackerMappingRow[];
  sellerSupplements: FcWeeklySellerSupplementRow[];
  capacity: FcWeeklyCapacityMetricRow | null;
  adhocTasks: FcWeeklyAdhocTaskRow[];
  employees: FcEmployeeOption[];
  transfers?: EmployeeTransferItem[];
  standards: FcActivityStandardRow[];
  manpowerDays: FcDailyManpowerProductivityRow[];
  workforceDays: FcWorkforceDay[];
  settings?: FcSettingsRow;
  employeeSettings?: FcEmployeeSettingsRow[];
  clients?: FcClientRow[];
  clientDailyVolumes?: FcDailyClientVolumeRow[];
  schedules?: Record<string, ResolvedScheduleRow[]>;
  attendance?: AttendanceRecordRow[];
  overtimeRecords?: OvertimeRecordRow[];
  offDayCompensations?: OffDayCompensationRecord[];
}

function dateRange(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  for (let value = fromDate; value <= toDate;) {
    dates.push(value);
    const date = new Date(`${value}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    value = date.toISOString().slice(0, 10);
  }
  return dates;
}

function isDirectLabor(employee: FcEmployeeOption): boolean {
  const title = employee.job_title?.trim() ?? '';
  if (/manager|supervisor|security|housekeep|administrat|coordinator|team lead/i.test(title)) return false;
  return !title || /dlp|labou?r|worker|operator|operation assistant|picker|packer|warehouse associate|associate/i.test(title);
}

function isContractLabor(employee: FcEmployeeOption): boolean {
  return /^3PL[-_ ]?/i.test(employee.employee_code) || /3PL|contract/i.test(employee.job_title ?? '');
}

function netShiftHours(schedule: ResolvedScheduleRow): number {
  if (schedule.state !== 'working' || !schedule.start_time || !schedule.end_time) return 0;
  const [startHour, startMinute] = schedule.start_time.split(':').map(Number);
  const [endHour, endMinute] = schedule.end_time.split(':').map(Number);
  let minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (schedule.crosses_midnight || minutes <= 0) minutes += 24 * 60;
  return Math.max(0, minutes - (schedule.break_minutes ?? 0)) / 60;
}

function buildDefaultFcSettings(organizationId: string, department: DepartmentRow): FcSettingsRow {
  const localOwn = typeof window !== 'undefined' ? localStorage.getItem(`fc_ot_rate_own_${organizationId}`) : null;
  const local3pl = typeof window !== 'undefined' ? localStorage.getItem(`fc_ot_rate_3pl_${organizationId}`) : null;
  return {
    id: `default-${department.id}`,
    organization_id: organizationId,
    branch_id: department.branch_id,
    department_id: department.id,
    standard_hours_per_day: 8,
    planned_absence_percent: 5,
    max_overtime_hours_per_day: 3,
    overtime_hourly_cost_own: localOwn ? Number(localOwn) : 0,
    overtime_hourly_cost_3pl: local3pl ? Number(local3pl) : 0,
    created_at: '',
    updated_at: '',
  };
}

function buildDefaultEmployeeSettings(
  organizationId: string,
  department: DepartmentRow,
  employees: FcEmployeeOption[],
): FcEmployeeSettingsRow[] {
  return employees.map(employee => ({
    id: `default-emp-${employee.id}`,
    organization_id: organizationId,
    branch_id: department.branch_id,
    department_id: department.id,
    employee_id: employee.id,
    labor_class: isDirectLabor(employee) ? 'dlp' : 'non_dlp',
    employment_source: isContractLabor(employee) ? '3pl' : 'own',
    overtime_eligible: isDirectLabor(employee),
    overtime_hourly_cost: null,
    created_at: '',
    updated_at: '',
  }));
}

function buildWorkforceDays(
  employees: FcEmployeeOption[],
  schedules: Record<string, ResolvedScheduleRow[]>,
  fromDate: string,
  toDate: string,
  employeeSettings?: FcEmployeeSettingsRow[],
  standardHoursPerDay = 8,
  attendance: AttendanceRecordRow[] = [],
): FcWorkforceDay[] {
  const settingByEmp = new Map((employeeSettings ?? []).map(row => [row.employee_id, row]));
  const isDlp = (emp: FcEmployeeOption) => {
    const s = settingByEmp.get(emp.id);
    return s ? s.labor_class === 'dlp' : isDirectLabor(emp);
  };
  const is3pl = (emp: FcEmployeeOption) => {
    const s = settingByEmp.get(emp.id);
    return s ? s.employment_source === '3pl' : isContractLabor(emp);
  };
  const directLabor = employees.filter(isDlp);
  const nonDlpCount = employees.length - directLabor.length;
  const attendanceByDate = new Map<string, Set<string>>();
  attendance.forEach(a => {
    if (a.status === 'present' || a.status === 'late' || a.check_in_at != null) {
      if (!attendanceByDate.has(a.attendance_date)) attendanceByDate.set(a.attendance_date, new Set());
      attendanceByDate.get(a.attendance_date)!.add(a.employee_id);
    }
  });
  return dateRange(fromDate, toDate).map(workDate => {
    const rows = directLabor.map(employee => ({ employee, schedule: schedules[employee.id]?.find(row => row.work_date === workDate) }));
    const hasConfiguredSchedule = rows.some(({ schedule }) => schedule && schedule.state !== 'unassigned');
    const available = hasConfiguredSchedule ? rows.filter(({ schedule }) => schedule?.state === 'working') : rows;
    const ownDlp = available.filter(({ employee }) => !is3pl(employee)).length;
    const contractDlp = available.filter(({ employee }) => is3pl(employee)).length;
    const presentSet = attendanceByDate.get(workDate) ?? new Set<string>();
    const presentDlp = available.filter(({ employee }) => presentSet.has(employee.id)).length;
    const absentDlp = Math.max(0, available.length - presentDlp);
    const availableLaborHours = hasConfiguredSchedule
      ? available.reduce((sum, { schedule }) => sum + (schedule ? netShiftHours(schedule) : 0), 0)
      : available.length * standardHoursPerDay;
    return {
      workDate,
      ownDlp,
      contractDlp,
      nonDlp: nonDlpCount,
      presentDlp,
      absentDlp,
      availableLaborHours,
      activeRosterDlp: directLabor.length,
      source: hasConfiguredSchedule ? 'shift_schedule' : 'active_roster',
    };
  });
}

export const fcProductivityService = {
  async findDepartment(organizationId: string): Promise<DepartmentRow | null> {
    const departments = await executeQuery<DepartmentRow[]>(getSupabaseClient().from('departments').select('*').eq('organization_id', organizationId).eq('status', 'active'), 'Unable to find the FC department.');
    return departments.find(row => row.name.trim().toUpperCase() === 'FC' || row.code.trim().toUpperCase() === 'FC') ?? null;
  },

  async loadWeek(organizationId: string, weekStart: string, periodFrom = weekStart, periodTo?: string): Promise<FcWorkspace | null> {
    const client = getSupabaseClient();
    const department = await this.findDepartment(organizationId);
    if (!department) return null;
    const weekEndDate = new Date(new Date(weekStart).getTime() + 6 * 86400000).toISOString().slice(0, 10);
    const manpowerEndDate = periodTo ?? weekEndDate;
    const [
      weeks,
      mappings,
      employees,
      transfers,
      standards,
      manpowerDays,
      attendance,
      overtimeRecords,
      offDayCompensations,
      settingsRows,
      employeeSettingsRows,
      clients,
      clientDailyVolumes,
    ] = await Promise.all([
      executeQuery<FcProductivityWeekRow[]>(client.from('fc_productivity_weeks').select('*').eq('organization_id', organizationId).eq('department_id', department.id).eq('week_start', weekStart).limit(1), 'Unable to load the FC productivity week.'),
      executeQuery<FcPackerMappingRow[]>(client.from('fc_packer_mappings').select('*').eq('organization_id', organizationId).eq('department_id', department.id), 'Unable to load FC packer mappings.'),
      executeQuery<FcEmployeeOption[]>(client.from('employee_profiles').select('id, organization_id, employee_code, full_name, branch_id, department_id, employment_status, job_title, joining_date, status_effective_date, created_at').eq('organization_id', organizationId).eq('department_id', department.id).eq('employment_status', 'active').order('full_name'), 'Unable to load FC employees.'),
      transferService.listTransfers({ organizationId, fromDate: periodFrom, toDate: manpowerEndDate }).catch(() => []),
      executeQuery<FcActivityStandardRow[]>(client.from('fc_activity_standards').select('*').eq('organization_id', organizationId).eq('department_id', department.id).order('sort_order'), 'Unable to load FC activity standards.'),
      executeQuery<FcDailyManpowerProductivityRow[]>(client.from('fc_daily_manpower_productivity').select('*').eq('organization_id', organizationId).eq('department_id', department.id).gte('work_date', periodFrom).lte('work_date', manpowerEndDate).order('work_date'), 'Unable to load FC daily manpower productivity.'),
      executeQuery<AttendanceRecordRow[]>(client.from('attendance_records').select('*').eq('organization_id', organizationId).gte('attendance_date', periodFrom).lte('attendance_date', manpowerEndDate), 'Unable to load FC attendance.').catch(() => [] as AttendanceRecordRow[]),
      executeQuery<OvertimeRecordRow[]>(client.from('overtime_records').select('*').eq('organization_id', organizationId), 'Unable to load FC overtime records.').catch(() => [] as OvertimeRecordRow[]),
      shiftService.listOffDayCompensations(organizationId).catch(() => [] as OffDayCompensationRecord[]),
      executeQuery<FcSettingsRow[]>(client.from('fc_settings').select('*').eq('organization_id', organizationId).eq('department_id', department.id).limit(1), 'Unable to load FC settings.').catch(() => [] as FcSettingsRow[]),
      executeQuery<FcEmployeeSettingsRow[]>(client.from('fc_employee_settings').select('*').eq('organization_id', organizationId).eq('department_id', department.id), 'Unable to load FC employee settings.').catch(() => [] as FcEmployeeSettingsRow[]),
      executeQuery<FcClientRow[]>(client.from('fc_clients').select('*').eq('organization_id', organizationId).eq('department_id', department.id).order('name'), 'Unable to load FC clients.').catch(() => [] as FcClientRow[]),
      executeQuery<FcDailyClientVolumeRow[]>(client.from('fc_daily_client_volumes').select('*').eq('organization_id', organizationId).eq('department_id', department.id).gte('work_date', periodFrom).lte('work_date', manpowerEndDate).order('work_date'), 'Unable to load FC client daily volumes.').catch(() => [] as FcDailyClientVolumeRow[]),
    ]);

    const settings = settingsRows[0] ?? buildDefaultFcSettings(organizationId, department);
    if (typeof window !== 'undefined') {
      const localOwn = localStorage.getItem(`fc_ot_rate_own_${organizationId}`);
      const local3pl = localStorage.getItem(`fc_ot_rate_3pl_${organizationId}`);
      if (!settings.overtime_hourly_cost_own && localOwn) settings.overtime_hourly_cost_own = Number(localOwn) || 0;
      if (!settings.overtime_hourly_cost_3pl && local3pl) settings.overtime_hourly_cost_3pl = Number(local3pl) || 0;
    }

    const fallbackEmployeeSettings = buildDefaultEmployeeSettings(organizationId, department, employees);
    const existingByEmp = new Map(employeeSettingsRows.map(row => [row.employee_id, row]));
    const employeeSettings = fallbackEmployeeSettings.map(def => existingByEmp.get(def.employee_id) ?? def);
    if (typeof window !== 'undefined') {
      employeeSettings.forEach(row => {
        if (row.overtime_hourly_cost == null) {
          const stored = localStorage.getItem(`fc_emp_ot_${row.employee_id}`);
          if (stored != null && stored !== '') row.overtime_hourly_cost = Number(stored);
        }
      });
    }

    const schedules = Object.fromEntries(await Promise.all(employees.map(async employee => [
      employee.id,
      await executeQuery<ResolvedScheduleRow[]>(client.rpc('resolve_employee_schedule', {
        p_employee_id: employee.id,
        p_start_date: periodFrom,
        p_end_date: manpowerEndDate,
      }), 'Unable to resolve FC workforce schedules.'),
    ])));
    const workforceDays = buildWorkforceDays(employees, schedules, periodFrom, manpowerEndDate, employeeSettings, settings.standard_hours_per_day, attendance);
    const week = weeks[0] ?? null;
    if (!week) {
      return {
        department, week: null, packers: [], sellers: [], mappings, sellerSupplements: [], capacity: null, adhocTasks: [],
        employees, transfers, standards, manpowerDays, workforceDays, settings, employeeSettings, clients, clientDailyVolumes, schedules, attendance, overtimeRecords, offDayCompensations,
      };
    }
    const [packers, sellers, sellerSupplements, capacities, adhocTasks] = await Promise.all([
      executeQuery<FcDailyPackerMetricRow[]>(client.from('fc_daily_packer_metrics').select('*').eq('week_id', week.id).order('work_date'), 'Unable to load FC packer metrics.'),
      executeQuery<FcDailySellerMetricRow[]>(client.from('fc_daily_seller_metrics').select('*').eq('week_id', week.id).order('work_date'), 'Unable to load FC seller metrics.'),
      executeQuery<FcWeeklySellerSupplementRow[]>(client.from('fc_weekly_seller_supplements').select('*').eq('week_id', week.id).order('seller_name'), 'Unable to load FC seller supplements.'),
      executeQuery<FcWeeklyCapacityMetricRow[]>(client.from('fc_weekly_capacity_metrics').select('*').eq('week_id', week.id).limit(1), 'Unable to load FC capacity.'),
      executeQuery<FcWeeklyAdhocTaskRow[]>(client.from('fc_weekly_adhoc_tasks').select('*').eq('week_id', week.id).order('seller_name'), 'Unable to load FC ad-hoc tasks.'),
    ]);
    return {
      department, week, packers, sellers, mappings, sellerSupplements, capacity: capacities[0] ?? null, adhocTasks,
      employees, transfers, standards, manpowerDays, workforceDays, settings, employeeSettings, clients, clientDailyVolumes, schedules, attendance, overtimeRecords, offDayCompensations,
    };
  },

  saveImport(organizationId: string, weekStart: string, preview: FcImportPreview): Promise<Json> {
    return executeQuery(getSupabaseClient().rpc('save_fc_productivity_week', { p_organization_id: organizationId, p_week_start: weekStart, p_import: {
      source_file_name: preview.sourceFileName, source_sha256: preview.sourceSha256, source_rows: preview.sourceRows,
      valid_rows: preview.validRows, ignored_rows: preview.ignoredRows, duplicate_rows: preview.duplicateRows,
      blank_packer_rows: preview.blankPackerRows, packers: preview.packers, sellers: preview.sellers,
    } as unknown as Json }), 'Unable to save the FC Orders import.');
  },

  saveSupplements(organizationId: string, weekStart: string, section: 'seller' | 'capacity' | 'adhoc', rows: unknown[], reviewed: boolean): Promise<number> {
    return executeQuery(getSupabaseClient().rpc('save_fc_week_supplements', { p_organization_id: organizationId, p_week_start: weekStart, p_section: section, p_rows: rows as Json, p_reviewed: reviewed }), 'Unable to save FC supplemental metrics.');
  },

  finalizeWeek(organizationId: string, weekStart: string): Promise<undefined> {
    return executeQuery(getSupabaseClient().rpc('finalize_fc_productivity_week', { p_organization_id: organizationId, p_week_start: weekStart }), 'Unable to finalize the FC productivity week.');
  },

  saveMapping(organizationId: string, packerLabel: string, employeeId: string): Promise<string> {
    return executeQuery(getSupabaseClient().rpc('save_fc_packer_mapping', { p_organization_id: organizationId, p_packer_label: packerLabel, p_employee_id: employeeId }), 'Unable to save the FC packer mapping.');
  },

  initializeStandards(organizationId: string): Promise<number> {
    return executeQuery(getSupabaseClient().rpc('initialize_fc_activity_standards', { p_organization_id: organizationId }), 'Unable to initialize FC activity standards.');
  },

  saveStandard(organizationId: string, standard: FcActivityStandardRow): Promise<undefined> {
    return executeQuery(getSupabaseClient().rpc('save_fc_activity_standard', {
      p_organization_id: organizationId, p_activity_code: standard.activity_code,
      p_units_per_worker: standard.units_per_worker, p_target_uom: standard.target_uom, p_is_active: standard.is_active,
    }), 'Unable to save the FC activity standard.');
  },

  saveManpowerDay(organizationId: string, workDate: string, data: Partial<FcDailyManpowerProductivityRow>): Promise<string> {
    return executeQuery(getSupabaseClient().rpc('save_fc_manpower_day', { p_organization_id: organizationId, p_work_date: workDate, p_data: data as Json }), 'Unable to save FC daily manpower productivity.');
  },

  async importOperationalMetrics(organizationId: string, preview: FcOperationalImportPreview): Promise<number> {
    return executeQuery<number>(getSupabaseClient().rpc('import_fc_operational_workspace', {
      p_organization_id: organizationId,
      p_source_file_names: preview.sourceFileNames.join(', '),
      p_sources: preview.sources as unknown as Json,
      p_from_date: preview.fromDate,
      p_to_date: preview.toDate,
      p_rows: preview.days as unknown as Json,
      p_client_rows: preview.clientDays as unknown as Json,
    }), 'Unable to import FC operational CSV metrics.');
  },

  initializeWorkspaceSettings(organizationId: string): Promise<undefined> {
    return executeQuery(getSupabaseClient().rpc('initialize_fc_workspace_settings', {
      p_organization_id: organizationId,
    }), 'Unable to initialize FC workspace settings.');
  },

  saveSettings(organizationId: string, updates: Partial<Pick<FcSettingsRow, 'standard_hours_per_day' | 'planned_absence_percent' | 'max_overtime_hours_per_day' | 'overtime_hourly_cost_own' | 'overtime_hourly_cost_3pl'>>): Promise<undefined> {
    return executeQuery(getSupabaseClient().rpc('save_fc_settings', {
      p_organization_id: organizationId,
      p_updates: updates as Json,
    }), 'Unable to save FC planning policy.');
  },

  saveEmployeeSetting(organizationId: string, employeeId: string, updates: Partial<Pick<FcEmployeeSettingsRow, 'labor_class' | 'employment_source' | 'overtime_eligible' | 'overtime_hourly_cost'>>): Promise<undefined> {
    return executeQuery(getSupabaseClient().rpc('save_fc_employee_setting', {
      p_organization_id: organizationId,
      p_employee_id: employeeId,
      p_updates: updates as Json,
    }), 'Unable to save FC employee labor classification.');
  },

  async createClient(organizationId: string, input: {
    code: string;
    name: string;
    templateClientId?: string | null;
    inbound_rate_override?: number | null;
    outbound_b2c_rate_override?: number | null;
    outbound_b2b_rate_override?: number | null;
    returns_rate_override?: number | null;
    vas_rate_override?: number | null;
    notes?: string | null;
  }): Promise<string> {
    const code = input.code.trim().toUpperCase();
    try {
      return await executeQuery(getSupabaseClient().rpc('create_fc_client', {
        p_organization_id: organizationId,
        p_code: code,
        p_name: input.name.trim(),
        p_template_client_id: input.templateClientId ?? null,
        p_overrides: {
          inbound_rate_override: input.inbound_rate_override ?? null,
          outbound_b2c_rate_override: input.outbound_b2c_rate_override ?? null,
          outbound_b2b_rate_override: input.outbound_b2b_rate_override ?? null,
          returns_rate_override: input.returns_rate_override ?? null,
          vas_rate_override: input.vas_rate_override ?? null,
          notes: input.notes ?? null,
        } as Json,
      }), 'Unable to create FC client.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('duplicate key') || msg.includes('fc_clients_')) {
        throw new Error(`An FC client with code "${code}" already exists.`);
      }
      throw err;
    }
  },

  updateClient(organizationId: string, clientId: string, updates: Partial<Pick<FcClientRow, 'name' | 'status' | 'inbound_rate_override' | 'outbound_b2c_rate_override' | 'outbound_b2b_rate_override' | 'returns_rate_override' | 'vas_rate_override' | 'notes'>>): Promise<undefined> {
    return executeQuery(getSupabaseClient().rpc('update_fc_client', {
      p_organization_id: organizationId,
      p_client_id: clientId,
      p_updates: updates as Json,
    }), 'Unable to update FC client.');
  },

  deleteClient(organizationId: string, clientId: string): Promise<undefined> {
    return executeQuery(getSupabaseClient().rpc('delete_fc_client', {
      p_organization_id: organizationId,
      p_client_id: clientId,
    }), 'Unable to delete FC client.');
  },
};
