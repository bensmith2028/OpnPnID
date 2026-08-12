/**
 * Where the organization's shared component-library data lives on disk — families,
 * categories, symbols, real (physical) parts, and catalog-import staging. This data is
 * never bundled with the app and never enters this repo's git history (see
 * `.gitignore`'s `library-data/` entry); instead each machine points at a folder that
 * the organization distributes however it likes (shared drive, cloud sync, its own
 * private repo). This module owns just the "where" — a persisted root path and
 * per-user name, both user-configurable — and the path joiners everything else in
 * `fileStore.ts`/`librarySync.ts` builds on.
 *
 * Layout under the chosen root:
 *   org/families.json            — small, rarely-changing family list
 *   org/categories/<id>.json     — one file per category, attribute defs embedded
 *   org/symbols/<id>.json        — symbol geometry
 *   org/parts/<categoryId>/<id>.json  — one file per real (physical) part
 *   users/<name>/imports/raw/        — catalog PDFs you drop in for extraction
 *   users/<name>/imports/extracted/  — AI-agent output, pre-review candidate parts
 */
import { join } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/plugin-dialog';
import { exists, mkdir, writeTextFile } from '@tauri-apps/plugin-fs';

const ROOT_STORAGE_KEY = 'opnpnid.libraryRoot';
const USER_STORAGE_KEY = 'opnpnid.libraryUser';

/** The configured library-data root, or null if the user hasn't connected one yet
 * (the app falls back to sqlite-only, exactly as it worked before this feature). */
export function getLibraryRoot(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage?.getItem(ROOT_STORAGE_KEY) || null;
}

export function setLibraryRoot(path: string | null): void {
  if (typeof window === 'undefined') return;
  if (path) window.localStorage.setItem(ROOT_STORAGE_KEY, path);
  else window.localStorage.removeItem(ROOT_STORAGE_KEY);
}

/** Label used for this machine's `users/<name>/` staging folder — just a folder name,
 * not an identity system. Defaults to "me" so single-user setups need not configure it. */
export function getLibraryUser(): string {
  if (typeof window === 'undefined') return 'me';
  return window.localStorage?.getItem(USER_STORAGE_KEY) || 'me';
}

export function setLibraryUser(name: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(USER_STORAGE_KEY, name.trim() || 'me');
}

/** Opens a native folder picker for choosing (or creating) the library-data root and
 * persists the choice. Returns the chosen path, or null if the user cancelled. */
export async function chooseLibraryRoot(): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false, title: 'Choose or create your library-data folder' });
  const path = Array.isArray(picked) ? picked[0] : picked;
  if (!path) return null;
  setLibraryRoot(path);
  return path;
}

// ------------------------------------------------------------------------------------
// Path joiners
// ------------------------------------------------------------------------------------

export const orgDir = (root: string): Promise<string> => join(root, 'org');
export const familiesFile = async (root: string): Promise<string> => join(await orgDir(root), 'families.json');
export const categoriesDir = async (root: string): Promise<string> => join(await orgDir(root), 'categories');
export const categoryFile = async (root: string, categoryId: string): Promise<string> => join(await categoriesDir(root), `${categoryId}.json`);
export const symbolsDir = async (root: string): Promise<string> => join(await orgDir(root), 'symbols');
export const symbolFile = async (root: string, symbolId: string): Promise<string> => join(await symbolsDir(root), `${symbolId}.json`);
export const partsDir = async (root: string): Promise<string> => join(await orgDir(root), 'parts');
export const partsCategoryDir = async (root: string, categoryId: string): Promise<string> => join(await partsDir(root), categoryId);
export const partFile = async (root: string, categoryId: string, partId: string): Promise<string> =>
  join(await partsCategoryDir(root, categoryId), `${partId}.json`);

export const userDir = async (root: string, user: string = getLibraryUser()): Promise<string> => join(root, 'users', user);
export const importsRawDir = async (root: string, user: string = getLibraryUser()): Promise<string> =>
  join(await userDir(root, user), 'imports', 'raw');
export const importsExtractedDir = async (root: string, user: string = getLibraryUser()): Promise<string> =>
  join(await userDir(root, user), 'imports', 'extracted');

// ------------------------------------------------------------------------------------
// Write-through suppression — `librarySync.syncLibraryFromDisk` upserts rows into
// sqlite that it just *read* from these same files; without this guard, db.ts's
// write-through (see its module doc) would immediately re-serialize each row straight
// back to the file it was just parsed from. Harmless (idempotent) but pointless I/O,
// and worth avoiding since it doubles every sync's disk traffic for no benefit.
// ------------------------------------------------------------------------------------

let writeThroughSuppressed = false;

export function isWriteThroughSuppressed(): boolean {
  return writeThroughSuppressed;
}

export async function withWriteThroughSuppressed<T>(fn: () => Promise<T>): Promise<T> {
  const outer = writeThroughSuppressed;
  writeThroughSuppressed = true;
  try {
    return await fn();
  } finally {
    writeThroughSuppressed = outer;
  }
}

/** Ensures the full `org/...` + `users/<user>/imports/{raw,extracted}` tree exists
 * under `root`, creating whatever's missing (including an empty `families.json`). Safe
 * to call repeatedly — every sync calls this first. */
export async function ensureLibraryTree(root: string): Promise<void> {
  const dirs = [await categoriesDir(root), await symbolsDir(root), await partsDir(root), await importsRawDir(root), await importsExtractedDir(root)];
  for (const dir of dirs) {
    if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  }
  const famFile = await familiesFile(root);
  if (!(await exists(famFile))) await writeTextFile(famFile, '[]\n');
}
