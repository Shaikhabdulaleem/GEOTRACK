import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { hasPermission } from '../src/auth/access-control.ts';
import { canAccessView, getAllowedViews } from '../src/auth/view-access.ts';
import {
  buildPayrollCsv,
  calculateEmployeePayroll,
  canFinalizePayrollRun,
  escapeCsvCell,
  hasOverlappingCompensation,
} from '../src/lib/payroll-model.ts';
import type { PayrollExportCsvRow } from '../src/types/database.ts';

const defaultSettings = {
  currencyCode: 'SAR',
  monthBasisDays: 30,
  dailyHours: 8,
  overtimeMultiplier: 1.5,
};

test('Full-month employment pays configured monthly salary in 31-day and February months', () => {
  const jan = calculateEmployeePayroll({
    payrollMonth: '2026-01',
    joiningDate: '2025-01-01',
    employmentStatus: 'active',
    statusEffectiveDate: null,
    settings: defaultSettings,
    salaries: [{ monthlyBaseSalary: 6000, effectiveFrom: '2025-01-01', effectiveTo: null }],
  });
  assert.equal(jan.payableDays, 30);
  assert.equal(jan.basePay, 6000);
  assert.equal(jan.netPay, 6000);

  const febNonLeap = calculateEmployeePayroll({
    payrollMonth: '2026-02',
    joiningDate: '2025-01-01',
    employmentStatus: 'active',
    statusEffectiveDate: null,
    settings: defaultSettings,
    salaries: [{ monthlyBaseSalary: 6000, effectiveFrom: '2025-01-01', effectiveTo: null }],
  });
  assert.equal(febNonLeap.payableDays, 30);
  assert.equal(febNonLeap.basePay, 6000);

  const febLeap = calculateEmployeePayroll({
    payrollMonth: '2024-02',
    joiningDate: '2023-01-01',
    employmentStatus: 'active',
    statusEffectiveDate: null,
    settings: defaultSettings,
    salaries: [{ monthlyBaseSalary: 6000, effectiveFrom: '2023-01-01', effectiveTo: null }],
  });
  assert.equal(febLeap.payableDays, 30);
  assert.equal(febLeap.basePay, 6000);
});

test('Partial employment: day 31 adds no extra pay, mid-month joining & termination prorate on 30-day basis', () => {
  // Joined Jan 16 in 31-day month: days 16..30 = 15 payable days, day 31 adds 0
  const joinedJan16 = calculateEmployeePayroll({
    payrollMonth: '2026-01',
    joiningDate: '2026-01-16',
    employmentStatus: 'active',
    statusEffectiveDate: null,
    settings: defaultSettings,
    salaries: [{ monthlyBaseSalary: 6000, effectiveFrom: '2026-01-16', effectiveTo: null }],
  });
  assert.equal(joinedJan16.payableDays, 15);
  assert.equal(joinedJan16.basePay, 3000);

  // Terminated Nov 18: active Nov 1..18 = 18 payable days
  const terminatedNov18 = calculateEmployeePayroll({
    payrollMonth: '2026-11',
    joiningDate: '2025-01-01',
    employmentStatus: 'terminated',
    statusEffectiveDate: '2026-11-18',
    settings: defaultSettings,
    salaries: [{ monthlyBaseSalary: 6000, effectiveFrom: '2025-01-01', effectiveTo: null }],
  });
  assert.equal(terminatedNov18.payableDays, 18);
  assert.equal(terminatedNov18.basePay, 3600);
});

test('Mid-month salary change splits segments accurately in both 31-day month and complete February', () => {
  const janSplit = calculateEmployeePayroll({
    payrollMonth: '2026-01',
    joiningDate: '2025-01-01',
    employmentStatus: 'active',
    statusEffectiveDate: null,
    settings: defaultSettings,
    salaries: [
      { monthlyBaseSalary: 6000, effectiveFrom: '2025-01-01', effectiveTo: '2026-01-15' },
      { monthlyBaseSalary: 9000, effectiveFrom: '2026-01-16', effectiveTo: null },
    ],
  });
  assert.equal(janSplit.payableDays, 30);
  assert.equal(janSplit.basePay, 3000 + 4500);

  const febSplit = calculateEmployeePayroll({
    payrollMonth: '2026-02',
    joiningDate: '2025-01-01',
    employmentStatus: 'active',
    statusEffectiveDate: null,
    settings: defaultSettings,
    salaries: [
      { monthlyBaseSalary: 6000, effectiveFrom: '2025-01-01', effectiveTo: '2026-02-14' },
      { monthlyBaseSalary: 9000, effectiveFrom: '2026-02-15', effectiveTo: null },
    ],
  });
  // Complete Feb: 14 days at 6000 (2800) + 16 days at 9000 (4800) = 7600
  assert.equal(febSplit.payableDays, 30);
  assert.equal(febSplit.basePay, 7600);
});

test('Overtime uses base salary hourly rate x 1.5 (excluding allowances) and rounds to 2 decimals', () => {
  // Base 6000 => hourly = 6000 / 240 = 25.00; 90 mins = 1.5 hrs * 25 * 1.5 = 56.25
  // Housing allowance 1200 must NOT affect OT rate
  const res = calculateEmployeePayroll({
    payrollMonth: '2026-11',
    joiningDate: '2025-01-01',
    employmentStatus: 'active',
    statusEffectiveDate: null,
    settings: defaultSettings,
    salaries: [{ monthlyBaseSalary: 6000, effectiveFrom: '2025-01-01', effectiveTo: null }],
    components: [
      { kind: 'allowance', code: 'HOUS', name: 'Housing', amount: 1200, effectiveFrom: '2025-01-01', effectiveTo: null, isActive: true },
    ],
    overtime: [
      { attendanceDate: '2026-11-10', status: 'approved', approvedMinutes: 90, requestedMinutes: 90 },
      { attendanceDate: '2026-11-11', status: 'pending', approvedMinutes: 0, requestedMinutes: 60 },
      { attendanceDate: '2026-11-12', status: 'rejected', approvedMinutes: 0, requestedMinutes: 60 },
    ],
  });

  assert.equal(res.allowancesPay, 1200);
  assert.equal(res.approvedOvertimeMinutes, 90);
  assert.equal(res.overtimePay, 56.25);
  assert.equal(res.pendingOvertimeCount, 1);
  assert.equal(res.grossPay, 7256.25);
});

test('Confirmed absences and approved unpaid leave deduct from base salary without double-counting overlaps', () => {
  // Base 6000 => daily = 200.00 (allowance 1500 does not increase daily deduction)
  const res = calculateEmployeePayroll({
    payrollMonth: '2026-11',
    joiningDate: '2025-01-01',
    employmentStatus: 'active',
    statusEffectiveDate: null,
    settings: defaultSettings,
    salaries: [{ monthlyBaseSalary: 6000, effectiveFrom: '2025-01-01', effectiveTo: null }],
    components: [
      { kind: 'allowance', code: 'TRANS', name: 'Transport', amount: 1500, effectiveFrom: '2025-01-01', effectiveTo: null, isActive: true },
      { kind: 'deduction', code: 'LOAN', name: 'Loan', amount: 300, effectiveFrom: '2025-01-01', effectiveTo: null, isActive: true },
    ],
    dailyRecords: [
      // Confirmed absence
      { workDate: '2026-11-02', scheduleState: 'working', attendanceStatus: 'absent' },
      // Overlapping unpaid leave AND absent status -> counted ONLY once as unpaid leave
      { workDate: '2026-11-03', scheduleState: 'working', attendanceStatus: 'absent', hasApprovedUnpaidLeave: true },
      // Approved paid leave -> no deduction
      { workDate: '2026-11-04', scheduleState: 'working', attendanceStatus: 'absent', hasApprovedPaidLeave: true },
      // Late & early departure -> exceptions only, NO automatic deduction
      { workDate: '2026-11-05', scheduleState: 'working', attendanceStatus: 'late', lateMinutes: 25, earlyLeavingMinutes: 10, hasCheckIn: true, hasCheckOut: true },
      // Incomplete attendance -> exception only
      { workDate: '2026-11-06', scheduleState: 'working', attendanceStatus: 'missing_check_out', missingMinutes: 120, hasCheckIn: true, hasCheckOut: false },
    ],
    manualAdjustments: [
      { direction: 'earning', code: 'BONUS', label: 'Spot Bonus', amount: 250 },
      { direction: 'deduction', code: 'DAMAGE', label: 'Equipment', amount: 50 },
    ],
  });

  assert.equal(res.absentDays, 1);
  assert.equal(res.unpaidLeaveDays, 1);
  assert.equal(res.absenceDeduction, 200);
  assert.equal(res.unpaidLeaveDeduction, 200);
  assert.equal(res.recurringDeductions, 300);
  assert.equal(res.manualAdditions, 250);
  assert.equal(res.manualDeductions, 50);
  assert.equal(res.grossPay, 7750);
  assert.equal(res.totalDeductions, 750);
  assert.equal(res.netPay, 7000);
  assert.equal(res.exceptions.length, 3);
  assert.deepEqual(
    res.exceptions.map(e => e.exceptionType),
    ['late', 'early_departure', 'incomplete_attendance'],
  );
});

test('Zero and negative net pay edge cases are preserved without artificial clamping', () => {
  const zeroNet = calculateEmployeePayroll({
    payrollMonth: '2026-11',
    joiningDate: '2025-01-01',
    employmentStatus: 'active',
    statusEffectiveDate: null,
    settings: defaultSettings,
    salaries: [],
  });
  assert.equal(zeroNet.grossPay, 0);
  assert.equal(zeroNet.netPay, 0);

  const negativeNet = calculateEmployeePayroll({
    payrollMonth: '2026-11',
    joiningDate: '2025-01-01',
    employmentStatus: 'active',
    statusEffectiveDate: null,
    settings: defaultSettings,
    salaries: [{ monthlyBaseSalary: 1000, effectiveFrom: '2025-01-01', effectiveTo: null }],
    manualAdjustments: [{ direction: 'deduction', code: 'ADV', label: 'Advance Recovery', amount: 1500 }],
  });
  assert.equal(negativeNet.grossPay, 1000);
  assert.equal(negativeNet.totalDeductions, 1500);
  assert.equal(negativeNet.netPay, -500);
});

test('Overlapping compensation periods are detected accurately', () => {
  const existing = [
    { id: 'c1', monthlyBaseSalary: 5000, effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' },
    { id: 'c2', monthlyBaseSalary: 6000, effectiveFrom: '2026-07-01', effectiveTo: null },
  ];
  assert.equal(hasOverlappingCompensation({ effectiveFrom: '2026-06-15', effectiveTo: '2026-07-15' }, existing), true);
  assert.equal(hasOverlappingCompensation({ id: 'c1', effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' }, existing), false);
});

test('Finalization blockers reject unresolved exceptions, pending overtime, and unreviewed entries', () => {
  assert.equal(canFinalizePayrollRun([]).allowed, false);
  assert.equal(
    canFinalizePayrollRun([{ unresolved_exception_count: 1, pending_overtime_count: 0, review_status: 'reviewed' }]).allowed,
    false,
  );
  assert.equal(
    canFinalizePayrollRun([{ unresolved_exception_count: 0, pending_overtime_count: 1, review_status: 'reviewed' }]).allowed,
    false,
  );
  assert.equal(
    canFinalizePayrollRun([{ unresolved_exception_count: 0, pending_overtime_count: 0, review_status: 'pending' }]).allowed,
    false,
  );
  assert.equal(
    canFinalizePayrollRun([{ unresolved_exception_count: 0, pending_overtime_count: 0, review_status: 'reviewed' }]).allowed,
    true,
  );
});

test('Role-based access control restricts Payroll view and actions properly', () => {
  assert.equal(canAccessView(['administrator'], 'payroll'), true);
  assert.equal(canAccessView(['manager'], 'payroll'), true);
  assert.equal(canAccessView(['employee'], 'payroll'), false);
  assert.equal(getAllowedViews(['employee']).includes('payroll'), false);

  assert.equal(hasPermission(['administrator'], 'payroll:manage'), true);
  assert.equal(hasPermission(['administrator'], 'payroll:export'), true);
  assert.equal(hasPermission(['manager'], 'payroll:read:scope'), true);
  assert.equal(hasPermission(['manager'], 'payroll:review:scope'), true);
  assert.equal(hasPermission(['manager'], 'payroll:manage'), false);
  assert.equal(hasPermission(['manager'], 'payroll:export'), false);
  assert.equal(hasPermission(['employee'], 'payroll:read:scope'), false);
});

test('CSV export escapes special characters and preserves exact stored totals', () => {
  assert.equal(escapeCsvCell('Ops, "North"'), '"Ops, ""North"""');
  assert.equal(escapeCsvCell(null), '');

  const rows: PayrollExportCsvRow[] = [
    {
      employee_code: 'EMP-01',
      employee_name: 'Ali, "Al-Mansoor"',
      branch_name: 'Riyadh HQ',
      department_name: 'Operations',
      job_title: 'Lead "Courier"',
      base_pay: 6000,
      allowances_pay: 1200,
      overtime_hours: 1.5,
      overtime_pay: 56.25,
      absence_deduction: 200,
      unpaid_leave_deduction: 0,
      other_adjustments: -50,
      gross_pay: 7256.25,
      total_deductions: 250,
      net_pay: 7006.25,
      currency_code: 'SAR',
      review_status: 'reviewed',
    },
  ];
  const csv = buildPayrollCsv(rows);
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^Employee Code,Employee Name,Site,Department/);
  assert.match(lines[1], /"Ali, ""Al-Mansoor"""/);
  assert.match(lines[1], /7006\.25,SAR,reviewed$/);
});

test('Migration, SQL tests, and UI integration wire payroll security and features', () => {
  const migration = readFileSync('../supabase/migrations/20261128140000_payroll_operations_module.sql', 'utf8');
  assert.match(migration, /private\.can_access_employee\(organization_id, employee_id\)/);
  assert.match(migration, /enforce_finalized_payroll_immutability/);
  assert.match(migration, /prevent_overlapping_compensation/);
  assert.match(migration, /payroll_run_reopened/);
  assert.match(migration, /revoke all on function .* from public, anon/);

  const onboardingMigration = readFileSync('../supabase/migrations/20261128125547_create_employee_with_compensation.sql', 'utf8');
  assert.match(onboardingMigration, /create_employee_with_compensation/);
  assert.match(onboardingMigration, /insert into public\.employee_profiles/);
  assert.match(onboardingMigration, /insert into public\.employee_compensations/);
  assert.match(onboardingMigration, /grant execute on function public\.create_employee_with_compensation/);

  const fixedOtMigration = readFileSync('../supabase/migrations/20261128143500_payroll_fixed_ot_rate.sql', 'utf8');
  assert.match(fixedOtMigration, /overtime_rate_mode/);
  assert.match(fixedOtMigration, /fixed_hourly/);
  assert.match(fixedOtMigration, /revoke all on function public\.get_payroll_settings\(uuid\) from public, anon/);
  assert.match(fixedOtMigration, /revoke all on function public\.upsert_payroll_settings/);

  const sqlTests = readFileSync('../supabase/tests/payroll_operations.sql', 'utf8');
  assert.match(sqlTests, /Overlapping compensation period/);
  assert.match(sqlTests, /Cross-organization payroll generation/);
  assert.match(sqlTests, /Finalized payroll entry must be immutable/);
  assert.match(sqlTests, /Employee onboarding must create one linked initial salary/);

  const employeeService = readFileSync('src/services/employee.service.ts', 'utf8');
  assert.match(employeeService, /rpc\('create_employee_with_compensation'/);
  const employeesView = readFileSync('src/views/Employees.tsx', 'utf8');
  assert.match(employeesView, /Monthly base salary \(SAR\)/);

  const sidebar = readFileSync('src/components/Sidebar.tsx', 'utf8');
  assert.match(sidebar, /id:\s*'payroll'/);

  const app = readFileSync('src/App.tsx', 'utf8');
  assert.match(app, /payroll:\s*Payroll/);
});

test('Fixed hourly OT rate pays flat SAR/hr regardless of base salary', () => {
  const res = calculateEmployeePayroll({
    payrollMonth: '2026-11',
    joiningDate: '2026-01-01',
    employmentStatus: 'active',
    statusEffectiveDate: null,
    settings: {
      currencyCode: 'SAR',
      monthBasisDays: 30,
      dailyHours: 8,
      overtimeMultiplier: 1.5,
      overtimeRateMode: 'fixed_hourly',
      overtimeHourlyRate: 12,
    },
    salaries: [{ monthlyBaseSalary: 3000, effectiveFrom: '2026-01-01', effectiveTo: null }],
    overtime: [
      { attendanceDate: '2026-11-10', status: 'approved', approvedMinutes: 150 },
    ],
  });
  assert.equal(res.approvedOvertimeMinutes, 150);
  assert.equal(res.overtimePay, 30); // 2.5 hrs * 12 SAR/hr
  assert.equal(res.grossPay, 3030);
});
