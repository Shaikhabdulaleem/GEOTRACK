import { AppError } from '../lib/errors';
import { getSupabaseClient } from '../lib/supabase';
import { executeQuery } from './database.service';
import type {
  AttendanceRecordRow,
  AttendanceEventRow,
  GeofenceValidationStatus,
  Json,
} from '../types/database';

export interface AttendanceQuery {
  organizationId: string;
  employeeId?: string;
  fromDate?: string;
  toDate?: string;
}

export interface AttendanceActionInput {
  /** Retained for compatibility; the database derives and verifies this value. */
  organizationId: string;
  employeeId: string;
  geofenceId: string;
  actionType: 'check_in' | 'check_out';
  isAuto: boolean;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  isMockLocation?: boolean;
  idempotencyKey: string;
  deviceInfo?: Json;
}

export interface AttendanceActionResult {
  attendanceRecordId: string | null;
  eventId: string;
  status: string;
  insideGeofence: boolean;
  validationStatus: GeofenceValidationStatus;
}

interface ProcessAttendanceRpcRow {
  attendance_record_id: string | null;
  event_id: string;
  status: string;
  inside_geofence: boolean;
  validation_status: GeofenceValidationStatus;
}

export const attendanceService = {
  async list(queryInput: AttendanceQuery): Promise<AttendanceRecordRow[]> {
    let query = getSupabaseClient()
      .from('attendance_records')
      .select('*')
      .eq('organization_id', queryInput.organizationId)
      .order('attendance_date', { ascending: false });

    if (queryInput.employeeId) query = query.eq('employee_id', queryInput.employeeId);
    if (queryInput.fromDate) query = query.gte('attendance_date', queryInput.fromDate);
    if (queryInput.toDate) query = query.lte('attendance_date', queryInput.toDate);

    return executeQuery(query, 'Unable to load attendance records.');
  },

  async listEvents(queryInput: AttendanceQuery): Promise<AttendanceEventRow[]> {
    let query = getSupabaseClient()
      .from('attendance_events')
      .select('*')
      .eq('organization_id', queryInput.organizationId)
      .order('event_at', { ascending: false });

    if (queryInput.employeeId) query = query.eq('employee_id', queryInput.employeeId);
    if (queryInput.fromDate) query = query.gte('event_at', `${queryInput.fromDate}T00:00:00Z`);
    if (queryInput.toDate) query = query.lt('event_at', `${nextUtcDate(queryInput.toDate)}T00:00:00Z`);

    return executeQuery(query, 'Unable to load attendance events.');
  },

  /**
   * Processes attendance atomically in Postgres. Identity, organization,
   * geofence assignment, polygon validation, duplicate prevention, shift
   * selection, night-shift handling, and totals are enforced by the database.
   */
  async processAttendance(input: AttendanceActionInput): Promise<AttendanceActionResult> {
    if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90) {
      throw new AppError('VALIDATION_ERROR', 'Latitude must be between -90 and 90.');
    }
    if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) {
      throw new AppError('VALIDATION_ERROR', 'Longitude must be between -180 and 180.');
    }
    if (
      input.accuracyMeters === null ||
      !Number.isFinite(input.accuracyMeters) ||
      input.accuracyMeters < 0
    ) {
      throw new AppError('VALIDATION_ERROR', 'A valid GPS accuracy reading is required.');
    }
    if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 200) {
      throw new AppError('VALIDATION_ERROR', 'The attendance request identifier is invalid.');
    }

    const row = await executeQuery(
      getSupabaseClient()
        .rpc('process_attendance_event', {
          p_employee_id: input.employeeId,
          p_geofence_id: input.geofenceId || null,
          p_action_type: input.actionType,
          p_is_auto: input.isAuto,
          p_latitude: input.latitude,
          p_longitude: input.longitude,
          p_accuracy_meters: input.accuracyMeters,
          p_is_mock_location: input.isMockLocation ?? false,
          p_idempotency_key: input.idempotencyKey,
          p_device_info: input.deviceInfo ?? {},
        })
        .single(),
      'Unable to process attendance.',
    ) as ProcessAttendanceRpcRow;

    if (!row.inside_geofence) {
      const message = row.validation_status === 'low_accuracy'
        ? 'Location accuracy is too low. Move to an open area and try again.'
        : row.validation_status === 'mock_location'
          ? 'Mock or spoofed locations are not allowed.'
          : 'You must be inside your assigned active geofence to record attendance.';
      throw new AppError('VALIDATION_ERROR', message);
    }

    return {
      attendanceRecordId: row.attendance_record_id,
      eventId: row.event_id,
      status: row.status,
      insideGeofence: row.inside_geofence,
      validationStatus: row.validation_status,
    };
  },
};

function nextUtcDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError('VALIDATION_ERROR', 'Invalid date filter.');
  }
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}
