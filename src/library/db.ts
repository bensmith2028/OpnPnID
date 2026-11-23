/**
 * The component library, kept entirely in the browser.
 *
 * The whole library — families, components ("categories") and the drawings they own — is
 * small, so it lives in memory as one `LibraryData` object and is written back to
 * IndexedDB as a single record after every change. There is no server and no database
 * engine: reads are plain array lookups, and the async signatures are kept only so the UI
 * code reads the same as it would against anything slower.
 *
 * First visit: nothing is stored yet, so the library is seeded from the bundled
 * `defaultLibrary.json`. After that the stored copy is the source of truth, and the default
 * is never re-applied over it. Sharing with other people goes through files instead — see
 * `io/libraryFormat.ts`, whose `mergeLibrary` only ever adds to what's here.
 *
 * Hierarchy: `Family` (Valve, Pump, … — a grouping, plus the ISA tag letter) → `Category`
 * (a general component, e.g. "Solenoid 2-Way Valve" — owns a symbol and its port count).
 */
import { type LibraryFile, type MergeSummary, mergeLibrary } from '../io/libraryFormat';
import type { ComponentSnapshot, SymbolGeometry } from '../types/geometry';
import { resolveSymbol } from './builtinSymbols';
import defaultLibrary from './defaultLibrary.json';

export interface Family {
  id: string;
  name: string;
  tagLetter: string | null;
  sortOrder: number;
}

export interface Category {
  id: string;
  familyId: string;
  name: string;
  subtype: string | null;
  actuation: string | null;
  portCount: number;
  symbolId: string | null;
}

export interface StoredSymbol {
  id: string;
  geometry: SymbolGeometry;
}

export interface LibraryData {
  families: Family[];
  categories: Category[];
  symbols: StoredSymbol[];
}

// ---------------------------------------------------------------------------------
// Persistence — one IndexedDB record. Quietly degrades to memory-only where IndexedDB
// is unavailable (some private windows), so the app still works for the session.
// ---------------------------------------------------------------------------------

const DB_NAME = 'opnpnid';
const STORE = 'kv';
const KEY = 'library';
/** Bumped if the stored shape ever changes, so old records can be migrated rather than
 * misread. */
const STORED_VERSION = 1;

function openIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readStored(): Promise<LibraryData | null> {
  const idb = await openIdb();
  if (!idb) return null;
  return new Promise((resolve) => {
    const req = idb.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    req.onsuccess = () => {
      const v = req.result as { version: number; data: LibraryData } | undefined;
      resolve(v && v.version === STORED_VERSION && v.data ? v.data : null);
    };
    req.onerror = () => resolve(null);
  });
}

async function writeStored(data: LibraryData): Promise<void> {
  const idb = await openIdb();
  if (!idb) return;
  await new Promise<void>((resolve) => {
    const tx = idb.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ version: STORED_VERSION, data }, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve(); // memory copy is still current; don't fail the edit
    tx.onabort = () => resolve();
  });
}

function defaultData(): LibraryData {
  return structuredClone(defaultLibrary) as unknown as LibraryData;
}

let loaded: Promise<LibraryData> | null = null;

function load(): Promise<LibraryData> {
  if (!loaded) loaded = readStored().then((stored) => stored ?? defaultData());
  return loaded;
}

/** Applies `change` to the library and saves the result. Edits are serialized through one
 * promise chain so two quick actions can't interleave their read-modify-write. */
let queue: Promise<unknown> = Promise.resolve();
function mutate<T>(change: (data: LibraryData) => T): Promise<T> {
  const run = queue.then(async () => {
    const data = await load();
    const result = change(data);
    await writeStored(data);
    for (const listener of listeners) listener();
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

/** Lets the UI re-read the library whenever anything changes it — including actions that
 * start outside the library panel, like File ▸ Import. Returns the unsubscribe function. */
const listeners = new Set<() => void>();
export function onLibraryChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

/** Test hook: forget the in-memory library so the next call reloads (or reseeds). */
export function resetLibraryCacheForTests(): void {
  loaded = null;
  queue = Promise.resolve();
}

// ---------------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------------

export async function listFamilies(): Promise<Family[]> {
  const { families } = await load();
  return [...families].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).map((f) => ({ ...f }));
}

export async function getFamily(id: string): Promise<Family | null> {
  const f = (await load()).families.find((x) => x.id === id);
  return f ? { ...f } : null;
}

export function upsertFamily(input: { id?: string; name: string; tagLetter: string | null; sortOrder?: number }): Promise<Family> {
  return mutate((data) => {
    const existing = input.id ? data.families.find((f) => f.id === input.id) : undefined;
    const family: Family = {
      id: input.id ?? newId('fam'),
      name: input.name,
      tagLetter: input.tagLetter,
      sortOrder: input.sortOrder ?? existing?.sortOrder ?? 0,
    };
    if (existing) Object.assign(existing, family);
    else data.families.push(family);
    return { ...family };
  });
}

/** Also removes the family's components and their drawings. The caller's UI is responsible
 * for warning first. */
export function deleteFamily(id: string): Promise<void> {
  return mutate((data) => {
    const doomed = data.categories.filter((c) => c.familyId === id);
    const symbolIds = new Set(doomed.map((c) => c.symbolId).filter((s): s is string => !!s));
    data.families = data.families.filter((f) => f.id !== id);
    data.categories = data.categories.filter((c) => c.familyId !== id);
    data.symbols = data.symbols.filter((s) => !symbolIds.has(s.id));
  });
}

// ---------------------------------------------------------------------------------
// Categories (components)
// ---------------------------------------------------------------------------------

export async function listCategories(familyId?: string): Promise<Category[]> {
  const { categories } = await load();
  return categories
    .filter((c) => !familyId || c.familyId === familyId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ ...c }));
}

export async function getCategory(id: string): Promise<Category | null> {
  const c = (await load()).categories.find((x) => x.id === id);
  return c ? { ...c } : null;
}

export function upsertCategory(input: {
  id?: string;
  familyId: string;
  name: string;
  subtype?: string | null;
  actuation?: string | null;
  portCount?: number;
  symbolId?: string | null;
}): Promise<Category> {
  return mutate((data) => {
    const category: Category = {
      id: input.id ?? newId('cat'),
      familyId: input.familyId,
      name: input.name,
      subtype: input.subtype ?? null,
      actuation: input.actuation ?? null,
      portCount: input.portCount ?? 2,
      symbolId: input.symbolId ?? null,
    };
    const existing = data.categories.find((c) => c.id === category.id);
    if (existing) Object.assign(existing, category);
    else data.categories.push(category);
    return { ...category };
  });
}

/** Also removes the component's own drawing. */
export function deleteCategory(id: string): Promise<void> {
  return mutate((data) => {
    const symbolId = data.categories.find((c) => c.id === id)?.symbolId;
    data.categories = data.categories.filter((c) => c.id !== id);
    if (symbolId) data.symbols = data.symbols.filter((s) => s.id !== symbolId);
  });
}

// ---------------------------------------------------------------------------------
// Symbols — user-drawn/uploaded, at most one per component. Built-in glyphs and the
// generic placeholder (builtinSymbols.ts) never live here; this only holds drawings made
// or imported in the app.
// ---------------------------------------------------------------------------------

export async function getSymbol(id: string): Promise<StoredSymbol | null> {
  const s = (await load()).symbols.find((x) => x.id === id);
  return s ? { id: s.id, geometry: structuredClone(s.geometry) } : null;
}

/** Saves a drawing: inserts when `id` is omitted, overwrites in place otherwise (a
 * component always rewrites its own symbol rather than accumulating orphaned versions). */
export function upsertSymbol(input: { id?: string; geometry: SymbolGeometry }): Promise<StoredSymbol> {
  return mutate((data) => {
    const id = input.id ?? newId('sym');
    const geometry = structuredClone(input.geometry);
    const existing = data.symbols.find((s) => s.id === id);
    if (existing) existing.geometry = geometry;
    else data.symbols.push({ id, geometry });
    return { id, geometry: structuredClone(geometry) };
  });
}

export function deleteSymbol(id: string): Promise<void> {
  return mutate((data) => {
    data.symbols = data.symbols.filter((s) => s.id !== id);
  });
}

// ---------------------------------------------------------------------------------
// Snapshots, and moving components in and out
// ---------------------------------------------------------------------------------

/** The drawing a component shows on the canvas: its own stored symbol when it has one,
 * otherwise the built-in glyph for its subtype/actuation (or the generic placeholder). */
export function effectiveSymbol(category: Category, symbols: StoredSymbol[]): SymbolGeometry {
  const stored = category.symbolId ? symbols.find((s) => s.id === category.symbolId) : undefined;
  return stored ? stored.geometry : resolveSymbol(category.subtype, category.actuation, category.portCount);
}

/** Builds the portable snapshot embedded in a placed component (see types/geometry.ts), so
 * a saved drawing stays correct even if the library later changes or is missing entirely.
 * Null if the component no longer exists. */
export async function buildComponentSnapshot(categoryId: string): Promise<ComponentSnapshot | null> {
  const data = await load();
  const category = data.categories.find((c) => c.id === categoryId);
  if (!category) return null;
  const family = data.families.find((f) => f.id === category.familyId);
  return {
    familyName: family?.name ?? 'Unknown',
    categoryName: category.name,
    symbol: structuredClone(effectiveSymbol(category, data.symbols)),
  };
}

/** The library as export-ready components — all of them, or just the ones named. Each
 * carries the drawing it actually shows, so the file is self-contained. */
export async function collectExportable(categoryIds?: string[]) {
  const data = await load();
  const wanted = categoryIds ? new Set(categoryIds) : null;
  return data.categories
    .filter((c) => !wanted || wanted.has(c.id))
    .map((category) => ({
      family: data.families.find((f) => f.id === category.familyId) ?? null,
      category: { ...category },
      geometry: structuredClone(effectiveSymbol(category, data.symbols)),
    }));
}

/** Adds a parsed library file's components to this library without touching anything
 * already here (see `mergeLibrary`). */
export function importLibrary(file: LibraryFile): Promise<MergeSummary> {
  return mutate((data) => {
    const { data: merged, summary } = mergeLibrary(data, file, { newId, effectiveSymbol });
    data.families = merged.families;
    data.categories = merged.categories;
    data.symbols = merged.symbols;
    return summary;
  });
}

/** Throws away the library and starts over from the bundled default. */
export function resetToDefaultLibrary(): Promise<void> {
  return mutate((data) => {
    const fresh = defaultData();
    data.families = fresh.families;
    data.categories = fresh.categories;
    data.symbols = fresh.symbols;
  });
}
