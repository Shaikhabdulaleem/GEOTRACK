import { getSupabaseClient } from '../lib/supabase';
import { executeQuery } from './database.service';
import { calculateTransferDuration, type TransferDurationCalculation } from '../lib/transfer-model';
export { calculateTransferDuration, type TransferDurationCalculation };
import type {
  EmployeeTransferItem,
  EmployeeTransferRow,
  TransferStatus,
  TransferType,
} from '../types/database';

export interface TransferListFilters {
  organizationId: string;
  fromDate?: string;
  toDate?: string;
  departmentId?: string;
  sourceDepartmentId?: string;
  targetDepartmentId?: string;
  employeeId?: string;
  status?: TransferStatus | 'all';
  search?: string;
}

export interface StartTransferInput {
  organizationId: string;
  employeeId: string;
  toDepartmentId: string;
  transferDate?: string;
  startTime?: string;
  endTime?: string | null;
  breakMinutes?: number;
  overtimeMinutes?: number;
  transferType?: TransferType;
  reason?: string;
  notes?: string;
}

export interface CompleteTransferInput {
  organizationId: string;
  transferId: string;
  endTime?: string;
  breakMinutes?: number;
  overtimeMinutes?: number;
  notes?: string;
}

export interface CancelTransferInput {
  organizationId: string;
  transferId: string;
  reason?: string;
}

export const transferService = {
  async listTransfers(filters: TransferListFilters): Promise<EmployeeTransferItem[]> {
    const client = getSupabaseClient();
    let query = client
      .from('employee_transfers')
      .select('*')
      .eq('organization_id', filters.organizationId)
      .order('transfer_date', { ascending: false })
      .order('start_time', { ascending: false });

    if (filters.fromDate) query = query.gte('transfer_date', filters.fromDate);
    if (filters.toDate) query = query.lte('transfer_date', filters.toDate);
    if (filters.employeeId) query = query.eq('employee_id', filters.employeeId);
    if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
    if (filters.sourceDepartmentId) query = query.eq('from_department_id', filters.sourceDepartmentId);
    if (filters.targetDepartmentId) query = query.eq('to_department_id', filters.targetDepartmentId);

    const transfers = await executeQuery<EmployeeTransferRow[]>(query, 'Unable to load employee transfers.');

    if (transfers.length === 0) return [];

    const empIds = [...new Set(transfers.map(t => t.employee_id))];
    const deptIds = [...new Set([...transfers.map(t => t.from_department_id), ...transfers.map(t => t.to_department_id)])];

    const [employees, departments] = await Promise.all([
      executeQuery<{ id: string; employee_code: string; full_name: string; job_title: string | null }[]>(
        client.from('employee_profiles').select('id, employee_code, full_name, job_title').in('id', empIds),
        'Unable to load transferred employees.',
      ).catch(() => []),
      executeQuery<{ id: string; name: string; code: string }[]>(
        client.from('departments').select('id, name, code').in('id', deptIds),
        'Unable to load transfer departments.',
      ).catch(() => []),
    ]);

    const empMap = new Map(employees.map(e => [e.id, e]));
    const deptMap = new Map(departments.map(d => [d.id, d]));

    let items: EmployeeTransferItem[] = transfers.map(t => ({
      ...t,
      employee: empMap.get(t.employee_id),
      from_department: deptMap.get(t.from_department_id),
      to_department: deptMap.get(t.to_department_id),
    }));

    if (filters.departmentId) {
      items = items.filter(
        i => i.from_department_id === filters.departmentId || i.to_department_id === filters.departmentId,
      );
    }

    if (filters.search?.trim()) {
      const q = filters.search.trim().toLowerCase();
      items = items.filter(
        item =>
          item.employee?.full_name?.toLowerCase().includes(q) ||
          item.employee?.employee_code?.toLowerCase().includes(q) ||
          item.from_department?.name?.toLowerCase().includes(q) ||
          item.to_department?.name?.toLowerCase().includes(q) ||
          item.reason?.toLowerCase().includes(q),
      );
    }

    return items;
  },

  async getActiveTransfers(organizationId: string, departmentId?: string): Promise<EmployeeTransferItem[]> {
    return this.listTransfers({
      organizationId,
      status: 'active',
      departmentId,
    });
  },

  async startTransfer(input: StartTransferInput): Promise<EmployeeTransferRow> {
    const client = getSupabaseClient();
    try {
      return await executeQuery<EmployeeTransferRow>(
        client.rpc('start_employee_transfer', {
          p_organization_id: input.organizationId,
          p_employee_id: input.employeeId,
          p_to_department_id: input.toDepartmentId,
          p_transfer_date: input.transferDate ?? null,
          p_start_time: input.startTime ?? null,
          p_end_time: input.endTime ?? null,
          p_break_minutes: input.breakMinutes ?? 0,
          p_overtime_minutes: input.overtimeMinutes ?? 0,
          p_transfer_type: input.transferType ?? 'temporary',
          p_reason: input.reason ?? null,
          p_notes: input.notes ?? null,
        }),
        'Unable to initiate employee transfer.',
      );
    } catch {
      // Fallback direct insert if RPC not loaded in cached client
      const employee = await executeQuery<{ department_id: string }>(
        client.from('employee_profiles').select('department_id').eq('id', input.employeeId).single(),
        'Unable to load employee.',
      );

      const startTime = input.startTime ?? new Date().toISOString();
      let status: TransferStatus = 'active';
      let transferredMinutes = 0;

      if (input.endTime) {
        status = 'completed';
        const calc = calculateTransferDuration(startTime, input.endTime, input.breakMinutes ?? 0);
        transferredMinutes = calc.netMinutes;
      }

      return executeQuery<EmployeeTransferRow>(
        client
          .from('employee_transfers')
          .insert({
            organization_id: input.organizationId,
            employee_id: input.employeeId,
            from_department_id: employee.department_id,
            to_department_id: input.toDepartmentId,
            transfer_date: input.transferDate ?? startTime.slice(0, 10),
            start_time: startTime,
            end_time: input.endTime ?? null,
            status,
            transfer_type: input.transferType ?? 'temporary',
            transferred_minutes: transferredMinutes,
            break_minutes: input.breakMinutes ?? 0,
            overtime_minutes: input.overtimeMinutes ?? 0,
            reason: input.reason ?? null,
            notes: input.notes ?? null,
          })
          .select('*')
          .single(),
        'Unable to create employee transfer.',
      );
    }
  },

  async completeTransfer(input: CompleteTransferInput): Promise<EmployeeTransferRow> {
    const client = getSupabaseClient();
    try {
      return await executeQuery<EmployeeTransferRow>(
        client.rpc('complete_employee_transfer', {
          p_organization_id: input.organizationId,
          p_transfer_id: input.transferId,
          p_end_time: input.endTime ?? null,
          p_break_minutes: input.breakMinutes ?? null,
          p_overtime_minutes: input.overtimeMinutes ?? null,
          p_notes: input.notes ?? null,
        }),
        'Unable to complete employee transfer.',
      );
    } catch {
      const existing = await executeQuery<EmployeeTransferRow>(
        client.from('employee_transfers').select('*').eq('id', input.transferId).single(),
        'Unable to find transfer record.',
      );

      const endTime = input.endTime ?? new Date().toISOString();
      const breakMinutes = input.breakMinutes ?? existing.break_minutes ?? 0;
      const calc = calculateTransferDuration(existing.start_time, endTime, breakMinutes);

      return executeQuery<EmployeeTransferRow>(
        client
          .from('employee_transfers')
          .update({
            end_time: endTime,
            status: 'completed',
            transferred_minutes: calc.netMinutes,
            break_minutes: breakMinutes,
            overtime_minutes: input.overtimeMinutes ?? existing.overtime_minutes ?? 0,
            notes: input.notes ? `${existing.notes ?? ''} | ${input.notes}`.trim() : existing.notes,
            updated_at: new Date().toISOString(),
          })
          .eq('id', input.transferId)
          .select('*')
          .single(),
        'Unable to complete transfer.',
      );
    }
  },

  async cancelTransfer(input: CancelTransferInput): Promise<EmployeeTransferRow> {
    const client = getSupabaseClient();
    try {
      return await executeQuery<EmployeeTransferRow>(
        client.rpc('cancel_employee_transfer', {
          p_organization_id: input.organizationId,
          p_transfer_id: input.transferId,
          p_reason: input.reason ?? null,
        }),
        'Unable to cancel employee transfer.',
      );
    } catch {
      return executeQuery<EmployeeTransferRow>(
        client
          .from('employee_transfers')
          .update({
            status: 'cancelled',
            notes: input.reason ? `Cancelled: ${input.reason}` : undefined,
            updated_at: new Date().toISOString(),
          })
          .eq('id', input.transferId)
          .select('*')
          .single(),
        'Unable to cancel transfer.',
      );
    }
  },
};
