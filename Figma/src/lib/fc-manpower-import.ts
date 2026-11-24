import readExcelFile, { type CellValue } from 'read-excel-file/browser';

type Cell = CellValue | null;

export interface FcManpowerDayInput {
  work_date: string; available_hours: number; inbound_quantity: number; return_rto_quantity: number;
  return_cir_quantity: number; outbound_b2c_quantity: number; outbound_b2b_quantity: number;
  vas_quantity: number; gift_wrap_quantity: number; other_activity_name: string | null;
  other_activity_quantity: number; b2c_orders: number; b2b_orders: number; closing_storage_quantity: number;
}

export interface FcManpowerImportPreview {
  sourceFileName: string; days: FcManpowerDayInput[]; sheetCount: number; firstDate: string | null; lastDate: string | null;
  inboundQuantity: number; outboundQuantity: number; returnsQuantity: number; vasQuantity: number; warnings: string[];
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const normalize = (value: Cell | undefined) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const number = (value: Cell | undefined) => {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 0;
};
const iso = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

export function parseFcManpowerSheets(sheets: Array<{ sheet: string; data: Cell[][] }>, sourceFileName = 'FC manpower workbook'): FcManpowerImportPreview {
  const byDate = new Map<string, FcManpowerDayInput>();
  let sheetCount = 0;
  const warnings: string[] = [];
  for (const sheet of sheets) {
    const monthKey = Object.keys(MONTHS).find(key => sheet.sheet.toLowerCase().startsWith(key));
    if (!monthKey || sheet.data.length < 4) continue;
    const month = MONTHS[monthKey];
    const header = sheet.data[2] ?? [];
    const activityColumn = header.findIndex(cell => normalize(cell) === 'activity');
    if (activityColumn < 0) continue;
    const labels = new Map<string, number>();
    for (let row = 3; row < sheet.data.length; row += 1) {
      const label = normalize(sheet.data[row]?.[activityColumn]);
      if (label && !labels.has(label)) labels.set(label, row);
    }
    const value = (label: string, column: number) => number(sheet.data[labels.get(label) ?? -1]?.[column]);
    let usedSheet = false;
    header.forEach((cell, column) => {
      if (!(cell instanceof Date) || cell.getUTCFullYear() !== 2026 || cell.getUTCMonth() + 1 !== month) return;
      const workDate = iso(cell);
      const otherLabel = [...labels.keys()].find(label => label.startsWith('other activity') && !label.includes('specify')) ?? null;
      const day: FcManpowerDayInput = {
        work_date: workDate, available_hours: 8,
        inbound_quantity: value('inbound', column), return_rto_quantity: value('return rto', column),
        return_cir_quantity: value('return cir', column), outbound_b2c_quantity: value('outbound b2c', column),
        outbound_b2b_quantity: value('outbound b2b', column), vas_quantity: value('vas activities', column),
        gift_wrap_quantity: 0, other_activity_name: otherLabel ? otherLabel.replace(/^other activity\s*\(|\)$/g, '') : null,
        other_activity_quantity: otherLabel ? value(otherLabel, column) : 0,
        b2c_orders: value('orders b2c', column), b2b_orders: value('orders b2b', column),
        closing_storage_quantity: value('closing storage qty', column),
      };
      const operationalTotal = day.inbound_quantity + day.return_rto_quantity + day.return_cir_quantity + day.outbound_b2c_quantity + day.outbound_b2b_quantity + day.vas_quantity + day.other_activity_quantity;
      if (operationalTotal > 0 || day.b2c_orders > 0 || day.b2b_orders > 0) byDate.set(workDate, day);
      usedSheet = true;
    });
    if (usedSheet) sheetCount += 1;
  }
  const days = [...byDate.values()].sort((a, b) => a.work_date.localeCompare(b.work_date));
  if (!days.length) throw new Error('No populated 2026 daily FC operational rows were found in the workbook.');
  if (days.some(day => day.b2c_orders === 0 && day.outbound_b2c_quantity > 0)) warnings.push('Some B2C volume days have no order count, so B2C UPT will display n.a.');
  if (days.some(day => day.b2b_orders === 0 && day.outbound_b2b_quantity > 0)) warnings.push('Some B2B volume days have no order count, so B2B UPT will display n.a.');
  return {
    sourceFileName, days, sheetCount, firstDate: days[0]?.work_date ?? null, lastDate: days.at(-1)?.work_date ?? null,
    inboundQuantity: days.reduce((sum, day) => sum + day.inbound_quantity, 0),
    outboundQuantity: days.reduce((sum, day) => sum + day.outbound_b2c_quantity + day.outbound_b2b_quantity, 0),
    returnsQuantity: days.reduce((sum, day) => sum + day.return_rto_quantity + day.return_cir_quantity, 0),
    vasQuantity: days.reduce((sum, day) => sum + day.vas_quantity, 0), warnings,
  };
}

export async function parseFcManpowerFile(file: File): Promise<FcManpowerImportPreview> {
  if (file.size > 10 * 1024 * 1024) throw new Error('FC manpower workbooks must be 10 MB or smaller.');
  if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('Upload the FC Daily Manpower Productivity .xlsx workbook.');
  const workbook = await readExcelFile(file);
  return parseFcManpowerSheets(workbook.map(sheet => ({ sheet: sheet.sheet, data: sheet.data })), file.name);
}
