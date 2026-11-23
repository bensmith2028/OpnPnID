/**
 * Moving components between people as files (see libraryFormat.ts): export one component or
 * the whole library, import someone else's. Importing only ever adds — see `mergeLibrary`.
 */
import { type Category, collectExportable, getFamily, importLibrary } from '../library/db';
import type { SymbolGeometry } from '../types/geometry';
import { downloadText, pickFile } from './fileTransfer';
import { type MergeSummary, parseLibraryFile, serializeLibrary, suggestedLibraryFileName } from './libraryFormat';

/** Downloads the named components (or the whole library when none are named). Returns how
 * many were written. */
export async function exportLibrary(categoryIds?: string[]): Promise<number> {
  const components = await collectExportable(categoryIds);
  if (components.length === 0) return 0;
  downloadText(suggestedLibraryFileName(components), serializeLibrary(components));
  return components.length;
}

/** Downloads one component exactly as given — used by the edit view, which shares what's on
 * screen (including edits not yet saved) rather than the stored version. */
export async function shareComponent(category: Category, geometry: SymbolGeometry): Promise<void> {
  const family = await getFamily(category.familyId);
  const components = [{ family, category, geometry }];
  downloadText(suggestedLibraryFileName(components), serializeLibrary(components));
}

/** Picks a library (or single-component) file and adds its components to the library.
 * Null if the user backed out; throws, with a message fit to show, if the file isn't usable. */
export async function importLibraryFile(): Promise<MergeSummary | null> {
  const file = await pickFile('.json,application/json');
  if (!file) return null;
  return importLibrary(parseLibraryFile(await file.text()));
}

/** One-line description of an import's outcome, for the panel's status line. */
export function describeImport(s: MergeSummary): string {
  const parts = [`Added ${s.added} component${s.added === 1 ? '' : 's'}`];
  if (s.renamed > 0) parts.push(`${s.renamed} renamed to avoid clashing with one you already have`);
  if (s.skipped > 0) parts.push(`${s.skipped} skipped — already in your library`);
  return parts.join('; ') + '.';
}
