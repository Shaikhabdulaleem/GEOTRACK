import assert from 'node:assert/strict';
import test from 'node:test';
import { isEmployeeActiveOnDate } from '../src/lib/employee-status.ts';
import type { EmployeeProfileRow } from '../src/types/database.ts';

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
