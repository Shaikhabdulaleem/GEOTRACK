import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  formatScheduleStateLabel,
  isScheduleOffDay,
  resolveCorrectionDayStatus,
} from '../src/lib/employee-status.ts';
import type {
  AttendanceRecordRow,
  ResolvedScheduleRow,
  ShiftAssignmentRow,
  ShiftRow,
} from '../src/types/database.ts';

const baseAttendance: AttendanceRecordRow = {
  id: 'att-1',
  organization_id: 'org-1',
  employee_id: 'emp-1',
  shift_assignment_id: null,
  attendance_date: '2026-11-29', // Sunday
  session_number: 1,
  check_in_event_id: null,
  check_out_event_id: null,
  check_in_at: null,
  check_out_at: null,
  source: 'automatic_geofence',
  status: 'absent',
  late_minutes: 0,
  early_leaving_minutes: 0,
  worked_minutes: 0,
  missing_minutes: 0,
  overtime_minutes: 0,
  geofence_validated: false,
  approval_status: 'not_required',
  approved_by: null,
  approved_at: null,
  notes: null,
  created_at: '2026-11-29T00:00:00Z',
  updated_at: '2026-11-29T00:00:00Z',
};

const sundayOffSchedule: ResolvedScheduleRow = {
  work_date: '2026-11-29',
  state: 'off',
  source: 'recurring',
  shift_assignment_id: null,
  recurring_schedule_id: 'rec-1',
  shift_id: null,
  shift_name: null,
  start_time: null,
  end_time: null,
  break_minutes: 0,
  crosses_midnight: false,
  reason: null,
};

test('Sunday recurring off-day without attendance record resolves to Employee Week Off', () => {
  const result = resolveCorrectionDayStatus({
    workDate: '2026-11-29', // Sunday
    rec: null,
    resolvedSchedule: sundayOffSchedule,
    assignment: null,
    offWeekdays: [0],
  });

  assert.equal(result.status, 'off');
  assert.equal(result.statusLabel, 'Employee Week Off');
  assert.equal(result.shiftName, 'Employee Week Off');
});

test('Sunday off-day via offWeekdays fallback (without resolvedSchedule) resolves to Employee Week Off', () => {
  const result = resolveCorrectionDayStatus({
    workDate: '2026-11-29', // Sunday (UTC day 0)
    rec: null,
    resolvedSchedule: null,
    assignment: null,
    offWeekdays: [0],
  });

  assert.equal(result.status, 'off');
  assert.equal(result.statusLabel, 'Employee Week Off');
});

test('Dated shift_assignments off override resolves to Employee Week Off', () => {
  const offAssignment: ShiftAssignmentRow & { shift: ShiftRow | null } = {
    id: 'sa-1',
    organization_id: 'org-1',
    employee_id: 'emp-1',
    shift_id: null,
    work_date: '2026-11-29',
    status: 'off',
    notes: null,
    created_by: null,
    created_at: '2026-11-29T00:00:00Z',
    updated_at: '2026-11-29T00:00:00Z',
    shift: null,
  };

  assert.equal(isScheduleOffDay('2026-11-29', null, offAssignment, null), true);
  const result = resolveCorrectionDayStatus({
    workDate: '2026-11-29',
    rec: null,
    resolvedSchedule: null,
    assignment: offAssignment,
    offWeekdays: null,
  });

  assert.equal(result.status, 'off');
  assert.equal(result.statusLabel, 'Employee Week Off');
});

test('Absent attendance record on an off-day still resolves to Employee Week Off', () => {
  const result = resolveCorrectionDayStatus({
    workDate: '2026-11-29',
    rec: baseAttendance,
    resolvedSchedule: sundayOffSchedule,
    assignment: null,
    offWeekdays: [0],
  });

  assert.equal(result.status, 'off');
  assert.equal(result.statusLabel, 'Employee Week Off');
});

test('Working on an off-day preserves present / corrected status', () => {
  const workedRec: AttendanceRecordRow = {
    ...baseAttendance,
    check_in_at: '2026-11-29T09:00:00Z',
    check_out_at: '2026-11-29T17:00:00Z',
    status: 'present',
    worked_minutes: 480,
  };

  const result = resolveCorrectionDayStatus({
    workDate: '2026-11-29',
    rec: workedRec,
    resolvedSchedule: sundayOffSchedule,
    assignment: null,
    offWeekdays: [0],
  });

  assert.equal(result.status, 'present');
  assert.equal(result.statusLabel, 'Correctly Marked');
});

test('Working day without attendance record resolves to Missed / Absent', () => {
  const workingSchedule: ResolvedScheduleRow = {
    ...sundayOffSchedule,
    work_date: '2026-11-30',
    state: 'working',
    shift_id: 'shift-day',
    shift_name: 'Day Shift',
    start_time: '09:00:00',
    end_time: '17:00:00',
  };

  const result = resolveCorrectionDayStatus({
    workDate: '2026-11-30',
    rec: null,
    resolvedSchedule: workingSchedule,
    assignment: null,
    offWeekdays: [0],
  });

  assert.equal(result.status, 'missed');
  assert.equal(result.statusLabel, 'Missed / Absent');
  assert.equal(result.shiftName, 'Day Shift');
  assert.equal(result.shiftStart, '09:00:00');
  assert.equal(result.shiftEnd, '17:00:00');
});

test('Overtime schedule_state formatting and UI off-day rendering', () => {
  assert.equal(formatScheduleStateLabel('off'), 'Employee Week Off');
  assert.equal(formatScheduleStateLabel('leave'), 'On Leave');
  assert.equal(formatScheduleStateLabel('holiday'), 'Holiday');

  const overtimeSource = readFileSync(new URL('../src/views/Overtime.tsx', import.meta.url), 'utf8');
  assert.equal(overtimeSource.includes('Employee Week Off'), true);
  assert.equal(overtimeSource.includes('formatScheduleStateLabel'), true);

  const correctionsSource = readFileSync(
    new URL('../src/views/AttendanceCorrections.tsx', import.meta.url),
    'utf8',
  );
  assert.equal(correctionsSource.includes("row.status === 'off'"), true);
  assert.equal(correctionsSource.includes('resolveSchedule'), true);
});
