import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isEmployeeActiveOnDate,
  isEmployeeActiveInMonth,
  isEmployeeActiveInRange,
  getApprovedOvertimeMinutes,
  getEffectiveApprovedOvertimeMinutes,
} from '../src/lib/employee-status.ts';
import type { AttendanceRecordRow, EmployeeProfileRow, OvertimeRecordRow } from '../src/types/database.ts';

test('isEmployeeActiveOnDate handles inactive employee with effective date 18 Nov', () => {
  const inactiveEmp: EmployeeProfileRow = {
    id: 'emp-inactive-1',
    organization_id: 'org-1',
    user_id: null,
    employee_code: 'EMP001',
    iqama_number: '1234567890',
    full_name: 'Ahmed Inactive',
    mobile_number: null,
    branch_id: 'b-1',
    department_id: 'dept-1',
    job_title: 'Sorter',
    manager_user_id: null,
    joining_date: '2026-01-01',
    employment_status: 'inactive',
    status_effective_date: '2026-11-18',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-11-18T12:00:00Z',
  };

  // Before joining: not active
  assert.equal(isEmployeeActiveOnDate(inactiveEmp, '2025-12-31'), false);

  // Before 18 Nov: active!
  assert.equal(isEmployeeActiveOnDate(inactiveEmp, '2026-11-16'), true);
  assert.equal(isEmployeeActiveOnDate(inactiveEmp, '2026-11-17'), true);

  // On 18 Nov (effective date): active on their last day
  assert.equal(isEmployeeActiveOnDate(inactiveEmp, '2026-11-18'), true);

  // After 18 Nov: inactive! Should NOT be active in productivity
  assert.equal(isEmployeeActiveOnDate(inactiveEmp, '2026-11-19'), false);
  assert.equal(isEmployeeActiveOnDate(inactiveEmp, '2026-11-20'), false);

  // Month check: In November (month 10), they were active Nov 1-18, so they can be shown in November!
  assert.equal(isEmployeeActiveInMonth(inactiveEmp, 2026, 10), true);

  // In December (month 11), they are inactive for the WHOLE month (not active on any day): do not show!
  assert.equal(isEmployeeActiveInMonth(inactiveEmp, 2026, 11), false);

  // In October (month 9), they were active: can be shown!
  assert.equal(isEmployeeActiveInMonth(inactiveEmp, 2026, 9), true);
});

test('isEmployeeActiveOnDate handles active employees correctly', () => {
  const activeEmp: EmployeeProfileRow = {
    id: 'emp-active-1',
    organization_id: 'org-1',
    user_id: null,
    employee_code: 'EMP002',
    iqama_number: '1234567891',
    full_name: 'Ali Active',
    mobile_number: null,
    branch_id: 'b-1',
    department_id: 'dept-1',
    job_title: 'Sorter',
    manager_user_id: null,
    joining_date: '2026-01-01',
    employment_status: 'active',
    status_effective_date: '2026-01-01',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  assert.equal(isEmployeeActiveOnDate(activeEmp, '2025-12-31'), false);
  assert.equal(isEmployeeActiveOnDate(activeEmp, '2026-11-17'), true);
  assert.equal(isEmployeeActiveOnDate(activeEmp, '2026-11-18'), true);
  assert.equal(isEmployeeActiveOnDate(activeEmp, '2026-11-19'), true);
  assert.equal(isEmployeeActiveOnDate(activeEmp, '2026-11-20'), true);
});

test('inactive employee without valid effective date is not active after joining', () => {
  const inactiveWithoutDate: EmployeeProfileRow = {
    id: 'emp-inactive-legacy',
    organization_id: 'org-1',
    user_id: null,
    employee_code: 'EMP003',
    iqama_number: '1234567892',
    full_name: 'Legacy Inactive',
    mobile_number: null,
    branch_id: 'b-1',
    department_id: 'dept-1',
    job_title: 'Sorter',
    manager_user_id: null,
    joining_date: '2026-01-01',
    employment_status: 'inactive',
    status_effective_date: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  // Without a known effective date, inactive employee is not active today
  assert.equal(isEmployeeActiveOnDate(inactiveWithoutDate, '2026-11-20'), false);
});

test('TEST2 employee made inactive from 1 Sept is NOT active on 19 Nov', () => {
  const test2Emp: EmployeeProfileRow = {
    id: 'emp-test2',
    organization_id: 'org-1',
    user_id: null,
    employee_code: 'TL001',
    iqama_number: '2098418052',
    full_name: 'TEST2',
    mobile_number: null,
    branch_id: 'b-1',
    department_id: 'dept-mailroom',
    job_title: 'LABOUR',
    manager_user_id: null,
    joining_date: '2026-09-01',
    employment_status: 'inactive',
    status_effective_date: '2026-09-01',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T12:00:00Z',
  };

  // On 19 Nov (more than 2 months after 1 Sept), TEST2 is inactive
  assert.equal(isEmployeeActiveOnDate(test2Emp, '2026-11-19'), false);
  assert.equal(isEmployeeActiveOnDate(test2Emp, '2026-11-20'), false);
});

test('rejected overtime has zero effective approved minutes and status rejected', () => {
  const attendanceRecord: AttendanceRecordRow = {
    id: 'att-arif-1',
    organization_id: 'org-1',
    employee_id: 'emp-arif',
    shift_assignment_id: 'shift-1',
    attendance_date: '2026-11-19',
    session_number: 1,
    check_in_event_id: null,
    check_out_event_id: null,
    check_in_at: '2026-11-19T09:00:00Z',
    check_out_at: '2026-11-19T17:29:00Z',
    source: 'biometric',
    status: 'present',
    late_minutes: 0,
    early_leaving_minutes: 0,
    worked_minutes: 479,
    missing_minutes: 1,
    overtime_minutes: 30,
    geofence_validated: true,
    approval_status: 'pending',
    approved_by: null,
    approved_at: null,
    notes: null,
    created_at: '2026-11-19T17:30:00Z',
    updated_at: '2026-11-19T17:30:00Z',
  };

  const rejectedOtRecord: OvertimeRecordRow = {
    id: 'ot-arif-1',
    organization_id: 'org-1',
    employee_id: 'emp-arif',
    attendance_record_id: 'att-arif-1',
    requested_minutes: 30,
    approved_minutes: 0,
    status: 'rejected',
    reason: 'Shift extension',
    requested_by: 'emp-arif',
    approved_by: 'user-manager',
    requested_at: '2026-11-19T17:30:00Z',
    approved_at: '2026-11-20T10:00:00Z',
    review_note: 'Unnecessary overtime',
    created_at: '2026-11-19T17:30:00Z',
    updated_at: '2026-11-20T10:00:00Z',
  };

  const rawResult = getApprovedOvertimeMinutes(
    'emp-arif',
    '2026-11-19',
    [attendanceRecord],
    [rejectedOtRecord]
  );

  assert.equal(rawResult.status, 'rejected');
  assert.equal(rawResult.approvedMinutes, 0);
  assert.equal(rawResult.requestedMinutes, 30);

  const effectiveResult = getEffectiveApprovedOvertimeMinutes(
    'emp-arif',
    '2026-11-19',
    [attendanceRecord],
    [rejectedOtRecord]
  );

  // Effective approved minutes MUST be 0 when rejected - NEVER fall back to requested 30m!
  assert.equal(effectiveResult.status, 'rejected');
  assert.equal(effectiveResult.effectiveMinutes, 0);
  assert.equal(effectiveResult.approvedMinutes, 0);
});

test('approved overtime uses approved minutes', () => {
  const attendanceRecord: AttendanceRecordRow = {
    id: 'att-alal-1',
    organization_id: 'org-1',
    employee_id: 'emp-alal',
    shift_assignment_id: 'shift-1',
    attendance_date: '2026-11-19',
    session_number: 1,
    check_in_event_id: null,
    check_out_event_id: null,
    check_in_at: '2026-11-19T09:00:00Z',
    check_out_at: '2026-11-19T19:12:00Z',
    source: 'biometric',
    status: 'present',
    late_minutes: 0,
    early_leaving_minutes: 0,
    worked_minutes: 612,
    missing_minutes: 0,
    overtime_minutes: 132,
    geofence_validated: true,
    approval_status: 'approved',
    approved_by: 'user-manager',
    approved_at: '2026-11-20T10:00:00Z',
    notes: null,
    created_at: '2026-11-19T19:15:00Z',
    updated_at: '2026-11-20T10:00:00Z',
  };

  const approvedOtRecord: OvertimeRecordRow = {
    id: 'ot-alal-1',
    organization_id: 'org-1',
    employee_id: 'emp-alal',
    attendance_record_id: 'att-alal-1',
    requested_minutes: 132,
    approved_minutes: 132,
    status: 'approved',
    reason: 'Backlog sorting',
    requested_by: 'emp-alal',
    approved_by: 'user-manager',
    requested_at: '2026-11-19T19:15:00Z',
    approved_at: '2026-11-20T10:00:00Z',
    review_note: 'Approved',
    created_at: '2026-11-19T19:15:00Z',
    updated_at: '2026-11-20T10:00:00Z',
  };

  const effectiveResult = getEffectiveApprovedOvertimeMinutes(
    'emp-alal',
    '2026-11-19',
    [attendanceRecord],
    [approvedOtRecord]
  );

  assert.equal(effectiveResult.status, 'approved');
  assert.equal(effectiveResult.effectiveMinutes, 132);
  assert.equal(effectiveResult.approvedMinutes, 132);
});
