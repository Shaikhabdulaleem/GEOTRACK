import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateAymakanReturns, aggregateAymakanReturnsByClient, aggregateAymakanSnapshot, aggregateAymakanTurnaroundMetrics, buildShiftTimeWindows, detectShipmentShift, firstCompleteAymakanMonthDate, getAymakanImportGroup, getAymakanReceivingDates, groupAymakanImportDaysByMonth, parseAymakanCsv, parseAymakanSnapshot, validationBatchCloseDate } from '../src/lib/aymakan-import.ts';

const clients = [
  { id: 'barq', code: 'BARQ', name: 'Barq' },
  { id: 'neo', code: 'NEOLEAP', name: 'Neoleap' },
  { id: 'urpay', code: 'URPAY', name: 'Urpay' },
  { id: 'mawarid', code: 'AL_MAWARID', name: 'Al Mawarid' },
  { id: 'elm', code: 'ELM', name: 'ELM' },
];

test('applies the approved received and processed rules', () => {
  const snapshot = parseAymakanSnapshot({
    source: 'aymakan-portal',
    work_date: '2026-11-19',
    shipments: [
      { tracking_number: 'B-1', customer: 'Barq', status: 'Received - Waiting Address Validation' },
      { tracking_number: 'N-1', customer: 'Neoleap', status: 'Received - Waiting Address Validation' },
      { tracking_number: 'N-2', customer: 'Neoleap', status: 'Delivered', third_party_provider: 'jnt' },
      { tracking_number: 'U-1', customer: 'Urpay', status: 'Cancelled' },
      { tracking_number: 'M-1', customer: 'Al Mawarid', status: 'Received - Waiting Address Validation' },
      { tracking_number: 'E-1', customer: 'ELM', status: 'Returned', third_party_provider: 'JNT' },
    ],
  });
  const result = aggregateAymakanSnapshot(snapshot, clients);
  const byCode = Object.fromEntries(result.clients.map(row => [row.client_code, row]));

  assert.deepEqual(
    Object.fromEntries(Object.entries(byCode).map(([code, row]) => [code, [row.received_units, row.processed_units, row.jnt_units]])),
    {
      BARQ: [1, 1, 0],
      NEOLEAP: [2, 1, 1],
      URPAY: [1, 1, 0],
      AL_MAWARID: [1, 0, 0],
      ELM: [1, 1, 1],
    },
  );
});

test('excludes duplicate tracking numbers and reports unknown customers', () => {
  const snapshot = parseAymakanSnapshot({
    source: 'aymakan-portal',
    work_date: '2026-11-19',
    shipments: [
      { tracking_number: 'AY-1', customer: 'Barq', status: 'Delivered' },
      { tracking_number: 'ay 1', customer: 'Barq', status: 'Delivered' },
      { tracking_number: 'AY-2', customer: 'Unknown Client', status: 'Delivered' },
    ],
  });
  const result = aggregateAymakanSnapshot(snapshot, clients);
  assert.equal(result.duplicateShipments, 1);
  assert.equal(result.ignoredShipments, 1);
  assert.deepEqual(result.unmatchedCustomers, ['Unknown Client']);
  assert.equal(result.clients.find(row => row.client_code === 'BARQ')?.received_units, 1);
});

test('rejects malformed snapshots', () => {
  assert.throws(() => parseAymakanSnapshot({ source: 'other', work_date: '19-11-2026', shipments: [] }), /valid Aymakan/);
});

test('separates receiving-date and validation customer exports', () => {
  assert.equal(getAymakanImportGroup('Barq'), 'receiving');
  assert.equal(getAymakanImportGroup('ELM'), 'receiving');
  assert.equal(getAymakanImportGroup('Elm - Express'), 'receiving');
  assert.equal(getAymakanImportGroup('Urpay'), 'validation');
  assert.equal(getAymakanImportGroup('Neoleap'), 'validation');
  assert.equal(getAymakanImportGroup('Al Mawarid Manpower Co'), 'validation');
  assert.equal(getAymakanImportGroup('Unknown'), null);
});

test('parses a shipping export CSV and maps portal customer names', () => {
  const csv = [
    'Tracking,Customer,Receiving Date,Formatted Receiving Date,Validation Date,Status,3PL Provider,Address',
    'AY-1,Elm - Express,2026-11-18 10:00:00,11/18/2026,2026-11-18 10:05:00,Delivered,jnt,"Riyadh, Saudi Arabia"',
    'AY-2,Al Mawarid Manpower Co,2026-11-18 10:10:00,11/18/2026,,Received - Waiting Address Validation,,Riyadh',
  ].join('\n');
  const snapshot = parseAymakanCsv(csv);
  const result = aggregateAymakanSnapshot(snapshot, clients, '2026-11-18');
  const byCode = Object.fromEntries(result.clients.map(row => [row.client_code, row]));

  assert.equal(snapshot.work_date, '2026-11-18');
  assert.deepEqual([byCode.ELM.received_units, byCode.ELM.processed_units, byCode.ELM.jnt_units], [1, 1, 1]);
  assert.deepEqual([byCode.AL_MAWARID.received_units, byCode.AL_MAWARID.processed_units], [1, 0]);
});

test('accepts daily and overall Barq/ELM receiving-date exports', () => {
  const daily = parseAymakanCsv([
    'Tracking,Customer,Receiving Date,Validation Date,Status,3PL Provider',
    'B-1,Barq,2026-11-18 08:00:00,,Delivered,',
    'E-1,Elm - Express,2026-11-18 09:00:00,,Delivered,jnt',
  ].join('\n'));
  const overall = parseAymakanCsv([
    'Tracking,Customer,Receiving Date,Validation Date,Status,3PL Provider',
    'B-1,Barq,2026-11-17 08:00:00,,Delivered,',
    'E-1,ELM,2026-11-18 09:00:00,,Delivered,jnt',
    'E-2,Elm - Express,2026-11-19 10:00:00,,Returned,',
  ].join('\n'));

  assert.deepEqual(getAymakanReceivingDates(daily, 'receiving'), ['2026-11-18']);
  assert.deepEqual(getAymakanReceivingDates(overall, 'receiving'), ['2026-11-17', '2026-11-18', '2026-11-19']);
});

test('parses Aymakan US dates that include a time', () => {
  const csv = [
    'Tracking,Customer,Receiving Date,Formatted Receiving Date,Validation Date,Status,3PL Provider',
    'AY-1,Urpay,2026-11-18 08:00:00,11/18/2026,11/18/2026 9:56,Delivered,jnt',
    'AY-2,Neoleap,2026-11-17 08:00:00,11/17/2026,11/18/2026 10:05:30,Delivered,',
  ].join('\n');
  const result = aggregateAymakanSnapshot(parseAymakanCsv(csv), clients, '2026-11-18');
  const byCode = Object.fromEntries(result.clients.map(row => [row.client_code, row]));

  assert.deepEqual([byCode.URPAY.received_units, byCode.URPAY.processed_units, byCode.URPAY.jnt_units], [1, 1, 1]);
  assert.deepEqual([byCode.NEOLEAP.received_units, byCode.NEOLEAP.processed_units], [0, 1]);
});

test('counts validation on the selected day even when receipt was earlier', () => {
  const csv = [
    'Tracking,Customer,Receiving Date,Validation Date,Status,3PL Provider',
    'AY-1,Urpay,2026-11-16 10:00:00,2026-11-18 09:00:00,Delivered,jnt',
    'AY-2,Urpay,2026-11-18 10:00:00,,Received - Waiting Address Validation,',
    'AY-3,Barq,2026-11-18 11:00:00,,Received - Waiting Address Validation,jnt',
  ].join('\n');
  const result = aggregateAymakanSnapshot(parseAymakanCsv(csv), clients, '2026-11-18');
  const byCode = Object.fromEntries(result.clients.map(row => [row.client_code, row]));

  assert.deepEqual([byCode.URPAY.received_units, byCode.URPAY.processed_units, byCode.URPAY.jnt_units], [1, 1, 1]);
  assert.deepEqual([byCode.BARQ.received_units, byCode.BARQ.processed_units, byCode.BARQ.jnt_units], [1, 1, 1]);
  assert.equal(result.uniqueShipments, 3);
});

test('groups a full validation export chronologically so receipts save before later validations', () => {
  const groups = groupAymakanImportDaysByMonth([
    { workDate: '2026-10-31', value: 'receipt' },
    { workDate: '2026-11-01', value: 'validation' },
    { workDate: '2026-11-02', value: 'next day' },
  ]);

  assert.deepEqual(groups.map(group => group.map(day => day.workDate)), [
    ['2026-10-31'],
    ['2026-11-01', '2026-11-02'],
  ]);
});

test('starts backlog tracking at the first complete month in a partial historical export', () => {
  assert.equal(firstCompleteAymakanMonthDate('2026-08-23'), '2026-09-01');
  assert.equal(firstCompleteAymakanMonthDate('2026-09-01'), '2026-09-01');
  const snapshot = parseAymakanSnapshot({
    source: 'aymakan-portal',
    work_date: '2026-09-02',
    shipments: [
      { tracking_number: 'OLD-1', customer: 'Neoleap', status: 'Validated', receiving_date: '2026-08-20', validation_date: '2026-09-02' },
      { tracking_number: 'NEW-1', customer: 'Neoleap', status: 'Validated', receiving_date: '2026-09-01', validation_date: '2026-09-02' },
    ],
  });
  const result = aggregateAymakanSnapshot(snapshot, clients, '2026-09-02', '2026-09-01');
  const neoleap = result.clients.find(row => row.client_code === 'NEOLEAP');

  assert.deepEqual([neoleap?.processed_units, neoleap?.backlog_released_units], [2, 1]);
});

test('does not release backlog before a shipment receiving date', () => {
  const snapshot = parseAymakanSnapshot({
    source: 'aymakan-portal',
    work_date: '2026-09-21',
    shipments: [
      { tracking_number: 'N-1', customer: 'Neoleap', status: 'Validated', receiving_date: '2026-09-21', validation_date: '2026-09-20' },
    ],
  });
  const validationDay = aggregateAymakanSnapshot(snapshot, clients, '2026-09-20', '2026-09-01').clients.find(row => row.client_code === 'NEOLEAP');
  const receivingDay = aggregateAymakanSnapshot(snapshot, clients, '2026-09-21', '2026-09-01').clients.find(row => row.client_code === 'NEOLEAP');

  assert.deepEqual([validationDay?.processed_units, validationDay?.backlog_released_units], [1, 0]);
  assert.deepEqual([receivingDay?.received_units, receivingDay?.backlog_released_units], [1, 1]);
});

test('counts received and processed independently from their portal dates', () => {
  const shipments = Array.from({ length: 433 }, (_, index) => ({
    tracking_number: `U-${index + 1}`,
    customer: 'Urpay',
    status: index < 386 ? 'Validated' : 'Received - Waiting Address Validation',
    receiving_date: '2026-11-18',
    validation_date: index < 386 ? '2026-11-18' : null,
  }));
  const result = aggregateAymakanSnapshot(parseAymakanSnapshot({ source: 'aymakan-portal', work_date: '2026-11-18', shipments }), clients, '2026-11-18');
  const urpay = result.clients.find(row => row.client_code === 'URPAY');

  assert.deepEqual(
    [urpay?.received_units, urpay?.processed_units, urpay?.backlog_released_units, urpay?.batch_closed_units],
    [433, 386, 386, 0],
  );
});

test('closes only the remaining validation backlog on the next month 25th', () => {
  assert.equal(validationBatchCloseDate('2026-09-01'), '2026-10-25');
  assert.equal(validationBatchCloseDate('2026-12-31'), '2027-01-25');
  const snapshot = parseAymakanSnapshot({
    source: 'aymakan-portal',
    work_date: '2026-10-26',
    shipments: [
      { tracking_number: 'U-1', customer: 'Urpay', status: 'Validated', receiving_date: '2026-09-10', validation_date: '2026-10-24' },
      { tracking_number: 'U-2', customer: 'Urpay', status: 'Validated', receiving_date: '2026-09-11', validation_date: '2026-10-26' },
      { tracking_number: 'U-3', customer: 'Urpay', status: 'Received - Waiting Address Validation', receiving_date: '2026-09-12', validation_date: null },
    ],
  });
  const closeDay = aggregateAymakanSnapshot(snapshot, clients, '2026-10-25').clients.find(row => row.client_code === 'URPAY');
  const lateValidation = aggregateAymakanSnapshot(snapshot, clients, '2026-10-26').clients.find(row => row.client_code === 'URPAY');

  assert.deepEqual([closeDay?.processed_units, closeDay?.backlog_released_units, closeDay?.batch_closed_units], [0, 0, 2]);
  assert.deepEqual([lateValidation?.processed_units, lateValidation?.backlog_released_units, lateValidation?.batch_closed_units], [1, 0, 0]);
});

test('calculates turnaround from receiving or validation and groups by destination bucket', () => {
  const snapshot = parseAymakanCsv([
    'Tracking,Customer,Receiving Date,Validation Date,LMD Handed Over At,Destination WH,Status,3PL Provider',
    'B-1,Barq,11/18/2026 08:00,,11/18/2026 10:30,RUH,Delivered,',
    'B-2,Barq,11/18/2026 08:00,,11/18/2026 11:00,HOF,Delivered,',
    'U-1,Urpay,11/17/2026 08:00,11/18/2026 09:00,11/18/2026 11:00,JED,Delivered,j&t',
    'U-2,Urpay,11/18/2026 08:00,11/18/2026 10:00,11/18/2026 09:00,JED,Delivered,jnt',
  ].join('\n'));
  const metrics = aggregateAymakanTurnaroundMetrics(snapshot, clients, '2026-11-18');
  const totals = aggregateAymakanSnapshot(snapshot, clients, '2026-11-18');

  assert.deepEqual(metrics.map(row => [row.client_id, row.warehouse_code, row.total_minutes, row.shipment_count]), [
    ['barq', 'RUH', 150, 1],
    ['barq', 'Other cities', 180, 1],
    ['urpay', 'Makanex', 120, 1],
  ]);
  assert.equal(totals.clients.find(row => row.client_code === 'BARQ')?.jnt_units, 0);
  assert.equal(totals.clients.find(row => row.client_code === 'URPAY')?.jnt_units, 2);
});

test('counts MR-On hold returns by Updated At and excludes duplicate tracking numbers', () => {
  const snapshot = parseAymakanCsv([
    'Tracking,Customer,Receiving Date,Validation Date,Updated At,Status',
    'R-1,Urpay,11/17/2026 08:00,,11/18/2026 09:00,MR-On hold',
    'r 1,Urpay,11/17/2026 08:00,,11/18/2026 10:00,MR-On hold',
    'R-2,Neoleap,11/17/2026 08:00,,11/18/2026 11:00,Delivered',
    'R-3,Neoleap,11/17/2026 08:00,,11/19/2026 11:00,MR-On hold',
    'R-4,Barq,11/17/2026 08:00,,11/18/2026 12:00,MR-On hold',
  ].join('\n'));

  assert.equal(aggregateAymakanReturns(snapshot, '2026-11-18'), 2);
  assert.equal(aggregateAymakanReturns(snapshot, '2026-11-19'), 1);
  assert.deepEqual(
    [...aggregateAymakanReturnsByClient(snapshot, clients, '2026-11-18')].sort((a, b) => a[0].localeCompare(b[0])),
    [['barq', 1], ['urpay', 1]],
  );
  assert.deepEqual([...aggregateAymakanReturnsByClient(snapshot, clients, '2026-11-19')], [['neo', 1]]);

  const snapshotResult = aggregateAymakanSnapshot(snapshot, clients, '2026-11-18');
  const byCode = Object.fromEntries(snapshotResult.clients.map(row => [row.client_code, row.return_units]));
  assert.equal(byCode.BARQ, 1);
  assert.equal(byCode.URPAY, 1);
  assert.equal(byCode.NEOLEAP, 0);
  assert.equal(byCode.ELM, 0);
});

test('recognizes J&T Express and provider column variants for DSP partner allocation', () => {
  const csv = [
    'Tracking,Customer,Receiving Date,Validation Date,Status,3pl Provider',
    'J-1,Barq,11/18/2026 08:00,,Delivered,J&T Express',
    'J-2,ELM,11/18/2026 08:30,,Delivered,JT Express',
    'J-3,Barq,11/18/2026 09:00,,Delivered,JNT Express',
    'J-4,ELM,11/18/2026 09:30,,Delivered,J&T Express KSA',
    'J-5,Barq,11/18/2026 10:00,,Delivered,OtherCourier',
  ].join('\n');
  const snapshot = parseAymakanCsv(csv);
  const result = aggregateAymakanSnapshot(snapshot, clients, '2026-11-18');
  const byCode = Object.fromEntries(result.clients.map(row => [row.client_code, row]));

  assert.equal(byCode.BARQ.jnt_units, 2); // J-1 and J-3
  assert.equal(byCode.ELM.jnt_units, 2);  // J-2 and J-4
});

test('detects Day and Night shift handovers including overnight Night shifts', () => {
  const windows = buildShiftTimeWindows([
    { name: 'Day Shift', start_time: '08:00', end_time: '17:00', crosses_midnight: false, status: 'active' },
    { name: 'Night Shift', start_time: '21:00', end_time: '05:00', crosses_midnight: true, status: 'active' },
  ]);

  const dayDetect = detectShipmentShift(Date.UTC(2026, 10, 24, 14, 15, 0), windows);
  assert.deepEqual(dayDetect, { shiftType: 'day', shiftWorkDate: '2026-11-24' });

  const nightPreMidnight = detectShipmentShift(Date.UTC(2026, 10, 24, 22, 30, 0), windows);
  assert.deepEqual(nightPreMidnight, { shiftType: 'night', shiftWorkDate: '2026-11-24' });

  const nightPostMidnight = detectShipmentShift(Date.UTC(2026, 10, 25, 2, 12, 32), windows);
  assert.deepEqual(nightPostMidnight, { shiftType: 'night', shiftWorkDate: '2026-11-24' });

  const csv = [
    'Tracking,Customer,Receiving Date,Validation Date,LMD Handed Over At,Destination WH,Status,3PL Provider',
    'D-1,Barq,2026-11-24 11:30:00,,2026-11-24 14:00:00,RUH,Delivered,',
    'N-1,Barq,2026-11-24 21:17:01,,2026-11-25 02:12:32,JED,Delivered,',
    'N-2,Barq,2026-11-24 21:48:17,,2026-11-25 02:11:40,HOF,Delivered,JNT Express',
  ].join('\n');
  const snapshot = parseAymakanCsv(csv);
  const metrics = aggregateAymakanTurnaroundMetrics(snapshot, clients, '2026-11-24', windows);

  assert.deepEqual(
    metrics.map(row => [row.warehouse_code, row.shift_type, row.shipment_count]),
    [
      ['RUH', 'day', 1],
      ['JED', 'night', 1],
      ['Makanex', 'night', 1],
    ],
  );
});

test('attributes overtime handovers in inter-shift gaps (e.g. 6-7 AM) to the preceding shift', () => {
  const windows = buildShiftTimeWindows([
    { name: 'Day Shift', start_time: '08:00', end_time: '17:00', crosses_midnight: false, status: 'active' },
    { name: 'Night Shift', start_time: '21:00', end_time: '05:00', crosses_midnight: true, status: 'active' },
  ]);

  assert.deepEqual(
    detectShipmentShift(Date.UTC(2026, 10, 25, 6, 15, 0), windows),
    { shiftType: 'night', shiftWorkDate: '2026-11-24' },
  );
  assert.deepEqual(
    detectShipmentShift(Date.UTC(2026, 10, 25, 7, 45, 0), windows),
    { shiftType: 'night', shiftWorkDate: '2026-11-24' },
  );
  assert.deepEqual(
    detectShipmentShift(Date.UTC(2026, 10, 24, 18, 30, 0), windows),
    { shiftType: 'day', shiftWorkDate: '2026-11-24' },
  );

  const csv = [
    'Tracking,Customer,Receiving Date,Validation Date,LMD Handed Over At,Destination WH,Status,3PL Provider',
    'OT-1,Barq,2026-11-24 22:00:00,,2026-11-25 06:30:00,RUH,Delivered,',
    'OT-2,Elm - Express,2026-11-24 23:00:00,,2026-11-25 07:15:00,JED,Delivered,',
    'OT-3,Barq,2026-11-24 10:00:00,,2026-11-24 18:45:00,DMM,Delivered,',
  ].join('\n');
  const snapshot = parseAymakanCsv(csv);
  const metrics = aggregateAymakanTurnaroundMetrics(snapshot, clients, '2026-11-24', windows);

  assert.deepEqual(
    metrics.map(row => [row.client_id, row.warehouse_code, row.shift_type, row.shipment_count]),
    [
      ['barq', 'RUH', 'night', 1],
      ['elm', 'JED', 'night', 1],
      ['barq', 'DMM', 'day', 1],
    ],
  );
});
