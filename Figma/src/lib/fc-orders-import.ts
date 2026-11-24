import Papa from 'papaparse';
import readExcelFile, { type CellValue } from 'read-excel-file/browser';

type FcCell = CellValue | null;

export const FC_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const FC_MAX_ORDER_ROWS = 50_000;

const REQUIRED_HEADERS = [
  'ORDER ID',
  'ORDER PACKED AT',
  'SELLER NAME',
  'ORDER TYPE',
  'TOTAL PACKED QUANTITY',
  'PACKED BY',
] as const;

export interface FcDailyPackerMetricInput {
  work_date: string;
  packer_label: string;
  normalized_packer_label: string;
  packed_orders: number;
  packed_quantity: number;
}

export interface FcDailySellerMetricInput {
  work_date: string;
  seller_name: string;
  order_type: 'B2B' | 'B2C' | 'Other';
  packed_orders: number;
  packed_quantity: number;
  a2p_minutes: number;
  a2p_samples: number;
  p2p_minutes: number;
  p2p_samples: number;
  o2p_minutes: number;
  o2p_samples: number;
  p2s_minutes: number;
  p2s_samples: number;
  o2s_minutes: number;
  o2s_samples: number;
}

export interface FcImportPreview {
  sourceFileName: string;
  sourceSha256: string;
  sourceRows: number;
  validRows: number;
  ignoredRows: number;
  invalidRows: number;
  outOfWeekRows: number;
  duplicateRows: number;
  blankPackerRows: number;
  unknownOrderTypeRows: number;
  packedOrders: number;
  packedQuantity: number;
  additionalItems: number;
  dateFrom: string | null;
  dateTo: string | null;
  packerLabels: string[];
  warnings: string[];
  packers: FcDailyPackerMetricInput[];
  sellers: FcDailySellerMetricInput[];
}

export interface FcImportSheet {
  sheet: string;
  data: FcCell[][];
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function normalizeFcPackerLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

function text(value: FcCell | undefined): string {
  return value == null ? '' : String(value).trim();
}

function localIsoDate(value: FcCell | undefined): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const raw = text(value);
  const match = raw.match(/^(\d{4})[-/]([01]?\d)[-/]([0-3]?\d)(?:[ T].*)?$/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const us = raw.match(/^([01]?\d)[/]([0-3]?\d)[/](\d{4})(?:[ T].*)?$/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return null;
}

function timestampMs(value: FcCell | undefined): number | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
  const raw = text(value);
  let match = raw.match(/^(\d{4})[-/]([01]?\d)[-/]([0-3]?\d)(?:[ T]([0-2]?\d):([0-5]?\d)(?::([0-5]?\d))?)?$/);
  if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] ?? 0), Number(match[5] ?? 0), Number(match[6] ?? 0));
  match = raw.match(/^([01]?\d)[/]([0-3]?\d)[/](\d{4})(?:[ T]([0-2]?\d):([0-5]?\d)(?::([0-5]?\d))?)?$/);
  if (match) return Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]), Number(match[4] ?? 0), Number(match[5] ?? 0), Number(match[6] ?? 0));
  return null;
}

function positiveInteger(value: FcCell | undefined): number | null {
  const parsed = typeof value === 'number' ? value : Number(text(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeMinutesFromHours(value: FcCell | undefined): number | null {
  const parsed = typeof value === 'number' ? value : Number(text(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 60 : null;
}

function elapsedMinutes(from: FcCell | undefined, to: FcCell | undefined): number | null {
  const start = timestampMs(from);
  const end = timestampMs(to);
  if (start == null || end == null || end < start) return null;
  return (end - start) / 60_000;
}

function normalizeOrderType(value: FcCell | undefined): 'B2B' | 'B2C' | 'Other' {
  const normalized = text(value).toLocaleUpperCase('en');
  return normalized === 'B2B' || normalized === 'B2C' ? normalized : 'Other';
}

function addSample(target: FcDailySellerMetricInput, prefix: 'a2p' | 'p2p' | 'o2p' | 'p2s' | 'o2s', value: number | null) {
  if (value == null) return;
  target[`${prefix}_minutes`] += value;
  target[`${prefix}_samples`] += 1;
}

export function parseFcOrderSheets(sheets: FcImportSheet[], weekStart: string, sourceFileName = 'Orders import', sourceSha256 = '0'.repeat(64)): FcImportPreview {
  const weekEnd = addDays(weekStart, 6);
  const packers = new Map<string, FcDailyPackerMetricInput>();
  const sellers = new Map<string, FcDailySellerMetricInput>();
  const seenOrderIds = new Set<string>();
  const dates = new Set<string>();
  let sourceRows = 0;
  let invalidRows = 0;
  let outOfWeekRows = 0;
  let duplicateRows = 0;
  let blankPackerRows = 0;
  let unknownOrderTypeRows = 0;

  for (const sheet of sheets) {
    if (!sheet.data.length) continue;
    const headerRowIndex = sheet.data.findIndex(row => REQUIRED_HEADERS.every(header => row.some(cell => text(cell).toLocaleUpperCase('en') === header)));
    if (headerRowIndex < 0) continue;
    const headers = sheet.data[headerRowIndex].map(cell => text(cell).toLocaleUpperCase('en'));
    const index = Object.fromEntries(headers.map((header, column) => [header, column]));
    for (const row of sheet.data.slice(headerRowIndex + 1)) {
      if (!row.some(value => value != null && text(value) !== '')) continue;
      sourceRows += 1;
      const orderId = text(row[index['ORDER ID']]).replace(/\s+/g, '').toLocaleLowerCase('en');
      const packedDate = localIsoDate(row[index['ORDER PACKED AT']]);
      const quantity = positiveInteger(row[index['TOTAL PACKED QUANTITY']]);
      if (!orderId || !packedDate || quantity == null) {
        invalidRows += 1;
        continue;
      }
      if (packedDate < weekStart || packedDate > weekEnd) {
        outOfWeekRows += 1;
        continue;
      }
      if (seenOrderIds.has(orderId)) {
        duplicateRows += 1;
        continue;
      }
      if (seenOrderIds.size >= FC_MAX_ORDER_ROWS) throw new Error(`The import exceeds ${FC_MAX_ORDER_ROWS.toLocaleString()} unique orders.`);
      seenOrderIds.add(orderId);
      dates.add(packedDate);

      const sourcePacker = text(row[index['PACKED BY']]);
      const packerLabel = sourcePacker || 'Unassigned';
      const normalizedPackerLabel = normalizeFcPackerLabel(packerLabel);
      if (!sourcePacker) blankPackerRows += 1;
      const packerKey = `${packedDate}\u0000${normalizedPackerLabel}`;
      const packer = packers.get(packerKey) ?? { work_date: packedDate, packer_label: packerLabel, normalized_packer_label: normalizedPackerLabel, packed_orders: 0, packed_quantity: 0 };
      packer.packed_orders += 1;
      packer.packed_quantity += quantity;
      packers.set(packerKey, packer);

      const sellerName = text(row[index['SELLER NAME']]) || 'Unspecified';
      const sourceOrderType = text(row[index['ORDER TYPE']]).toLocaleUpperCase('en');
      const orderType = normalizeOrderType(row[index['ORDER TYPE']]);
      if (sourceOrderType !== 'B2B' && sourceOrderType !== 'B2C') unknownOrderTypeRows += 1;
      const sellerKey = `${packedDate}\u0000${sellerName.toLocaleLowerCase('en')}\u0000${orderType}`;
      const seller = sellers.get(sellerKey) ?? {
        work_date: packedDate, seller_name: sellerName, order_type: orderType, packed_orders: 0, packed_quantity: 0,
        a2p_minutes: 0, a2p_samples: 0, p2p_minutes: 0, p2p_samples: 0,
        o2p_minutes: 0, o2p_samples: 0, p2s_minutes: 0, p2s_samples: 0, o2s_minutes: 0, o2s_samples: 0,
      };
      seller.packed_orders += 1;
      seller.packed_quantity += quantity;
      addSample(seller, 'a2p', elapsedMinutes(row[index['HUB ASSIGNED AT']], row[index['ORDER PICKED AT']]));
      addSample(seller, 'p2p', elapsedMinutes(row[index['ORDER PICKED AT']], row[index['ORDER PACKED AT']]));
      addSample(seller, 'o2p', nonNegativeMinutesFromHours(row[index.O2P]));
      addSample(seller, 'p2s', nonNegativeMinutesFromHours(row[index.P2S]));
      addSample(seller, 'o2s', nonNegativeMinutesFromHours(row[index.O2S]));
      sellers.set(sellerKey, seller);
    }
  }

  const validRows = seenOrderIds.size;
  if (!validRows) throw new Error(`No packed orders were found from ${weekStart} through ${weekEnd}.`);
  const packerRows = [...packers.values()].sort((a, b) => a.work_date.localeCompare(b.work_date) || a.packer_label.localeCompare(b.packer_label));
  const sellerRows = [...sellers.values()].sort((a, b) => a.work_date.localeCompare(b.work_date) || a.seller_name.localeCompare(b.seller_name));
  const packedQuantity = packerRows.reduce((sum, row) => sum + row.packed_quantity, 0);
  const warnings: string[] = [];
  if (duplicateRows) warnings.push(`${duplicateRows} duplicate order row${duplicateRows === 1 ? '' : 's'} ignored.`);
  if (invalidRows) warnings.push(`${invalidRows} malformed row${invalidRows === 1 ? '' : 's'} ignored.`);
  if (outOfWeekRows) warnings.push(`${outOfWeekRows} row${outOfWeekRows === 1 ? '' : 's'} outside the selected week ignored.`);
  if (blankPackerRows) warnings.push(`${blankPackerRows} packed order${blankPackerRows === 1 ? '' : 's'} had no packer and will remain Unassigned.`);
  if (unknownOrderTypeRows) warnings.push(`${unknownOrderTypeRows} order${unknownOrderTypeRows === 1 ? '' : 's'} grouped as Other.`);
  const sortedDates = [...dates].sort();
  return {
    sourceFileName, sourceSha256, sourceRows, validRows,
    ignoredRows: invalidRows + outOfWeekRows + duplicateRows,
    invalidRows, outOfWeekRows, duplicateRows, blankPackerRows, unknownOrderTypeRows,
    packedOrders: validRows, packedQuantity, additionalItems: packedQuantity - validRows,
    dateFrom: sortedDates[0] ?? null, dateTo: sortedDates.at(-1) ?? null,
    packerLabels: [...new Set(packerRows.map(row => row.packer_label))].sort(), warnings,
    packers: packerRows, sellers: sellerRows,
  };
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function parseFcOrdersFile(file: File, weekStart: string): Promise<FcImportPreview> {
  if (file.size > FC_MAX_FILE_BYTES) throw new Error('FC order files must be 10 MB or smaller.');
  const lowerName = file.name.toLocaleLowerCase('en');
  let sheets: FcImportSheet[];
  if (lowerName.endsWith('.csv')) {
    const parsed = Papa.parse<FcCell[]>(await file.text(), { skipEmptyLines: 'greedy' });
    if (parsed.errors.length) throw new Error(`Unable to parse CSV: ${parsed.errors[0].message}`);
    sheets = [{ sheet: file.name, data: parsed.data }];
  } else if (lowerName.endsWith('.xlsx')) {
    sheets = (await readExcelFile(file)).map(sheet => ({ sheet: sheet.sheet, data: sheet.data }));
  } else {
    throw new Error('Upload an .xlsx or .csv Orders export.');
  }
  return parseFcOrderSheets(sheets, weekStart, file.name, await sha256(file));
}
