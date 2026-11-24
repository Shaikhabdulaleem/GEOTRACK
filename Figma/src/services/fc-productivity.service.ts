import { getSupabaseClient } from '../lib/supabase';
import { executeQuery } from './database.service';
import { transferService } from './transfer.service';
import type {
  DepartmentRow, EmployeeProfileRow, EmployeeTransferItem, FcDailyPackerMetricRow, FcDailySellerMetricRow,
  FcPackerMappingRow, FcProductivityWeekRow, FcWeeklyAdhocTaskRow,
  FcWeeklyCapacityMetricRow, FcWeeklySellerSupplementRow, Json,
} from '../types/database';
import type { FcImportPreview } from '../lib/fc-orders-import';

export interface FcSellerSupplementInput {
  seller_name: string;
  purchase_order_units: number;
  return_order_units: number;
  return_orders: number;
}

export interface FcCapacityMetricInput {
  capacity_bins: number; utilized_bins: number; capacity_pallets: number; utilized_pallets: number;
  capacity_units: number; utilized_units: number; capacity_cbm: number; utilized_cbm: number;
}

export interface FcAdhocTaskInput { seller_name: string; task_name: string; usage: number }
export type FcDailyPackerMetric = FcDailyPackerMetricRow;
export type FcDailySellerMetric = FcDailySellerMetricRow;
export type FcWeekSupplement = FcSellerSupplementInput;
export type FcCapacityMetric = FcCapacityMetricInput;
export type FcAdhocTask = FcAdhocTaskInput;
export type FcEmployeeOption = Pick<EmployeeProfileRow, 'id' | 'organization_id' | 'employee_code' | 'full_name' | 'branch_id' | 'department_id' | 'employment_status'>;
export interface FcWorkspace {
  department: DepartmentRow;
  week: FcProductivityWeekRow | null;
  packers: FcDailyPackerMetricRow[];
  sellers: FcDailySellerMetricRow[];
  mappings: FcPackerMappingRow[];
  sellerSupplements: FcWeeklySellerSupplementRow[];
  capacity: FcWeeklyCapacityMetricRow | null;
  adhocTasks: FcWeeklyAdhocTaskRow[];
  employees: FcEmployeeOption[];
  transfers?: EmployeeTransferItem[];
}

export const fcProductivityService = {
  async findDepartment(organizationId: string): Promise<DepartmentRow | null> {
    const departments = await executeQuery<DepartmentRow[]>(getSupabaseClient().from('departments').select('*').eq('organization_id', organizationId).eq('status', 'active'), 'Unable to find the FC department.');
    return departments.find(row => row.name.trim().toUpperCase() === 'FC' || row.code.trim().toUpperCase() === 'FC') ?? null;
  },

  async loadWeek(organizationId: string, weekStart: string): Promise<FcWorkspace | null> {
    const client = getSupabaseClient();
    const department = await this.findDepartment(organizationId);
    if (!department) return null;
    const weekEndDate = new Date(new Date(weekStart).getTime() + 6 * 86400000).toISOString().slice(0, 10);
    const [weeks, mappings, employees, transfers] = await Promise.all([
      executeQuery<FcProductivityWeekRow[]>(client.from('fc_productivity_weeks').select('*').eq('organization_id', organizationId).eq('department_id', department.id).eq('week_start', weekStart).limit(1), 'Unable to load the FC productivity week.'),
      executeQuery<FcPackerMappingRow[]>(client.from('fc_packer_mappings').select('*').eq('organization_id', organizationId).eq('department_id', department.id), 'Unable to load FC packer mappings.'),
      executeQuery<FcEmployeeOption[]>(client.from('employee_profiles').select('id, organization_id, employee_code, full_name, branch_id, department_id, employment_status').eq('organization_id', organizationId).eq('department_id', department.id).eq('employment_status', 'active').order('full_name'), 'Unable to load FC employees.'),
      transferService.listTransfers({ organizationId, fromDate: weekStart, toDate: weekEndDate }).catch(() => []),
    ]);
    const week = weeks[0] ?? null;
    if (!week) return { department, week: null, packers: [], sellers: [], mappings, sellerSupplements: [], capacity: null, adhocTasks: [], employees, transfers };
    const [packers, sellers, sellerSupplements, capacities, adhocTasks] = await Promise.all([
      executeQuery<FcDailyPackerMetricRow[]>(client.from('fc_daily_packer_metrics').select('*').eq('week_id', week.id).order('work_date'), 'Unable to load FC packer metrics.'),
      executeQuery<FcDailySellerMetricRow[]>(client.from('fc_daily_seller_metrics').select('*').eq('week_id', week.id).order('work_date'), 'Unable to load FC seller metrics.'),
      executeQuery<FcWeeklySellerSupplementRow[]>(client.from('fc_weekly_seller_supplements').select('*').eq('week_id', week.id).order('seller_name'), 'Unable to load FC seller supplements.'),
      executeQuery<FcWeeklyCapacityMetricRow[]>(client.from('fc_weekly_capacity_metrics').select('*').eq('week_id', week.id).limit(1), 'Unable to load FC capacity.'),
      executeQuery<FcWeeklyAdhocTaskRow[]>(client.from('fc_weekly_adhoc_tasks').select('*').eq('week_id', week.id).order('seller_name'), 'Unable to load FC ad-hoc tasks.'),
    ]);
    return { department, week, packers, sellers, mappings, sellerSupplements, capacity: capacities[0] ?? null, adhocTasks, employees, transfers };
  },

  saveImport(organizationId: string, weekStart: string, preview: FcImportPreview): Promise<Json> {
    return executeQuery(getSupabaseClient().rpc('save_fc_productivity_week', { p_organization_id: organizationId, p_week_start: weekStart, p_import: {
      source_file_name: preview.sourceFileName, source_sha256: preview.sourceSha256, source_rows: preview.sourceRows,
      valid_rows: preview.validRows, ignored_rows: preview.ignoredRows, duplicate_rows: preview.duplicateRows,
      blank_packer_rows: preview.blankPackerRows, packers: preview.packers, sellers: preview.sellers,
    } as unknown as Json }), 'Unable to save the FC Orders import.');
  },

  saveSupplements(organizationId: string, weekStart: string, section: 'seller' | 'capacity' | 'adhoc', rows: unknown[], reviewed: boolean): Promise<number> {
    return executeQuery(getSupabaseClient().rpc('save_fc_week_supplements', { p_organization_id: organizationId, p_week_start: weekStart, p_section: section, p_rows: rows as Json, p_reviewed: reviewed }), 'Unable to save FC supplemental metrics.');
  },

  finalizeWeek(organizationId: string, weekStart: string): Promise<undefined> {
    return executeQuery(getSupabaseClient().rpc('finalize_fc_productivity_week', { p_organization_id: organizationId, p_week_start: weekStart }), 'Unable to finalize the FC productivity week.');
  },

  saveMapping(organizationId: string, packerLabel: string, employeeId: string): Promise<string> {
    return executeQuery(getSupabaseClient().rpc('save_fc_packer_mapping', { p_organization_id: organizationId, p_packer_label: packerLabel, p_employee_id: employeeId }), 'Unable to save the FC packer mapping.');
  },
};
