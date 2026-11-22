import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isEmployeeActiveOnDate,
  isEmployeeActiveInMonth,
  isEmployeeActiveInRange,
} from '../src/lib/employee-status.ts';
import type { EmployeeProfileRow } from '../src/types/database.ts';
import type { OffDayCompensationRecord, OffDayCompensationType } from '../src/services/shift.service.ts';

test('Shift Scheduler Inactive Employee Visibility Filter: Nov 18 deactivation example', () => {
  const nov18Emp: EmployeeProfileRow = {
    id: 'emp-nov-18',
    organization_id: 'org-test',
    user_id: null,
    employee_code: 'NOV18',
    iqama_number: '1000000001',
    full_name: 'Tariq Nov18',
    mobile_number: null,
    branch_id: 'b-1',
    department_id: 'd-1',
    job_title: 'Packer',
    manager_user_id: null,
    joining_date: '2026-01-01',
    employment_status: 'inactive',
    status_effective_date: '2026-11-18',
    must_change_password: false,
    login_last_reset_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-11-18T10:00:00Z',
  };

  // 1. In November 2026 (month index 10):
  // They were active from Nov 1 to Nov 18, so they CAN and SHOULD be shown in November!
  const shownInNovember = isEmployeeActiveInMonth(nov18Emp, 2026, 10);
  assert.equal(shownInNovember, true, 'Employee inactive on Nov 18 must be shown in November');

  // 2. In December 2026 (month index 11):
  // Throughout the WHOLE month of December they are inactive (0 active days): DO NOT SHOW!
  const shownInDecember = isEmployeeActiveInMonth(nov18Emp, 2026, 11);
  assert.equal(shownInDecember, false, 'Employee inactive whole month of December must not be shown in December');

  // 3. In October 2026 (month index 9):
  // Active prior to deactivation: can be shown!
  const shownInOctober = isEmployeeActiveInMonth(nov18Emp, 2026, 9);
  assert.equal(shownInOctober, true, 'Employee was active in October and should be shown');

  // 4. On specific dates within November:
  // Active up to and including Nov 18
  assert.equal(isEmployeeActiveOnDate(nov18Emp, '2026-11-01'), true);
  assert.equal(isEmployeeActiveOnDate(nov18Emp, '2026-11-18'), true);
  // Inactive starting Nov 19
  assert.equal(isEmployeeActiveOnDate(nov18Emp, '2026-11-19'), false);
  assert.equal(isEmployeeActiveOnDate(nov18Emp, '2026-11-20'), false);
});

test('Shift Scheduler Inactive Employee Visibility: employee inactive before month started', () => {
  const octInactiveEmp: EmployeeProfileRow = {
    id: 'emp-oct-inactive',
    organization_id: 'org-test',
    user_id: null,
    employee_code: 'OCT15',
    iqama_number: '1000000002',
    full_name: 'Fahad Oct',
    mobile_number: null,
    branch_id: 'b-1',
    department_id: 'd-1',
    job_title: 'Sorter',
    manager_user_id: null,
    joining_date: '2026-02-01',
    employment_status: 'inactive',
    status_effective_date: '2026-10-15',
    must_change_password: false,
    login_last_reset_at: null,
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-10-15T10:00:00Z',
  };

  // In November (month index 10): 0 active days in the whole month -> DO NOT SHOW!
  assert.equal(isEmployeeActiveInMonth(octInactiveEmp, 2026, 10), false);
  // In October: was active Oct 1 to Oct 15 -> CAN BE SHOWN in October!
  assert.equal(isEmployeeActiveInMonth(octInactiveEmp, 2026, 9), true);
});

test('Shift Scheduler Inactive Employee Visibility: employee joining in future month', () => {
  const decJoiningEmp: EmployeeProfileRow = {
    id: 'emp-dec-join',
    organization_id: 'org-test',
    user_id: null,
    employee_code: 'DEC01',
    iqama_number: '1000000003',
    full_name: 'Sami Future',
    mobile_number: null,
    branch_id: 'b-1',
    department_id: 'd-1',
    job_title: 'Driver',
    manager_user_id: null,
    joining_date: '2026-12-01',
    employment_status: 'active',
    status_effective_date: '2026-12-01',
    must_change_password: false,
    login_last_reset_at: null,
    created_at: '2026-11-15T00:00:00Z',
    updated_at: '2026-11-15T00:00:00Z',
  };

  // In November 2026: before joining date, 0 active days -> DO NOT SHOW in November!
  assert.equal(isEmployeeActiveInMonth(decJoiningEmp, 2026, 10), false);
  // In December 2026: active from Dec 1 -> SHOW in December!
  assert.equal(isEmployeeActiveInMonth(decJoiningEmp, 2026, 11), true);
});

test('Off-Day Work Tracking & Compensation Record Structure', () => {
  const offRecord: OffDayCompensationRecord = {
    id: 'emp-1_2026-11-21',
    organization_id: 'org-test',
    employee_id: 'emp-1',
    work_date: '2026-11-21', // Friday (regular weekly off)
    shift_id: 'shift-day',
    shift_name: 'Day Shift',
    compensation_type: 'pending',
    comp_off_date: null,
    notes: null,
    created_at: '2026-11-21T08:00:00Z',
    updated_at: '2026-11-21T08:00:00Z',
  };

  assert.equal(offRecord.compensation_type, 'pending');

  // Transition to Overtime:
  const otRecord: OffDayCompensationRecord = {
    ...offRecord,
    compensation_type: 'overtime',
    notes: 'Kept for Overtime (OT)',
  };
  assert.equal(otRecord.compensation_type, 'overtime');
  assert.equal(otRecord.comp_off_date, null);

  // Transition to Compensatory Leave (Comp-Off):
  const compOffRecord: OffDayCompensationRecord = {
    ...offRecord,
    compensation_type: 'comp_off',
    comp_off_date: '2026-11-25', // Scheduled leave on Tuesday when load is low
    notes: 'Comp-off granted for working Nov 21 off day',
  };
  assert.equal(compOffRecord.compensation_type, 'comp_off');
  assert.equal(compOffRecord.comp_off_date, '2026-11-25');
});
