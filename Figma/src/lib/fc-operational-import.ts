import Papa from 'papaparse';

export type FcOperationalSource = 'orders' | 'vas' | 'grn_returns';

export interface FcOperationalImportDay {
  work_date: string;
  inbound_quantity: number;
  return_rto_quantity: number;
  return_cir_quantity: number;
  outbound_b2c_quantity: number;
  outbound_b2b_quantity: number;
  vas_quantity: number;
  gift_wrap_quantity: number;
  other_activity_quantity: number;
  b2c_orders: number;
  b2b_orders: number;
}

export interface FcOperationalClientDay {
  work_date: string;
  client_name: string;
  inbound_quantity: number;
  outbound_b2c_quantity: number;
  outbound_b2b_quantity: number;
  returns_quantity: number;
  vas_quantity: number;
  b2c_orders: number;
  b2b_orders: number;
}

export interface FcOperationalImportPreview {
  fromDate: string;
  toDate: string;
  sources: FcOperationalSource[];
  sourceFileNames: string[];
  days: FcOperationalImportDay[];
  clientDays: FcOperationalClientDay[];
  sourceRows: number;
  acceptedRows: number;
  duplicateRows: number;
  invalidRows: number;
  outOfPeriodRows: number;
  totals: Omit<FcOperationalImportDay, 'work_date'>;
  warnings: string[];
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_SOURCE_ROWS = 50_000;
const emptyDay = (workDate: string): FcOperationalImportDay => ({
  work_date: workDate, inbound_quantity: 0, return_rto_quantity: 0, return_cir_quantity: 0,
  outbound_b2c_quantity: 0, outbound_b2b_quantity: 0, vas_quantity: 0, gift_wrap_quantity: 0,
  other_activity_quantity: 0, b2c_orders: 0, b2b_orders: 0,
});

function normalize(value: unknown): string { return String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase(); }

function dateOnly(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const numeric = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (numeric) return `${numeric[1]}-${numeric[2].padStart(2, '0')}-${numeric[3].padStart(2, '0')}`;
  const parsed = new Date(`${text} 12:00:00 GMT+0300`);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsed);
}

function positiveNumber(value: unknown): number | null {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function identify(headers: string[]): FcOperationalSource {
  const set = new Set(headers.map(normalize));
  if (['ORDER ID', 'ORDER PACKED AT', 'ORDER TYPE', 'TOTAL PACKED QUANTITY'].every(header => set.has(header))) return 'orders';
  if (['ADHOC TASK NAME', 'USAGE', 'ACTIVITY DATE'].every(header => set.has(header))) return 'vas';
  if (['GRN ID', 'GRN COMPLETED AT', 'ORDER TYPE', 'SKU TOTAL QUANTITY'].every(header => set.has(header))) return 'grn_returns';
  throw new Error('Unsupported FC CSV. Upload an Orders, VAS, or GRN - Returns export.');
}

async function parseFile(file: File): Promise<{ source: FcOperationalSource; rows: Record<string, string>[] }> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} exceeds the 10 MB upload limit.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isUtf16Le = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes.length > 3 && bytes[1] === 0 && bytes[3] === 0);
  const text = new TextDecoder(isUtf16Le ? 'utf-16le' : 'utf-8').decode(bytes);
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: 'greedy', delimiter: '' });
  if (parsed.errors.length && !parsed.data.length) throw new Error(`${file.name} could not be parsed as CSV.`);
  if (parsed.data.length > MAX_SOURCE_ROWS) throw new Error(`${file.name} exceeds 50,000 rows.`);
  const fields = parsed.meta.fields ?? Object.keys(parsed.data[0] ?? {});
  const source = identify(fields);
  const normalizedRows = parsed.data.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [normalize(key), String(value ?? '').trim()])));
  return { source, rows: normalizedRows };
}

export async function parseFcOperationalFiles(files: File[], fromDate: string, toDate: string): Promise<FcOperationalImportPreview> {
  if (!files.length) throw new Error('Choose at least one FC CSV export.');
  const parsedFiles = await Promise.all(files.map(parseFile));
  const repeated = parsedFiles.map(file => file.source).filter((source, index, all) => all.indexOf(source) !== index);
  if (repeated.length) throw new Error(`Only one file per source type is allowed: ${[...new Set(repeated)].join(', ')}.`);
  const days = new Map<string, FcOperationalImportDay>();
  const clientDays = new Map<string, FcOperationalClientDay>();
  const seen = new Set<string>();
  let sourceRows = 0; let acceptedRows = 0; let duplicateRows = 0; let invalidRows = 0; let outOfPeriodRows = 0;
  const day = (date: string) => { const current = days.get(date) ?? emptyDay(date); days.set(date, current); return current; };
  const clientDay = (date: string, clientName: string) => {
    const clean = clientName.trim() || 'Unspecified';
    const k = `${date}::${clean.toLowerCase()}`;
    const existing = clientDays.get(k) ?? {
      work_date: date, client_name: clean,
      inbound_quantity: 0, outbound_b2c_quantity: 0, outbound_b2b_quantity: 0,
      returns_quantity: 0, vas_quantity: 0, b2c_orders: 0, b2b_orders: 0,
    };
    clientDays.set(k, existing);
    return existing;
  };
  for (const file of parsedFiles) {
    for (const row of file.rows) {
      sourceRows += 1;
      const date = dateOnly(row[file.source === 'orders' ? 'ORDER PACKED AT' : file.source === 'vas' ? 'ACTIVITY DATE' : 'GRN COMPLETED AT']);
      const amount = positiveNumber(row[file.source === 'orders' ? 'TOTAL PACKED QUANTITY' : file.source === 'vas' ? 'USAGE' : 'SKU TOTAL QUANTITY']);
      if (!date || amount == null) { invalidRows += 1; continue; }
      if (date < fromDate || date > toDate) { outOfPeriodRows += 1; continue; }
      let key: string;
      if (file.source === 'orders') key = `orders:${normalize(row['ORDER ID'])}`;
      else if (file.source === 'vas') key = `vas:${date}:${normalize(row['S. NO.'])}:${normalize(row['SELLER'])}:${normalize(row['ADHOC TASK NAME'])}:${amount}`;
      else key = `grn:${JSON.stringify(row)}`;
      if (!key.split(':')[1] || seen.has(key)) { duplicateRows += 1; continue; }
      seen.add(key); acceptedRows += 1;
      const current = day(date);
      const sellerName = (row['SELLER NAME'] || row['SELLER'] || 'Unspecified').trim();
      const cDay = clientDay(date, sellerName);
      if (file.source === 'orders') {
        const type = normalize(row['ORDER TYPE']);
        if (type === 'B2C') { current.outbound_b2c_quantity += amount; current.b2c_orders += 1; cDay.outbound_b2c_quantity += amount; cDay.b2c_orders += 1; }
        else if (type === 'B2B') { current.outbound_b2b_quantity += amount; current.b2b_orders += 1; cDay.outbound_b2b_quantity += amount; cDay.b2b_orders += 1; }
        else current.other_activity_quantity += amount;
      } else if (file.source === 'vas') {
        if (/GIFT\s*WRAP/.test(normalize(row['ADHOC TASK NAME']))) current.gift_wrap_quantity += amount;
        else current.vas_quantity += amount;
        cDay.vas_quantity += amount;
      } else if (normalize(row['ORDER TYPE']) === 'RETURN ORDER') {
        current.return_rto_quantity += amount;
        cDay.returns_quantity += amount;
      } else {
        current.inbound_quantity += amount;
        cDay.inbound_quantity += amount;
      }
    }
  }
  const rows = [...days.values()].sort((a, b) => a.work_date.localeCompare(b.work_date));
  const clientRows = [...clientDays.values()].sort((a, b) => a.work_date.localeCompare(b.work_date) || a.client_name.localeCompare(b.client_name));
  const totals = rows.reduce((sum, row) => {
    (Object.keys(sum) as Array<keyof typeof sum>).forEach(key => { sum[key] += row[key]; });
    return sum;
  }, { inbound_quantity: 0, return_rto_quantity: 0, return_cir_quantity: 0, outbound_b2c_quantity: 0, outbound_b2b_quantity: 0, vas_quantity: 0, gift_wrap_quantity: 0, other_activity_quantity: 0, b2c_orders: 0, b2b_orders: 0 } as Omit<FcOperationalImportDay, 'work_date'>);
  const warnings: string[] = [];
  const sources = parsedFiles.map(file => file.source);
  const missing = (['orders', 'vas', 'grn_returns'] as FcOperationalSource[]).filter(source => !sources.includes(source));
  if (missing.length) warnings.push(`Partial import: ${missing.join(', ')} values will be preserved from the current saved data.`);
  if (invalidRows) warnings.push(`${invalidRows.toLocaleString()} malformed rows were ignored.`);
  if (duplicateRows) warnings.push(`${duplicateRows.toLocaleString()} duplicate rows were ignored.`);
  if (outOfPeriodRows) warnings.push(`${outOfPeriodRows.toLocaleString()} rows outside ${fromDate} through ${toDate} were ignored.`);
  return { fromDate, toDate, sources, sourceFileNames: files.map(file => file.name), days: rows, clientDays: clientRows, sourceRows, acceptedRows, duplicateRows, invalidRows, outOfPeriodRows, totals, warnings };
}
