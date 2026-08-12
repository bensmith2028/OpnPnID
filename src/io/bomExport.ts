/**
 * Bill-of-Materials CSV export — one of the app's originally-planned output file types
 * alongside the project file and PDF (see pdfExport.ts). Two flavors, per the original
 * spec: a per-instance "detailed" listing and a grouped/quantity-counted "summary".
 *
 * Row-building/CSV-formatting are pure and DOM-free (unit-tested in bomExport.test.ts);
 * the exported `exportBom*` functions are the thin async save-dialog wrappers, following
 * the same save()+writeTextFile() pattern as projectIO.ts.
 */
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { rowToCsvLine } from '../library/csv';
import { useSketchStore } from '../canvas/store/useSketchStore';
import type { ComponentInstance, RealPartSnapshot } from '../types/geometry';

/** Flattens a real part's specs into one readable string, e.g. `cv=2.5; fail_position=FC`. */
function formatSpecs(specs: RealPartSnapshot['specs']): string {
  return Object.entries(specs)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

export interface DetailedBomRow {
  tag: string;
  family: string;
  category: string;
  manufacturer: string;
  modelNumber: string;
  specs: string;
  datasheetUrl: string;
}

/** One row per placed instance. An instance with no real part assigned still gets a row
 * (it still belongs in the BOM as "needs a part picked") with the part-derived columns blank. */
export function buildDetailedRows(components: ComponentInstance[]): DetailedBomRow[] {
  return components.map((instance) => {
    const part = instance.snapshot.realPart;
    return {
      tag: instance.tag,
      family: instance.snapshot.familyName,
      category: instance.snapshot.categoryName,
      manufacturer: part?.manufacturer ?? '',
      modelNumber: part?.modelNumber ?? '',
      specs: part ? formatSpecs(part.specs) : '',
      datasheetUrl: part?.datasheetUrl ?? '',
    };
  });
}

export interface SummaryBomRow {
  family: string;
  category: string;
  manufacturer: string;
  modelNumber: string;
  quantity: number;
  specs: string;
  datasheetUrl: string;
}

/** Groups instances by (Category, Manufacturer, Model Number) into one row each with a
 * quantity count. Instances with no real part assigned group by Category alone
 * (Manufacturer/Model blank), separately from any assigned-part group in that category.
 * The join key is JSON-encoded (rather than plain-concatenated) so field values
 * containing arbitrary characters can never collide across a different combination. */
export function buildSummaryRows(components: ComponentInstance[]): SummaryBomRow[] {
  const groups = new Map<string, SummaryBomRow>();
  for (const instance of components) {
    const part = instance.snapshot.realPart;
    const manufacturer = part?.manufacturer ?? '';
    const modelNumber = part?.modelNumber ?? '';
    const key = JSON.stringify([instance.snapshot.categoryName, manufacturer, modelNumber]);
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += 1;
      continue;
    }
    groups.set(key, {
      family: instance.snapshot.familyName,
      category: instance.snapshot.categoryName,
      manufacturer,
      modelNumber,
      quantity: 1,
      specs: part ? formatSpecs(part.specs) : '',
      datasheetUrl: part?.datasheetUrl ?? '',
    });
  }
  return [...groups.values()];
}

const DETAILED_HEADERS = ['Tag', 'Family', 'Category', 'Manufacturer', 'Model Number', 'Specs', 'Datasheet URL'];
const SUMMARY_HEADERS = ['Family', 'Category', 'Manufacturer', 'Model Number', 'Quantity', 'Specs', 'Datasheet URL'];

export function detailedRowsToCsv(rows: DetailedBomRow[]): string {
  const lines = [
    rowToCsvLine(DETAILED_HEADERS),
    ...rows.map((r) => rowToCsvLine([r.tag, r.family, r.category, r.manufacturer, r.modelNumber, r.specs, r.datasheetUrl])),
  ];
  return lines.join('\n') + '\n';
}

export function summaryRowsToCsv(rows: SummaryBomRow[]): string {
  const lines = [
    rowToCsvLine(SUMMARY_HEADERS),
    ...rows.map((r) => rowToCsvLine([r.family, r.category, r.manufacturer, r.modelNumber, r.quantity, r.specs, r.datasheetUrl])),
  ];
  return lines.join('\n') + '\n';
}

export async function exportBomDetailed(): Promise<void> {
  const components = [...useSketchStore.getState().graph.components.values()];
  const csv = detailedRowsToCsv(buildDetailedRows(components));
  const path = await save({ filters: [{ name: 'CSV', extensions: ['csv'] }], defaultPath: 'bom-detailed.csv' });
  if (!path) return;
  await writeTextFile(path, csv);
}

export async function exportBomSummary(): Promise<void> {
  const components = [...useSketchStore.getState().graph.components.values()];
  const csv = summaryRowsToCsv(buildSummaryRows(components));
  const path = await save({ filters: [{ name: 'CSV', extensions: ['csv'] }], defaultPath: 'bom-summary.csv' });
  if (!path) return;
  await writeTextFile(path, csv);
}
