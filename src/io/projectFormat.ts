/**
 * The OpnPnID project-document format — what a `.pnid.json` file contains, and the only
 * place that decides whether a file being opened is one. Pure and DOM/Tauri-free (so it's
 * unit-tested directly in projectFormat.test.ts); projectIO.ts is the thin platform
 * wrapper that moves the text to and from a file.
 *
 * A document is a single JSON object:
 *
 * ```json
 * {
 *   "app": "opnpnid",
 *   "version": 3,
 *   "componentScale": 1,
 *   "scene": { "points": [], "lines": [], "arcs": [], "components": [], "texts": [] }
 * }
 * ```
 *
 * - `app` / `version` identify the file. `version` is the *schema* version of the
 *   document, not the app's — see the version history below.
 * - `componentScale` is the global symbol-size multiplier the drawing was authored at
 *   (see useSketchStore). It travels with the document because component bodies are drawn
 *   at that scale while their ports are stored in world coordinates: opening a drawing on
 *   an instance set to a different scale would otherwise render every symbol detached
 *   from the pipes attached to it.
 * - `scene` is exactly `SceneGraph.toJSON()`'s output, loaded back through
 *   `SceneGraph.fromJSON` — the same serialization undo/redo already round-trips through,
 *   so there is only ever one definition of what a scene is. Points, lines, arcs,
 *   components and texts are carried through whole rather than field by field, so anything
 *   later added to those entities is exported and imported without this module changing.
 *
 * Every placed component embeds a full `ComponentSnapshot` of the library data it came
 * from (including image symbols, which are already data: URLs), so a document opens
 * identically on a machine whose component library differs — or has none at all. That's
 * what makes the file portable between instances rather than only a local save.
 *
 * ## Version history
 *
 * - **1** — `{ version, scene }`.
 * - **2** — adds the `app` marker and `componentScale`. A v1 file still opens; it simply
 *   leaves the current component scale alone, since v1 didn't record one.
 * - **3** — adds `scene.texts`, the drawing's free text annotations. Older files still
 *   open: an absent list simply means a drawing with no notes on it.
 *
 * Files from version MIN_SUPPORTED_VERSION through PROJECT_FORMAT_VERSION are read;
 * anything newer is refused with a "saved by a newer version" message rather than being
 * half-loaded.
 */
import type { ProjectFile, SceneGraphJSON } from '../types/geometry';

export const PROJECT_FORMAT_VERSION = 3;
export const MIN_SUPPORTED_VERSION = 1;
export const PROJECT_APP_MARKER = 'opnpnid';

/** Double extension: the file reads as ordinary JSON to every tool that only knows about
 * `.json`, while still naming the app it belongs to. */
export const PROJECT_FILE_EXTENSION = 'pnid.json';
export const DEFAULT_PROJECT_FILENAME = `untitled.${PROJECT_FILE_EXTENSION}`;

const NOT_A_PROJECT = "That doesn't look like an OpnPnID project file.";

function fail(message: string): never {
  throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isVec2(value: unknown): boolean {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

export function buildProjectFile(scene: SceneGraphJSON, componentScale: number): ProjectFile {
  return { app: PROJECT_APP_MARKER, version: PROJECT_FORMAT_VERSION, componentScale, scene };
}

/** Serializes the current drawing. Pretty-printed rather than minified: project files are
 * plain text that people diff and version alongside the library folder. */
export function serializeProject(scene: SceneGraphJSON, componentScale: number): string {
  return JSON.stringify(buildProjectFile(scene, componentScale), null, 2);
}

/**
 * Parses and validates a project file's text, throwing an `Error` whose message is meant
 * to be shown to the user (wrong file type, malformed JSON, unreadable/newer schema).
 * Callers surface it — nothing should reach the store unvalidated, since a half-valid
 * scene would replace whatever's on the canvas with a broken one.
 */
export function parseProjectFile(text: string): ProjectFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("That file isn't valid JSON, so it can't be an OpnPnID project file.");
  }

  // Identify the file before judging its contents: a stray .json (or a project file from
  // a future release) deserves a clearer answer than "corrupt".
  if (!isRecord(parsed) || !isFiniteNumber(parsed.version) || !isRecord(parsed.scene)) fail(NOT_A_PROJECT);
  const version = parsed.version;
  if (!Number.isInteger(version) || version < MIN_SUPPORTED_VERSION) fail(`${NOT_A_PROJECT} (Unrecognized schema version ${version}.)`);
  if (version > PROJECT_FORMAT_VERSION) {
    fail(
      `This project was saved by a newer version of OpnPnID (file schema v${version}; this build reads up to v${PROJECT_FORMAT_VERSION}). Update OpnPnID to open it.`,
    );
  }

  const componentScale = isFiniteNumber(parsed.componentScale) && parsed.componentScale > 0 ? parsed.componentScale : undefined;
  return { app: PROJECT_APP_MARKER, version, componentScale, scene: parseScene(parsed.scene) };
}

/**
 * Structural validation only — enough that `SceneGraph.fromJSON` and the renderer can't
 * trip over a malformed file, without re-describing every field of every entity here.
 * Entities are returned as they were read (not rebuilt field by field), so fields added
 * to points/lines/arcs/components elsewhere in the app keep flowing through untouched.
 */
function parseScene(raw: Record<string, unknown>): SceneGraphJSON {
  const scene: SceneGraphJSON = {
    // arcs/components/texts may be absent (SceneGraph.fromJSON tolerates that too, and a
    // pre-v3 file has no texts at all); points and lines are always written, so a missing
    // one means the file really is damaged.
    points: readEntities(raw.points, 'points', true, (p) => typeof p.id === 'string' && isFiniteNumber(p.x) && isFiniteNumber(p.y)),
    lines: readEntities(raw.lines, 'lines', true, (l) => typeof l.id === 'string' && typeof l.startId === 'string' && typeof l.endId === 'string'),
    arcs: readEntities(
      raw.arcs,
      'arcs',
      false,
      (a) => typeof a.id === 'string' && typeof a.startId === 'string' && typeof a.endId === 'string' && isFiniteNumber(a.bulge),
    ),
    components: readEntities(raw.components, 'components', false, isComponentShaped),
    texts: readEntities(
      raw.texts,
      'texts',
      false,
      (t) => typeof t.id === 'string' && isFiniteNumber(t.x) && isFiniteNumber(t.y) && typeof t.text === 'string' && isFiniteNumber(t.fontSize),
    ),
  };

  // Every edge/port must resolve to a point that's actually in the file — a dangling id
  // would otherwise only surface later as a crash mid-render or mid-drag.
  const pointIds = new Set(scene.points.map((p) => p.id));
  for (const line of scene.lines) requirePoints(pointIds, line.startId, line.endId);
  for (const arc of scene.arcs) requirePoints(pointIds, arc.startId, arc.endId);
  for (const component of scene.components) {
    for (const conn of component.connections) requirePoints(pointIds, conn.pointId);
  }
  return scene;
}

function readEntities<T>(value: unknown, field: string, required: boolean, isValid: (entity: Record<string, unknown>) => boolean): T[] {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) fail(`This project file is damaged: its "${field}" list is missing or isn't a list.`);
  for (const entity of value) {
    if (!isRecord(entity) || !isValid(entity)) fail(`This project file is damaged: one of its ${field} entries is incomplete.`);
  }
  return value as T[];
}

/** The parts of a placed component this app dereferences directly (transform, ports,
 * symbol geometry). Everything else it carries — tag, real-part snapshot, and whatever
 * gets added to `ComponentInstance` later — rides along unexamined. */
function isComponentShaped(c: Record<string, unknown>): boolean {
  if (typeof c.id !== 'string' || !isVec2(c.position) || !isFiniteNumber(c.rotation)) return false;
  if (!Array.isArray(c.connections)) return false;
  if (!c.connections.every((conn) => isRecord(conn) && typeof conn.localId === 'string' && typeof conn.pointId === 'string')) return false;
  if (!isRecord(c.snapshot) || !isRecord(c.snapshot.symbol)) return false;
  const symbol = c.snapshot.symbol;
  return isRecord(symbol.points) && Array.isArray(symbol.ports);
}

function requirePoints(pointIds: Set<string>, ...ids: string[]): void {
  for (const id of ids) {
    if (!pointIds.has(id)) fail("This project file is damaged: it references points that it doesn't contain.");
  }
}
