import { getSupabaseClient } from '../lib/supabase';
import { executeQuery } from './database.service';
import { AppError } from '../lib/errors';
import type { BranchRow, DepartmentRow, EmployeeProfileRow, EmploymentStatus, RecurringScheduleRow, RecurringScheduleRuleRow, ShiftAssignmentRow, ShiftRow, TablesInsert, TablesUpdate, UserRow } from '../types/database';
import { todayInTimezone } from '../lib/dates';

export interface EmployeeListQuery {
  organizationId: string;
  search?: string;
  branchId?: string;
  departmentId?: string;
  managerUserId?: string;
  status?: EmploymentStatus;
  sortBy?: 'full_name' | 'employee_code' | 'created_at' | 'employment_status';
  sortAscending?: boolean;
  page?: number;
  pageSize?: number;
}

export interface EmployeeListResult { rows: EmployeeProfileRow[]; count: number; }
export interface EmployeeLookups { branches: BranchRow[]; departments: DepartmentRow[]; shifts: ShiftRow[]; managers: UserRow[]; }
export interface ShiftAssignmentInput { organization_id: string; employee_id: string; shift_id: string; work_date?: string; }
export interface EmployeeRecurringSchedule { schedule: RecurringScheduleRow; rules: RecurringScheduleRuleRow[]; }
export interface EmployeeCreateInput {
  organization_id: string;
  employee_code: string;
  iqama_number: string;
  full_name: string;
  mobile_number?: string | null;
  branch_id: string;
  department_id: string;
  job_title?: string | null;
  manager_user_id?: string | null;
  joining_date?: string | null;
  employment_status?: EmploymentStatus;
  status_effective_date?: string | null;
  monthly_base_salary?: number;
}

export const employeeService = {
  async list(input: EmployeeListQuery): Promise<EmployeeListResult> {
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
    let query = getSupabaseClient()
      .from('employee_profiles')
      .select('*', { count: 'exact' })
      .eq('organization_id', input.organizationId);
    if (input.search?.trim()) {
      const search = input.search.trim().replace(/[%_,]/g, '');
      query = query.or(`full_name.ilike.%${search}%,employee_code.ilike.%${search}%,iqama_number.ilike.%${search}%`);
    }
    if (input.branchId) query = query.eq('branch_id', input.branchId);
    if (input.departmentId) query = query.eq('department_id', input.departmentId);
    if (input.managerUserId) query = query.eq('manager_user_id', input.managerUserId);
    if (input.status) query = query.eq('employment_status', input.status);
    const from = (page - 1) * pageSize;
    const result = await query.order(input.sortBy ?? 'full_name', { ascending: input.sortAscending ?? true }).range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    const rows = (result.data ?? []) as EmployeeProfileRow[];
    if (typeof window !== 'undefined') {
      rows.forEach(r => {
        if (!r.status_effective_date) {
          const stored = localStorage.getItem(`emp_status_date_${r.id}`);
          if (stored) {
            r.status_effective_date = stored;
          } else if (r.employment_status === 'active') {
            r.status_effective_date = r.joining_date || r.created_at?.slice(0, 10) || null;
          }
        }
      });
    }
    return { rows, count: result.count ?? 0 };
  },

  /** Fetches every matching row in bounded pages. Callers that aggregate
   * workforce data must use this instead of requesting an oversized page,
   * which PostgREST caps silently. */
  async listAll(input: Omit<EmployeeListQuery, 'page' | 'pageSize'> & { pageSize?: number }): Promise<EmployeeProfileRow[]> {
    const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 100));
    const rows: EmployeeProfileRow[] = [];
    let page = 1;
    while (true) {
      const result = await this.list({ ...input, page, pageSize });
      rows.push(...result.rows);
      if (rows.length >= result.count || result.rows.length === 0) return rows;
      page += 1;
    }
  },

  async getById(employeeId: string): Promise<EmployeeProfileRow> {
    const row = await executeQuery<EmployeeProfileRow>(
      getSupabaseClient().from('employee_profiles').select('*').eq('id', employeeId).single(),
      'Unable to load the employee.',
    );
    if (typeof window !== 'undefined' && !row.status_effective_date) {
      const stored = localStorage.getItem(`emp_status_date_${row.id}`);
      if (stored) {
        row.status_effective_date = stored;
      } else if (row.employment_status === 'active') {
        row.status_effective_date = row.joining_date || row.created_at?.slice(0, 10) || null;
      }
    }
    return row;
  },

  async create(input: EmployeeCreateInput): Promise<EmployeeProfileRow> {
    const normalized = validateEmployeeInput(input);
    const row = await executeQuery<EmployeeProfileRow>(
      getSupabaseClient().rpc('create_employee_with_compensation', {
        p_organization_id: normalized.organization_id,
        p_employee_code: normalized.employee_code,
        p_iqama_number: normalized.iqama_number,
        p_full_name: normalized.full_name,
        p_mobile_number: normalized.mobile_number ?? null,
        p_branch_id: normalized.branch_id,
        p_department_id: normalized.department_id,
        p_job_title: normalized.job_title ?? null,
        p_manager_user_id: normalized.manager_user_id ?? null,
        p_joining_date: normalized.joining_date!,
        p_employment_status: normalized.employment_status ?? 'active',
        p_status_effective_date: normalized.status_effective_date ?? normalized.joining_date!,
        p_monthly_base_salary: normalized.monthly_base_salary!,
      }),
      'Unable to create the employee and initial salary.',
    );
    if (typeof window !== 'undefined' && normalized.status_effective_date) {
      localStorage.setItem(`emp_status_date_${row.id}`, normalized.status_effective_date);
      row.status_effective_date = normalized.status_effective_date;
    }
    return row;
  },

  async update(employeeId: string, input: TablesUpdate<'employee_profiles'>): Promise<EmployeeProfileRow> {
    const safeInput = sanitizeEmployeeUpdate(input);
    const client = getSupabaseClient();
    if (typeof window !== 'undefined' && (input as any).status_effective_date) {
      localStorage.setItem(`emp_status_date_${employeeId}`, String((input as any).status_effective_date));
    }
    try {
      const row = await executeQuery<EmployeeProfileRow>(
        client.from('employee_profiles').update(safeInput).eq('id', employeeId).select('*').single(),
        'Unable to update the employee.',
      );
      if (typeof window !== 'undefined' && (input as any).status_effective_date) {
        row.status_effective_date = String((input as any).status_effective_date);
      }
      return row;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('status_effective_date') || msg.includes('schema cache')) {
        const stripped = { ...safeInput };
        delete (stripped as any).status_effective_date;
        const row = await executeQuery<EmployeeProfileRow>(
          client.from('employee_profiles').update(stripped as TablesUpdate<'employee_profiles'>).eq('id', employeeId).select('*').single(),
          'Unable to update the employee.',
        );
        if (typeof window !== 'undefined' && (input as any).status_effective_date) {
          row.status_effective_date = String((input as any).status_effective_date);
        }
        return row;
      }
      throw err;
    }
  },

  async setStatus(employeeId: string, status: EmploymentStatus, effectiveDate?: string): Promise<EmployeeProfileRow> {
    const updates: Record<string, unknown> = { employment_status: status };
    if (effectiveDate) updates.status_effective_date = effectiveDate;
    return this.update(employeeId, updates as TablesUpdate<'employee_profiles'>);
  },

  async assignShift(input: ShiftAssignmentInput): Promise<ShiftAssignmentRow> {
    return executeQuery(
      getSupabaseClient().from('shift_assignments').upsert({
        organization_id: input.organization_id,
        employee_id: input.employee_id,
        shift_id: input.shift_id,
        work_date: input.work_date ?? todayInTimezone('Asia/Riyadh'),
        status: 'scheduled',
        source: 'manual',
      } as TablesInsert<'shift_assignments'>, { onConflict: 'employee_id,work_date' }).select('*').single(),
      'Unable to assign the shift.',
    );
  },

  async getLookups(organizationId: string): Promise<EmployeeLookups> {
    const client = getSupabaseClient();
    const [branches, departments, shifts, memberships] = await Promise.all([
      executeQuery(client.from('branches').select('*').eq('organization_id', organizationId).eq('status', 'active').order('name'), 'Unable to load sites.'),
      executeQuery(client.from('departments').select('*').eq('organization_id', organizationId).eq('status', 'active').order('name'), 'Unable to load departments.'),
      executeQuery(client.from('shifts').select('*').eq('organization_id', organizationId).eq('status', 'active').is('effective_to', null).order('name'), 'Unable to load shifts.'),
      executeQuery(client.from('organization_memberships').select('user_id').eq('organization_id', organizationId).eq('status', 'active').in('role_code', ['manager', 'administrator']), 'Unable to load managers.'),
    ]);
    const managerIds = memberships.map(item => item.user_id);
    const managers = managerIds.length ? await executeQuery(client.from('users').select('*').in('id', managerIds).eq('is_active', true).order('display_name'), 'Unable to load managers.') : [];
    return { branches, departments, shifts, managers };
  },

  async getRecurringSchedule(employeeId: string): Promise<EmployeeRecurringSchedule | null> {
    const client = getSupabaseClient();
    const { data, error } = await client.from('recurring_schedules').select('*').eq('employee_id', employeeId).eq('status', 'active').order('effective_from', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const rules = await executeQuery(client.from('recurring_schedule_rules').select('*').eq('schedule_id', data.id).order('weekday'), 'Unable to load weekly schedule.');
    return { schedule: data, rules };
  },
};

function validateEmployeeInput(input: EmployeeCreateInput): EmployeeCreateInput {
  const fullName = input.full_name.trim();
  const employeeCode = input.employee_code.trim().toUpperCase();
  const iqamaNumber = input.iqama_number.trim();
  const mobile = input.mobile_number?.trim() || null;

  if (fullName.length < 2 || fullName.length > 150) {
    throw new AppError('VALIDATION_ERROR', 'Full name must contain 2 to 150 characters.');
  }
  if (!/^[A-Z0-9_-]{2,32}$/.test(employeeCode)) {
    throw new AppError('VALIDATION_ERROR', 'Employee ID must contain 2 to 32 letters, numbers, dashes, or underscores.');
  }
  if (!/^\d{10}$/.test(iqamaNumber)) {
    throw new AppError('VALIDATION_ERROR', 'Iqama number must contain exactly 10 digits.');
  }
  if (!input.branch_id || !input.department_id) {
    throw new AppError('VALIDATION_ERROR', 'Site and department are required.');
  }
  if (!input.joining_date) {
    throw new AppError('VALIDATION_ERROR', 'Joining date is required so Payroll can apply the salary correctly.');
  }
  if (!Number.isFinite(input.monthly_base_salary) || Number(input.monthly_base_salary) <= 0) {
    throw new AppError('VALIDATION_ERROR', 'Monthly base salary must be greater than zero.');
  }
  if (mobile && !/^\+?[0-9 ()-]{7,20}$/.test(mobile)) {
    throw new AppError('VALIDATION_ERROR', 'Enter a valid mobile number.');
  }

  return {
    ...input,
    full_name: fullName,
    employee_code: employeeCode,
    iqama_number: iqamaNumber,
    mobile_number: mobile,
    job_title: input.job_title?.trim() || null,
  };
}

function sanitizeEmployeeUpdate(input: TablesUpdate<'employee_profiles'>): TablesUpdate<'employee_profiles'> {
  const safe: TablesUpdate<'employee_profiles'> = {};
  const allowed = [
    'employee_code', 'iqama_number', 'full_name', 'mobile_number', 'branch_id',
    'department_id', 'job_title', 'manager_user_id', 'joining_date', 'employment_status',
    'status_effective_date',
  ] as const;
  for (const key of allowed) {
    if (input[key] !== undefined) safe[key] = input[key] as never;
  }

  if (typeof safe.full_name === 'string') {
    safe.full_name = safe.full_name.trim();
    if (safe.full_name.length < 2 || safe.full_name.length > 150) {
      throw new AppError('VALIDATION_ERROR', 'Full name must contain 2 to 150 characters.');
    }
  }
  if (typeof safe.employee_code === 'string') {
    safe.employee_code = safe.employee_code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,32}$/.test(safe.employee_code)) {
      throw new AppError('VALIDATION_ERROR', 'Employee ID must contain 2 to 32 letters, numbers, dashes, or underscores.');
    }
  }
  if (typeof safe.iqama_number === 'string' && !/^\d{10}$/.test(safe.iqama_number)) {
    throw new AppError('VALIDATION_ERROR', 'Iqama number must contain exactly 10 digits.');
  }
  if (typeof safe.mobile_number === 'string') {
    safe.mobile_number = safe.mobile_number.trim() || null;
    if (safe.mobile_number && !/^\+?[0-9 ()-]{7,20}$/.test(safe.mobile_number)) {
      throw new AppError('VALIDATION_ERROR', 'Enter a valid mobile number.');
    }
  }
  if (typeof safe.job_title === 'string') safe.job_title = safe.job_title.trim() || null;
  return safe;
}

export { isEmployeeActiveOnDate } from '../lib/employee-status';
