import { getSupabaseClient } from '../lib/supabase';
import { executeQuery } from './database.service';
import { toAppError } from '../lib/errors';
import type { OvertimeRecordRow, AttendanceRecordRow, TablesInsert, ApprovalStatus, Json, EmployeeProfileRow, BranchRow, DepartmentRow, PhoneUsageRecordRow, ProductivityRecordRow, ResolvedScheduleRow } from '../types/database';

export interface OvertimeQuery {
  organizationId: string;
  employeeId?: string;
  attendanceRecordId?: string;
  status?: ApprovalStatus;
}

export interface OvertimeReviewFilters {
  organizationId: string;
  fromDate: string;
  toDate: string;
  search?: string;
  branchId?: string;
  departmentId?: string;
  overtimeStatus?: string;
  attendanceIssue?: string;
  deviceStatus?: string;
  actionRequired?: boolean;
  page?: number;
  pageSize?: number;
}

export interface OvertimeEmployeeSummary {
  employee_id: string;
  employee_code: string;
  full_name: string;
  job_title: string | null;
  branch_id: string;
  branch_name: string;
  department_id: string;
  department_name: string;
  worked_days: number;
  worked_minutes: number;
  pending_count: number;
  pending_minutes: number;
  approved_minutes: number;
  attendance_issue_count: number;
  average_device_usage_percent: number | null;
  average_productivity_percent: number | null;
  action_required: boolean;
  total_count: number;
}

export interface OvertimeReviewDay {
  work_date: string;
  schedule_state: string;
  shift_name: string | null;
  shift_start: string | null;
  shift_end: string | null;
  attendance_record_id: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  attendance_status: string | null;
  worked_minutes: number;
  missing_minutes: number;
  late_minutes: number;
  early_leaving_minutes: number;
  calculated_overtime_minutes: number;
  overtime_record_id: string | null;
  requested_minutes: number;
  approved_minutes: number | null;
  overtime_status: ApprovalStatus | null;
  review_note?: string | null;
  device_minutes: number;
  device_usage_percent: number | null;
  device_data_status: string;
  productivity_percent: number | null;
  attendance_issue: boolean;
  reconciliation_issue: boolean;
}

export interface OvertimeDecision {
  id: string;
  status: 'approved' | 'rejected';
  approved_minutes: number;
  review_note: string | null;
}

export interface ManagerAttendanceCorrection {
  organizationId: string;
  employeeId: string;
  workDate: string;
  attendanceRecordId: string | null;
  checkInAt: string;
  checkOutAt: string;
  reason: string;
}

export const overtimeService = {
  async listEmployeeReviewSummaries(input: OvertimeReviewFilters): Promise<{ rows: OvertimeEmployeeSummary[]; count: number }> {
    const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 25));
    const page = Math.max(1, input.page ?? 1);
    const result = await getSupabaseClient().rpc('list_overtime_review_employees', {
        p_organization_id: input.organizationId,
        p_from_date: input.fromDate,
        p_to_date: input.toDate,
        p_search: input.search?.trim() || null,
        p_branch_id: input.branchId || null,
        p_department_id: input.departmentId || null,
        p_overtime_status: input.overtimeStatus || null,
        p_attendance_issue: input.attendanceIssue || null,
        p_device_status: input.deviceStatus || null,
        p_action_required: input.actionRequired,
        p_limit: pageSize,
        p_offset: (page - 1) * pageSize,
      });
    if (result.error) {
      if (isMissingRpc(result.error)) return buildFallbackSummaries(input, page, pageSize);
      throw toAppError(result.error, 'Unable to load the overtime review workspace.');
    }
    const rows = result.data ?? [];
    return { rows, count: rows[0]?.total_count ?? 0 };
  },

  async getEmployeeReviewDetail(input: Pick<OvertimeReviewFilters, 'organizationId' | 'fromDate' | 'toDate'> & { employeeId: string }): Promise<OvertimeReviewDay[]> {
    const result = await getSupabaseClient().rpc('get_overtime_review_detail', {
        p_organization_id: input.organizationId,
        p_employee_id: input.employeeId,
        p_from_date: input.fromDate,
        p_to_date: input.toDate,
      });
    if (result.error) {
      if (isMissingRpc(result.error)) return buildFallbackDetail(input);
      throw toAppError(result.error, 'Unable to load employee overtime details.');
    }
    return result.data ?? [];
  },

  async reviewBatch(decisions: OvertimeDecision[]): Promise<OvertimeRecordRow[]> {
    return executeQuery(
      getSupabaseClient().rpc('review_overtime_batch', { p_decisions: decisions as unknown as Json }),
      'Unable to review the selected overtime records.',
    );
  },

  async updateApprovedOvertime(input: {
    id: string;
    approvedMinutes: number;
    reviewNote?: string | null;
  }): Promise<OvertimeRecordRow> {
    return executeQuery(
      getSupabaseClient().rpc('update_approved_overtime', {
        p_overtime_id: input.id,
        p_approved_minutes: input.approvedMinutes,
        p_review_note: input.reviewNote ?? null,
      }).single(),
      'Unable to update approved overtime hours.',
    );
  },

  async correctAttendance(input: ManagerAttendanceCorrection): Promise<AttendanceRecordRow> {
    return executeQuery(
      getSupabaseClient().rpc('manager_correct_attendance', {
        p_organization_id: input.organizationId,
        p_employee_id: input.employeeId,
        p_work_date: input.workDate,
        p_attendance_record_id: input.attendanceRecordId,
        p_check_in_at: input.checkInAt,
        p_check_out_at: input.checkOutAt,
        p_reason: input.reason,
      }).single(),
      'Unable to correct attendance.',
    );
  },

  /**
   * List overtime records based on filters.
   */
  async list(queryInput: OvertimeQuery): Promise<OvertimeRecordRow[]> {
    let query = getSupabaseClient()
      .from('overtime_records')
      .select('*')
      .eq('organization_id', queryInput.organizationId)
      .order('created_at', { ascending: false });

    if (queryInput.employeeId) query = query.eq('employee_id', queryInput.employeeId);
    if (queryInput.attendanceRecordId) query = query.eq('attendance_record_id', queryInput.attendanceRecordId);
    if (queryInput.status) query = query.eq('status', queryInput.status);

    return executeQuery(query, 'Unable to load overtime records.');
  },

  /**
   * Request overtime. This could be triggered automatically by check-out if overtime > 0,
   * or manually by an employee/manager.
   */
  async requestOvertime(input: TablesInsert<'overtime_records'>): Promise<OvertimeRecordRow> {
    return executeQuery(
      getSupabaseClient().from('overtime_records').insert(input).select('*').single(),
      'Unable to request overtime.',
    );
  },

  /**
   * Approve or reject an overtime request.
   */
  async reviewOvertime(
    overtimeId: string,
    status: 'approved' | 'rejected',
    approvedMinutes: number | null,
    _reviewerId: string,
    reviewNote: string | null = null
  ): Promise<OvertimeRecordRow> {
    return executeQuery(
      getSupabaseClient()
        .rpc('review_overtime_record', {
          p_overtime_id: overtimeId,
          p_status: status,
          p_approved_minutes: approvedMinutes,
          p_review_note: reviewNote,
        })
        .single(),
      'Unable to review overtime.',
    );
  }
};

function isMissingRpc(error: { code?: string; message?: string }) {
  return error.code === 'PGRST202' || error.code === '42883' || /function .* does not exist|schema cache/i.test(error.message ?? '');
}

async function buildFallbackSummaries(input: OvertimeReviewFilters, page: number, pageSize: number): Promise<{ rows: OvertimeEmployeeSummary[]; count: number }> {
  const client = getSupabaseClient();
  const [profilesResult, branchesResult, departmentsResult, attendanceResult, overtimeResult, deviceResult, productivityResult] = await Promise.all([
    client.from('employee_profiles').select('*').eq('organization_id', input.organizationId).eq('employment_status', 'active'),
    client.from('branches').select('*').eq('organization_id', input.organizationId),
    client.from('departments').select('*').eq('organization_id', input.organizationId),
    client.from('attendance_records').select('*').eq('organization_id', input.organizationId).gte('attendance_date', input.fromDate).lte('attendance_date', input.toDate),
    client.from('overtime_records').select('*').eq('organization_id', input.organizationId),
    client.from('phone_usage_records').select('*').eq('organization_id', input.organizationId).gte('work_date', input.fromDate).lte('work_date', input.toDate),
    client.from('productivity_records').select('*').eq('organization_id', input.organizationId).gte('work_date', input.fromDate).lte('work_date', input.toDate),
  ]);
  const firstError = [profilesResult.error, branchesResult.error, departmentsResult.error, attendanceResult.error, overtimeResult.error, deviceResult.error, productivityResult.error].find(Boolean);
  if (firstError) throw toAppError(firstError, 'Unable to load the overtime review workspace.');
  const profiles = (profilesResult.data ?? []) as EmployeeProfileRow[];
  const branches = new Map(((branchesResult.data ?? []) as BranchRow[]).map(row => [row.id, row.name]));
  const departments = new Map(((departmentsResult.data ?? []) as DepartmentRow[]).map(row => [row.id, row.name]));
  const attendance = (attendanceResult.data ?? []) as AttendanceRecordRow[];
  const attendanceIds = new Set(attendance.map(row => row.id));
  const overtime = ((overtimeResult.data ?? []) as OvertimeRecordRow[]).filter(row => attendanceIds.has(row.attendance_record_id));
  const device = (deviceResult.data ?? []) as PhoneUsageRecordRow[];
  const productivity = (productivityResult.data ?? []) as ProductivityRecordRow[];
  const scheduleResults = await Promise.all(profiles.map(profile => client.rpc('resolve_employee_schedule', { p_employee_id: profile.id, p_start_date: input.fromDate, p_end_date: input.toDate })));
  const scheduleError = scheduleResults.map(result => result.error).find(Boolean);
  if (scheduleError) throw toAppError(scheduleError, 'Unable to resolve employee schedules.');
  const schedules = new Map(profiles.map((profile, index) => [profile.id, (scheduleResults[index].data ?? []) as ResolvedScheduleRow[]]));
  const rows = profiles.map(profile => {
    const empAttendance = attendance.filter(row => row.employee_id === profile.id);
    const empOvertime = overtime.filter(row => row.employee_id === profile.id);
    const deviceValues = device.filter(row => row.employee_id === profile.id && row.usage_percentage != null).map(row => row.usage_percentage!);
    const productivityValues = productivity.filter(row => row.employee_id === profile.id && row.productivity_percent != null).map(row => row.productivity_percent!);
    const empSchedules = schedules.get(profile.id) ?? [];
    const incomplete = empAttendance.filter(row => {
      const daySchedule = empSchedules.find(s => s.work_date === row.attendance_date);
      if (daySchedule?.state !== 'working') return false;
      return !row.check_in_at || !row.check_out_at || Date.parse(row.check_out_at) <= Date.parse(row.check_in_at) || (row.worked_minutes === 0 && row.missing_minutes > 0) || ['absent', 'missing_check_in', 'missing_check_out', 'invalid'].includes(row.status);
    }).length;
    const missingScheduled = empSchedules.filter(schedule => schedule.state === 'working' && !empAttendance.some(row => row.attendance_date === schedule.work_date)).length;
    const issues = incomplete + missingScheduled;
    const pending = empOvertime.filter(row => row.status === 'pending');
    const summary: OvertimeEmployeeSummary = {
      employee_id: profile.id, employee_code: profile.employee_code, full_name: profile.full_name, job_title: profile.job_title,
      branch_id: profile.branch_id, branch_name: branches.get(profile.branch_id) ?? 'Unknown site', department_id: profile.department_id, department_name: departments.get(profile.department_id) ?? 'Unknown department',
      worked_days: empAttendance.filter(row => row.worked_minutes > 0).length, worked_minutes: empAttendance.reduce((sum, row) => sum + row.worked_minutes, 0),
      pending_count: pending.length, pending_minutes: pending.reduce((sum, row) => sum + row.requested_minutes, 0), approved_minutes: empOvertime.filter(row => row.status === 'approved').reduce((sum, row) => sum + (row.approved_minutes ?? 0), 0),
      attendance_issue_count: issues, average_device_usage_percent: deviceValues.length ? deviceValues.reduce((sum, value) => sum + value, 0) / deviceValues.length : null,
      average_productivity_percent: productivityValues.length ? productivityValues.reduce((sum, value) => sum + value, 0) / productivityValues.length : null,
      action_required: pending.length > 0 || issues > 0, total_count: 0,
    };
    return { summary, empOvertime };
  }).filter(({ summary, empOvertime }) => {
    const query = input.search?.trim().toLowerCase();
    if (query && !summary.full_name.toLowerCase().includes(query) && !summary.employee_code.toLowerCase().includes(query)) return false;
    if (input.branchId && summary.branch_id !== input.branchId) return false;
    if (input.departmentId && summary.department_id !== input.departmentId) return false;
    if (input.overtimeStatus && !empOvertime.some(row => row.status === input.overtimeStatus)) return false;
    if (input.attendanceIssue === 'issues' && summary.attendance_issue_count === 0) return false;
    if (input.attendanceIssue === 'clear' && summary.attendance_issue_count > 0) return false;
    const usage = summary.average_device_usage_percent;
    if (input.deviceStatus === 'unavailable' && usage != null) return false;
    if (input.deviceStatus === 'normal' && (usage == null || usage > 30)) return false;
    if (input.deviceStatus === 'review' && (usage == null || usage <= 30 || usage > 60)) return false;
    if (input.deviceStatus === 'high' && (usage == null || usage <= 60)) return false;
    if (input.actionRequired !== undefined && summary.action_required !== input.actionRequired) return false;
    return true;
  }).map(item => item.summary).sort((a, b) => Number(b.action_required) - Number(a.action_required) || b.pending_minutes - a.pending_minutes || b.attendance_issue_count - a.attendance_issue_count || a.full_name.localeCompare(b.full_name));
  rows.forEach(row => { row.total_count = rows.length; });
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), count: rows.length };
}

async function buildFallbackDetail(input: Pick<OvertimeReviewFilters, 'organizationId' | 'fromDate' | 'toDate'> & { employeeId: string }): Promise<OvertimeReviewDay[]> {
  const client = getSupabaseClient();
  const [scheduleResult, attendanceResult, overtimeResult, deviceResult, productivityResult] = await Promise.all([
    client.rpc('resolve_employee_schedule', { p_employee_id: input.employeeId, p_start_date: input.fromDate, p_end_date: input.toDate }),
    client.from('attendance_records').select('*').eq('organization_id', input.organizationId).eq('employee_id', input.employeeId).gte('attendance_date', input.fromDate).lte('attendance_date', input.toDate).order('session_number', { ascending: false }),
    client.from('overtime_records').select('*').eq('organization_id', input.organizationId).eq('employee_id', input.employeeId),
    client.from('phone_usage_records').select('*').eq('organization_id', input.organizationId).eq('employee_id', input.employeeId).gte('work_date', input.fromDate).lte('work_date', input.toDate),
    client.from('productivity_records').select('*').eq('organization_id', input.organizationId).eq('employee_id', input.employeeId).gte('work_date', input.fromDate).lte('work_date', input.toDate),
  ]);
  const firstError = [scheduleResult.error, attendanceResult.error, overtimeResult.error, deviceResult.error, productivityResult.error].find(Boolean);
  if (firstError) throw toAppError(firstError, 'Unable to load employee overtime details.');
  const attendance = (attendanceResult.data ?? []) as AttendanceRecordRow[];
  const overtime = (overtimeResult.data ?? []) as OvertimeRecordRow[];
  const device = (deviceResult.data ?? []) as PhoneUsageRecordRow[];
  const productivity = (productivityResult.data ?? []) as ProductivityRecordRow[];
  return ((scheduleResult.data ?? []) as ResolvedScheduleRow[]).map(schedule => {
    const record = attendance.find(row => row.attendance_date === schedule.work_date);
    const overtimeRecord = record ? overtime.find(row => row.attendance_record_id === record.id) : undefined;
    const deviceRecord = device.find(row => row.work_date === schedule.work_date);
    const productivityValues = productivity.filter(row => row.work_date === schedule.work_date && row.productivity_percent != null).map(row => row.productivity_percent!);
    const issue = schedule.state === 'working' && (!record || !record.check_in_at || !record.check_out_at || Date.parse(record.check_out_at) <= Date.parse(record.check_in_at) || (record.worked_minutes === 0 && record.missing_minutes > 0) || ['absent', 'missing_check_in', 'missing_check_out', 'invalid'].includes(record.status));
    return {
      work_date: schedule.work_date, schedule_state: schedule.state, shift_name: schedule.shift_name, shift_start: schedule.start_time, shift_end: schedule.end_time,
      attendance_record_id: record?.id ?? null, check_in_at: record?.check_in_at ?? null, check_out_at: record?.check_out_at ?? null, attendance_status: record?.status ?? null,
      worked_minutes: record?.worked_minutes ?? 0, missing_minutes: record?.missing_minutes ?? 0, late_minutes: record?.late_minutes ?? 0, early_leaving_minutes: record?.early_leaving_minutes ?? 0, calculated_overtime_minutes: record?.overtime_minutes ?? 0,
      overtime_record_id: overtimeRecord?.id ?? null, requested_minutes: overtimeRecord?.requested_minutes ?? 0, approved_minutes: overtimeRecord?.approved_minutes ?? null, overtime_status: overtimeRecord?.status ?? null,
      device_minutes: deviceRecord?.within_shift_minutes ?? 0, device_usage_percent: deviceRecord?.usage_percentage ?? null, device_data_status: deviceRecord ? 'available' : 'unavailable',
      productivity_percent: productivityValues.length ? productivityValues.reduce((sum, value) => sum + value, 0) / productivityValues.length : null,
      attendance_issue: issue, reconciliation_issue: !!overtimeRecord && ['approved', 'rejected'].includes(overtimeRecord.status) && overtimeRecord.requested_minutes !== (record?.overtime_minutes ?? 0),
    };
  }).sort((a, b) => b.work_date.localeCompare(a.work_date));
}
