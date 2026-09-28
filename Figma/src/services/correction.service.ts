import { getSupabaseClient } from '../lib/supabase';
import { executeQuery } from './database.service';
import type { ManualAttendanceRequestRow, TablesInsert, ApprovalStatus } from '../types/database';

export interface CorrectionQuery {
  organizationId: string;
  employeeId?: string;
  status?: ApprovalStatus;
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
    reviewNote: string | null = null
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
  }
};
