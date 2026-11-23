/**
 * Bill-of-Materials CSV export. Two flavors: a per-instance "detailed" listing (one row per
 * placed component) and a grouped "summary" with a quantity per kind of component.
 *
 * Row-building/CSV-formatting are pure and DOM-free (unit-tested in bomExport.test.ts); the
 * exported `exportBom*` functions are the thin download wrappers.
 */
import { useSketchStore } from '../canvas/store/useSketchStore';
import type { ComponentInstance } from '../types/geometry';
import { downloadText } from './fileTransfer';

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function rowToCsvLine(values: (string | number | null | undefined)[]): string {
  return values.map((v) => csvEscape(v === null || v === undefined ? '' : String(v))).join(',');
}

export interface DetailedBomRow {
  tag: string;
  name: string;
  family: string;
  category: string;
}

/** One row per placed instance. `name` is optional on the instance (never auto-generated —
 * see ComponentInstance.name), so an unnamed component gets a blank cell. */
export function buildDetailedRows(components: ComponentInstance[]): DetailedBomRow[] {
  return components.map((instance) => ({
    tag: instance.tag,
    name: instance.name ?? '',
    family: instance.snapshot.familyName,
    category: instance.snapshot.categoryName,
  }));
}

export interface SummaryBomRow {
  family: string;
  category: string;
  quantity: number;
}

/** Groups instances by component kind into one row each with a quantity. Deliberately
 * carries no Name column: a name describes one instance's service ("Reactor feed pump"), so
 * it has no meaning for a group of several. The join key is JSON-encoded so values
 * containing arbitrary characters can never collide across a different combination. */
export function buildSummaryRows(components: ComponentInstance[]): SummaryBomRow[] {
  const groups = new Map<string, SummaryBomRow>();
  for (const instance of components) {
    const key = JSON.stringify([instance.snapshot.familyName, instance.snapshot.categoryName]);
    const existing = groups.get(key);
    if (existing) existing.quantity += 1;
    else groups.set(key, { family: instance.snapshot.familyName, category: instance.snapshot.categoryName, quantity: 1 });
  }
  return [...groups.values()];
}

const DETAILED_HEADERS = ['Tag', 'Name', 'Family', 'Component'];
const SUMMARY_HEADERS = ['Family', 'Component', 'Quantity'];

export function detailedRowsToCsv(rows: DetailedBomRow[]): string {
  const lines = [rowToCsvLine(DETAILED_HEADERS), ...rows.map((r) => rowToCsvLine([r.tag, r.name, r.family, r.category]))];
  return lines.join('\n') + '\n';
}

export function summaryRowsToCsv(rows: SummaryBomRow[]): string {
  const lines = [rowToCsvLine(SUMMARY_HEADERS), ...rows.map((r) => rowToCsvLine([r.family, r.category, r.quantity]))];
  return lines.join('\n') + '\n';
}

export async function exportBomDetailed(): Promise<void> {
  const components = [...useSketchStore.getState().graph.components.values()];
  downloadText('bom-detailed.csv', detailedRowsToCsv(buildDetailedRows(components)), 'text/csv');
}

export async function exportBomSummary(): Promise<void> {
  const components = [...useSketchStore.getState().graph.components.values()];
  downloadText('bom-summary.csv', summaryRowsToCsv(buildSummaryRows(components)), 'text/csv');
}
