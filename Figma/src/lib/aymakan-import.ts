import Papa from 'papaparse';

export const AYMAKAN_WAITING_VALIDATION_STATUS = 'Received - Waiting Address Validation';

export interface AymakanShipmentSnapshotRow {
  tracking_number: string;
  customer: string;
  status: string;
  third_party_provider?: string | null;
  receiving_date?: string | null;
  validation_date?: string | null;
  updated_date?: string | null;
  receiving_at_ms?: number | null;
  validation_at_ms?: number | null;
  lmd_handover_at_ms?: number | null;
  warehouse_code?: string | null;
}

export interface AymakanShipmentSnapshot {
  source: 'aymakan-portal';
  work_date?: string;
  generated_at?: string;
  shipments: AymakanShipmentSnapshotRow[];
}

export interface AymakanClientDefinition {
  id: string;
  code: string;
  name: string;
}

export interface AymakanClientImportTotal {
  client_id: string;
  client_code: string;
  client_name: string;
  received_units: number;
  processed_units: number;
  backlog_released_units: number;
  batch_closed_units: number;
  jnt_units: number;
  return_units: number;
  turnaround_total_minutes: number;
  turnaround_shipment_count: number;
}

export interface AymakanImportResult {
  workDate: string;
  uniqueShipments: number;
  duplicateShipments: number;
  ignoredShipments: number;
  unmatchedCustomers: string[];
  clients: AymakanClientImportTotal[];
}

export type MailroomShiftType = 'day' | 'night' | 'unassigned';

export interface ShiftTimeWindow {
  shiftType: 'day' | 'night';
  startMinutes: number;
  endMinutes: number;
  crossesMidnight: boolean;
}

export interface AymakanTurnaroundMetric {
  client_id: string;
  warehouse_code: string;
  shift_type: MailroomShiftType;
  total_minutes: number;
  shipment_count: number;
}

export type AymakanImportGroup = 'receiving' | 'validation';

export function groupAymakanImportDaysByMonth<T extends { workDate: string }>(days: T[]): T[][] {
  const groups = new Map<string, T[]>();
  days.forEach(day => {
    const month = day.workDate.slice(0, 7);
    const group = groups.get(month) ?? [];
    group.push(day);
    groups.set(month, group);
  });
  return [...groups.values()];
}

export function firstCompleteAymakanMonthDate(firstObservedDate: string): string {
  if (firstObservedDate.endsWith('-01')) return firstObservedDate;
  const date = new Date(`${firstObservedDate.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

export function getAymakanReceivingDates(snapshot: AymakanShipmentSnapshot, group: AymakanImportGroup): string[] {
  return [...new Set(snapshot.shipments
    .filter(shipment => getAymakanImportGroup(shipment.customer) === group)
    .map(shipment => shipment.receiving_date)
    .filter((date): date is string => Boolean(date)))]
    .sort();
}

const VALIDATION_GATED_CLIENTS = new Set(['NEOLEAP', 'URPAY', 'AL_MAWARID']);
const CUSTOMER_ALIASES: Record<string, string> = {
  barq: 'BARQ',
  elm: 'ELM',
  elmexpress: 'ELM',
  neoleap: 'NEOLEAP',
  urpay: 'URPAY',
  almawarid: 'AL_MAWARID',
  almawaridmanpowerco: 'AL_MAWARID',
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, '');
}

export function validationBatchCloseDate(receivingDate: string): string {
  const year = Number(receivingDate.slice(0, 4));
  const month = Number(receivingDate.slice(5, 7));
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-25`;
}

function canonicalClientCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

export function getAymakanImportGroup(customer: string): AymakanImportGroup | null {
  const code = CUSTOMER_ALIASES[normalize(customer)];
  if (!code) return null;
  return VALIDATION_GATED_CLIENTS.has(code) ? 'validation' : 'receiving';
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function exportDateToIso(value: string): string | null {
  const trimmed = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const usMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)?$/i.exec(trimmed);
  if (!usMatch) return null;
  return `${usMatch[3]}-${usMatch[1].padStart(2, '0')}-${usMatch[2].padStart(2, '0')}`;
}

function exportTimestampToMillis(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})\/(\d{1,2})\/(\d{4}))(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1] ?? match[6]);
  const month = Number(match[2] ?? match[4]);
  const day = Number(match[3] ?? match[5]);
  let hour = Number(match[7] ?? 0);
  const minute = Number(match[8] ?? 0);
  const second = Number(match[9] ?? 0);
  const meridiem = match[10]?.toUpperCase();
  if (meridiem === 'AM' && hour === 12) hour = 0;
  if (meridiem === 'PM' && hour < 12) hour += 12;
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

export function isJntProvider(value?: string | null): boolean {
  if (!value) return false;
  const raw = value.trim().toLowerCase();
  const norm = normalize(value);
  if (['jnt', 'jt', 'jandt'].includes(norm)) return true;
  if (norm.startsWith('jnt') || norm.startsWith('jandt')) return true;
  if (norm.startsWith('jtexpress') || norm.startsWith('jtksa') || norm.startsWith('jtsa')) return true;
  if (raw.includes('j&t') || raw.includes('j & t') || raw.includes('j and t')) return true;
  return false;
}

export function aggregateAymakanReturns(snapshot: AymakanShipmentSnapshot, selectedWorkDate: string): number {
  const seen = new Set<string>();
  let count = 0;
  snapshot.shipments.forEach(shipment => {
    const tracking = normalize(shipment.tracking_number);
    if (seen.has(tracking)) return;
    seen.add(tracking);
    if (normalize(shipment.status) === 'mronhold' && shipment.updated_date === selectedWorkDate) count += 1;
  });
  return count;
}

export function aggregateAymakanReturnsByClient(
  snapshot: AymakanShipmentSnapshot,
  clients: AymakanClientDefinition[],
  selectedWorkDate: string,
): Map<string, number> {
  const lookup = buildClientLookup(clients);
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  snapshot.shipments.forEach(shipment => {
    const tracking = normalize(shipment.tracking_number);
    if (seen.has(tracking)) return;
    seen.add(tracking);
    if (normalize(shipment.status) !== 'mronhold' || shipment.updated_date !== selectedWorkDate) return;
    const client = lookup.get(normalize(shipment.customer));
    if (client) counts.set(client.id, (counts.get(client.id) ?? 0) + 1);
  });
  return counts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseAymakanSnapshot(value: string | unknown): AymakanShipmentSnapshot {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!isRecord(parsed) || parsed.source !== 'aymakan-portal' || !isIsoDate(parsed.work_date) || !Array.isArray(parsed.shipments)) {
    throw new Error('This is not a valid Aymakan portal snapshot.');
  }

  const shipments = parsed.shipments.map((row, index): AymakanShipmentSnapshotRow => {
    if (!isRecord(row)) throw new Error(`Shipment row ${index + 1} is invalid.`);
    const tracking = typeof row.tracking_number === 'string' ? row.tracking_number.trim() : '';
    const customer = typeof row.customer === 'string' ? row.customer.trim() : '';
    const status = typeof row.status === 'string' ? row.status.trim() : '';
    if (!tracking || !customer || !status) {
      throw new Error(`Shipment row ${index + 1} is missing tracking, customer, or status.`);
    }
    return {
      tracking_number: tracking,
      customer,
      status,
      third_party_provider: typeof row.third_party_provider === 'string' ? row.third_party_provider.trim() : null,
      receiving_date: typeof row.receiving_date === 'string' ? exportDateToIso(row.receiving_date) : null,
      validation_date: typeof row.validation_date === 'string' ? exportDateToIso(row.validation_date) : null,
      updated_date: typeof row.updated_date === 'string' ? exportDateToIso(row.updated_date) : null,
      receiving_at_ms: typeof row.receiving_at_ms === 'number' ? row.receiving_at_ms : null,
      validation_at_ms: typeof row.validation_at_ms === 'number' ? row.validation_at_ms : null,
      lmd_handover_at_ms: typeof row.lmd_handover_at_ms === 'number' ? row.lmd_handover_at_ms : null,
      warehouse_code: typeof row.warehouse_code === 'string' ? row.warehouse_code.trim() : null,
    };
  });

  return {
    source: 'aymakan-portal',
    work_date: parsed.work_date,
    generated_at: typeof parsed.generated_at === 'string' ? parsed.generated_at : undefined,
    shipments,
  };
}

export function parseAymakanCsv(value: string): AymakanShipmentSnapshot {
  const parsed = Papa.parse<Record<string, string>>(value, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: header => header.trim(),
  });
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new Error(`The Aymakan CSV could not be read${typeof first.row === 'number' ? ` near row ${first.row + 2}` : ''}: ${first.message}`);
  }

  const requiredColumns = ['Tracking', 'Customer', 'Status', 'Receiving Date', 'Validation Date'];
  const missingColumns = requiredColumns.filter(column => !parsed.meta.fields?.includes(column));
  if (missingColumns.length > 0) {
    throw new Error(`This is not a valid Aymakan shipping export. Missing: ${missingColumns.join(', ')}.`);
  }

  const workDates = new Set<string>();
  const shipments = parsed.data.map((row, index): AymakanShipmentSnapshotRow => {
    const tracking = (row.Tracking ?? '').trim();
    const customer = (row.Customer ?? '').trim();
    const status = (row.Status ?? '').trim();
    if (!tracking || !customer || !status) throw new Error(`Aymakan export row ${index + 2} is missing Tracking, Customer, or Status.`);

    const receivingDate = exportDateToIso(row['Formatted Receiving Date'] ?? '') ?? exportDateToIso(row['Receiving Date'] ?? '');
    const validationDate = exportDateToIso(row['Validation Date'] ?? '');
    const updatedDate = exportDateToIso(row['Updated At'] ?? '');
    if (receivingDate) workDates.add(receivingDate);
    const find3plProvider = (): string | null => {
      const candidates = [
        '3PL Provider', '3pl Provider', '3PL provider', '3pl provider',
        '3PL Partner', '3pl Partner', '3PL partner', '3pl partner',
        '3PL', '3pl',
        'Third Party Provider', 'Third Party Partner', 'Third Party',
        'Courier', 'courier', 'DSP Partner', 'DSP Provider', 'DSP',
      ];
      for (const col of candidates) {
        if (row[col] != null && row[col].trim() !== '') return row[col].trim();
      }
      for (const [key, val] of Object.entries(row)) {
        const normKey = normalize(key);
        if (['3plprovider', '3plpartner', '3pl', 'thirdpartyprovider', 'thirdpartypartner', 'courier', 'dsppartner', 'dspprovider'].includes(normKey)) {
          if (val && val.trim()) return val.trim();
        }
      }
      return null;
    };

    return {
      tracking_number: tracking,
      customer,
      status,
      third_party_provider: find3plProvider(),
      receiving_date: receivingDate,
      validation_date: validationDate,
      updated_date: updatedDate,
      receiving_at_ms: exportTimestampToMillis(row['Receiving Date'] ?? ''),
      validation_at_ms: exportTimestampToMillis(row['Validation Date'] ?? ''),
      lmd_handover_at_ms: exportTimestampToMillis(row['LMD Handed Over At'] ?? ''),
      warehouse_code: (row['Destination WH'] ?? '').trim() || 'Unspecified',
    };
  });

  if (shipments.length === 0) throw new Error('The Aymakan shipping export has no shipment rows.');
  return {
    source: 'aymakan-portal',
    work_date: workDates.size === 1 ? [...workDates][0] : undefined,
    shipments,
  };
}

export function parseAymakanFile(value: string, fileName: string): AymakanShipmentSnapshot {
  return fileName.toLocaleLowerCase('en').endsWith('.csv') ? parseAymakanCsv(value) : parseAymakanSnapshot(value);
}

function buildClientLookup(clients: AymakanClientDefinition[]): Map<string, AymakanClientDefinition> {
  const lookup = new Map<string, AymakanClientDefinition>();
  clients.forEach(client => {
    lookup.set(normalize(client.code), client);
    lookup.set(normalize(client.name), client);
  });

  Object.entries(CUSTOMER_ALIASES).forEach(([alias, code]) => {
    const client = clients.find(item => canonicalClientCode(item.code) === code);
    if (client) lookup.set(alias, client);
  });
  return lookup;
}

export function aggregateAymakanSnapshot(
  snapshot: AymakanShipmentSnapshot,
  clients: AymakanClientDefinition[],
  selectedWorkDate?: string,
  backlogTrackingStartDate?: string,
): AymakanImportResult {
  const lookup = buildClientLookup(clients);
  const totals = new Map<string, AymakanClientImportTotal>();
  clients.forEach(client => totals.set(client.id, {
    client_id: client.id,
    client_code: canonicalClientCode(client.code),
    client_name: client.name,
    received_units: 0,
    processed_units: 0,
    backlog_released_units: 0,
    batch_closed_units: 0,
    jnt_units: 0,
    return_units: 0,
    turnaround_total_minutes: 0,
    turnaround_shipment_count: 0,
  }));

  const seen = new Set<string>();
  const unmatched = new Set<string>();
  let duplicates = 0;
  let ignored = 0;
  let relevantShipments = 0;

  snapshot.shipments.forEach(shipment => {
    const tracking = normalize(shipment.tracking_number);
    if (seen.has(tracking)) {
      duplicates += 1;
      return;
    }
    seen.add(tracking);

    const client = lookup.get(normalize(shipment.customer));
    if (!client) {
      ignored += 1;
      unmatched.add(shipment.customer);
      return;
    }

    const total = totals.get(client.id);
    if (!total) return;
    const clientCode = canonicalClientCode(client.code);
    const validationGated = VALIDATION_GATED_CLIENTS.has(clientCode);
    const isWaitingValidation = normalize(shipment.status) === normalize(AYMAKAN_WAITING_VALIDATION_STATUS);
    const received = selectedWorkDate && shipment.receiving_date !== undefined
      ? shipment.receiving_date === selectedWorkDate
      : true;
    const processed = selectedWorkDate && shipment.receiving_date !== undefined
      ? (validationGated ? shipment.validation_date === selectedWorkDate : received)
      : !validationGated || !isWaitingValidation;
    const batchCloseDate = validationGated && shipment.receiving_date ? validationBatchCloseDate(shipment.receiving_date) : null;
    const trackedBacklogCohort = !backlogTrackingStartDate || !shipment.receiving_date || shipment.receiving_date >= backlogTrackingStartDate;
    const backlogReleaseDate = validationGated
      ? (shipment.receiving_date && shipment.validation_date
          ? (shipment.receiving_date > shipment.validation_date ? shipment.receiving_date : shipment.validation_date)
          : shipment.validation_date)
      : shipment.receiving_date;
    const releasesOnSelectedDate = selectedWorkDate ? backlogReleaseDate === selectedWorkDate : processed;
    const backlogReleased = releasesOnSelectedDate && trackedBacklogCohort && (!validationGated || !selectedWorkDate || !batchCloseDate || selectedWorkDate <= batchCloseDate);
    const batchClosed = Boolean(
      validationGated
      && trackedBacklogCohort
      && selectedWorkDate
      && batchCloseDate === selectedWorkDate
      && (!shipment.validation_date || shipment.validation_date > selectedWorkDate),
    );
    const isReturn = normalize(shipment.status) === 'mronhold'
      && (selectedWorkDate ? shipment.updated_date === selectedWorkDate : true);
    if (isReturn) total.return_units += 1;
    if (!received && !processed && !batchClosed && !isReturn) return;

    relevantShipments += 1;
    if (received) total.received_units += 1;
    if (processed) {
      total.processed_units += 1;
      if (isJntProvider(shipment.third_party_provider)) total.jnt_units += 1;
    }
    const turnaroundStart = validationGated ? shipment.validation_at_ms : shipment.receiving_at_ms;
    const turnaroundStartDate = validationGated ? shipment.validation_date : shipment.receiving_date;
    if (turnaroundStartDate === selectedWorkDate && turnaroundStart != null && shipment.lmd_handover_at_ms != null && shipment.lmd_handover_at_ms >= turnaroundStart) {
      total.turnaround_total_minutes += (shipment.lmd_handover_at_ms - turnaroundStart) / 60000;
      total.turnaround_shipment_count += 1;
    }
    if (backlogReleased) total.backlog_released_units += 1;
    if (batchClosed) total.batch_closed_units += 1;
  });

  return {
    workDate: selectedWorkDate ?? snapshot.work_date ?? '',
    uniqueShipments: relevantShipments,
    duplicateShipments: duplicates,
    ignoredShipments: ignored,
    unmatchedCustomers: [...unmatched].sort(),
    clients: [...totals.values()],
  };
}

const DEFAULT_SHIFT_WINDOWS: ShiftTimeWindow[] = [
  { shiftType: 'day', startMinutes: 6 * 60, endMinutes: 18 * 60, crossesMidnight: false },
  { shiftType: 'night', startMinutes: 18 * 60, endMinutes: 6 * 60, crossesMidnight: true },
];

function parseTimeToMinutes(timeStr: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(timeStr.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function buildShiftTimeWindows(
  shifts: Array<{ name: string; start_time: string; end_time: string; crosses_midnight?: boolean; status?: string }>,
): ShiftTimeWindow[] {
  const windows: ShiftTimeWindow[] = [];
  for (const shift of shifts) {
    if (shift.status && shift.status !== 'active') continue;
    const startMinutes = parseTimeToMinutes(shift.start_time);
    const endMinutes = parseTimeToMinutes(shift.end_time);
    if (startMinutes == null || endMinutes == null) continue;
    const crossesMidnight = Boolean(shift.crosses_midnight) || endMinutes <= startMinutes;
    const lowerName = shift.name.toLowerCase();
    let shiftType: 'day' | 'night' | null = null;
    if (lowerName.includes('night') || crossesMidnight) {
      shiftType = 'night';
    } else if (lowerName.includes('day') || (startMinutes >= 5 * 60 && startMinutes < 17 * 60)) {
      shiftType = 'day';
    }
    if (shiftType) {
      windows.push({ shiftType, startMinutes, endMinutes, crossesMidnight });
    }
  }
  return windows.length > 0 ? windows : DEFAULT_SHIFT_WINDOWS;
}

export function detectShipmentShift(
  timestampMs: number,
  windows: ShiftTimeWindow[] = DEFAULT_SHIFT_WINDOWS,
): { shiftType: MailroomShiftType; shiftWorkDate: string } {
  const activeWindows = windows.length > 0 ? windows : DEFAULT_SHIFT_WINDOWS;
  const dt = new Date(timestampMs);
  const minutesOfDay = dt.getUTCHours() * 60 + dt.getUTCMinutes();
  const calendarDate = dt.toISOString().slice(0, 10);

  for (const w of activeWindows) {
    if (!w.crossesMidnight) {
      if (minutesOfDay >= w.startMinutes && minutesOfDay < w.endMinutes) {
        return { shiftType: w.shiftType, shiftWorkDate: calendarDate };
      }
    } else if (minutesOfDay >= w.startMinutes || minutesOfDay < w.endMinutes) {
      const shiftWorkDate = minutesOfDay < w.endMinutes
        ? new Date(timestampMs - 86_400_000).toISOString().slice(0, 10)
        : calendarDate;
      return { shiftType: w.shiftType, shiftWorkDate };
    }
  }

  return { shiftType: 'unassigned', shiftWorkDate: calendarDate };
}

export function aggregateAymakanTurnaroundMetrics(
  snapshot: AymakanShipmentSnapshot,
  clients: AymakanClientDefinition[],
  selectedWorkDate: string,
  shiftWindows?: ShiftTimeWindow[],
): AymakanTurnaroundMetric[] {
  const lookup = buildClientLookup(clients);
  const seen = new Set<string>();
  const totals = new Map<string, AymakanTurnaroundMetric>();
  const windows = shiftWindows && shiftWindows.length > 0 ? shiftWindows : DEFAULT_SHIFT_WINDOWS;

  snapshot.shipments.forEach(shipment => {
    const tracking = normalize(shipment.tracking_number);
    if (seen.has(tracking)) return;
    seen.add(tracking);
    const client = lookup.get(normalize(shipment.customer));
    if (!client) return;
    const validationGated = VALIDATION_GATED_CLIENTS.has(canonicalClientCode(client.code));
    const startDate = validationGated ? shipment.validation_date : shipment.receiving_date;
    const start = validationGated ? shipment.validation_at_ms : shipment.receiving_at_ms;
    const handover = shipment.lmd_handover_at_ms;
    if (startDate !== selectedWorkDate || start == null || handover == null || handover < start) return;
    const warehouse = shipment.warehouse_code?.trim() || 'Unspecified';
    const { shiftType } = detectShipmentShift(handover, windows);
    const key = `${client.id}:${warehouse}:${shiftType}`;
    const metric = totals.get(key) ?? {
      client_id: client.id,
      warehouse_code: warehouse,
      shift_type: shiftType,
      total_minutes: 0,
      shipment_count: 0,
    };
    metric.total_minutes += (handover - start) / 60000;
    metric.shipment_count += 1;
    totals.set(key, metric);
  });
  return [...totals.values()];
}
