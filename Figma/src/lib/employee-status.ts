import type {
  EmployeeProfileRow,
  AttendanceRecordRow,
  OvertimeRecordRow,
  ResolvedScheduleRow,
  ShiftAssignmentRow,
  ShiftRow,
} from '../types/database.ts';

export function isEmployeeActiveOnDate(employee: EmployeeProfileRow, date: string): boolean {
  const joiningDate = employee.joining_date || employee.created_at?.slice(0, 10);
  let effectiveDate = employee.status_effective_date;

  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(`emp_status_date_${employee.id}`);
    if (stored) effectiveDate = stored;
  }

  // Before joining date, the employee was not with the organization
  if (joiningDate && date < joiningDate) return false;

  if (employee.employment_status === 'active') {
    const startDate = effectiveDate || joiningDate;
    if (startDate && date < startDate) return false;
    return true;
  }

  if (employee.employment_status === 'inactive' || employee.employment_status === 'terminated') {
    // If date is strictly after effective date, the employee is inactive!
    if (effectiveDate && date > effectiveDate) return false;

    // If effective date is set and not equal to joining_date:
    // Dates on or before the effective date (e.g. before 18 Nov when date is 18 Nov): employee was active!
    if (effectiveDate && effectiveDate !== joiningDate) {
      return true;
    }

    // If effectiveDate equals joiningDate (fallback artifact) or null,
    // they are currently inactive:
    return false;
  }

  // on_leave: active employee who is currently on leave
  return true;
}

/**
 * Checks if an employee was active on at least one day in the given month (0-indexed month: 0=Jan..11=Dec).
 * If employee became inactive on Nov 18, they were active Nov 1-18, so this returns true for November (month=10),
 * but false for December (month=11) where they are inactive for the whole month.
 */
export function isEmployeeActiveInMonth(employee: EmployeeProfileRow, year: number, month: number): boolean {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const dayStr = String(day).padStart(2, '0');
    const mStr = String(month + 1).padStart(2, '0');
    const date = `${year}-${mStr}-${dayStr}`;
    if (isEmployeeActiveOnDate(employee, date)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if an employee was active on at least one day within the given date range (inclusive).
 */
export function isEmployeeActiveInRange(employee: EmployeeProfileRow, startDate: string, endDate: string): boolean {
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  const curr = new Date(start);
  while (curr <= end) {
    const iso = curr.toISOString().slice(0, 10);
    if (isEmployeeActiveOnDate(employee, iso)) {
      return true;
    }
    curr.setDate(curr.getDate() + 1);
  }
  return false;
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
        } else if (a.approval_status === 'rejected') {
          hasRejected = true;
        }
      }
    });
  }

  const status: 'approved' | 'pending' | 'rejected' | 'none' =
    hasApproved ? 'approved' : hasPending ? 'pending' : hasRejected ? 'rejected' : 'none';

  return { approvedMinutes, requestedMinutes, status };
}

export function getEffectiveApprovedOvertimeMinutes(
  employeeId: string,
  workDate: string,
  attendance: AttendanceRecordRow[],
  overtimeRecords: OvertimeRecordRow[],
): { effectiveMinutes: number; approvedMinutes: number; requestedMinutes: number; status: 'approved' | 'pending' | 'rejected' | 'none' } {
  const result = getApprovedOvertimeMinutes(employeeId, workDate, attendance, overtimeRecords);
  let effectiveMinutes = 0;
  if (result.status === 'approved') {
    effectiveMinutes = result.approvedMinutes;
  } else if (result.status === 'rejected') {
    effectiveMinutes = 0;
  } else {
    // Before review ('pending' or 'none'), fallback to recorded/requested minutes
    effectiveMinutes = result.requestedMinutes;
  }
  return { effectiveMinutes, ...result };
}

export type OffDayCompensationType = 'pending' | 'overtime' | 'comp_off';

export interface OffDayCompensationRecord {
  id: string; // `${employee_id}_${work_date}`
  organization_id: string;
  employee_id: string;
  work_date: string;
  shift_id: string | null;
  shift_name?: string;
  compensation_type: OffDayCompensationType;
  comp_off_date?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * Calculates approved overtime hours resulting from working on an off-day that is kept for Overtime.
 * If compensation_type is 'overtime', returns the worked hours (or scheduled shift duration fallback).
 * If compensation_type is 'comp_off' or 'pending', returns 0.
 */
export function getOffDayOvertimeHours(
  employeeId: string,
  workDate: string,
  compensations: OffDayCompensationRecord[] | Map<string, OffDayCompensationRecord>,
  scheduledShiftHours: number = 7.5,
  workedAttendanceHours: number = 0,
): number {
  let match: OffDayCompensationRecord | undefined;
  if (compensations instanceof Map) {
    match = compensations.get(`${employeeId}:${workDate}`) ?? compensations.get(`${employeeId}_${workDate}`) ?? compensations.get(`${employeeId}_${workDate}`);
  } else {
    match = (compensations ?? []).find(
      c => c.employee_id === employeeId && c.work_date === workDate
    );
  }

  if (!match || match.compensation_type !== 'overtime') return 0;
  return workedAttendanceHours > 0 ? workedAttendanceHours : scheduledShiftHours;
}

/**
 * Determines whether a given work date is an employee's scheduled off-day,
 * checking resolved schedule first, then dated shift assignment, then recurring/weekly off weekdays.
 */
export function isScheduleOffDay(
  workDate: string,
  resolvedSchedule?: Pick<ResolvedScheduleRow, 'state'> | null,
  assignment?: Pick<ShiftAssignmentRow, 'status'> | null,
  offWeekdays?: number[] | null,
): boolean {
  if (resolvedSchedule) {
    return resolvedSchedule.state === 'off';
  }
  if (assignment?.status === 'off') {
    return true;
  }
  if (assignment?.status === 'scheduled') {
    return false;
  }
  if (offWeekdays && offWeekdays.length > 0) {
    const weekday = new Date(`${workDate}T00:00:00Z`).getUTCDay();
    return offWeekdays.includes(weekday);
  }
  return false;
}

export type CorrectionDayStatus =
  | 'present'
  | 'late'
  | 'missing_in'
  | 'missing_out'
  | 'missed'
  | 'corrected'
  | 'off';

export interface ResolvedCorrectionDay {
  status: CorrectionDayStatus;
  statusLabel: string;
  shiftName: string;
  shiftStart: string | null;
  shiftEnd: string | null;
}

/**
 * Resolves the daily status and shift display for the Attendance Correction module.
 * Off-days (including recurring weekly offs such as Sunday) resolve to 'off' instead of 'missed',
 * unless the employee actually worked on that day.
 */
export function resolveCorrectionDayStatus(input: {
  workDate: string;
  rec: AttendanceRecordRow | null;
  resolvedSchedule?: ResolvedScheduleRow | null;
  assignment?: (ShiftAssignmentRow & { shift: ShiftRow | null }) | null;
  offWeekdays?: number[] | null;
}): ResolvedCorrectionDay {
  const { workDate, rec, resolvedSchedule, assignment, offWeekdays } = input;
  const isOff = isScheduleOffDay(workDate, resolvedSchedule, assignment, offWeekdays);

  const shift = assignment?.shift ?? null;
  const shiftName =
    shift?.name ??
    resolvedSchedule?.shift_name ??
    (isOff ? 'Employee Week Off' : 'Unassigned');
  const shiftStart = shift?.start_time ?? resolvedSchedule?.start_time ?? null;
  const shiftEnd = shift?.end_time ?? resolvedSchedule?.end_time ?? null;

  let status: CorrectionDayStatus = isOff ? 'off' : 'missed';
  let statusLabel = isOff ? 'Employee Week Off' : 'Missed / Absent';

  if (rec) {
    if (rec.source === 'manual_manager') {
      status = 'corrected';
      statusLabel = 'Manager Corrected';
    } else if (rec.status === 'present') {
      status = 'present';
      statusLabel = 'Correctly Marked';
    } else if (rec.status === 'late') {
      status = 'late';
      statusLabel = 'Late';
    } else if (isOff) {
      status = 'off';
      statusLabel = 'Employee Week Off';
    } else if (rec.status === 'missing_check_in') {
      status = 'missing_in';
      statusLabel = 'Missing Check-In';
    } else if (rec.status === 'missing_check_out') {
      status = 'missing_out';
      statusLabel = 'Missing Check-Out';
    } else if (rec.status === 'absent') {
      status = 'missed';
      statusLabel = 'Missed / Absent';
    }
  }

  return { status, statusLabel, shiftName, shiftStart, shiftEnd };
}

/**
 * Formats raw schedule_state values into human-readable labels for Dashboard views.
 */
export function formatScheduleStateLabel(state: string | null | undefined): string {
  switch (state) {
    case 'off':
      return 'Employee Week Off';
    case 'leave':
      return 'On Leave';
    case 'holiday':
      return 'Holiday';
    case 'cancelled':
      return 'Cancelled';
    case 'unassigned':
      return 'Unassigned';
    case 'working':
      return 'Scheduled';
    default:
      return state || 'Unassigned';
  }
}
