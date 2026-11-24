import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { test } from 'node:test';
import readExcelFile from 'read-excel-file/node';
import { parseFcOrderSheets, type FcImportSheet } from '../src/lib/fc-orders-import.ts';
import { parseFcManpowerSheets } from '../src/lib/fc-manpower-import.ts';
import { parseFcOperationalFiles } from '../src/lib/fc-operational-import.ts';
import { buildFcDashboard, buildFcManpowerDashboard } from '../src/lib/fc-productivity-model.ts';
import type { FcWorkspace } from '../src/services/fc-productivity.service.ts';

const headers = [
  'ORDER ID', 'ORDER PACKED AT', 'SELLER NAME', 'ORDER TYPE', 'TOTAL PACKED QUANTITY', 'PACKED BY',
  'HUB ASSIGNED AT', 'ORDER PICKED AT', 'O2P', 'P2S', 'O2S',
];

const row = (values: Array<string | number | Date | null>) => values;

test('FC parser enforces week boundaries, deduplication, defaults, and valid cycle samples', () => {
  const sheets: FcImportSheet[] = [{
    sheet: 'Orders',
    data: [
      headers,
      row(['A-1', '2026-11-15 08:00:00', 'Seller A', 'B2C', 3, 'Jane', '2026-11-15 07:00:00', '2026-11-15 07:30:00', 1, 2, 3]),
      row(['A-2', '2026-11-21 18:00:00', '', 'unexpected', 2, '', '2026-11-21 18:20:00', '2026-11-21 18:10:00', -1, 0.5, 1]),
      row(['A-2', '2026-11-21 18:00:00', 'Duplicate', 'B2B', 99, 'Jane', null, null, null, null, null]),
      row(['A-3', '2026-11-22 00:00:00', 'Outside', 'B2B', 1, 'Jane', null, null, null, null, null]),
      row(['A-4', '2026-11-20 10:00:00', 'Invalid', 'B2B', 0, 'Jane', null, null, null, null, null]),
    ],
  }];

  const preview = parseFcOrderSheets(sheets, '2026-11-15');
  assert.equal(preview.packedOrders, 2);
  assert.equal(preview.packedQuantity, 5);
  assert.equal(preview.additionalItems, 3);
  assert.equal(preview.duplicateRows, 1);
  assert.equal(preview.outOfWeekRows, 1);
  assert.equal(preview.invalidRows, 1);
  assert.equal(preview.blankPackerRows, 1);
  assert.equal(preview.unknownOrderTypeRows, 1);
  assert.equal(preview.dateFrom, '2026-11-15');
  assert.equal(preview.dateTo, '2026-11-21');
  const unspecified = preview.sellers.find(metric => metric.seller_name === 'Unspecified');
  assert.equal(unspecified?.order_type, 'Other');
  assert.equal(unspecified?.a2p_samples, 0, 'negative elapsed cycle samples are excluded');
  assert.equal(unspecified?.o2p_samples, 0, 'negative exported cycle samples are excluded');
  assert.equal(unspecified?.p2s_minutes, 30);
});

test('FC parser combines every worksheet that contains the required headers', () => {
  const preview = parseFcOrderSheets([
    { sheet: 'Notes', data: [['not', 'an', 'orders', 'sheet']] },
    { sheet: 'One', data: [headers, row(['1', '2026-11-15', 'A', 'B2B', 1, 'P1', null, null, null, null, null])] },
    { sheet: 'Two', data: [headers, row(['2', '2026-11-16', 'B', 'B2C', 4, 'P2', null, null, null, null, null])] },
  ], '2026-11-15');
  assert.equal(preview.packedOrders, 2);
  assert.equal(preview.packedQuantity, 5);
});

test('FC dashboard applies mappings dynamically and uses weighted cycle averages', () => {
  const packerBase = { id: 'x', organization_id: 'o', branch_id: 'b', department_id: 'd', week_id: 'w', created_at: '' };
  const sellerBase = { ...packerBase, seller_name: 'Seller', order_type: 'B2C' as const, p2p_minutes: 0, p2p_samples: 0, o2p_minutes: 0, o2p_samples: 0, p2s_minutes: 0, p2s_samples: 0, o2s_minutes: 0, o2s_samples: 0 };
  const workspace = {
    packers: [
      { ...packerBase, id: 'p1', work_date: '2026-11-15', packer_label: 'Alias A', normalized_packer_label: 'alias a', packed_orders: 2, packed_quantity: 5 },
      { ...packerBase, id: 'p2', work_date: '2026-11-16', packer_label: 'Alias A', normalized_packer_label: 'alias a', packed_orders: 1, packed_quantity: 1 },
      { ...packerBase, id: 'p3', work_date: '2026-11-16', packer_label: 'Unknown', normalized_packer_label: 'unknown', packed_orders: 1, packed_quantity: 2 },
    ],
    sellers: [
      { ...sellerBase, id: 's1', work_date: '2026-11-15', packed_orders: 2, packed_quantity: 5, a2p_minutes: 20, a2p_samples: 1 },
      { ...sellerBase, id: 's2', work_date: '2026-11-16', packed_orders: 2, packed_quantity: 3, a2p_minutes: 90, a2p_samples: 3 },
    ],
    mappings: [{ normalized_packer_label: 'alias a', employee_id: 'e1' }],
    employees: [{ id: 'e1', full_name: 'Mapped Employee' }],
    week: null, department: {}, sellerSupplements: [], capacity: null, adhocTasks: [],
  } as unknown as FcWorkspace;
  const model = buildFcDashboard(workspace);
  assert.equal(model.packedOrders, 4);
  assert.equal(model.packedQuantity, 8);
  assert.equal(model.additionalItems, 4);
  assert.equal(model.mappedOrders, 3);
  assert.equal(model.unassignedOrders, 1);
  assert.equal(model.employees.find(employee => employee.employeeId === 'e1')?.activeDays, 2);
  assert.equal(model.cycleTimes.a2p.minutes, 27.5);
  assert.equal(model.cycleTimes.a2p.samples, 4);
});

test('FC manpower model applies hourly and daily standards plus the 5% absenteeism buffer', () => {
  const workspace = {
    standards: [
      { activity_code: 'IN', activity_name: 'Inbound QC', volume_driver: 'inbound', target_uom: 'hour', units_per_worker: 100, is_active: true },
      { activity_code: 'RET', activity_name: 'Return QC', volume_driver: 'return_rto', target_uom: 'day', units_per_worker: 200, is_active: true },
    ],
    manpowerDays: [{ work_date: '2026-11-15', available_hours: 8, inbound_quantity: 800, return_rto_quantity: 200, return_cir_quantity: 0, outbound_b2c_quantity: 100, outbound_b2b_quantity: 200, vas_quantity: 0, gift_wrap_quantity: 0, other_activity_quantity: 0, b2c_orders: 50, b2b_orders: 2, closing_storage_quantity: 1000, actual_own_dlp: 2, actual_contract_dlp: 1 }],
    workforceDays: [{ workDate: '2026-11-15', ownDlp: 2, contractDlp: 1, availableLaborHours: 24, activeRosterDlp: 3, source: 'shift_schedule' }],
  } as unknown as FcWorkspace;
  const model = buildFcManpowerDashboard(workspace);
  assert.equal(model.requiredDlp, 2);
  assert.equal(model.absenteeismBuffer, 0.1);
  assert.equal(model.totalRequiredDlp, 2.1);
  assert.equal(model.actualDlp, 3);
  assert.ok(Math.abs(model.staffingGap - 0.9) < 1e-9);
  assert.equal(model.ownDlp, 2);
  assert.equal(model.contractDlp, 1);
  assert.equal(model.requiredLaborHours, 16.8);
  assert.equal(model.availableLaborHours, 24);
  assert.equal(model.b2cUpt, 2);
  assert.equal(model.b2bUpt, 100);

  const b2cModel = buildFcManpowerDashboard({
    standards: [
      { activity_code: 'IN', activity_name: 'Inbound QC', volume_driver: 'inbound', target_uom: 'hour', units_per_worker: 100, is_active: true },
      { activity_code: 'PACK_B2C', activity_name: 'Packer B2C', volume_driver: 'outbound_b2c', target_uom: 'hour', units_per_worker: 100, is_active: true },
      { activity_code: 'PACK_B2B', activity_name: 'Packer B2B', volume_driver: 'outbound_b2b', target_uom: 'hour', units_per_worker: 1000, is_active: true },
    ],
    manpowerDays: [{ work_date: '2026-11-15', available_hours: 8, inbound_quantity: 800, return_rto_quantity: 0, return_cir_quantity: 0, outbound_b2c_quantity: 800, outbound_b2b_quantity: 2000, vas_quantity: 0, gift_wrap_quantity: 0, other_activity_quantity: 0, b2c_orders: 400, b2b_orders: 20, closing_storage_quantity: 0, actual_own_dlp: 2, actual_contract_dlp: 1 }],
    workforceDays: [{ workDate: '2026-11-15', ownDlp: 2, contractDlp: 1, availableLaborHours: 24, activeRosterDlp: 3, source: 'shift_schedule' }],
  } as unknown as FcWorkspace, 'b2c');
  assert.equal(b2cModel.outboundB2c, 800);
  assert.equal(b2cModel.outboundB2b, 0);
  assert.equal(b2cModel.throughput, 800);
  assert.equal(b2cModel.requiredDlp, 1);
  assert.equal(b2cModel.b2cUpt, 2);
  assert.equal(b2cModel.b2bUpt, null);
});

const suppliedWorkbook = 'C:\\Users\\shaik\\Downloads\\Orders 15Nov-21Nov 2026.xlsx';
test('supplied FC export matches the 15–21 Nov golden totals', { skip: !existsSync(suppliedWorkbook) }, async () => {
  const workbook = await readExcelFile(suppliedWorkbook);
  const preview = parseFcOrderSheets(workbook.map(sheet => ({ sheet: sheet.sheet, data: sheet.data })), '2026-11-15', suppliedWorkbook);
  assert.equal(preview.packedOrders, 1_244);
  assert.equal(preview.packedQuantity, 5_320);
});

const manpowerWorkbook = 'C:\\Users\\shaik\\Downloads\\FC Daily Manpower Productivity Analysis- Dec 2025 (2).xlsx';
test('real FC manpower workbook imports the populated 2026 daily operational history', { skip: !existsSync(manpowerWorkbook) }, async () => {
  const workbook = await readExcelFile(manpowerWorkbook);
  const preview = parseFcManpowerSheets(workbook.map(sheet => ({ sheet: sheet.sheet, data: sheet.data })), manpowerWorkbook);
  assert.equal(preview.days.length, 289);
  assert.equal(preview.sheetCount, 11);
  assert.equal(preview.firstDate, '2026-01-01');
  assert.equal(preview.lastDate, '2026-11-21');
  assert.equal(preview.days.filter(day => day.work_date >= '2026-11-15' && day.work_date <= '2026-11-21').length, 6);
});

const operationalFiles = [
  'C:\\Users\\shaik\\Downloads\\Orders.csv',
  'C:\\Users\\shaik\\Downloads\\VAS.csv',
  'C:\\Users\\shaik\\Downloads\\GRN - Returns.csv',
];
test('daily operational CSV exports aggregate the 15–21 Nov FC source totals', { skip: operationalFiles.some(file => !existsSync(file)) }, async () => {
  const files = operationalFiles.map(path => new File([readFileSync(path)], basename(path), { type: 'text/csv' }));
  const preview = await parseFcOperationalFiles(files, '2026-11-15', '2026-11-21');
  assert.equal(preview.days.length, 6);
  assert.equal(preview.totals.inbound_quantity, 6_589);
  assert.equal(preview.totals.return_rto_quantity, 338);
  assert.equal(preview.totals.outbound_b2c_quantity, 3_823);
  assert.equal(preview.totals.outbound_b2b_quantity, 29_639);
  assert.equal(preview.totals.other_activity_quantity, 75);
  assert.equal(preview.totals.b2c_orders, 1_309);
  assert.equal(preview.totals.b2b_orders, 21);
  assert.equal(preview.totals.vas_quantity, 4_731);
});
