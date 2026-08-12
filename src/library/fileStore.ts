/**
 * Pure file I/O for the organization's on-disk component library (see `libraryRoot.ts`
 * for the folder layout and why this data lives outside the app's git history). Every
 * function here just reads or writes JSON — no sqlite, no caching, no id generation.
 * Two callers use this module for opposite purposes:
 *   - `librarySync.ts` reads the whole tree and upserts it into sqlite (files -> cache).
 *   - `db.ts`'s upsert/delete functions call the `write*`/`remove*` functions here
 *     right after every sqlite mutation, so the file tree stays current with every
 *     in-app edit (cache -> files, "write-through").
 * All functions are no-ops-safe to call against a root that doesn't exist yet — callers
 * are expected to have called `ensureLibraryTree` first (librarySync and the write-through
 * wiring both do).
 */
import { readDir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import type { AttributeDefinition, Category, Family, RealPart, StoredSymbol } from './db';
import {
  categoriesDir,
  categoryFile,
  ensureLibraryTree,
  familiesFile,
  partFile,
  partsCategoryDir,
  partsDir,
  symbolFile,
  symbolsDir,
} from './libraryRoot';

const PRETTY = (data: unknown) => JSON.stringify(data, null, 2) + '\n';

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readTextFile(path)) as T;
  } catch {
    return null; // missing file, or a bad/partial write — caller treats as "not present"
  }
}

// ------------------------------------------------------------------------------------
// Families — one shared array file (small, low-churn, fine to always rewrite whole)
// ------------------------------------------------------------------------------------

export async function readFamilies(root: string): Promise<Family[]> {
  return (await readJson<Family[]>(await familiesFile(root))) ?? [];
}

export async function writeFamily(root: string, family: Family): Promise<void> {
  const families = await readFamilies(root);
  const next = families.filter((f) => f.id !== family.id);
  next.push(family);
  await writeTextFile(await familiesFile(root), PRETTY(next));
}

/** Also removes every category (and its parts) that belonged to this family, mirroring
 * the ON DELETE CASCADE the sqlite side already does. */
export async function removeFamily(root: string, familyId: string): Promise<void> {
  const families = await readFamilies(root);
  await writeTextFile(await familiesFile(root), PRETTY(families.filter((f) => f.id !== familyId)));
  for (const { category } of await readCategories(root)) {
    if (category.familyId === familyId) await removeCategory(root, category.id);
  }
}

// ------------------------------------------------------------------------------------
// Categories — one file per category, attribute definitions embedded (they're owned
// 1:1 by their category, so there's no benefit to splitting them into their own files).
// ------------------------------------------------------------------------------------

interface CategoryFileShape extends Category {
  attributeDefinitions: AttributeDefinition[];
}

export async function readCategories(root: string): Promise<{ category: Category; attributeDefinitions: AttributeDefinition[] }[]> {
  const dir = await categoriesDir(root);
  let entries;
  try {
    entries = await readDir(dir);
  } catch {
    return [];
  }
  const out: { category: Category; attributeDefinitions: AttributeDefinition[] }[] = [];
  for (const entry of entries) {
    if (!entry.isFile || !entry.name.endsWith('.json')) continue;
    const parsed = await readJson<CategoryFileShape>(`${dir}/${entry.name}`);
    if (!parsed) continue;
    const { attributeDefinitions, ...category } = parsed;
    out.push({ category, attributeDefinitions });
  }
  return out;
}

export async function writeCategory(root: string, category: Category, attributeDefinitions: AttributeDefinition[]): Promise<void> {
  const shape: CategoryFileShape = { ...category, attributeDefinitions };
  await writeTextFile(await categoryFile(root, category.id), PRETTY(shape));
}

/** Also removes every real part filed under this category, mirroring the sqlite
 * ON DELETE CASCADE. */
export async function removeCategory(root: string, categoryId: string): Promise<void> {
  await remove(await categoryFile(root, categoryId)).catch(() => {});
  await remove(await partsCategoryDir(root, categoryId), { recursive: true }).catch(() => {});
}

// ------------------------------------------------------------------------------------
// Symbols
// ------------------------------------------------------------------------------------

export async function readSymbols(root: string): Promise<StoredSymbol[]> {
  const dir = await symbolsDir(root);
  let entries;
  try {
    entries = await readDir(dir);
  } catch {
    return [];
  }
  const out: StoredSymbol[] = [];
  for (const entry of entries) {
    if (!entry.isFile || !entry.name.endsWith('.json')) continue;
    const parsed = await readJson<StoredSymbol>(`${dir}/${entry.name}`);
    if (parsed) out.push(parsed);
  }
  return out;
}

export async function writeSymbol(root: string, symbol: StoredSymbol): Promise<void> {
  await writeTextFile(await symbolFile(root, symbol.id), PRETTY(symbol));
}

export async function removeSymbol(root: string, symbolId: string): Promise<void> {
  await remove(await symbolFile(root, symbolId)).catch(() => {});
}

// ------------------------------------------------------------------------------------
// Real parts — one file per part, filed under its category's subfolder so the mapping
// between a part and its category is the folder structure itself.
// ------------------------------------------------------------------------------------

export async function readParts(root: string): Promise<RealPart[]> {
  const dir = await partsDir(root);
  let categoryDirs;
  try {
    categoryDirs = await readDir(dir);
  } catch {
    return [];
  }
  const out: RealPart[] = [];
  for (const catDir of categoryDirs) {
    if (!catDir.isDirectory) continue;
    const sub = `${dir}/${catDir.name}`;
    let entries;
    try {
      entries = await readDir(sub);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile || !entry.name.endsWith('.json')) continue;
      const parsed = await readJson<RealPart>(`${sub}/${entry.name}`);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

/** Writes `part` under its (current) `categoryId` folder. If `previousCategoryId` is
 * given and differs, the stale file under the old category's folder is removed first —
 * pass it whenever a part's category assignment can change out from under an existing id. */
export async function writePart(root: string, part: RealPart, previousCategoryId?: string): Promise<void> {
  if (previousCategoryId && previousCategoryId !== part.categoryId) {
    await remove(await partFile(root, previousCategoryId, part.id)).catch(() => {});
  }
  await writeTextFile(await partFile(root, part.categoryId, part.id), PRETTY(part));
}

export async function removePart(root: string, categoryId: string, partId: string): Promise<void> {
  await remove(await partFile(root, categoryId, partId)).catch(() => {});
}

export { ensureLibraryTree };
