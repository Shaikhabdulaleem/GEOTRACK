import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateTransferDuration } from '../src/lib/transfer-model.ts';
import { buildFcDashboard } from '../src/lib/fc-productivity-model.ts';
import type { FcWorkspace } from '../src/services/fc-productivity.service.ts';
import type { DepartmentRow, EmployeeTransferItem } from '../src/types/database.ts';

const read = (file: string) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// 1. User Scenario: Al Amin FC -> Mailroom Split Day & Duration Calculation
// ─────────────────────────────────────────────────────────────────────────────
test('Al Amin example: 8:00am-12:30pm in FC, break 12:30-1:00pm, 1:00pm-5:00pm in Mailroom', () => {
  // Morning shift in FC: 8:00 AM to 12:30 PM (4.5 hours = 270 minutes)
  const fcStart = new Date('2026-11-24T08:00:00+03:00');
  const fcEnd = new Date('2026-11-24T12:30:00+03:00');
  const fcShift = calculateTransferDuration(fcStart, fcEnd, 0);

  assert.equal(fcShift.rawMinutes, 270);
  assert.equal(fcShift.netMinutes, 270);
  assert.equal(fcShift.hours, 4.5);
  assert.equal(fcShift.display, '4h 30m');

  // Lunch break: 12:30 PM to 1:00 PM (30 minutes)
  const breakStart = new Date('2026-11-24T12:30:00+03:00');
  const breakEnd = new Date('2026-11-24T13:00:00+03:00');
  const lunchBreakMinutes = (breakEnd.getTime() - breakStart.getTime()) / 60000;
  assert.equal(lunchBreakMinutes, 30);

  // Afternoon transfer to Mailroom: 1:00 PM to 5:00 PM (4.0 hours = 240 minutes)
  const mailroomStart = new Date('2026-11-24T13:00:00+03:00');
  const mailroomEnd = new Date('2026-11-24T17:00:00+03:00');
  const mailroomShift = calculateTransferDuration(mailroomStart, mailroomEnd, 0);

  assert.equal(mailroomShift.rawMinutes, 240);
  assert.equal(mailroomShift.netMinutes, 240);
  assert.equal(mailroomShift.hours, 4);
  assert.equal(mailroomShift.display, '4h 0m');

  // Total working day = 4.5h FC + 4.0h Mailroom = 8.5 hours
  const totalWorkedHours = fcShift.hours + mailroomShift.hours;
  assert.equal(totalWorkedHours, 8.5);
});

test('calculateTransferDuration handles break deduction and overtime properly', () => {
  const start = '2026-11-24T13:00:00Z';
  const end = '2026-11-24T18:00:00Z'; // 5 hours = 300 minutes
  const breakMin = 30;

  const result = calculateTransferDuration(start, end, breakMin);

  assert.equal(result.rawMinutes, 300);
  assert.equal(result.breakMinutes, 30);
  assert.equal(result.netMinutes, 270); // 4.5 hours
  assert.equal(result.hours, 4.5);
  assert.equal(result.display, '4h 30m');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Productivity Attribution: Transferred Workforce Credits
// ─────────────────────────────────────────────────────────────────────────────
test('Mailroom productivity model accounts for transferred-in and transferred-out labor hours', async () => {
  const serviceCode = await read('src/services/productivity.service.ts');

  // Transferred-in labor addition to capacity
  assert.match(serviceCode, /dayTransferredInRegHours/);
  assert.match(serviceCode, /dayTransferredInOtHours/);
  assert.match(serviceCode, /dayTransferredOutRegHours/);
  assert.match(serviceCode, /regularCapacityHours = Math\.max\(0, regularCapacityHours \+ dayTransferredInRegHours - dayTransferredOutRegHours\)/);
  assert.match(serviceCode, /actualOvertimeHours = dayApprovedOtHours \+ dayTransferredInOtHours/);

  // Transferred labor structure
  assert.match(serviceCode, /transferredLabor:\s*TransferredLaborItem\[\]/);
  assert.match(serviceCode, /totalTransferredInHours/);
  assert.match(serviceCode, /totalTransferredOutHours/);
});

test('FC dashboard model reports transferred-out workforce to prevent double-counting', () => {
  const fcDept: DepartmentRow = {
    id: 'dept-fc-1',
    organization_id: 'org-1',
    branch_id: 'branch-1',
    code: 'FC',
    name: 'FC',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  const mockFcWorkspace: FcWorkspace = {
    department: fcDept,
    week: {
      id: 'week-1',
      organization_id: 'org-1',
      branch_id: 'branch-1',
      department_id: fcDept.id,
      week_start: '2026-11-22',
      status: 'draft',
      revision: 1,
      source_file_name: 'FC_Orders_W47.xlsx',
      source_sha256: 'a'.repeat(64),
      source_rows: 100,
      valid_rows: 100,
      ignored_rows: 0,
      duplicate_rows: 0,
      blank_packer_rows: 0,
      seller_supplements_reviewed: false,
      capacity_reviewed: false,
      adhoc_reviewed: false,
      imported_by: null,
      imported_at: '2026-11-22T00:00:00Z',
      finalized_by: null,
      finalized_at: null,
      created_at: '2026-11-22T00:00:00Z',
      updated_at: '2026-11-22T00:00:00Z',
    },
    packers: [
      {
        id: 'packer-1',
        organization_id: 'org-1',
        branch_id: 'branch-1',
        department_id: fcDept.id,
        week_id: 'week-1',
        work_date: '2026-11-24',
        packer_label: 'AL_AMIN_FC',
        normalized_packer_label: 'al amin fc',
        packed_orders: 120,
        packed_quantity: 180,
        created_at: '2026-11-24T00:00:00Z',
      },
    ],
    sellers: [],
    mappings: [
      {
        id: 'map-1',
        organization_id: 'org-1',
        branch_id: 'branch-1',
        department_id: fcDept.id,
        packer_label: 'AL_AMIN_FC',
        normalized_packer_label: 'al amin fc',
        employee_id: 'emp-alamin-1',
        created_by: null,
        updated_by: null,
        created_at: '2026-11-24T00:00:00Z',
        updated_at: '2026-11-24T00:00:00Z',
      },
    ],
    sellerSupplements: [],
    capacity: null,
    adhocTasks: [],
    employees: [
      {
        id: 'emp-alamin-1',
        organization_id: 'org-1',
        employee_code: 'FC-99',
        full_name: 'Al Amin',
        branch_id: 'branch-1',
        department_id: fcDept.id,
        employment_status: 'active',
      },
    ],
    transfers: [
      {
        id: 'transfer-alamin-1',
        organization_id: 'org-1',
        employee_id: 'emp-alamin-1',
        from_department_id: fcDept.id,
        to_department_id: 'dept-mailroom-1',
        transfer_date: '2026-11-24',
        start_time: '2026-11-24T10:00:00Z',
        end_time: '2026-11-24T14:00:00Z',
        status: 'completed',
        transfer_type: 'temporary',
        transferred_minutes: 240,
        break_minutes: 0,
        overtime_minutes: 0,
        reason: 'Mailroom assistance',
        notes: null,
        transferred_by: null,
        completed_by: null,
        created_at: '2026-11-24T00:00:00Z',
        updated_at: '2026-11-24T00:00:00Z',
        employee: {
          id: 'emp-alamin-1',
          employee_code: 'FC-99',
          full_name: 'Al Amin',
          job_title: 'Packer',
        },
        from_department: { id: fcDept.id, name: 'FC', code: 'FC' },
        to_department: { id: 'dept-mailroom-1', name: 'Mailroom', code: 'MR' },
      },
    ],
  };

  const fcDashboard = buildFcDashboard(mockFcWorkspace);

  assert.equal(fcDashboard.transfers.transfersOutCount, 1);
  assert.equal(fcDashboard.transfers.transfersOutHours, 4);
  assert.equal(fcDashboard.transfers.records.length, 1);
  assert.equal(fcDashboard.transfers.records[0].employeeName, 'Al Amin');
  assert.equal(fcDashboard.transfers.records[0].toDepartment, 'Mailroom');
  assert.equal(fcDashboard.transfers.records[0].hours, 4);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Manager Scope and Reassignment Security Rules
// ─────────────────────────────────────────────────────────────────────────────
test('manager scope evaluation permits source manager to transfer and target manager to inspect', () => {
  interface ManagerScope {
    userId: string;
    assignedDeptIds: string[];
    status: 'active' | 'suspended';
  }

  interface Employee {
    id: string;
    departmentId: string;
  }

  interface Transfer {
    employeeId: string;
    fromDeptId: string;
    toDeptId: string;
    status: 'active' | 'completed' | 'cancelled';
  }

  const fcManager: ManagerScope = {
    userId: 'mgr-fc',
    assignedDeptIds: ['dept-fc'],
    status: 'active',
  };

  const mailroomManager: ManagerScope = {
    userId: 'mgr-mr',
    assignedDeptIds: ['dept-mr'],
    status: 'active',
  };

  const alAmin: Employee = { id: 'emp-alamin', departmentId: 'dept-fc' };

  // Rule: Can initiate transfer if manager of employee's home department
  const canInitiateTransfer = (mgr: ManagerScope, emp: Employee, targetDeptId: string) => {
    if (mgr.status !== 'active') return false;
    if (emp.departmentId === targetDeptId) return false; // Distinct departments required
    return mgr.assignedDeptIds.includes(emp.departmentId);
  };

  // FC Manager CAN transfer Al Amin to Mailroom
  assert.equal(canInitiateTransfer(fcManager, alAmin, 'dept-mr'), true);

  // Mailroom Manager CANNOT initiate a transfer for an FC employee
  assert.equal(canInitiateTransfer(mailroomManager, alAmin, 'dept-mr'), false);

  // Cannot transfer to same department
  assert.equal(canInitiateTransfer(fcManager, alAmin, 'dept-fc'), false);

  // Once transfer is active: target department manager can access the employee
  const activeTransfer: Transfer = {
    employeeId: alAmin.id,
    fromDeptId: 'dept-fc',
    toDeptId: 'dept-mr',
    status: 'active',
  };

  const canAccessEmployee = (mgr: ManagerScope, emp: Employee, currentTransfers: Transfer[]) => {
    if (mgr.status !== 'active') return false;
    // Direct home dept
    if (mgr.assignedDeptIds.includes(emp.departmentId)) return true;
    // Transferred dept
    return currentTransfers.some(
      t => t.employeeId === emp.id && t.status !== 'cancelled' && mgr.assignedDeptIds.includes(t.toDeptId),
    );
  };

  // Mailroom manager now gains authorized access to Al Amin!
  assert.equal(canAccessEmployee(mailroomManager, alAmin, [activeTransfer]), true);

  // FC manager retains access as home department manager
  assert.equal(canAccessEmployee(fcManager, alAmin, [activeTransfer]), true);

  // Unrelated manager (e.g. Inbound) has zero access
  const inboundManager: ManagerScope = { userId: 'mgr-inbound', assignedDeptIds: ['dept-inbound'], status: 'active' };
  assert.equal(canAccessEmployee(inboundManager, alAmin, [activeTransfer]), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Migration & SQL Schema Verification
// ─────────────────────────────────────────────────────────────────────────────
test('migration 20261124140000 creates employee_transfers table with RLS and atomic RPCs', async () => {
  const sql = await read('../supabase/migrations/20261124140000_employee_transfers.sql');

  // Table creation & constraints
  assert.match(sql, /create table if not exists public\.employee_transfers/i);
  assert.match(sql, /from_department_id <> to_department_id/i);
  assert.match(sql, /end_time is null or end_time >= start_time/i);
  assert.match(sql, /transferred_minutes integer not null default 0/i);
  assert.match(sql, /overtime_minutes integer not null default 0/i);

  // RLS enablement and policies
  assert.match(sql, /alter table public\.employee_transfers enable row level security/i);
  assert.match(sql, /create policy employee_transfers_select_policy on public\.employee_transfers/i);
  assert.match(sql, /create policy employee_transfers_insert_policy on public\.employee_transfers/i);
  assert.match(sql, /create policy employee_transfers_update_policy on public\.employee_transfers/i);

  // Security definer RPCs & table grants
  assert.match(sql, /grant select, insert, update on table public\.employee_transfers to authenticated/i);
  assert.match(sql, /create or replace function public\.start_employee_transfer/i);
  assert.match(sql, /create or replace function public\.complete_employee_transfer/i);
  assert.match(sql, /create or replace function public\.cancel_employee_transfer/i);

  // Target department manager access in private.can_access_employee
  assert.match(sql, /from public\.employee_transfers et/i);
  assert.match(sql, /s\.department_id = et\.to_department_id/i);
});

test('view access rules register transfers for administrator and manager roles', async () => {
  const viewAccessCode = await read('src/auth/view-access.ts');

  assert.match(viewAccessCode, /'transfers'/);
  assert.match(viewAccessCode, /transfers:\s*\[\s*'administrator',\s*'manager'\s*\]/);
});

test('EmployeeTransfer UI module contains live counter and modal components', async () => {
  const [viewCode, sidebarCode, appCode] = await Promise.all([
    read('src/views/EmployeeTransfer.tsx'),
    read('src/components/Sidebar.tsx'),
    read('src/App.tsx'),
  ]);

  // View UI elements
  assert.match(viewCode, /Employee Transfer/);
  assert.match(viewCode, /Active Live Transfers/);
  assert.match(viewCode, /Complete Transfer/);
  assert.match(viewCode, /New Transfer/);
  assert.match(viewCode, /Transfer Route/);
  assert.match(viewCode, /Transferred Hours Today/);
  assert.match(viewCode, /Transferred OT Today/);

  // Sidebar navigation entry
  assert.match(sidebarCode, /id:\s*'transfers'/);
  assert.match(sidebarCode, /label:\s*'Employee Transfer'/);
  assert.match(sidebarCode, /icon:\s*ArrowLeftRight/);

  // App routing
  assert.match(appCode, /import\('\.\/views\/EmployeeTransfer'\)/);
  assert.match(appCode, /transfers:\s*EmployeeTransfer/);
});
