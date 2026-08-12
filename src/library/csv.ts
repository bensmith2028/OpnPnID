/**
 * "BMEcat-lite" catalog import, per the research report's synthesis (§5.1): fixed common
 * columns + one column per the category's *current* attribute definitions. Per-category,
 * not one universal schema — real supplier catalogs are naturally tabular per product
 * family, which is what a category is here. One import targets one category (the
 * product line the CSV represents); different categories are separate imports.
 *
 * Parsing/row-mapping are pure functions (independently unit-tested); `importCsv` is the
 * thin async wrapper that writes the mapped rows via db.ts.
 */
import type { AttributeDefinition } from './db';
import { upsertRealPart } from './db';

const COMMON_COLUMNS = ['manufacturer', 'model_number', 'description', 'price', 'currency', 'datasheet_url', 'image_url'];

/** The column header row for a category's import/template CSV: fixed common fields plus
 * that category's current attribute keys — regenerate this whenever attributes change. */
export function csvTemplateHeaders(attributes: AttributeDefinition[]): string[] {
  return [...COMMON_COLUMNS, ...attributes.map((a) => a.key)];
}

export function buildCsvTemplate(attributes: AttributeDefinition[]): string {
  return csvTemplateHeaders(attributes).join(',') + '\n';
}

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function rowToCsvLine(values: (string | number | null | undefined)[]): string {
  return values.map((v) => csvEscape(v === null || v === undefined ? '' : String(v))).join(',');
}

/** Minimal RFC4180-ish CSV parser (quoted fields, escaped quotes, CRLF/LF) — no
 * dependency needed for a schema this small. Blank trailing lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

export interface ParsedRealPartRow {
  manufacturer: string;
  modelNumber: string;
  description: string | null;
  price: number | null;
  currency: string | null;
  datasheetUrl: string | null;
  imageUrl: string | null;
  specs: Record<string, string | number | boolean>;
}

/** Maps one CSV data row (given the header row and the category's current attribute
 * definitions) into real-part fields. Malformed *individual* attribute values are
 * dropped (not the whole row) — real scraped data is messy; a row is only rejected
 * outright when it's missing the two truly required fields. */
export function mapCsvRow(headers: string[], cells: string[], attributes: AttributeDefinition[]): ParsedRealPartRow | { error: string } {
  const record: Record<string, string> = {};
  headers.forEach((h, i) => {
    record[h.trim()] = (cells[i] ?? '').trim();
  });

  if (!record.manufacturer || !record.model_number) {
    return { error: 'missing manufacturer or model_number' };
  }

  const specs: Record<string, string | number | boolean> = {};
  for (const attr of attributes) {
    const raw = record[attr.key];
    if (raw === undefined || raw === '') continue;
    if (attr.type === 'number') {
      const n = parseFloat(raw);
      if (Number.isFinite(n)) specs[attr.key] = n;
    } else if (attr.type === 'boolean') {
      specs[attr.key] = /^(true|yes|1)$/i.test(raw);
    } else {
      specs[attr.key] = raw;
    }
  }

  return {
    manufacturer: record.manufacturer,
    modelNumber: record.model_number,
    description: record.description || null,
    price: record.price ? (Number.isFinite(parseFloat(record.price)) ? parseFloat(record.price) : null) : null,
    currency: record.currency || null,
    datasheetUrl: record.datasheet_url || null,
    imageUrl: record.image_url || null,
    specs,
  };
}

export interface ImportResult {
  imported: number;
  skipped: { row: number; reason: string }[];
}

export async function importCsv(text: string, categoryId: string, attributes: AttributeDefinition[]): Promise<ImportResult> {
  const rows = parseCsv(text);
  const result: ImportResult = { imported: 0, skipped: [] };
  if (rows.length === 0) return result;

  const headers = rows[0];
  for (let r = 1; r < rows.length; r++) {
    const mapped = mapCsvRow(headers, rows[r], attributes);
    if ('error' in mapped) {
      result.skipped.push({ row: r + 1, reason: mapped.error });
      continue;
    }
    await upsertRealPart({ categoryId, ...mapped });
    result.imported += 1;
  }
  return result;
}
