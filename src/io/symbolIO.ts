/**
 * Getting one part drawing (see symbolFormat.ts for the format) to and from a file — the
 * symbol-sized counterpart of projectIO: a download to export, a file picker to import.
 */
import type { SymbolGeometry } from '../types/geometry';
import { downloadText, pickFile } from './fileTransfer';
import { type ImportedSymbol, parseSymbolFile, serializeSymbol, suggestedSymbolFileName } from './symbolFormat';

/** The file picker's filter — `.pnidsym.json` files are `.json` files, and the format's own
 * validation is what actually decides whether a pick is usable. */
const ACCEPT = '.json,application/json';

export interface SymbolMeta {
  name: string;
  subtype: string | null;
  actuation: string | null;
}

/** Downloads one symbol as a file. */
export async function exportSymbol(geometry: SymbolGeometry, meta: SymbolMeta): Promise<boolean> {
  downloadText(suggestedSymbolFileName(meta.name), serializeSymbol(geometry, meta));
  return true;
}

/** Reads a symbol file, or null if the user backed out. Throws (for the caller to surface)
 * if the pick isn't a readable OpnPnID symbol — see parseSymbolFile. The geometry comes
 * back already normalized to this build's local units, with the factor that took it there. */
export async function importSymbol(): Promise<ImportedSymbol | null> {
  const file = await pickFile(ACCEPT);
  if (!file) return null;
  return parseSymbolFile(await file.text());
}
