import type { FcWorkspace } from '../services/fc-productivity.service';

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

export function buildFcDashboard(workspace: FcWorkspace): FcDashboardModel {
  const packedOrders = workspace.packers.reduce((sum, row) => sum + row.packed_orders, 0);
  const packedQuantity = workspace.packers.reduce((sum, row) => sum + row.packed_quantity, 0);
  const mappingByLabel = new Map(workspace.mappings.map(row => [row.normalized_packer_label, row]));
  const employeeById = new Map(workspace.employees.map(row => [row.id, row]));
  const employeeGroups = new Map<string, { employeeId: string | null; name: string; labels: Set<string>; dates: Set<string>; orders: number; quantity: number }>();
  workspace.packers.forEach(row => {
    const mapping = mappingByLabel.get(row.normalized_packer_label);
    const employee = mapping ? employeeById.get(mapping.employee_id) : undefined;
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
  workspace.packers.forEach(row => { const value = dailyMap.get(row.work_date) ?? { packedOrders: 0, packedQuantity: 0 }; value.packedOrders += row.packed_orders; value.packedQuantity += row.packed_quantity; dailyMap.set(row.work_date, value); });
  const sellerMap = new Map<string, FcDashboardModel['sellers'][number]>();
  workspace.sellers.forEach(row => {
    const value = sellerMap.get(row.seller_name) ?? { sellerName: row.seller_name, b2bOrders: 0, b2bQuantity: 0, b2cOrders: 0, b2cQuantity: 0, otherOrders: 0, otherQuantity: 0, totalOrders: 0, totalQuantity: 0 };
    if (row.order_type === 'B2B') { value.b2bOrders += row.packed_orders; value.b2bQuantity += row.packed_quantity; }
    else if (row.order_type === 'B2C') { value.b2cOrders += row.packed_orders; value.b2cQuantity += row.packed_quantity; }
    else { value.otherOrders += row.packed_orders; value.otherQuantity += row.packed_quantity; }
    value.totalOrders += row.packed_orders; value.totalQuantity += row.packed_quantity; sellerMap.set(row.seller_name, value);
  });
  const cycle = (prefix: 'a2p' | 'p2p' | 'o2p' | 'p2s' | 'o2s') => {
    const samples = workspace.sellers.reduce((sum, row) => sum + row[`${prefix}_samples`], 0);
    const minutes = workspace.sellers.reduce((sum, row) => sum + row[`${prefix}_minutes`], 0);
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
