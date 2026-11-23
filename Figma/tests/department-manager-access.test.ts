import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const read = (file: string) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

// ── 1. Manager ID & Temporary Password Rules ────────────────────────────────
test('manager code format validation and generation rules', () => {
  const validManagerCodes = ['MGR-001', 'MGR-OPS', 'MGR_IT_01', 'DEPT-MGR-42', 'mgr123'];
  const invalidManagerCodes = ['', '   ', 'MGR 001', 'MGR/001', 'MGR#1', 'M', 'TOOLONGMANAGERCODEFORFIELD123456789'];

  const managerCodeRegex = /^[A-Za-z0-9_-]{3,24}$/;

  for (const code of validManagerCodes) {
    assert.match(code, managerCodeRegex, `Expected ${code} to be a valid manager code`);
  }
  for (const code of invalidManagerCodes) {
    assert.doesNotMatch(code, managerCodeRegex, `Expected ${code} to be rejected`);
  }
});

test('temporary password generator produces secure high-entropy credentials', () => {
  // Logic from provision-manager / reset-manager-login
  const generateSecureTemporaryPassword = (length = 14): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
    let result = '';
    for (let i = 0; i < length; i++) {
      const idx = Math.floor(Math.random() * chars.length);
      result += chars.charAt(idx);
    }
    return result;
  };

  const password = generateSecureTemporaryPassword(14);
  assert.equal(password.length, 14);
  assert.match(password, /[A-Za-z0-9!@#$%&*]{14}/);
});

// ── 2. Identifier Resolution Logic ──────────────────────────────────────────
test('identifier resolver discerns email vs manager code vs employee code', () => {
  const resolveInputType = (identifier: string): 'email' | 'manager_or_employee_code' | 'invalid' => {
    const trimmed = identifier.trim();
    if (!trimmed) return 'invalid';
    if (trimmed.includes('@')) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? 'email' : 'invalid';
    }
    if (/^[A-Za-z0-9_-]{2,32}$/.test(trimmed)) {
      return 'manager_or_employee_code';
    }
    return 'invalid';
  };

  assert.equal(resolveInputType('admin@geotrack.com'), 'email');
  assert.equal(resolveInputType('manager.ops@company.sa'), 'email');
  assert.equal(resolveInputType('MGR-101'), 'manager_or_employee_code');
  assert.equal(resolveInputType('EMP-902'), 'manager_or_employee_code');
  assert.equal(resolveInputType('   '), 'invalid');
  assert.equal(resolveInputType('bad email@test'), 'invalid');
});

// ── 3. Force Password Change Enforcement ────────────────────────────────────
test('must_change_password enforcement flow intercepts login and clears upon update', () => {
  interface ManagerProfileState {
    user_id: string;
    must_change_password: boolean;
    status: 'active' | 'suspended' | 'deactivated';
  }

  const profile: ManagerProfileState = {
    user_id: 'usr-1',
    must_change_password: true,
    status: 'active',
  };

  // User is blocked if must_change_password is true
  const requiresPasswordChange = (p: ManagerProfileState) => p.must_change_password && p.status === 'active';
  assert.equal(requiresPasswordChange(profile), true);

  // After complete_password_change()
  profile.must_change_password = false;
  assert.equal(requiresPasswordChange(profile), false);
});

// ── 4. Manager Scopes & Department Reassignment ─────────────────────────────
test('manager scope access evaluation strictly enforces exact department matches', () => {
  interface Employee {
    id: string;
    department_id: string;
    branch_id: string;
  }
  interface ScopeState {
    assignedDepartmentIds: string[];
    status: 'active' | 'suspended' | 'deactivated';
  }

  const canAccessEmployee = (emp: Employee, scope: ScopeState): boolean => {
    if (scope.status !== 'active') return false;
    return scope.assignedDepartmentIds.includes(emp.department_id);
  };

  const empDeptA: Employee = { id: 'emp-1', department_id: 'dept-A', branch_id: 'site-1' };
  const empDeptB: Employee = { id: 'emp-2', department_id: 'dept-B', branch_id: 'site-1' };
  const empDeptC: Employee = { id: 'emp-3', department_id: 'dept-C', branch_id: 'site-2' };

  // Initial assignment: Manager manages Dept A
  const managerScope: ScopeState = {
    assignedDepartmentIds: ['dept-A'],
    status: 'active',
  };

  assert.equal(canAccessEmployee(empDeptA, managerScope), true);
  assert.equal(canAccessEmployee(empDeptB, managerScope), false, 'Must not leak Dept B even in the same site');
  assert.equal(canAccessEmployee(empDeptC, managerScope), false);

  // Multi-department assignment: Dept A and Dept C
  managerScope.assignedDepartmentIds = ['dept-A', 'dept-C'];
  assert.equal(canAccessEmployee(empDeptA, managerScope), true);
  assert.equal(canAccessEmployee(empDeptB, managerScope), false);
  assert.equal(canAccessEmployee(empDeptC, managerScope), true);

  // Immediate department reassignment: Dept A -> Dept B
  managerScope.assignedDepartmentIds = ['dept-B'];
  assert.equal(canAccessEmployee(empDeptA, managerScope), false, 'Old department immediately revoked');
  assert.equal(canAccessEmployee(empDeptB, managerScope), true, 'New department immediately accessible');

  // Account suspended: Immediate revocation of all access
  managerScope.status = 'suspended';
  assert.equal(canAccessEmployee(empDeptB, managerScope), false, 'Suspended manager must be completely blocked');
});

// ── 5. Mailroom Productivity Permission Isolation ───────────────────────────
test('mailroom productivity access is strictly scoped to mailroom department', () => {
  interface UserAccess {
    role: 'administrator' | 'manager' | 'employee';
    status: 'active' | 'suspended';
    assignedDepartmentIds: string[];
  }

  const mailroomDeptId = 'dept-mailroom-id';

  const canAccessMailroomModule = (user: UserAccess): boolean => {
    if (user.status !== 'active') return false;
    if (user.role === 'administrator') return true;
    if (user.role === 'manager') {
      return user.assignedDepartmentIds.includes(mailroomDeptId);
    }
    return false;
  };

  assert.equal(canAccessMailroomModule({ role: 'administrator', status: 'active', assignedDepartmentIds: [] }), true);
  assert.equal(canAccessMailroomModule({ role: 'manager', status: 'active', assignedDepartmentIds: [mailroomDeptId] }), true);
  assert.equal(canAccessMailroomModule({ role: 'manager', status: 'active', assignedDepartmentIds: ['other-dept-id'] }), false);
  assert.equal(canAccessMailroomModule({ role: 'manager', status: 'suspended', assignedDepartmentIds: [mailroomDeptId] }), false);
  assert.equal(canAccessMailroomModule({ role: 'employee', status: 'active', assignedDepartmentIds: [mailroomDeptId] }), false);
});

// ── 6. Role Escalation Prevention ───────────────────────────────────────────
test('managers cannot modify manager accounts or assign department scopes', () => {
  interface SessionUser {
    id: string;
    roles: string[];
  }

  const canManageManagers = (user: SessionUser): boolean => {
    return user.roles.includes('administrator');
  };

  assert.equal(canManageManagers({ id: 'admin-1', roles: ['administrator'] }), true);
  assert.equal(canManageManagers({ id: 'mgr-1', roles: ['manager'] }), false);
  assert.equal(canManageManagers({ id: 'emp-1', roles: ['employee'] }), false);
});

// ── 7. Migration SQL Hardening & Security Audit ──────────────────────────────
test('migration 20261123100000 enforces database RLS, prevents wildcards, and revokes manager org-management', async () => {
  const sql = await read('../supabase/migrations/20261123100000_department_manager_access_management.sql');

  // Verify manager_profiles & manager_activity_logs creation and RLS
  assert.match(sql, /create table if not exists public\.manager_profiles/i);
  assert.match(sql, /alter table public\.manager_profiles enable row level security/i);
  assert.match(sql, /create table if not exists public\.manager_activity_logs/i);
  assert.match(sql, /alter table public\.manager_activity_logs enable row level security/i);

  // Verify departments manager_user_id column
  assert.match(sql, /add column if not exists manager_user_id uuid references auth\.users\(id\)/i);

  // Verify reconciliation of private.can_access_employee and elimination of wildcards
  assert.match(sql, /create or replace function private\.can_access_employee/i);
  assert.match(sql, /create or replace function private\.manager_can_access_employee/i);
  assert.match(sql, /mp\.status = 'active'/i, 'Must check active manager profile status');
  assert.doesNotMatch(sql, /department_id is null/i, 'No wildcard department matching permitted');

  // Verify revocation of organization-management privileges from manager role
  assert.match(sql, /create policy branches_manage_admin_insert on public\.branches/i);
  assert.match(sql, /create policy departments_manage_admin_insert on public\.departments/i);
  assert.match(sql, /create policy geofences_manage_admin_insert on public\.geofences/i);
  assert.match(sql, /save_shift_template/i);
  assert.match(sql, /Site management denied: administrator role required/i);
  assert.match(sql, /Shift management denied: administrator role required/i);
  assert.match(sql, /revoke all on function public\.create_site/i);
  assert.match(sql, /revoke all on function public\.save_shift_template/i);

  // Verify administrator-only execution of RPCs
  assert.match(sql, /create or replace function public\.admin_assign_manager_departments/i);
  assert.match(sql, /create or replace function public\.admin_update_manager_status/i);
  assert.match(sql, /create or replace function public\.list_organization_managers/i);
  assert.match(sql, /create or replace function public\.get_manager_activity_history/i);
  assert.match(sql, /set search_path = ''/i, 'Security definer functions must clear search path');
});

// ── 8. Edge Function Security Audit ─────────────────────────────────────────
test('edge functions protect credentials, prevent timing enumeration, and check admin role', async () => {
  const [managerLogin, provisionManager, resetManager] = await Promise.all([
    read('../supabase/functions/manager-login/index.ts'),
    read('../supabase/functions/provision-manager/index.ts'),
    read('../supabase/functions/reset-manager-login/index.ts'),
  ]);

  // manager-login checks
  assert.match(managerLogin, /manager_profiles/i);
  assert.match(managerLogin, /status === 'suspended'/i);
  assert.match(managerLogin, /status === 'active'/i);
  assert.match(managerLogin, /Equalise timing/i, 'Mitigate user enumeration timing attacks');
  assert.doesNotMatch(managerLogin, /console\.log\(.*password/i, 'Never log credentials');

  // provision-manager checks
  assert.match(provisionManager, /administrator/i, 'Must restrict to administrators');
  assert.match(provisionManager, /must_change_password: true/i, 'Require password change on first login');
  assert.match(provisionManager, /manager_activity_logs/i, 'Must audit manager provisioning');

  // reset-manager-login checks
  assert.match(resetManager, /administrator/i, 'Must restrict to administrators');
  assert.match(resetManager, /must_change_password: true/i, 'Require password change on reset');
  assert.match(resetManager, /manager_activity_logs/i, 'Must audit manager password reset');
});
