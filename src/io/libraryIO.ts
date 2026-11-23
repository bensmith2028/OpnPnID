/**
 * Moving components between people as files (see libraryFormat.ts): export one component or
 * the whole library, import someone else's. Importing only ever adds — see `mergeLibrary`.
 */
import { collectExportable, importLibrary } from '../library/db';
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
  if (s.hardware > 0) parts.push(`${s.hardware} hardware item${s.hardware === 1 ? '' : 's'}`);
  if (s.renamed > 0) parts.push(`${s.renamed} renamed to avoid clashing with one you already have`);
  if (s.skipped > 0) parts.push(`${s.skipped} skipped — already in your library`);
  return parts.join('; ') + '.';
}
