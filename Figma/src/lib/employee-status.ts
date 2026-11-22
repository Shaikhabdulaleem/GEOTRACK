import type { EmployeeProfileRow, AttendanceRecordRow, OvertimeRecordRow } from '../types/database.ts';

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
