import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import readExcelFile from 'read-excel-file/node';
import { parseFcOrderSheets, type FcImportSheet } from '../src/lib/fc-orders-import.ts';
import { buildFcDashboard } from '../src/lib/fc-productivity-model.ts';
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

const suppliedWorkbook = 'C:\\Users\\shaik\\Downloads\\Orders 15Nov-21Nov 2026.xlsx';
test('supplied FC export matches the 15–21 Nov golden totals', { skip: !existsSync(suppliedWorkbook) }, async () => {
  const workbook = await readExcelFile(suppliedWorkbook);
  const preview = parseFcOrderSheets(workbook.map(sheet => ({ sheet: sheet.sheet, data: sheet.data })), '2026-11-15', suppliedWorkbook);
  assert.equal(preview.packedOrders, 1_244);
  assert.equal(preview.packedQuantity, 5_320);
});
