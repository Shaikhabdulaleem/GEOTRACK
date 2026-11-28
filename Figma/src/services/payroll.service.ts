import { getSupabaseClient } from '../lib/supabase';
import { executeQuery } from './database.service';
import type {
  EmployeeCompensationRow,
  EmployeePayrollComponentRow,
  OvertimeRateMode,
  PayrollComponentKind,
  PayrollEntryDetail,
  PayrollEntryRow,
  PayrollExceptionRow,
  PayrollExportCsvRow,
  PayrollLineItemRow,
  PayrollReviewStatus,
  PayrollRunRow,
  PayrollSettingsRow,
} from '../types/database';

export interface UpsertPayrollSettingsInput {
  organizationId: string;
  currencyCode: string;
  monthBasisDays: number;
  dailyHours: number;
  overtimeMultiplier: number;
  overtimeRateMode?: OvertimeRateMode;
  overtimeHourlyRate?: number;
}

export interface UpsertCompensationInput {
  id?: string | null;
  organizationId: string;
  employeeId: string;
  monthlyBaseSalary: number;
  currencyCode: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  notes?: string | null;
}

export interface UpsertPayrollComponentInput {
  id?: string | null;
  organizationId: string;
  employeeId: string;
  componentKind: PayrollComponentKind;
  code: string;
  name: string;
  amount: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  isActive?: boolean;
  notes?: string | null;
}

export interface ListPayrollEntriesFilters {
  organizationId: string;
  payrollRunId: string;
  search?: string;
  branchId?: string;
  departmentId?: string;
  reviewStatus?: PayrollReviewStatus | '';
}

export interface AddManualAdjustmentInput {
  organizationId: string;
  payrollEntryId: string;
  direction: 'earning' | 'deduction';
  code: string;
  label: string;
  amount: number;
  notes?: string | null;
}

export const payrollService = {
  async getSettings(organizationId: string): Promise<PayrollSettingsRow> {
    const rows = await executeQuery(
      getSupabaseClient().rpc('get_payroll_settings', { p_organization_id: organizationId }),
      'Unable to load payroll settings.',
    );
    return (
      rows[0] ?? {
        organization_id: organizationId,
        currency_code: 'SAR',
        month_basis_days: 30,
        daily_hours: 8,
        overtime_multiplier: 1.5,
        overtime_rate_mode: 'multiplier',
        overtime_hourly_rate: 0,
        updated_at: null,
      }
    );
  },

  async upsertSettings(input: UpsertPayrollSettingsInput): Promise<PayrollSettingsRow> {
    return executeQuery(
      getSupabaseClient().rpc('upsert_payroll_settings', {
        p_organization_id: input.organizationId,
        p_currency_code: input.currencyCode,
        p_month_basis_days: input.monthBasisDays,
        p_daily_hours: input.dailyHours,
        p_overtime_multiplier: input.overtimeMultiplier,
        p_overtime_rate_mode: input.overtimeRateMode ?? 'multiplier',
        p_overtime_hourly_rate: input.overtimeHourlyRate ?? 0,
      }),
      'Unable to save payroll settings.',
    );
  },

  async listCompensations(organizationId: string, employeeId?: string): Promise<EmployeeCompensationRow[]> {
    return executeQuery(
      getSupabaseClient().rpc('list_employee_compensations', {
        p_organization_id: organizationId,
        p_employee_id: employeeId ?? null,
      }),
      'Unable to load compensation history.',
    );
  },

  async upsertCompensation(input: UpsertCompensationInput): Promise<EmployeeCompensationRow> {
    return executeQuery(
      getSupabaseClient().rpc('upsert_employee_compensation', {
        p_organization_id: input.organizationId,
        p_employee_id: input.employeeId,
        p_monthly_base_salary: input.monthlyBaseSalary,
        p_currency_code: input.currencyCode,
        p_effective_from: input.effectiveFrom,
        p_effective_to: input.effectiveTo || null,
        p_notes: input.notes ?? null,
        p_id: input.id ?? null,
      }),
      'Unable to save employee compensation.',
    );
  },

  async deleteCompensation(organizationId: string, id: string): Promise<void> {
    await executeQuery(
      getSupabaseClient().rpc('delete_employee_compensation', {
        p_organization_id: organizationId,
        p_id: id,
      }),
      'Unable to delete employee compensation.',
    );
  },

  async listComponents(organizationId: string, employeeId?: string): Promise<EmployeePayrollComponentRow[]> {
    return executeQuery(
      getSupabaseClient().rpc('list_employee_payroll_components', {
        p_organization_id: organizationId,
        p_employee_id: employeeId ?? null,
      }),
      'Unable to load recurring payroll components.',
    );
  },

  async upsertComponent(input: UpsertPayrollComponentInput): Promise<EmployeePayrollComponentRow> {
    return executeQuery(
      getSupabaseClient().rpc('upsert_employee_payroll_component', {
        p_organization_id: input.organizationId,
        p_employee_id: input.employeeId,
        p_component_kind: input.componentKind,
        p_code: input.code,
        p_name: input.name,
        p_amount: input.amount,
        p_effective_from: input.effectiveFrom,
        p_effective_to: input.effectiveTo || null,
        p_is_active: input.isActive ?? true,
        p_notes: input.notes ?? null,
        p_id: input.id ?? null,
      }),
      'Unable to save recurring payroll component.',
    );
  },

  async deleteComponent(organizationId: string, id: string): Promise<void> {
    await executeQuery(
      getSupabaseClient().rpc('delete_employee_payroll_component', {
        p_organization_id: organizationId,
        p_id: id,
      }),
      'Unable to delete recurring payroll component.',
    );
  },

  async listRuns(organizationId: string): Promise<PayrollRunRow[]> {
    return executeQuery(
      getSupabaseClient().rpc('list_payroll_runs', { p_organization_id: organizationId }),
      'Unable to load payroll runs.',
    );
  },

  async generateRun(organizationId: string, payrollMonthDate: string): Promise<PayrollRunRow> {
    return executeQuery(
      getSupabaseClient().rpc('generate_payroll_run', {
        p_organization_id: organizationId,
        p_payroll_month: payrollMonthDate,
      }),
      'Unable to generate payroll run.',
    );
  },

  async listEntries(filters: ListPayrollEntriesFilters): Promise<PayrollEntryRow[]> {
    return executeQuery(
      getSupabaseClient().rpc('list_payroll_entries', {
        p_organization_id: filters.organizationId,
        p_payroll_run_id: filters.payrollRunId,
        p_search: filters.search?.trim() || null,
        p_branch_id: filters.branchId || null,
        p_department_id: filters.departmentId || null,
        p_review_status: filters.reviewStatus || null,
      }),
      'Unable to load payroll entries.',
    );
  },

  async getEntryDetail(organizationId: string, payrollEntryId: string): Promise<PayrollEntryDetail> {
    return executeQuery(
      getSupabaseClient().rpc('get_payroll_entry_detail', {
        p_organization_id: organizationId,
        p_payroll_entry_id: payrollEntryId,
      }),
      'Unable to load payroll calculation breakdown.',
    );
  },

  async addManualAdjustment(input: AddManualAdjustmentInput): Promise<PayrollLineItemRow> {
    return executeQuery(
      getSupabaseClient().rpc('add_payroll_manual_adjustment', {
        p_organization_id: input.organizationId,
        p_payroll_entry_id: input.payrollEntryId,
        p_direction: input.direction,
        p_code: input.code,
        p_label: input.label,
        p_amount: input.amount,
        p_notes: input.notes ?? null,
      }),
      'Unable to add manual adjustment.',
    );
  },

  async deleteManualAdjustment(organizationId: string, lineItemId: string): Promise<void> {
    await executeQuery(
      getSupabaseClient().rpc('delete_payroll_manual_adjustment', {
        p_organization_id: organizationId,
        p_line_item_id: lineItemId,
      }),
      'Unable to remove manual adjustment.',
    );
  },

  async waiveException(organizationId: string, exceptionId: string, reason: string): Promise<PayrollExceptionRow> {
    return executeQuery(
      getSupabaseClient().rpc('waive_payroll_exception', {
        p_organization_id: organizationId,
        p_exception_id: exceptionId,
        p_reason: reason,
      }),
      'Unable to waive attendance exception.',
    );
  },

  async reviewEntry(
    organizationId: string,
    payrollEntryId: string,
    reviewStatus: PayrollReviewStatus,
    reviewNote?: string | null,
  ): Promise<PayrollEntryRow> {
    return executeQuery(
      getSupabaseClient().rpc('review_payroll_entry', {
        p_organization_id: organizationId,
        p_payroll_entry_id: payrollEntryId,
        p_review_status: reviewStatus,
        p_review_note: reviewNote ?? null,
      }),
      'Unable to update employee review status.',
    );
  },

  async submitForReview(organizationId: string, payrollRunId: string): Promise<PayrollRunRow> {
    return executeQuery(
      getSupabaseClient().rpc('submit_payroll_run_for_review', {
        p_organization_id: organizationId,
        p_payroll_run_id: payrollRunId,
      }),
      'Unable to move payroll run to under review.',
    );
  },

  async finalizeRun(organizationId: string, payrollRunId: string): Promise<PayrollRunRow> {
    return executeQuery(
      getSupabaseClient().rpc('finalize_payroll_run', {
        p_organization_id: organizationId,
        p_payroll_run_id: payrollRunId,
      }),
      'Unable to finalize payroll run.',
    );
  },

  async reopenRun(organizationId: string, payrollRunId: string, reason: string): Promise<PayrollRunRow> {
    return executeQuery(
      getSupabaseClient().rpc('reopen_payroll_run', {
        p_organization_id: organizationId,
        p_payroll_run_id: payrollRunId,
        p_reason: reason,
      }),
      'Unable to reopen payroll run.',
    );
  },

  async exportRunRows(organizationId: string, payrollRunId: string): Promise<PayrollExportCsvRow[]> {
    return executeQuery(
      getSupabaseClient().rpc('export_payroll_run_rows', {
        p_organization_id: organizationId,
        p_payroll_run_id: payrollRunId,
      }),
      'Unable to export finalized payroll run.',
    );
  },
};
