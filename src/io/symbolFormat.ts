/**
 * The OpnPnID symbol format — what a `.pnidsym.json` file contains, and the only place
 * that decides whether a file being imported is one. Pure and DOM/Tauri-free (so it's
 * unit-tested directly in symbolFormat.test.ts); symbolIO.ts is the thin platform wrapper
 * that moves the text to and from a file.
 *
 * This is one *part drawing* — a single category's symbol — as opposed to projectFormat's
 * whole document. A symbol file is a single JSON object:
 *
 * ```json
 * {
 *   "app": "opnpnid-symbol",
 *   "version": 2,
 *   "name": "Automated 2-Way Valve",
 *   "subtype": "2-way",
 *   "actuation": "automated",
 *   "halfExtent": 14,
 *   "geometry": { "points": {}, "lines": [], "arcs": [], "ports": [], "texts": [], "image": null }
 * }
 * ```
 *
 * - `app` / `version` identify the file; `version` is the *schema* version, not the app's.
 * - `name` / `subtype` / `actuation` are the authoring category's descriptors, carried so
 *   an import can say what it's about. They are metadata only — importing a symbol never
 *   renames or reclassifies the category it's imported into.
 * - `geometry` is exactly a `SymbolGeometry`: lines and arcs over named points, an ordered
 *   `ports` list naming which of those points pipes snap to, optional `texts` (labels drawn
 *   as part of the glyph, positioned and sized in the same local units), and optionally an
 *   `image` (a `data:` URL raster body sized the same way). Vector and raster symbols use
 *   the identical container, so both export and import through this one format.
 *
 * ## Scale
 *
 * `halfExtent` is what makes a symbol land at the right size in another instance. Symbol
 * geometry is stored in *local units*, unrelated to the importing drawing's world scale:
 * the built-in glyphs are drawn to a ±`SYMBOL_HALF_EXTENT` box (see builtinSymbols.ts),
 * and a placed component multiplies those local units by the document's `componentScale`
 * at render time. So a symbol is "properly scaled" exactly when its local units mean the
 * same thing on both ends:
 *
 * - Same convention on both ends (the ordinary case) — geometry round-trips verbatim, and
 *   the imported symbol is the same size relative to the built-ins as it was when authored.
 * - Different convention (a file written by a build using a different `SYMBOL_HALF_EXTENT`)
 *   — `parseSymbolFile` rescales by `SYMBOL_HALF_EXTENT / file.halfExtent`, so the symbol
 *   keeps its authored size *relative to the standard glyphs* rather than silently coming
 *   in over- or undersized.
 * - Larger than the symbol editor can draw — geometry beyond ±`MAX_LOCAL_EXTENT` is scaled
 *   to fit. The editor has no pan/zoom (see SymbolEditor), so anything bigger could not
 *   have been authored here and would be both uneditable and wildly oversized next to the
 *   pipes it connects to.
 *
 * Rescaling multiplies point coordinates, image width/height and label positions/sizes by
 * one uniform factor. Arc `bulge` is deliberately left alone: it's `tan(includedAngle / 4)`,
 * a pure shape ratio, so a uniform scale changes an arc's size without touching how far it
 * bows.
 *
 * `parseSymbolFile` reports the factor it applied, so the UI can tell the user a symbol
 * was resized rather than quietly changing their drawing.
 *
 * ## Version history
 *
 * - **1** — the shape above, without `geometry.texts`.
 * - **2** — adds `geometry.texts`, the symbol's own labels. A v1 file still imports: an
 *   absent list simply means a glyph with no lettering on it.
 *
 * Files from version MIN_SUPPORTED_SYMBOL_VERSION through SYMBOL_FORMAT_VERSION are read;
 * anything newer is refused with a "saved by a newer version" message rather than being
 * half-loaded.
 */
import type { SymbolGeometry, Vec2 } from '../types/geometry';

export const SYMBOL_FORMAT_VERSION = 2;
export const MIN_SUPPORTED_SYMBOL_VERSION = 1;
export const SYMBOL_APP_MARKER = 'opnpnid-symbol';

/** Double extension, for the same reason as `.pnid.json`: ordinary JSON to every tool that
 * only knows `.json`, while still naming what it is. */
export const SYMBOL_FILE_EXTENSION = 'pnidsym.json';

/** The local-unit convention symbol geometry is authored in — the half-width of a built-in
 * glyph's nominal box (builtinSymbols.ts's own `HALF_EXTENT`). Written into every exported
 * file as `halfExtent` so an importer can tell whether the file's units mean what its own
 * units mean. */
export const SYMBOL_HALF_EXTENT = 14;

/** The largest local extent the symbol editor can display (CANVAS_PX / 2 / PX_PER_UNIT —
 * see SymbolEditor). Geometry past this is scaled to fit on import, since the editor has no
 * camera to reach it with. */
export const MAX_LOCAL_EXTENT = 28;

export interface SymbolFile {
  app: string;
  version: number;
  name: string;
  subtype: string | null;
  actuation: string | null;
  halfExtent: number;
  geometry: SymbolGeometry;
}

export interface ImportedSymbol {
  file: SymbolFile;
  /** The uniform factor applied to the file's geometry to bring it into this build's local
   * units and within the editor's drawable range — 1 when the file needed no adjustment. */
  scale: number;
}

const NOT_A_SYMBOL = "That doesn't look like an OpnPnID symbol file.";

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function buildSymbolFile(
  geometry: SymbolGeometry,
  meta: { name: string; subtype: string | null; actuation: string | null },
): SymbolFile {
  return {
    app: SYMBOL_APP_MARKER,
    version: SYMBOL_FORMAT_VERSION,
    name: meta.name,
    subtype: meta.subtype,
    actuation: meta.actuation,
    halfExtent: SYMBOL_HALF_EXTENT,
    geometry,
  };
}

/** Serializes one symbol. Pretty-printed for the same reason project files are: these are
 * plain text that people diff and version alongside the library folder. */
export function serializeSymbol(
  geometry: SymbolGeometry,
  meta: { name: string; subtype: string | null; actuation: string | null },
): string {
  return JSON.stringify(buildSymbolFile(geometry, meta), null, 2);
}

/** A filename-safe version of a category name, so an exported symbol arrives named after
 * what it draws rather than as `untitled`. */
export function suggestedSymbolFileName(categoryName: string): string {
  const slug = categoryName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'symbol'}.${SYMBOL_FILE_EXTENSION}`;
}

/** The local bounding half-extent of a symbol: the furthest any of its points — or the
 * corner of its image body, which extends past them when the image is larger than the
 * ports placed on it — sits from the local origin. A label counts by its anchor plus half
 * its own height; its width is left out deliberately, so a long caption can't shrink the
 * whole glyph on import the way including it would. */
export function symbolExtent(geometry: SymbolGeometry): number {
  let extent = 0;
  for (const p of Object.values(geometry.points)) {
    extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y));
  }
  if (geometry.image) {
    // The image is drawn centered on the local origin, so it reaches half its size each way.
    extent = Math.max(extent, geometry.image.width / 2, geometry.image.height / 2);
  }
  for (const text of geometry.texts ?? []) {
    extent = Math.max(extent, Math.abs(text.y) + text.size / 2, Math.abs(text.x));
  }
  return extent;
}

/** Uniformly resizes a symbol: point coordinates and image size scale, ids/topology and arc
 * bulges (pure shape ratios) don't. Returns the input untouched at factor 1 so the common
 * no-rescale import doesn't rebuild the object. */
export function scaleGeometry(geometry: SymbolGeometry, factor: number): SymbolGeometry {
  if (factor === 1) return geometry;
  const points: Record<string, Vec2> = {};
  for (const [id, p] of Object.entries(geometry.points)) points[id] = { x: p.x * factor, y: p.y * factor };
  return {
    ...geometry,
    points,
    image: geometry.image ? { ...geometry.image, width: geometry.image.width * factor, height: geometry.image.height * factor } : undefined,
    texts: geometry.texts?.map((t) => ({ ...t, x: t.x * factor, y: t.y * factor, size: t.size * factor })),
  };
}

/**
 * Parses and validates a symbol file's text, throwing an `Error` whose message is meant to
 * be shown to the user (wrong file type, malformed JSON, unreadable/newer schema, damaged
 * geometry). Callers surface it — nothing should reach the editor unvalidated.
 *
 * The returned geometry is already normalized into this build's local units; see the Scale
 * section above for what that means and when the factor is anything but 1.
 */
export function parseSymbolFile(text: string): ImportedSymbol {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("That file isn't valid JSON, so it can't be an OpnPnID symbol file.");
  }

  // Identify the file before judging its contents, so a stray .json (or a project file
  // picked by mistake) gets a clearer answer than "damaged".
  if (!isRecord(parsed) || !isFiniteNumber(parsed.version) || !isRecord(parsed.geometry)) {
    fail(isRecord(parsed) && isRecord(parsed.scene) ? `${NOT_A_SYMBOL} That's a whole project file — open it with File ▸ Open instead.` : NOT_A_SYMBOL);
  }
  const version = parsed.version;
  if (!Number.isInteger(version) || version < MIN_SUPPORTED_SYMBOL_VERSION) fail(`${NOT_A_SYMBOL} (Unrecognized schema version ${version}.)`);
  if (version > SYMBOL_FORMAT_VERSION) {
    fail(
      `This symbol was saved by a newer version of OpnPnID (file schema v${version}; this build reads up to v${SYMBOL_FORMAT_VERSION}). Update OpnPnID to import it.`,
    );
  }

  // A missing/nonsensical halfExtent means the file can't tell us what its units are; the
  // only safe reading is that they're ours, which is also what every file this build writes
  // will say.
  const halfExtent = isFiniteNumber(parsed.halfExtent) && parsed.halfExtent > 0 ? parsed.halfExtent : SYMBOL_HALF_EXTENT;
  const geometry = parseGeometry(parsed.geometry);

  const unitScale = SYMBOL_HALF_EXTENT / halfExtent;
  const extent = symbolExtent(geometry) * unitScale;
  const fitScale = extent > MAX_LOCAL_EXTENT ? MAX_LOCAL_EXTENT / extent : 1;
  const scale = unitScale * fitScale;

  return {
    file: {
      app: SYMBOL_APP_MARKER,
      version,
      name: optionalText(parsed.name) ?? 'Imported symbol',
      subtype: optionalText(parsed.subtype),
      actuation: optionalText(parsed.actuation),
      halfExtent: SYMBOL_HALF_EXTENT,
      geometry: scaleGeometry(geometry, scale),
    },
    scale,
  };
}

/**
 * Structural validation of a `SymbolGeometry`. Stricter than projectFormat's scene check in
 * one respect: an imported symbol is arbitrary text from another machine that this app will
 * then render, so its image body has to actually be an embedded raster — a remote URL here
 * would turn importing a symbol into fetching from whatever host the file names.
 */
function parseGeometry(raw: Record<string, unknown>): SymbolGeometry {
  if (!isRecord(raw.points)) fail('This symbol file is damaged: its "points" are missing or malformed.');
  const points: Record<string, Vec2> = {};
  for (const [id, value] of Object.entries(raw.points)) {
    if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
      fail(`This symbol file is damaged: point "${id}" has no usable coordinates.`);
    }
    points[id] = { x: value.x, y: value.y };
  }

  const lines = readList(raw.lines, 'lines').map((entry) => {
    if (!Array.isArray(entry) || entry.length < 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'string') {
      fail('This symbol file is damaged: one of its lines is incomplete.');
    }
    requirePoints(points, entry[0], entry[1]);
    return [entry[0], entry[1]] as [string, string];
  });

  const arcs = readList(raw.arcs, 'arcs').map((entry) => {
    if (!isRecord(entry) || typeof entry.a !== 'string' || typeof entry.b !== 'string' || !isFiniteNumber(entry.bulge)) {
      fail('This symbol file is damaged: one of its arcs is incomplete.');
    }
    requirePoints(points, entry.a, entry.b);
    return { a: entry.a, b: entry.b, bulge: entry.bulge };
  });

  const ports = readList(raw.ports, 'ports').map((id) => {
    if (typeof id !== 'string') fail('This symbol file is damaged: one of its ports is not a point name.');
    requirePoints(points, id);
    return id;
  });

  const texts = readList(raw.texts, 'texts').map((entry) => {
    if (!isRecord(entry) || typeof entry.text !== 'string' || !isFiniteNumber(entry.x) || !isFiniteNumber(entry.y) || !isFiniteNumber(entry.size)) {
      fail('This symbol file is damaged: one of its labels is incomplete.');
    }
    return { x: entry.x, y: entry.y, text: entry.text, size: entry.size };
  });

  // An absent/empty list stays absent rather than becoming `[]`, so a symbol with no
  // lettering round-trips identical to the way every symbol authored before labels
  // existed looks — one shape of "no labels", not two.
  return { points, lines, arcs, ports, image: parseImage(raw.image), ...(texts.length > 0 ? { texts } : {}) };
}

function parseImage(raw: unknown): SymbolGeometry['image'] {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw) || typeof raw.dataUrl !== 'string') fail('This symbol file is damaged: its image body is malformed.');
  if (!/^data:image\/[a-z0-9.+-]+;/i.test(raw.dataUrl)) {
    fail("This symbol file's image isn't embedded in the file. Only symbols whose image travels with them can be imported.");
  }
  if (!isFiniteNumber(raw.width) || !isFiniteNumber(raw.height) || raw.width <= 0 || raw.height <= 0) {
    fail("This symbol file is damaged: its image has no usable size.");
  }
  return { dataUrl: raw.dataUrl, width: raw.width, height: raw.height };
}

/** Optional lists default to empty — a symbol with no arcs, or a raster one with no lines,
 * is perfectly ordinary — but a present-and-not-a-list field means the file is damaged. */
function readList(value: unknown, field: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`This symbol file is damaged: its "${field}" list isn't a list.`);
  return value;
}

function requirePoints(points: Record<string, Vec2>, ...ids: string[]): void {
  for (const id of ids) {
    if (!(id in points)) fail("This symbol file is damaged: it references points that it doesn't contain.");
  }
}
