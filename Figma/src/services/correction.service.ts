import { getSupabaseClient } from '../lib/supabase';
import { executeQuery } from './database.service';
import type {
  ManualAttendanceRequestRow,
  AttendanceRecordRow,
  EmployeeProfileRow,
  ResolvedScheduleRow,
  TablesInsert,
  ApprovalStatus,
} from '../types/database';

export interface CorrectionQuery {
  organizationId: string;
  employeeId?: string;
  status?: ApprovalStatus;
  fromDate?: string;
  toDate?: string;
}

export interface DirectAttendanceCorrectionInput {
  organizationId: string;
  employeeId: string;
  workDate: string;
  attendanceRecordId?: string | null;
  checkInAt: string;
  checkOutAt: string;
  reason: string;
}

export interface DetailedCorrectionRequest extends ManualAttendanceRequestRow {
  employee?: EmployeeProfileRow;
  attendanceRecord?: AttendanceRecordRow | null;
}

export const correctionService = {
  /**
   * List correction requests based on filters.
   */
  async list(queryInput: CorrectionQuery): Promise<ManualAttendanceRequestRow[]> {
    let query = getSupabaseClient()
      .from('manual_attendance_requests')
      .select('*')
      .eq('organization_id', queryInput.organizationId)
      .order('created_at', { ascending: false });

    if (queryInput.employeeId) query = query.eq('employee_id', queryInput.employeeId);
    if (queryInput.status) query = query.eq('status', queryInput.status);
    if (queryInput.fromDate) query = query.gte('requested_at', `${queryInput.fromDate}T00:00:00Z`);
    if (queryInput.toDate) query = query.lte('requested_at', `${queryInput.toDate}T23:59:59.999Z`);

    return executeQuery(query, 'Unable to load correction requests.');
  },

  /**
   * Submit a manual attendance correction or check-in request.
   */
  async submitRequest(input: TablesInsert<'manual_attendance_requests'>): Promise<ManualAttendanceRequestRow> {
    const result = await executeQuery(
      getSupabaseClient().from('manual_attendance_requests').insert(input).select('*').single(),
      'Unable to submit correction request.',
    ) as ManualAttendanceRequestRow;

    return result;
  },

  /**
   * Manager approves or rejects a correction request.
   */
  async reviewRequest(
    requestId: string,
    status: 'approved' | 'rejected',
    _reviewerId: string,
    reviewNote: string | null = null,
  ): Promise<ManualAttendanceRequestRow> {
    return executeQuery(
      getSupabaseClient()
        .rpc('review_manual_attendance_request', {
          p_request_id: requestId,
          p_status: status,
          p_review_note: reviewNote,
        })
        .single(),
      'Unable to review correction request.',
    );
  },

  /**
   * Directly correct attendance for an employee (manager/admin action).
   * Executes transactional recalculation of worked hours, late minutes, and overtime.
   */
  async directCorrection(input: DirectAttendanceCorrectionInput): Promise<AttendanceRecordRow> {
    return executeQuery(
      getSupabaseClient().rpc('manager_correct_attendance', {
        p_organization_id: input.organizationId,
        p_employee_id: input.employeeId,
        p_work_date: input.workDate,
        p_attendance_record_id: input.attendanceRecordId || null,
        p_check_in_at: input.checkInAt,
        p_check_out_at: input.checkOutAt,
        p_reason: input.reason,
      }).single(),
      'Unable to apply attendance correction.',
    );
  },

  /**
   * Loads existing attendance record and resolved shift schedule for an employee on a work date.
   */
  async getAttendanceDetails(
    organizationId: string,
    employeeId: string,
    workDate: string,
  ): Promise<{
    attendance: AttendanceRecordRow | null;
    schedule: ResolvedScheduleRow | null;
  }> {
    const client = getSupabaseClient();
    const [attResult, schedResult] = await Promise.all([
      client
        .from('attendance_records')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('employee_id', employeeId)
        .eq('attendance_date', workDate)
        .maybeSingle(),
      client.rpc('resolve_employee_schedule', {
        p_employee_id: employeeId,
        p_start_date: workDate,
        p_end_date: workDate,
      }),
    ]);

    return {
      attendance: attResult.data ?? null,
      schedule: schedResult.data && schedResult.data.length > 0 ? schedResult.data[0] : null,
    };
  },

  /**
   * List direct manager corrections applied.
   */
  async listDirectCorrections(
    organizationId: string,
    fromDate?: string,
    toDate?: string,
  ): Promise<AttendanceRecordRow[]> {
    let query = getSupabaseClient()
      .from('attendance_records')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('source', 'manual_manager')
      .order('attendance_date', { ascending: false });

    if (fromDate) query = query.gte('attendance_date', fromDate);
    if (toDate) query = query.lte('attendance_date', toDate);

    return executeQuery(query, 'Unable to load direct attendance corrections.');
  },
};
