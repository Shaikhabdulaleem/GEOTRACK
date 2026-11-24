import type { FcWorkspace } from '../services/fc-productivity.service';
import type { FcActivityStandardRow, FcDailyManpowerProductivityRow } from '../types/database';
import {
  getEffectiveApprovedOvertimeMinutes,
  getOffDayOvertimeHours,
} from './employee-status.ts';

export interface FcEmployeeMetric {
  key: string; employeeId: string | null; employeeName: string; packerLabels: string[];
  activeDays: number; packedOrders: number; packedQuantity: number; additionalItems: number;
  unitsPerOrder: number; ordersPerActiveDay: number; shareOfOrders: number;
}

export interface FcTransferSummary {
  transfersOutCount: number;
  transfersOutHours: number;
  transfersInCount: number;
  transfersInHours: number;
  records: Array<{
    id: string;
    employeeName: string;
    employeeCode: string;
    fromDepartment: string;
    toDepartment: string;
    date: string;
    hours: number;
    otHours: number;
    status: string;
  }>;
}

export interface FcDashboardModel {
  packedOrders: number; packedQuantity: number; additionalItems: number; activePackers: number;
  mappedOrders: number; unassignedOrders: number;
  employees: FcEmployeeMetric[];
  daily: Array<{ date: string; packedOrders: number; packedQuantity: number }>;
  sellers: Array<{ sellerName: string; b2bOrders: number; b2bQuantity: number; b2cOrders: number; b2cQuantity: number; otherOrders: number; otherQuantity: number; totalOrders: number; totalQuantity: number }>;
  cycleTimes: Record<'a2p' | 'p2p' | 'o2p' | 'p2s' | 'o2s', { minutes: number | null; samples: number }>;
  transfers: FcTransferSummary;
}

export type FcChannelFilter = 'all' | 'b2c' | 'b2b';

export function buildFcDashboard(workspace: FcWorkspace, channelFilter: FcChannelFilter = 'all'): FcDashboardModel {
  const filteredSellers = channelFilter === 'all'
    ? workspace.sellers
    : workspace.sellers.filter(row => row.order_type === (channelFilter === 'b2c' ? 'B2C' : 'B2B'));
  const packedOrders = channelFilter === 'all'
    ? workspace.packers.reduce((sum, row) => sum + row.packed_orders, 0)
    : filteredSellers.reduce((sum, row) => sum + row.packed_orders, 0);
  const packedQuantity = channelFilter === 'all'
    ? workspace.packers.reduce((sum, row) => sum + row.packed_quantity, 0)
    : filteredSellers.reduce((sum, row) => sum + row.packed_quantity, 0);
  const mappingByLabel = new Map(workspace.mappings.map(row => [row.normalized_packer_label, row]));
  const employeeById = new Map(workspace.employees.map(row => [row.id, row]));
  const normalizePackerKey = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
  const employeeByLabel = new Map<string, (typeof workspace.employees)[number]>();
  workspace.employees.forEach(emp => {
    if (emp.full_name) employeeByLabel.set(normalizePackerKey(emp.full_name), emp);
    if (emp.employee_code) employeeByLabel.set(normalizePackerKey(emp.employee_code), emp);
  });
  const employeeGroups = new Map<string, { employeeId: string | null; name: string; labels: Set<string>; dates: Set<string>; orders: number; quantity: number }>();
  workspace.packers.forEach(row => {
    const directEmployee = employeeByLabel.get(row.normalized_packer_label);
    const mapping = mappingByLabel.get(row.normalized_packer_label);
    const employee = directEmployee ?? (mapping ? employeeById.get(mapping.employee_id) : undefined);
    const key = employee?.id ?? 'unassigned';
    const group = employeeGroups.get(key) ?? { employeeId: employee?.id ?? null, name: employee?.full_name ?? 'Unassigned', labels: new Set(), dates: new Set(), orders: 0, quantity: 0 };
    group.labels.add(row.packer_label); group.dates.add(row.work_date); group.orders += row.packed_orders; group.quantity += row.packed_quantity;
    employeeGroups.set(key, group);
  });
  const employees = [...employeeGroups.entries()].map(([key, row]) => ({
    key, employeeId: row.employeeId, employeeName: row.name, packerLabels: [...row.labels].sort(), activeDays: row.dates.size,
    packedOrders: row.orders, packedQuantity: row.quantity, additionalItems: row.quantity - row.orders,
    unitsPerOrder: row.orders ? row.quantity / row.orders : 0,
    ordersPerActiveDay: row.dates.size ? row.orders / row.dates.size : 0,
    shareOfOrders: packedOrders ? row.orders / packedOrders : 0,
  })).sort((a, b) => b.packedOrders - a.packedOrders);
  const dailyMap = new Map<string, { packedOrders: number; packedQuantity: number }>();
  if (channelFilter === 'all') {
    workspace.packers.forEach(row => { const value = dailyMap.get(row.work_date) ?? { packedOrders: 0, packedQuantity: 0 }; value.packedOrders += row.packed_orders; value.packedQuantity += row.packed_quantity; dailyMap.set(row.work_date, value); });
  } else {
    filteredSellers.forEach(row => { const value = dailyMap.get(row.work_date) ?? { packedOrders: 0, packedQuantity: 0 }; value.packedOrders += row.packed_orders; value.packedQuantity += row.packed_quantity; dailyMap.set(row.work_date, value); });
  }
  const sellerMap = new Map<string, FcDashboardModel['sellers'][number]>();
  filteredSellers.forEach(row => {
    const value = sellerMap.get(row.seller_name) ?? { sellerName: row.seller_name, b2bOrders: 0, b2bQuantity: 0, b2cOrders: 0, b2cQuantity: 0, otherOrders: 0, otherQuantity: 0, totalOrders: 0, totalQuantity: 0 };
    if (row.order_type === 'B2B') { value.b2bOrders += row.packed_orders; value.b2bQuantity += row.packed_quantity; }
    else if (row.order_type === 'B2C') { value.b2cOrders += row.packed_orders; value.b2cQuantity += row.packed_quantity; }
    else { value.otherOrders += row.packed_orders; value.otherQuantity += row.packed_quantity; }
    value.totalOrders += row.packed_orders; value.totalQuantity += row.packed_quantity; sellerMap.set(row.seller_name, value);
  });
  const cycle = (prefix: 'a2p' | 'p2p' | 'o2p' | 'p2s' | 'o2s') => {
    const samples = filteredSellers.reduce((sum, row) => sum + row[`${prefix}_samples`], 0);
    const minutes = filteredSellers.reduce((sum, row) => sum + row[`${prefix}_minutes`], 0);
    return { minutes: samples ? minutes / samples : null, samples };
  };
  const mappedOrders = employees.filter(row => row.employeeId).reduce((sum, row) => sum + row.packedOrders, 0);

  const rawTransfers = workspace.transfers ?? [];
  const fcDeptId = workspace.department.id;
  const isFcSource = (t: typeof rawTransfers[number]) =>
    t.from_department_id === fcDeptId || t.from_department?.name?.toUpperCase() === 'FC';
  const isFcTarget = (t: typeof rawTransfers[number]) =>
    t.to_department_id === fcDeptId || t.to_department?.name?.toUpperCase() === 'FC';

  const transferRecords = rawTransfers.filter(t => t.status !== 'cancelled').map(t => {
    const hours = Math.round((t.transferred_minutes / 60) * 100) / 100;
    const otHours = Math.round(((t.overtime_minutes || 0) / 60) * 100) / 100;
    return {
      id: t.id,
      employeeName: t.employee?.full_name || 'Transferred Employee',
      employeeCode: t.employee?.employee_code || '',
      fromDepartment: t.from_department?.name || 'FC',
      toDepartment: t.to_department?.name || 'Department',
      date: t.transfer_date,
      hours,
      otHours,
      status: t.status,
    };
  });

  const transfersOut = rawTransfers.filter(t => t.status !== 'cancelled' && isFcSource(t));
  const transfersIn = rawTransfers.filter(t => t.status !== 'cancelled' && isFcTarget(t));

  const transferSummary: FcTransferSummary = {
    transfersOutCount: new Set(transfersOut.map(t => t.employee_id)).size,
    transfersOutHours: Math.round(transfersOut.reduce((sum, t) => sum + t.transferred_minutes / 60, 0) * 100) / 100,
    transfersInCount: new Set(transfersIn.map(t => t.employee_id)).size,
    transfersInHours: Math.round(transfersIn.reduce((sum, t) => sum + t.transferred_minutes / 60, 0) * 100) / 100,
    records: transferRecords,
  };

  return {
    packedOrders, packedQuantity, additionalItems: packedQuantity - packedOrders,
    activePackers: new Set(workspace.packers.filter(row => row.normalized_packer_label !== 'unassigned').map(row => row.normalized_packer_label)).size,
    mappedOrders, unassignedOrders: packedOrders - mappedOrders,
    employees, daily: [...dailyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, ...value })),
    sellers: [...sellerMap.values()].sort((a, b) => b.totalOrders - a.totalOrders),
    cycleTimes: { a2p: cycle('a2p'), p2p: cycle('p2p'), o2p: cycle('o2p'), p2s: cycle('p2s'), o2s: cycle('o2s') },
    transfers: transferSummary,
  };
}

export interface FcEmployeeOvertimeSummary {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  employmentSource: 'own' | '3pl';
  approvedOvertimeHours: number;
  otRate: number;
  approvedOvertimeCost: number;
  source: 'overtime_record' | 'off_day_compensation' | 'transfer';
}

export interface FcClientVolumeSummary {
  clientName: string;
  inbound: number;
  outboundB2c: number;
  outboundB2b: number;
  returns: number;
  vas: number;
  totalThroughput: number;
  b2cUpt: number | null;
  b2bUpt: number | null;
}

export interface FcManpowerDayModel {
  date: string; status: 'draft' | 'finalized';
  inbound: number; outbound: number; returns: number; vas: number; throughput: number;
  requiredDlp: number; absenteeismBuffer: number; totalRequiredDlp: number; actualDlp: number; staffingGap: number;
  ownDlp: number; contractDlp: number; presentDlp: number; absentDlp: number;
  availableHours: number; requiredLaborHours: number; availableLaborHours: number;
  transferredInHours: number; transferredOutHours: number;
  regularUnitsCapacity: number; unmetUnits: number;
  overtimeRecommendedHours: number; overtimeRecommendedCost: number; otRequiredPerPerson: number;
  overtimeCapacityHours: number; uncoveredHours: number; additional3pl: number;
  actualOvertimeHours: number; actualOvertimeCost: number; approvedOtEmployees: number;
  b2cUpt: number | null; b2bUpt: number | null; closingStorage: number;
}

export interface FcManpowerDashboardModel {
  daily: FcManpowerDayModel[];
  draftDates: string[];
  activities: Array<{ code: string; name: string; uom: 'hour' | 'day'; target: number; volume: number; laborHours: number; requiredDlp: number }>;
  clientBreakdown: FcClientVolumeSummary[];
  inbound: number; outboundB2c: number; outboundB2b: number; returns: number; vas: number; throughput: number;
  requiredDlp: number; absenteeismBuffer: number; totalRequiredDlp: number; actualDlp: number; staffingGap: number;
  ownDlp: number; contractDlp: number; totalPresentDlp: number; totalAbsentDlp: number;
  rosterOwnDlpCount: number; rosterContractDlpCount: number; rosterNonDlpCount: number;
  indirectToDirectRatio: number;
  eligibleDlpCount: number; scheduledDlpCount: number;
  requiredLaborHours: number; availableLaborHours: number;
  totalTransferredInHours: number; totalTransferredOutHours: number;
  totalRegularUnitsCapacity: number; totalUnmetUnits: number;
  overtimeRecommendedHours: number; overtimeRecommendedCost: number; averageOtRequiredPerPerson: number;
  overtimeCapacityHours: number; uncoveredHours: number; peakAdditional3pl: number;
  actualOvertimeHours: number; actualOvertimeCost: number; overtimeCostSaved: number;
  totalApprovedOtEmployees: number;
  approvedOvertimeByEmployee: FcEmployeeOvertimeSummary[];
  b2cUpt: number | null; b2bUpt: number | null; closingStorage: number;
}

export function driverVolume(day: Pick<FcDailyManpowerProductivityRow, 'inbound_quantity' | 'return_rto_quantity' | 'return_cir_quantity' | 'outbound_b2c_quantity' | 'outbound_b2b_quantity' | 'vas_quantity' | 'gift_wrap_quantity' | 'other_activity_quantity'>, driver: FcActivityStandardRow['volume_driver']): number {
  if (driver === 'inbound') return day.inbound_quantity;
  if (driver === 'return_rto') return day.return_rto_quantity;
  if (driver === 'return_cir') return day.return_cir_quantity;
  if (driver === 'returns_total') return day.return_rto_quantity + day.return_cir_quantity;
  if (driver === 'outbound_b2c') return day.outbound_b2c_quantity;
  if (driver === 'outbound_b2b') return day.outbound_b2b_quantity;
  if (driver === 'vas') return day.vas_quantity;
  if (driver === 'gift_wrap') return day.gift_wrap_quantity;
  return day.other_activity_quantity;
}

function requiredFor(day: Pick<FcDailyManpowerProductivityRow, 'available_hours' | 'inbound_quantity' | 'return_rto_quantity' | 'return_cir_quantity' | 'outbound_b2c_quantity' | 'outbound_b2b_quantity' | 'vas_quantity' | 'gift_wrap_quantity' | 'other_activity_quantity'>, standard: FcActivityStandardRow): number {
  const capacity = standard.units_per_worker * (standard.target_uom === 'hour' ? day.available_hours : 1);
  return capacity > 0 ? driverVolume(day, standard.volume_driver) / capacity : 0;
}

function resolveFcEmpOtRate(
  setting: { employment_source?: string; overtime_hourly_cost?: number | null } | undefined,
  ownRate: number,
  threePlRate: number,
): number {
  if (setting?.overtime_hourly_cost != null && Number(setting.overtime_hourly_cost) > 0) {
    return Number(setting.overtime_hourly_cost);
  }
  const base = setting?.employment_source === '3pl' ? threePlRate : ownRate;
  return base > 0 ? base : (ownRate || threePlRate || 0);
}

function scopeManpowerDay(day: FcDailyManpowerProductivityRow, channelFilter: FcChannelFilter): FcDailyManpowerProductivityRow {
  if (channelFilter === 'all') return day;
  if (channelFilter === 'b2c') {
    return {
      ...day,
      inbound_quantity: 0,
      return_rto_quantity: 0,
      return_cir_quantity: 0,
      outbound_b2b_quantity: 0,
      vas_quantity: 0,
      gift_wrap_quantity: 0,
      other_activity_quantity: 0,
      b2b_orders: 0,
    };
  }
  return {
    ...day,
    inbound_quantity: 0,
    return_rto_quantity: 0,
    return_cir_quantity: 0,
    outbound_b2c_quantity: 0,
    vas_quantity: 0,
    gift_wrap_quantity: 0,
    other_activity_quantity: 0,
    b2c_orders: 0,
  };
}

export function buildFcManpowerDashboard(workspace: FcWorkspace, channelFilter: FcChannelFilter = 'all'): FcManpowerDashboardModel {
  const standards = workspace.standards.filter(row => {
    if (!row.is_active) return false;
    if (channelFilter === 'b2c') return row.volume_driver === 'outbound_b2c';
    if (channelFilter === 'b2b') return row.volume_driver === 'outbound_b2b';
    return true;
  });
  const scopedDays = workspace.manpowerDays.map(d => scopeManpowerDay(d, channelFilter));
  const workforceByDate = new Map((workspace.workforceDays ?? []).map(day => [day.workDate, day]));
  const absencePercent = workspace.settings?.planned_absence_percent ?? 5;
  const maxOtPerDay = workspace.settings?.max_overtime_hours_per_day ?? 3;
  const ownOtRate = workspace.settings?.overtime_hourly_cost_own ?? 0;
  const threePlOtRate = workspace.settings?.overtime_hourly_cost_3pl ?? 0;
  const empSettingsList = workspace.employeeSettings ?? [];
  const empSettingMap = new Map(empSettingsList.map(row => [row.employee_id, row]));
  const empById = new Map((workspace.employees ?? []).map(emp => [emp.id, emp]));

  const rosterOwnDlpCount = empSettingsList.length > 0
    ? empSettingsList.filter(s => s.labor_class === 'dlp' && s.employment_source === 'own').length
    : (workspace.employees ?? []).filter(e => !/^3PL[-_ ]?/i.test(e.employee_code)).length;
  const rosterContractDlpCount = empSettingsList.length > 0
    ? empSettingsList.filter(s => s.labor_class === 'dlp' && s.employment_source === '3pl').length
    : (workspace.employees ?? []).filter(e => /^3PL[-_ ]?/i.test(e.employee_code)).length;
  const rosterNonDlpCount = empSettingsList.length > 0
    ? empSettingsList.filter(s => s.labor_class === 'non_dlp').length
    : Math.max(0, (workspace.employees ?? []).length - rosterOwnDlpCount - rosterContractDlpCount);
  const eligibleDlpCount = rosterOwnDlpCount + rosterContractDlpCount;

  const avgOtRate = eligibleDlpCount > 0
    ? (rosterOwnDlpCount * ownOtRate + rosterContractDlpCount * threePlOtRate) / eligibleDlpCount
    : (ownOtRate || threePlOtRate || 0);

  const overtimeByDateAndEmp = new Map<string, Map<string, { hours: number; source: FcEmployeeOvertimeSummary['source'] }>>();
  const addOtEntry = (date: string, empId: string, hours: number, source: FcEmployeeOvertimeSummary['source']) => {
    if (hours <= 0) return;
    if (!overtimeByDateAndEmp.has(date)) overtimeByDateAndEmp.set(date, new Map());
    const dayMap = overtimeByDateAndEmp.get(date)!;
    const prev = dayMap.get(empId);
    dayMap.set(empId, { hours: (prev?.hours ?? 0) + hours, source: prev?.source ?? source });
  };

  const attendance = workspace.attendance ?? [];
  const overtimeRecords = workspace.overtimeRecords ?? [];
  const offDayComps = workspace.offDayCompensations ?? [];
  const allDates = [...new Set(workspace.manpowerDays.map(d => d.work_date))];

  allDates.forEach(date => {
    (workspace.employees ?? []).forEach(emp => {
      const otRes = getEffectiveApprovedOvertimeMinutes(emp.id, date, attendance, overtimeRecords);
      if (otRes.effectiveMinutes > 0) {
        addOtEntry(date, emp.id, otRes.effectiveMinutes / 60, 'overtime_record');
      } else {
        const offHrs = getOffDayOvertimeHours(emp.id, date, offDayComps);
        if (offHrs > 0) {
          addOtEntry(date, emp.id, offHrs, 'off_day_compensation');
        }
      }
    });
  });

  const fcDeptId = workspace.department?.id;
  const transferHoursByDate = new Map<string, { inHours: number; outHours: number }>();
  (workspace.transfers ?? []).forEach(t => {
    if (t.status === 'cancelled') return;
    const isIntoFc = t.to_department_id === fcDeptId || t.to_department?.name?.toUpperCase() === 'FC';
    const isOutOfFc = t.from_department_id === fcDeptId || t.from_department?.name?.toUpperCase() === 'FC';
    const entry = transferHoursByDate.get(t.transfer_date) ?? { inHours: 0, outHours: 0 };
    if (isIntoFc) {
      entry.inHours += (t.transferred_minutes || 0) / 60;
      if ((t.overtime_minutes || 0) > 0) {
        addOtEntry(t.transfer_date, t.employee_id, (t.overtime_minutes || 0) / 60, 'transfer');
      }
    } else if (isOutOfFc) {
      entry.outHours += (t.transferred_minutes || 0) / 60;
    }
    transferHoursByDate.set(t.transfer_date, entry);
  });

  const draftDates = scopedDays
    .filter(day => day.status === 'draft')
    .map(day => day.work_date);

  const daily: FcManpowerDayModel[] = scopedDays.map(day => {
    const requiredDlp = standards.reduce((sum, standard) => sum + requiredFor(day, standard), 0);
    const absenteeismBuffer = requiredDlp * (absencePercent / 100);
    const totalRequiredDlp = requiredDlp + absenteeismBuffer;
    const workforce = workforceByDate.get(day.work_date);
    const ownDlp = workforce?.ownDlp ?? 0;
    const contractDlp = workforce?.contractDlp ?? 0;
    const actualDlp = ownDlp + contractDlp;
    const presentDlp = workforce?.presentDlp ?? 0;
    const absentDlp = workforce?.absentDlp ?? 0;
    const dayTransfers = transferHoursByDate.get(day.work_date) ?? { inHours: 0, outHours: 0 };
    const baseAvailableLaborHours = workforce?.availableLaborHours ?? 0;
    const availableLaborHours = Math.max(0, baseAvailableLaborHours + dayTransfers.inHours - dayTransfers.outHours);
    const requiredLaborHours = totalRequiredDlp * day.available_hours;

    const throughput = day.inbound_quantity + day.return_rto_quantity + day.return_cir_quantity +
      day.outbound_b2c_quantity + day.outbound_b2b_quantity + day.vas_quantity + day.gift_wrap_quantity + day.other_activity_quantity;

    const regularUnitsCapacity = requiredLaborHours > 0
      ? Math.round(throughput * Math.min(1, availableLaborHours / requiredLaborHours))
      : throughput;
    const unmetUnits = Math.max(0, throughput - regularUnitsCapacity);

    const shortageHours = Math.max(0, requiredLaborHours - availableLaborHours);
    const otEligibleDlp = actualDlp > 0 ? actualDlp : eligibleDlpCount;
    const overtimeCapacityHours = otEligibleDlp * maxOtPerDay;
    const overtimeRecommendedHours = Math.min(shortageHours, overtimeCapacityHours);
    const uncoveredHours = Math.max(0, shortageHours - overtimeRecommendedHours);
    const additional3pl = day.available_hours > 0 ? Math.ceil(uncoveredHours / day.available_hours) : 0;
    const otRequiredPerPerson = otEligibleDlp > 0 ? overtimeRecommendedHours / otEligibleDlp : 0;
    const overtimeRecommendedCost = overtimeRecommendedHours * avgOtRate;

    const dayOtMap = overtimeByDateAndEmp.get(day.work_date);
    let actualOvertimeHours = 0;
    let actualOvertimeCost = 0;
    if (dayOtMap) {
      dayOtMap.forEach((entry, empId) => {
        const rate = resolveFcEmpOtRate(empSettingMap.get(empId), ownOtRate, threePlOtRate);
        actualOvertimeHours += entry.hours;
        actualOvertimeCost += entry.hours * rate;
      });
    }

    return {
      date: day.work_date,
      status: day.status ?? 'finalized',
      inbound: day.inbound_quantity,
      outbound: day.outbound_b2c_quantity + day.outbound_b2b_quantity,
      returns: day.return_rto_quantity + day.return_cir_quantity,
      vas: day.vas_quantity,
      throughput,
      requiredDlp,
      absenteeismBuffer,
      totalRequiredDlp,
      actualDlp,
      staffingGap: actualDlp - totalRequiredDlp,
      ownDlp,
      contractDlp,
      presentDlp,
      absentDlp,
      availableHours: day.available_hours,
      requiredLaborHours,
      availableLaborHours,
      transferredInHours: dayTransfers.inHours,
      transferredOutHours: dayTransfers.outHours,
      regularUnitsCapacity,
      unmetUnits,
      overtimeRecommendedHours,
      overtimeRecommendedCost,
      otRequiredPerPerson,
      overtimeCapacityHours,
      uncoveredHours,
      additional3pl,
      actualOvertimeHours,
      actualOvertimeCost,
      approvedOtEmployees: dayOtMap ? dayOtMap.size : 0,
      b2cUpt: day.b2c_orders > 0 ? day.outbound_b2c_quantity / day.b2c_orders : null,
      b2bUpt: day.b2b_orders > 0 ? day.outbound_b2b_quantity / day.b2b_orders : null,
      closingStorage: day.closing_storage_quantity,
    };
  });

  const activities = standards.map(standard => {
    const reqDlp = scopedDays.reduce((sum, day) => sum + requiredFor(day, standard), 0);
    const laborHours = scopedDays.reduce((sum, day) => sum + requiredFor(day, standard) * day.available_hours, 0);
    return {
      code: standard.activity_code,
      name: standard.activity_name,
      uom: standard.target_uom,
      target: standard.units_per_worker,
      volume: scopedDays.reduce((sum, day) => sum + driverVolume(day, standard.volume_driver), 0),
      laborHours,
      requiredDlp: reqDlp,
    };
  });

  const empSummaryMap = new Map<string, FcEmployeeOvertimeSummary>();
  overtimeByDateAndEmp.forEach(dayMap => {
    dayMap.forEach((entry, empId) => {
      const emp = empById.get(empId);
      const setting = empSettingMap.get(empId);
      const rate = resolveFcEmpOtRate(setting, ownOtRate, threePlOtRate);
      const prev = empSummaryMap.get(empId);
      const addedHours = entry.hours;
      const addedCost = addedHours * rate;
      if (prev) {
        prev.approvedOvertimeHours += addedHours;
        prev.approvedOvertimeCost += addedCost;
      } else {
        empSummaryMap.set(empId, {
          employeeId: empId,
          employeeName: emp?.full_name ?? 'FC Employee',
          employeeCode: emp?.employee_code ?? '',
          employmentSource: (setting?.employment_source === '3pl' ? '3pl' : 'own'),
          approvedOvertimeHours: addedHours,
          otRate: rate,
          approvedOvertimeCost: addedCost,
          source: entry.source,
        });
      }
    });
  });

  const clientMap = new Map<string, {
    clientName: string; inbound: number; outboundB2c: number; outboundB2b: number;
    returns: number; vas: number; b2cOrders: number; b2bOrders: number;
  }>();
  (workspace.clientDailyVolumes ?? []).forEach(row => {
    const k = row.client_name.trim().toLowerCase();
    const cur = clientMap.get(k) ?? {
      clientName: row.client_name, inbound: 0, outboundB2c: 0, outboundB2b: 0,
      returns: 0, vas: 0, b2cOrders: 0, b2bOrders: 0,
    };
    cur.inbound += row.inbound_quantity;
    cur.outboundB2c += row.outbound_b2c_quantity;
    cur.outboundB2b += row.outbound_b2b_quantity;
    cur.returns += row.returns_quantity;
    cur.vas += row.vas_quantity;
    cur.b2cOrders += row.b2c_orders;
    cur.b2bOrders += row.b2b_orders;
    clientMap.set(k, cur);
  });
  const clientBreakdown: FcClientVolumeSummary[] = [...clientMap.values()].map(c => {
    const inbound = channelFilter === 'all' ? c.inbound : 0;
    const outboundB2c = channelFilter === 'b2b' ? 0 : c.outboundB2c;
    const outboundB2b = channelFilter === 'b2c' ? 0 : c.outboundB2b;
    const returns = channelFilter === 'all' ? c.returns : 0;
    const vas = channelFilter === 'all' ? c.vas : 0;
    return {
      clientName: c.clientName,
      inbound,
      outboundB2c,
      outboundB2b,
      returns,
      vas,
      totalThroughput: inbound + outboundB2c + outboundB2b + returns + vas,
      b2cUpt: outboundB2c > 0 && c.b2cOrders > 0 ? outboundB2c / c.b2cOrders : null,
      b2bUpt: outboundB2b > 0 && c.b2bOrders > 0 ? outboundB2b / c.b2bOrders : null,
    };
  }).filter(c => c.totalThroughput > 0).sort((a, b) => b.totalThroughput - a.totalThroughput);

  const sum = (field: keyof FcManpowerDayModel) => daily.reduce((total, day) => total + (typeof day[field] === 'number' ? day[field] as number : 0), 0);
  const b2cQuantity = scopedDays.reduce((total, day) => total + day.outbound_b2c_quantity, 0);
  const b2bQuantity = scopedDays.reduce((total, day) => total + day.outbound_b2b_quantity, 0);
  const b2cOrders = scopedDays.reduce((total, day) => total + day.b2c_orders, 0);
  const b2bOrders = scopedDays.reduce((total, day) => total + day.b2b_orders, 0);
  const totalRequiredDlp = sum('totalRequiredDlp');
  const actualDlp = sum('actualDlp');
  const overtimeRecommendedHours = sum('overtimeRecommendedHours');
  const overtimeRecommendedCost = sum('overtimeRecommendedCost');
  const actualOvertimeHours = sum('actualOvertimeHours');
  const actualOvertimeCost = sum('actualOvertimeCost');
  const scheduledDlpCount = daily.length > 0 ? Math.round(actualDlp / daily.length) : eligibleDlpCount;
  const otDenominator = scheduledDlpCount || eligibleDlpCount;

  return {
    daily,
    draftDates,
    activities,
    clientBreakdown,
    inbound: sum('inbound'),
    outboundB2c: b2cQuantity,
    outboundB2b: b2bQuantity,
    returns: sum('returns'),
    vas: sum('vas'),
    throughput: sum('throughput'),
    requiredDlp: sum('requiredDlp'),
    absenteeismBuffer: sum('absenteeismBuffer'),
    totalRequiredDlp,
    actualDlp,
    staffingGap: actualDlp - totalRequiredDlp,
    ownDlp: sum('ownDlp'),
    contractDlp: sum('contractDlp'),
    totalPresentDlp: sum('presentDlp'),
    totalAbsentDlp: sum('absentDlp'),
    rosterOwnDlpCount,
    rosterContractDlpCount,
    rosterNonDlpCount,
    indirectToDirectRatio: eligibleDlpCount > 0 ? rosterNonDlpCount / eligibleDlpCount : 0,
    eligibleDlpCount,
    scheduledDlpCount,
    requiredLaborHours: sum('requiredLaborHours'),
    availableLaborHours: sum('availableLaborHours'),
    totalTransferredInHours: sum('transferredInHours'),
    totalTransferredOutHours: sum('transferredOutHours'),
    totalRegularUnitsCapacity: sum('regularUnitsCapacity'),
    totalUnmetUnits: sum('unmetUnits'),
    overtimeRecommendedHours,
    overtimeRecommendedCost,
    averageOtRequiredPerPerson: otDenominator > 0 ? overtimeRecommendedHours / otDenominator : 0,
    overtimeCapacityHours: sum('overtimeCapacityHours'),
    uncoveredHours: sum('uncoveredHours'),
    peakAdditional3pl: Math.max(...daily.map(d => d.additional3pl), 0),
    actualOvertimeHours,
    actualOvertimeCost,
    overtimeCostSaved: Math.max(0, overtimeRecommendedCost - actualOvertimeCost),
    totalApprovedOtEmployees: empSummaryMap.size,
    approvedOvertimeByEmployee: [...empSummaryMap.values()].sort((a, b) => b.approvedOvertimeHours - a.approvedOvertimeHours),
    b2cUpt: b2cOrders ? b2cQuantity / b2cOrders : null,
    b2bUpt: b2bOrders ? b2bQuantity / b2bOrders : null,
    closingStorage: daily.at(-1)?.closingStorage ?? 0,
  };
}

export interface FcDayPreviewModel {
  totalThroughput: number;
  regularUnitsCapacity: number;
  unmetUnits: number;
  regularCapacityHours: number;
  requiredHours: number;
  requiredEmployees: number;
  scheduledDlp: number;
  overtimeHours: number;
  overtimeCost: number;
  otRequiredPerPerson: number;
  additional3pl: number;
  activities: Array<{ code: string; name: string; volume: number; target: number; uom: 'hour' | 'day'; laborHours: number; requiredDlp: number }>;
}

export function buildFcDayPreview(
  workspace: FcWorkspace,
  workDate: string,
  day: Partial<FcDailyManpowerProductivityRow>,
): FcDayPreviewModel {
  const standards = workspace.standards.filter(row => row.is_active);
  const availHours = Number(day.available_hours ?? workspace.settings?.standard_hours_per_day ?? 8);
  const absencePct = workspace.settings?.planned_absence_percent ?? 5;
  const maxOt = workspace.settings?.max_overtime_hours_per_day ?? 3;
  const ownRate = workspace.settings?.overtime_hourly_cost_own ?? 0;
  const threePlRate = workspace.settings?.overtime_hourly_cost_3pl ?? 0;

  const inputDay = {
    available_hours: availHours,
    inbound_quantity: Number(day.inbound_quantity ?? 0),
    return_rto_quantity: Number(day.return_rto_quantity ?? 0),
    return_cir_quantity: Number(day.return_cir_quantity ?? 0),
    outbound_b2c_quantity: Number(day.outbound_b2c_quantity ?? 0),
    outbound_b2b_quantity: Number(day.outbound_b2b_quantity ?? 0),
    vas_quantity: Number(day.vas_quantity ?? 0),
    gift_wrap_quantity: Number(day.gift_wrap_quantity ?? 0),
    other_activity_quantity: Number(day.other_activity_quantity ?? 0),
  };

  const totalThroughput = inputDay.inbound_quantity + inputDay.return_rto_quantity + inputDay.return_cir_quantity +
    inputDay.outbound_b2c_quantity + inputDay.outbound_b2b_quantity + inputDay.vas_quantity + inputDay.gift_wrap_quantity + inputDay.other_activity_quantity;

  const activities = standards.map(standard => {
    const reqDlp = requiredFor(inputDay, standard);
    return {
      code: standard.activity_code,
      name: standard.activity_name,
      volume: driverVolume(inputDay, standard.volume_driver),
      target: standard.units_per_worker,
      uom: standard.target_uom,
      laborHours: reqDlp * availHours,
      requiredDlp: reqDlp,
    };
  });

  const baseDlp = activities.reduce((sum, a) => sum + a.requiredDlp, 0);
  const requiredEmployees = baseDlp * (1 + absencePct / 100);
  const requiredHours = requiredEmployees * availHours;

  const wf = (workspace.workforceDays ?? []).find(w => w.workDate === workDate);
  const scheduledDlp = wf ? wf.ownDlp + wf.contractDlp : (workspace.employees ?? []).length;
  const regularCapacityHours = wf ? wf.availableLaborHours : scheduledDlp * availHours;

  const regularUnitsCapacity = requiredHours > 0
    ? Math.round(totalThroughput * Math.min(1, regularCapacityHours / requiredHours))
    : totalThroughput;
  const unmetUnits = Math.max(0, totalThroughput - regularUnitsCapacity);

  const shortageHours = Math.max(0, requiredHours - regularCapacityHours);
  const overtimeCapacityHours = scheduledDlp * maxOt;
  const overtimeHours = Math.min(shortageHours, overtimeCapacityHours);
  const uncoveredHours = Math.max(0, shortageHours - overtimeHours);
  const additional3pl = availHours > 0 ? Math.ceil(uncoveredHours / availHours) : 0;
  const otRequiredPerPerson = scheduledDlp > 0 ? overtimeHours / scheduledDlp : 0;
  const avgRate = ownRate || threePlRate || 0;
  const overtimeCost = overtimeHours * avgRate;

  return {
    totalThroughput,
    regularUnitsCapacity,
    unmetUnits,
    regularCapacityHours,
    requiredHours,
    requiredEmployees,
    scheduledDlp,
    overtimeHours,
    overtimeCost,
    otRequiredPerPerson,
    additional3pl,
    activities,
  };
}
