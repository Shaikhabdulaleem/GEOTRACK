import type {
  OvertimeRateMode,
  PayrollComponentKind,
  PayrollExceptionType,
  PayrollExportCsvRow,
  PayrollReviewStatus,
} from '../types/database.ts';

export interface PayrollSettingsConfig {
  currencyCode: string;
  monthBasisDays: number;
  dailyHours: number;
  overtimeMultiplier: number;
  overtimeRateMode?: OvertimeRateMode;
  overtimeHourlyRate?: number;
}

export interface SalarySegmentInput {
  id?: string;
  monthlyBaseSalary: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface RecurringComponentInput {
  id?: string;
  kind: PayrollComponentKind;
  code: string;
  name: string;
  amount: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
}

export interface ManualAdjustmentInput {
  direction: 'earning' | 'deduction';
  code: string;
  label: string;
  amount: number;
}

export interface OvertimeItemInput {
  attendanceDate: string;
  status: 'approved' | 'pending' | 'rejected' | 'not_required';
  approvedMinutes: number;
  requestedMinutes: number;
}

export interface DailyAttendanceInput {
  workDate: string;
  scheduleState: 'working' | 'off' | 'holiday' | 'leave';
  attendanceStatus?: string | null;
  lateMinutes?: number;
  earlyLeavingMinutes?: number;
  missingMinutes?: number;
  hasCheckIn?: boolean;
  hasCheckOut?: boolean;
  hasApprovedUnpaidLeave?: boolean;
  hasApprovedPaidLeave?: boolean;
}

export interface EmployeePayrollInput {
  payrollMonth: string; // YYYY-MM
  joiningDate: string | null;
  employmentStatus: 'active' | 'inactive' | 'on_leave' | 'terminated';
  statusEffectiveDate: string | null;
  settings: PayrollSettingsConfig;
  salaries: SalarySegmentInput[];
  components?: RecurringComponentInput[];
  overtime?: OvertimeItemInput[];
  dailyRecords?: DailyAttendanceInput[];
  manualAdjustments?: ManualAdjustmentInput[];
}

export interface CalculatedException {
  workDate: string;
  exceptionType: PayrollExceptionType;
  minutes: number;
}

export interface CalculatedPayrollResult {
  activeFrom: string | null;
  activeTo: string | null;
  activeDays: number;
  payableDays: number;
  basePay: number;
  allowancesPay: number;
  overtimePay: number;
  approvedOvertimeMinutes: number;
  pendingOvertimeCount: number;
  manualAdditions: number;
  absenceDeduction: number;
  unpaidLeaveDeduction: number;
  recurringDeductions: number;
  manualDeductions: number;
  grossPay: number;
  totalDeductions: number;
  netPay: number;
  absentDays: number;
  unpaidLeaveDays: number;
  exceptions: CalculatedException[];
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function getMonthBounds(payrollMonth: string): { monthStart: string; monthEnd: string; calendarDays: number } {
  const [yStr, mStr] = payrollMonth.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return {
    monthStart: `${year}-${mm}-01`,
    monthEnd: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
    calendarDays: lastDay,
  };
}

export function calculatePayrollDaysInSegment(
  segFrom: string,
  segTo: string,
  monthStart: string,
  monthEnd: string,
  empActiveFrom: string,
  empActiveTo: string,
  monthBasisDays: number,
): number {
  if (!segFrom || !segTo || segTo < segFrom) return 0;
  if (segFrom === monthStart && segTo === monthEnd) return monthBasisDays;

  let days = 0;
  const cur = new Date(`${segFrom}T00:00:00Z`);
  const end = new Date(`${segTo}T00:00:00Z`);
  while (cur <= end) {
    if (cur.getUTCDate() <= monthBasisDays) {
      days += 1;
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  const calendarDays = Number(monthEnd.slice(8, 10));
  if (
    empActiveFrom === monthStart
    && empActiveTo === monthEnd
    && segTo === monthEnd
    && calendarDays < monthBasisDays
  ) {
    days += monthBasisDays - calendarDays;
  }

  return Math.max(0, Math.min(monthBasisDays, days));
}

export function hasOverlappingCompensation(
  candidate: Pick<SalarySegmentInput, 'id' | 'effectiveFrom' | 'effectiveTo'>,
  existing: SalarySegmentInput[],
): boolean {
  const candEnd = candidate.effectiveTo ?? '9999-12-31';
  return existing.some(item => {
    if (candidate.id && item.id === candidate.id) return false;
    const itemEnd = item.effectiveTo ?? '9999-12-31';
    return candidate.effectiveFrom <= itemEnd && item.effectiveFrom <= candEnd;
  });
}

function getSalaryOnDate(salaries: SalarySegmentInput[], date: string): number {
  const match = salaries
    .filter(s => date >= s.effectiveFrom && (s.effectiveTo === null || date <= s.effectiveTo))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  return match?.monthlyBaseSalary ?? 0;
}

export function calculateEmployeePayroll(input: EmployeePayrollInput): CalculatedPayrollResult {
  const { monthStart, monthEnd } = getMonthBounds(input.payrollMonth);
  const { monthBasisDays, dailyHours, overtimeMultiplier } = input.settings;
  const overtimeRateMode = input.settings.overtimeRateMode ?? 'multiplier';
  const overtimeHourlyRate = Number(input.settings.overtimeHourlyRate ?? 0);

  const joinDate = input.joiningDate ?? monthStart;
  let activeFrom = joinDate > monthStart ? joinDate : monthStart;
  let activeTo = monthEnd;

  if (input.employmentStatus === 'active') {
    if (input.statusEffectiveDate && input.statusEffectiveDate > activeFrom) {
      activeFrom = input.statusEffectiveDate;
    }
  } else if (input.employmentStatus === 'inactive' || input.employmentStatus === 'terminated') {
    if (input.statusEffectiveDate && input.statusEffectiveDate !== joinDate) {
      activeTo = input.statusEffectiveDate < monthEnd ? input.statusEffectiveDate : monthEnd;
    } else {
      return {
        activeFrom: null,
        activeTo: null,
        activeDays: 0,
        payableDays: 0,
        basePay: 0,
        allowancesPay: 0,
        overtimePay: 0,
        approvedOvertimeMinutes: 0,
        pendingOvertimeCount: 0,
        manualAdditions: 0,
        absenceDeduction: 0,
        unpaidLeaveDeduction: 0,
        recurringDeductions: 0,
        manualDeductions: 0,
        grossPay: 0,
        totalDeductions: 0,
        netPay: 0,
        absentDays: 0,
        unpaidLeaveDays: 0,
        exceptions: [],
      };
    }
  }

  if (activeFrom > activeTo) {
    return {
      activeFrom: null,
      activeTo: null,
      activeDays: 0,
      payableDays: 0,
      basePay: 0,
      allowancesPay: 0,
      overtimePay: 0,
      approvedOvertimeMinutes: 0,
      pendingOvertimeCount: 0,
      manualAdditions: 0,
      absenceDeduction: 0,
      unpaidLeaveDeduction: 0,
      recurringDeductions: 0,
      manualDeductions: 0,
      grossPay: 0,
      totalDeductions: 0,
      netPay: 0,
      absentDays: 0,
      unpaidLeaveDays: 0,
      exceptions: [],
    };
  }

  const activeDays = Math.round(
    (new Date(`${activeTo}T00:00:00Z`).getTime() - new Date(`${activeFrom}T00:00:00Z`).getTime()) / 86400000,
  ) + 1;

  let basePay = 0;
  let payableDays = 0;
  const sortedSalaries = [...input.salaries].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  for (const sal of sortedSalaries) {
    const salEnd = sal.effectiveTo ?? activeTo;
    if (sal.effectiveFrom > activeTo || salEnd < activeFrom) continue;
    const segFrom = sal.effectiveFrom > activeFrom ? sal.effectiveFrom : activeFrom;
    const segTo = salEnd < activeTo ? salEnd : activeTo;
    const segDays = calculatePayrollDaysInSegment(segFrom, segTo, monthStart, monthEnd, activeFrom, activeTo, monthBasisDays);
    if (segDays > 0) {
      payableDays += segDays;
      basePay = roundMoney(basePay + roundMoney(sal.monthlyBaseSalary * (segDays / monthBasisDays)));
    }
  }

  let allowancesPay = 0;
  let recurringDeductions = 0;
  for (const comp of input.components ?? []) {
    if (!comp.isActive) continue;
    const compEnd = comp.effectiveTo ?? activeTo;
    if (comp.effectiveFrom > activeTo || compEnd < activeFrom) continue;
    const segFrom = comp.effectiveFrom > activeFrom ? comp.effectiveFrom : activeFrom;
    const segTo = compEnd < activeTo ? compEnd : activeTo;
    const segDays = calculatePayrollDaysInSegment(segFrom, segTo, monthStart, monthEnd, activeFrom, activeTo, monthBasisDays);
    if (segDays > 0) {
      const amount = roundMoney(comp.amount * (segDays / monthBasisDays));
      if (comp.kind === 'allowance') allowancesPay = roundMoney(allowancesPay + amount);
      else recurringDeductions = roundMoney(recurringDeductions + amount);
    }
  }

  let overtimePay = 0;
  let approvedOvertimeMinutes = 0;
  let pendingOvertimeCount = 0;
  for (const ot of input.overtime ?? []) {
    if (ot.attendanceDate < activeFrom || ot.attendanceDate > activeTo) continue;
    if (ot.status === 'pending') {
      pendingOvertimeCount += 1;
    } else if (ot.status === 'approved' && ot.approvedMinutes > 0) {
      approvedOvertimeMinutes += ot.approvedMinutes;
      if (overtimeRateMode === 'fixed_hourly') {
        if (overtimeHourlyRate > 0) {
          overtimePay = roundMoney(overtimePay + roundMoney((ot.approvedMinutes / 60) * overtimeHourlyRate));
        }
      } else {
        const salary = getSalaryOnDate(sortedSalaries, ot.attendanceDate);
        if (salary > 0) {
          const hourlyRate = salary / (monthBasisDays * dailyHours);
          overtimePay = roundMoney(overtimePay + roundMoney((ot.approvedMinutes / 60) * hourlyRate * overtimeMultiplier));
        }
      }
    }
  }

  let absenceDeduction = 0;
  let unpaidLeaveDeduction = 0;
  let absentDays = 0;
  let unpaidLeaveDays = 0;
  const exceptions: CalculatedException[] = [];

  for (const day of input.dailyRecords ?? []) {
    if (day.workDate < activeFrom || day.workDate > activeTo) continue;
    const daySalary = getSalaryOnDate(sortedSalaries, day.workDate);
    const dayRate = roundMoney(daySalary / monthBasisDays);

    if (day.hasApprovedUnpaidLeave) {
      unpaidLeaveDays += 1;
      unpaidLeaveDeduction = roundMoney(unpaidLeaveDeduction + dayRate);
      continue;
    }

    if (day.hasApprovedPaidLeave || day.scheduleState !== 'working') {
      continue;
    }

    if (day.attendanceStatus === 'absent') {
      absentDays += 1;
      absenceDeduction = roundMoney(absenceDeduction + dayRate);
      continue;
    }

    if (day.attendanceStatus === 'on_leave') continue;

    if (
      day.attendanceStatus === 'missing_check_in'
      || day.attendanceStatus === 'missing_check_out'
      || day.attendanceStatus === 'invalid'
      || (day.hasCheckIn && !day.hasCheckOut)
      || (!day.hasCheckIn && day.hasCheckOut)
      || !day.attendanceStatus
    ) {
      exceptions.push({
        workDate: day.workDate,
        exceptionType: 'incomplete_attendance',
        minutes: day.missingMinutes ?? Math.round(dailyHours * 60),
      });
    }
    if ((day.lateMinutes ?? 0) > 0) {
      exceptions.push({
        workDate: day.workDate,
        exceptionType: 'late',
        minutes: day.lateMinutes ?? 0,
      });
    }
    if ((day.earlyLeavingMinutes ?? 0) > 0) {
      exceptions.push({
        workDate: day.workDate,
        exceptionType: 'early_departure',
        minutes: day.earlyLeavingMinutes ?? 0,
      });
    }
  }

  let manualAdditions = 0;
  let manualDeductions = 0;
  for (const adj of input.manualAdjustments ?? []) {
    if (adj.direction === 'earning') manualAdditions = roundMoney(manualAdditions + roundMoney(adj.amount));
    else manualDeductions = roundMoney(manualDeductions + roundMoney(adj.amount));
  }

  const grossPay = roundMoney(basePay + allowancesPay + overtimePay + manualAdditions);
  const totalDeductions = roundMoney(absenceDeduction + unpaidLeaveDeduction + recurringDeductions + manualDeductions);
  const netPay = roundMoney(grossPay - totalDeductions);

  return {
    activeFrom,
    activeTo,
    activeDays,
    payableDays,
    basePay,
    allowancesPay,
    overtimePay,
    approvedOvertimeMinutes,
    pendingOvertimeCount,
    manualAdditions,
    absenceDeduction,
    unpaidLeaveDeduction,
    recurringDeductions,
    manualDeductions,
    grossPay,
    totalDeductions,
    netPay,
    absentDays,
    unpaidLeaveDays,
    exceptions,
  };
}

export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export const PAYROLL_CSV_HEADERS = [
  'Employee Code',
  'Employee Name',
  'Site',
  'Department',
  'Job Title',
  'Base Pay',
  'Allowances',
  'Overtime Hours',
  'Overtime Pay',
  'Absence Deduction',
  'Unpaid Leave Deduction',
  'Other Adjustments',
  'Gross Pay',
  'Total Deductions',
  'Net Pay',
  'Currency',
  'Review Status',
] as const;

export function buildPayrollCsv(rows: readonly PayrollExportCsvRow[]): string {
  const lines = [PAYROLL_CSV_HEADERS.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.employee_code,
        row.employee_name,
        row.branch_name,
        row.department_name,
        row.job_title ?? '',
        row.base_pay.toFixed(2),
        row.allowances_pay.toFixed(2),
        row.overtime_hours.toFixed(2),
        row.overtime_pay.toFixed(2),
        row.absence_deduction.toFixed(2),
        row.unpaid_leave_deduction.toFixed(2),
        row.other_adjustments.toFixed(2),
        row.gross_pay.toFixed(2),
        row.total_deductions.toFixed(2),
        row.net_pay.toFixed(2),
        row.currency_code,
        row.review_status,
      ]
        .map(escapeCsvCell)
        .join(','),
    );
  }
  return lines.join('\r\n');
}

export function formatMoney(amount: number, currency = 'SAR'): string {
  return `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function monthInputToDate(monthValue: string): string {
  return `${monthValue}-01`;
}

export function dateToMonthInput(dateValue: string): string {
  return dateValue.slice(0, 7);
}

export function canFinalizePayrollRun(
  entries: ReadonlyArray<{
    unresolved_exception_count: number;
    pending_overtime_count: number;
    review_status: PayrollReviewStatus;
  }>,
): { allowed: boolean; reason: string | null } {
  if (entries.length === 0) {
    return { allowed: false, reason: 'Generate payroll entries before finalizing.' };
  }
  const unresolved = entries.reduce((sum, e) => sum + e.unresolved_exception_count, 0);
  if (unresolved > 0) {
    return { allowed: false, reason: `${unresolved} unresolved attendance exception(s) must be corrected or waived.` };
  }
  const pendingOt = entries.reduce((sum, e) => sum + e.pending_overtime_count, 0);
  if (pendingOt > 0) {
    return { allowed: false, reason: `${pendingOt} pending overtime record(s) must be approved or rejected.` };
  }
  const unreviewed = entries.filter(e => e.review_status !== 'reviewed').length;
  if (unreviewed > 0) {
    return { allowed: false, reason: `${unreviewed} employee entry/entries still pending review.` };
  }
  return { allowed: true, reason: null };
}
