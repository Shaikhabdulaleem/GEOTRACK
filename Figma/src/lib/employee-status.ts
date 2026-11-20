import type { EmployeeProfileRow } from '../types/database.ts';

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
    // If effective date is set and not equal to joining_date:
    // Dates on or before the effective date (e.g. before 18 Nov when date is 18 Nov): employee was active!
    // Dates strictly after the effective date (e.g. after 18 Nov): employee is inactive!
    if (effectiveDate && effectiveDate !== joiningDate) {
      if (date > effectiveDate) return false;
      return true;
    }
    // If effectiveDate equals joiningDate (fallback artifact) or null,
    // they are currently inactive:
    return false;
  }

  // on_leave: active employee who is currently on leave
  return true;
}
