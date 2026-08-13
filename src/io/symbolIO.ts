/**
 * Getting one part drawing (see symbolFormat.ts for the format) to and from a file — the
 * symbol-sized counterpart of projectIO. Same two-runtime arrangement: native dialogs
 * inside the Tauri shell, download + file picker in a plain browser tab, identical bytes
 * either way, so a symbol exported from one instance imports into any other.
 */
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { isTauriRuntime } from '../platform/runtime';
import type { SymbolGeometry } from '../types/geometry';
import { downloadText, pickFile } from './fileTransfer';
import { type ImportedSymbol, SYMBOL_FILE_EXTENSION, parseSymbolFile, serializeSymbol, suggestedSymbolFileName } from './symbolFormat';

const FILTERS = [{ name: `OpnPnID Symbol (*.${SYMBOL_FILE_EXTENSION})`, extensions: ['json'] }];
/** The browser picker's equivalent of FILTERS — `.pnidsym.json` files are `.json` files,
 * and the format's own validation is what actually decides whether a pick is usable. */
const ACCEPT = '.json,application/json';

export interface SymbolMeta {
  name: string;
  subtype: string | null;
  actuation: string | null;
}

/** Writes one symbol out, returning true if it landed somewhere (false if the user backed
 * out of the native dialog). */
export async function exportSymbol(geometry: SymbolGeometry, meta: SymbolMeta): Promise<boolean> {
  const text = serializeSymbol(geometry, meta);
  const name = suggestedSymbolFileName(meta.name);
  if (!isTauriRuntime()) {
    downloadText(name, text);
    return true;
  }
  const target = await save({ filters: FILTERS, defaultPath: name });
  if (!target) return false;
  await writeTextFile(target, text);
  return true;
}

/** Reads a symbol file, or null if the user backed out. Throws (for the caller to surface)
 * if the pick isn't a readable OpnPnID symbol — see parseSymbolFile. The geometry comes
 * back already normalized to this build's local units, with the factor that took it there. */
export async function importSymbol(): Promise<ImportedSymbol | null> {
  if (!isTauriRuntime()) {
    const file = await pickFile(ACCEPT);
    if (!file) return null;
    return parseSymbolFile(await file.text());
  }
  const selected = await open({ multiple: false, filters: FILTERS });
  if (!selected || Array.isArray(selected)) return null;
  return parseSymbolFile(await readTextFile(selected));
}
