import { getSupabaseClient } from '../lib/supabase';
import { executeQuery } from './database.service';
import type { OvertimeRecordRow, TablesInsert, ApprovalStatus } from '../types/database';

export interface OvertimeQuery {
  organizationId: string;
  employeeId?: string;
  attendanceRecordId?: string;
  status?: ApprovalStatus;
}

export const overtimeService = {
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
