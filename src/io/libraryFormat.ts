/**
 * The OpnPnID library-sharing format — what a `.pnidlib.json` file contains. This is how
 * components move between people: one component, a few, or a whole library, all the same
 * file. Pure and DOM-free (unit-tested in libraryFormat.test.ts); libraryIO.ts moves the
 * text to and from a file, and library/db.ts applies a parsed file to the stored library.
 *
 * ```json
 * {
 *   "app": "opnpnid-library",
 *   "version": 1,
 *   "components": [
 *     {
 *       "family": { "name": "Valve", "tagLetter": "V" },
 *       "name": "Check Valve",
 *       "subtype": "check",
 *       "actuation": null,
 *       "portCount": 2,
 *       "symbol": { ...a symbol file's contents (see symbolFormat.ts)... }
 *     }
 *   ]
 * }
 * ```
 *
 * Every component carries its own drawing, so a file is self-contained.
 *
 * ## Importing never overwrites
 *
 * `mergeLibrary` only ever *adds*. A family that already exists (matched by name) is reused;
 * a component that's already there with an identical drawing is skipped; one that shares a
 * name with a different drawing arrives under a numbered name — "Check Valve (2)" — so
 * sharing a library with a colleague can never wipe out or silently replace your own.
 */
import type { Category, Family, LibraryData, StoredSymbol } from '../library/db';
import type { SymbolGeometry } from '../types/geometry';
import { buildSymbolFile, parseSymbolObject } from './symbolFormat';

export const LIBRARY_FORMAT_VERSION = 1;
export const LIBRARY_APP_MARKER = 'opnpnid-library';
/** Double extension for the same reason as `.pnid.json`: plain JSON to every tool, but
 * named for what it is. */
export const LIBRARY_FILE_EXTENSION = 'pnidlib.json';

export interface LibraryFileComponent {
  family: { name: string; tagLetter: string | null };
  name: string;
  subtype: string | null;
  actuation: string | null;
  portCount: number;
  geometry: SymbolGeometry;
}

export interface LibraryFile {
  app: string;
  version: number;
  components: LibraryFileComponent[];
}

/** One component ready to export: the category plus the drawing it actually shows on the
 * canvas (a custom symbol, or the built-in glyph it falls back to). */
export interface ExportableComponent {
  family: Family | null;
  category: Category;
  geometry: SymbolGeometry;
}

export function buildLibraryFile(components: ExportableComponent[]): LibraryFile {
  return {
    app: LIBRARY_APP_MARKER,
    version: LIBRARY_FORMAT_VERSION,
    components: components.map(({ family, category, geometry }) => ({
      family: { name: family?.name ?? 'Other', tagLetter: family?.tagLetter ?? null },
      name: category.name,
      subtype: category.subtype,
      actuation: category.actuation,
      portCount: category.portCount,
      geometry,
    })),
  };
}

export function serializeLibrary(components: ExportableComponent[]): string {
  // Each component's drawing is written as a full symbol file so it is validated and
  // rescaled by exactly the same code that reads a standalone `.pnidsym.json`.
  const file = buildLibraryFile(components);
  return JSON.stringify(
    {
      ...file,
      components: file.components.map(({ geometry, ...rest }) => ({
        ...rest,
        symbol: buildSymbolFile(geometry, { name: rest.name, subtype: rest.subtype, actuation: rest.actuation }),
      })),
    },
    null,
    2,
  );
}

/** A filename-safe name for an export: the component's own name for a single component, or
 * a generic one for several. */
export function suggestedLibraryFileName(components: { category: Category }[]): string {
  const base = components.length === 1 ? components[0].category.name : 'opnpnid-library';
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'library'}.${LIBRARY_FILE_EXTENSION}`;
}

const NOT_A_LIBRARY = "That doesn't look like an OpnPnID library file.";

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Parses and validates a library file, throwing an `Error` whose message is meant for the
 * user. A bare single-symbol file (`.pnidsym.json`) is also accepted, and read as a library
 * of one component in an "Imported" family — the quickest thing someone might send. */
export function parseLibraryFile(raw: string): LibraryFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("That file isn't valid JSON, so it can't be an OpnPnID library file.");
  }
  if (!isRecord(parsed)) fail(NOT_A_LIBRARY);

  if (parsed.app !== LIBRARY_APP_MARKER || !Array.isArray(parsed.components)) {
    if (isRecord(parsed.geometry)) {
      const { file } = parseSymbolObject(parsed);
      return {
        app: LIBRARY_APP_MARKER,
        version: LIBRARY_FORMAT_VERSION,
        components: [
          {
            family: { name: 'Imported', tagLetter: null },
            name: file.name,
            subtype: file.subtype,
            actuation: file.actuation,
            portCount: Math.max(1, file.geometry.ports.length),
            geometry: file.geometry,
          },
        ],
      };
    }
    fail(isRecord(parsed.scene) ? `${NOT_A_LIBRARY} That's a whole drawing — open it with Open instead.` : NOT_A_LIBRARY);
  }

  const version = parsed.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) fail(`${NOT_A_LIBRARY} (Unrecognized schema version.)`);
  if (version > LIBRARY_FORMAT_VERSION) {
    fail(
      `This library was saved by a newer version of OpnPnID (file schema v${version}; this build reads up to v${LIBRARY_FORMAT_VERSION}). Update OpnPnID to import it.`,
    );
  }

  const components = parsed.components.map((entry, i): LibraryFileComponent => {
    if (!isRecord(entry) || !isRecord(entry.symbol)) fail(`This library file is damaged: component ${i + 1} has no drawing.`);
    const name = text(entry.name);
    if (!name) fail(`This library file is damaged: component ${i + 1} has no name.`);
    const family = isRecord(entry.family) ? entry.family : {};
    const { file } = parseSymbolObject(entry.symbol);
    const portCount = typeof entry.portCount === 'number' && Number.isFinite(entry.portCount) ? Math.max(1, Math.floor(entry.portCount)) : Math.max(1, file.geometry.ports.length);
    return {
      family: { name: text(family.name) ?? 'Imported', tagLetter: text(family.tagLetter)?.toUpperCase().slice(0, 1) ?? null },
      name,
      subtype: text(entry.subtype),
      actuation: text(entry.actuation),
      portCount,
      geometry: file.geometry,
    };
  });

  return { app: LIBRARY_APP_MARKER, version, components };
}

export interface MergeSummary {
  added: number;
  skipped: number;
  /** Components that arrived under a different name because theirs was taken. */
  renamed: number;
}

export interface MergeDeps {
  newId: (prefix: string) => string;
  /** The drawing a category actually shows — its stored symbol, or its built-in fallback. */
  effectiveSymbol: (category: Category, symbols: StoredSymbol[]) => SymbolGeometry;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const key = (s: string) => s.trim().toLowerCase();

/** Adds a parsed library file's components to `existing`, returning the combined library
 * and what happened. Never mutates its input and never removes or replaces anything — see
 * the module comment for the rules. */
export function mergeLibrary(existing: LibraryData, incoming: LibraryFile, deps: MergeDeps): { data: LibraryData; summary: MergeSummary } {
  const families = existing.families.map((f) => ({ ...f }));
  const categories = existing.categories.map((c) => ({ ...c }));
  const symbols = existing.symbols.map((s) => ({ ...s }));
  const summary: MergeSummary = { added: 0, skipped: 0, renamed: 0 };

  for (const item of incoming.components) {
    let family = families.find((f) => key(f.name) === key(item.family.name));
    if (!family) {
      family = {
        id: deps.newId('fam'),
        name: item.family.name,
        tagLetter: item.family.tagLetter,
        sortOrder: families.reduce((max, f) => Math.max(max, f.sortOrder), -1) + 1,
      };
      families.push(family);
    }

    const sameName = categories.filter((c) => c.familyId === family.id && key(c.name) === key(item.name));
    if (sameName.some((c) => same(deps.effectiveSymbol(c, symbols), item.geometry))) {
      summary.skipped++;
      continue;
    }

    // A name taken by a *different* drawing: take the next free "Name (n)".
    let name = item.name;
    if (sameName.length > 0) {
      let n = 2;
      while (categories.some((c) => c.familyId === family.id && key(c.name) === key(`${item.name} (${n})`))) n++;
      name = `${item.name} (${n})`;
      summary.renamed++;
    }

    const symbol: StoredSymbol = { id: deps.newId('sym'), geometry: item.geometry };
    symbols.push(symbol);
    categories.push({
      id: deps.newId('cat'),
      familyId: family.id,
      name,
      subtype: item.subtype,
      actuation: item.actuation,
      portCount: item.portCount,
      symbolId: symbol.id,
    });
    summary.added++;
  }

  return { data: { families, categories, symbols }, summary };
}
