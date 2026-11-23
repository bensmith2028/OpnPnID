/**
 * In-app editor for one category's symbol — the surface that turns the `symbols` table
 * (see db.ts's getSymbol/upsertSymbol) into something a user can actually author.
 *
 * Two ways to make a symbol, presented as tabs because they're mutually exclusive
 * authoring modes rather than two halves of one form:
 *  - "Draw": a miniature vector editor backed by its own isolated `SceneGraph` instance.
 *    Reusing the sketch engine's graph/snapping/arc math here (rather than a bespoke
 *    little data model) means points shared between segments, endpoint/grid snapping and
 *    bulge-based arcs all come for free, and the save step is a near-direct translation
 *    into `SymbolGeometry`.
 *  - "Upload Image": a raster body plus hand-placed connection ports. Ports are ordinary
 *    `SymbolGeometry` points either way, so nothing downstream has to care which mode
 *    produced a given symbol.
 *
 * The canvas here deliberately has no pan/zoom: a symbol is a small, fixed-extent glyph
 * (±14 local units by convention — see builtinSymbols.ts's HALF_EXTENT), so a fixed
 * pixels-per-unit scale with the origin pinned to the canvas centre is both simpler and
 * easier to draw against than a camera.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  arcGeometry,
  bulgeFromSagittaCursor,
  distance,
  projectPointOnArc,
  projectPointOnSegment,
  textHalfExtent,
} from '../canvas/geometry';
import { SceneGraph } from '../canvas/sceneGraph';
import { computeSnap, type SnapOptions, type SnapResult } from '../canvas/snapping';
import { SYMBOL_FILE_EXTENSION } from '../io/symbolFormat';
import { exportSymbol, importSymbol } from '../io/symbolIO';
import type { Id, SceneGraphJSON, SymbolGeometry, SymbolLine, Vec2 } from '../types/geometry';
import { strokeWidth } from '../canvas/renderer';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { PORT_TOOL, SHARED_TOOLS, type ToolDef, ToolRailView } from '../ui/ToolRail';
import { WeightField, commonWeight } from '../ui/WeightField';
import { resolveSymbol } from './builtinSymbols';
import * as db from './db';
import { describeError } from './errors';

const CANVAS_PX = 616;
/** Fixed zoom: visible range is CANVAS_PX / 2 / PX_PER_UNIT = ±28 local units. Sized for
 * the built-in symbols' actual extents, not just their nominal "±14" convention — the
 * automated-actuator valves' actuator box reaches y=-21 (see builtinSymbols.ts's
 * withAutomatedStem), so ±20 (the old 480px/12px-per-unit view) clipped it. ±28 leaves
 * real margin above that, and above the default uploaded-image width too. */
const PX_PER_UNIT = 11;
const GRID_UNITS = 2;
/** Vertical space the rest of the edit window takes (header, tool row, status, footer,
 * padding), so the canvas can be sized to leave the window free of scrollbars. */
const EDITOR_CHROME_HEIGHT = 250;
/** Width of everything beside the canvas (the tool rail) plus the window's own padding. */
const EDITOR_SIDE_WIDTH = 130;
const MIN_VIEW_PX = 260;

/** How big, in CSS pixels, to show the (CANVAS_PX × CANVAS_PX) drawing canvas so the whole
 * edit window fits the browser window. The canvas always *draws* at CANVAS_PX; this only
 * scales how it's displayed, and pointer positions are mapped back (see `pointerPx`). */
function fitViewPx(): number {
  const byHeight = window.innerHeight - EDITOR_CHROME_HEIGHT;
  const byWidth = window.innerWidth - EDITOR_SIDE_WIDTH - 48;
  return Math.round(Math.max(MIN_VIEW_PX, Math.min(CANVAS_PX, byHeight, byWidth)));
}

/** Where a pointer event landed on the canvas, in CANVAS_PX coordinates regardless of the
 * size the canvas is displayed at. */
function pointerPx(e: { clientX: number; clientY: number; currentTarget: Element }): { x: number; y: number } {
  const rect = e.currentTarget.getBoundingClientRect();
  const k = rect.width > 0 ? CANVAS_PX / rect.width : 1;
  return { x: (e.clientX - rect.left) * k, y: (e.clientY - rect.top) * k };
}
/** Click/snap tolerance in screen pixels, converted to local units where needed. */
const PICK_PX = 8;
/** Local units a pasted copy is nudged by, so it doesn't land exactly on its original.
 * Repeated pastes of the same clipboard cascade by multiples of this. */
const PASTE_OFFSET = 2;
/** Height (in local units) of a freshly placed label — a few units inside the ±14 box a
 * built-in glyph is drawn to, so a default label reads without swamping the symbol. */
const DEFAULT_TEXT_SIZE = 4;
/** Bounds on a label's height, in the same local units. The floor is a tenth of a unit
 * because a label below that is sub-pixel on a placed instance (componentScale × zoom is
 * around 1 at the default view) — invisible, and so unclickable to fix. The ceiling is the
 * half-extent this fixed-zoom canvas can show, so a label can never be sized past the edge
 * of the only view the user has of it. */
const MIN_TEXT_SIZE = 0.1;
const MAX_TEXT_SIZE = CANVAS_PX / 2 / PX_PER_UNIT;

/** Same order as the main window's rail (Select, Line, Arc, Point, Circle, Text), then Port. */
const EDITOR_TOOLS: ToolDef<DrawTool>[] = [SHARED_TOOLS.select, SHARED_TOOLS.line, SHARED_TOOLS.arc, SHARED_TOOLS.point, SHARED_TOOLS.circle, SHARED_TOOLS.text, PORT_TOOL];

/** Same order as the main app's own toolbar (Toolbar.tsx) — Select, Line, Arc, Point,
 * Circle, Text — so the two tool rows read as the same tool set, not a different order to
 * relearn just because this modal is open. */
type DrawTool = 'select' | 'line' | 'arc' | 'point' | 'circle' | 'text' | 'port';
/** Hotkeys deliberately mirror the main app's own tool letters (see SketchCanvas's key
 * handler) — muscle memory shouldn't change just because this modal is open. The letters shown
 * on the rail buttons come from the shared tool definitions (ui/ToolRail.tsx). */
const HOTKEY_TOOLS: Record<string, DrawTool> = { v: 'select', l: 'line', a: 'arc', p: 'point', c: 'circle', t: 'text', o: 'port' };

/** What one click landed on — the atom a selection is built from. */
type DrawHit = { kind: 'point' | 'line' | 'arc' | 'text'; id: Id } | null;

/** The selection is multi-item (shift-click and marquee), so it's a set per kind rather
 * than a single `{kind, id}`: a marquee routinely spans a mix of points, lines and arcs. */
interface DrawSelection {
  points: Set<Id>;
  lines: Set<Id>;
  arcs: Set<Id>;
  texts: Set<Id>;
}

/** Geometry-only copy buffer (a `SymbolGeometry` minus ports/image). Copy/paste duplicates
 * shapes, never connection semantics — a pasted point is never automatically a port. */
interface DrawClipboard {
  points: { id: Id; x: number; y: number }[];
  lines: [Id, Id, number?][];
  arcs: { a: Id; b: Id; bulge: number; weight?: number }[];
  texts: { x: number; y: number; text: string; size: number }[];
}

/** The inline label editor, mirroring the main canvas's (see SketchCanvas's
 * TextEditorState): an `<input>` over the mini canvas where the label will be drawn. `id`
 * is the label being re-edited, or null while placing a new one. */
interface TextEditorState {
  id: Id | null;
  local: Vec2;
  size: number;
  value: string;
}

interface LocalRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Undo/redo unit: the whole editing session's state that isn't recoverable from the
 * graph alone. `ports` lives in React state, not the graph, so it has to travel with
 * every snapshot alongside the graph's own point/line/arc content. */
interface EditorSnapshot {
  scene: SceneGraphJSON;
  ports: string[];
}

function snapshotsEqual(a: EditorSnapshot, b: EditorSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** An in-progress drag of one or more points (Select tool). `singlePointId` is set only
 * when dragging exactly one point directly — that's the one case with an unambiguous
 * "point being moved" to run a full grid+endpoint snap search against; a group/edge drag
 * instead quantizes the raw pointer delta to the grid (computeSnap's `gridMode: 'delta'`). */
interface GroupDrag {
  grabLocal: Vec2;
  pointOrigins: Map<Id, Vec2>;
  textOrigins: Map<Id, Vec2>;
  singlePointId: Id | null;
  before: EditorSnapshot;
}

function emptySelection(): DrawSelection {
  return { points: new Set(), lines: new Set(), arcs: new Set(), texts: new Set() };
}

function selectionCount(sel: DrawSelection): number {
  return sel.points.size + sel.lines.size + sel.arcs.size + sel.texts.size;
}

/** Corner-order-independent rect, so a marquee dragged up-left behaves like one dragged
 * down-right. */
function normalizeRect(a: Vec2, b: Vec2): LocalRect {
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

function pointInRect(p: Vec2, rect: LocalRect): boolean {
  return p.x >= rect.x0 && p.x <= rect.x1 && p.y >= rect.y0 && p.y <= rect.y1;
}

/**
 * The two diametrically-opposite points a circle is built from. There's no Circle
 * primitive in this data model: a full circle is two bulge=1 arcs sharing both endpoints
 * (see sceneGraph.test.ts's "circle composition" block, and drawCircleTool.ts for the main
 * app's version of the same construction). The clicked rim point is kept as-is so the
 * circle passes exactly through where the user clicked.
 */
function circleArcEndpoints(center: Vec2, rim: Vec2): { radius: number; a: Vec2; b: Vec2 } {
  return {
    radius: distance(center, rim),
    a: { x: rim.x, y: rim.y },
    b: { x: 2 * center.x - rim.x, y: 2 * center.y - rim.y },
  };
}

/** This editor's binding of the shared snap: its zoom and grid are both fixed, so the only
 * things a call site chooses are what it's snapping and which snaps apply. Callers pass
 * `disabled: e.altKey` — Alt is the freehand escape hatch here exactly as it is on the main
 * canvas, which matters more now that the grid snap itself is ungated. */
function editorSnap(opts: Omit<SnapOptions, 'threshold' | 'gridSize'>): SnapResult {
  return computeSnap({ ...opts, threshold: PICK_PX / PX_PER_UNIT, gridSize: GRID_UNITS });
}

function localToScreen(p: Vec2): Vec2 {
  return { x: CANVAS_PX / 2 + p.x * PX_PER_UNIT, y: CANVAS_PX / 2 + p.y * PX_PER_UNIT };
}

function screenToLocal(p: Vec2): Vec2 {
  return { x: (p.x - CANVAS_PX / 2) / PX_PER_UNIT, y: (p.y - CANVAS_PX / 2) / PX_PER_UNIT };
}

/**
 * A short, human-readable id that's free in the given graph. Deliberately not
 * `SceneGraph`'s own `nextId` counter: that counter is module-global and resets on
 * reload, so a symbol saved with `pt_3` in it could collide with a freshly generated
 * `pt_3` the next time it's loaded for editing.
 */
function freshId(graph: SceneGraph, prefix: string): Id {
  let n = 0;
  while (
    graph.points.has(`${prefix}${n}`) ||
    graph.lines.has(`${prefix}${n}`) ||
    graph.arcs.has(`${prefix}${n}`) ||
    graph.texts.has(`${prefix}${n}`)
  ) {
    n++;
  }
  return `${prefix}${n}`;
}

/** Loads a `SymbolGeometry` into an (empty) editing graph, preserving point ids so a
 * re-saved symbol keeps stable port ids. Lines/arcs referencing a missing point are
 * skipped rather than trusted — stored geometry is user data, not an invariant. */
function populateGraph(graph: SceneGraph, geometry: SymbolGeometry) {
  for (const [id, p] of Object.entries(geometry.points)) graph.addPoint(p.x, p.y, id);
  for (const [a, b, weight] of geometry.lines) {
    if (graph.points.has(a) && graph.points.has(b)) graph.addLine(a, b, null, freshId(graph, 'l'), weight);
  }
  for (const arc of geometry.arcs) {
    if (graph.points.has(arc.a) && graph.points.has(arc.b)) graph.addArc(arc.a, arc.b, arc.bulge, freshId(graph, 'a'), arc.weight);
  }
  // Labels get editing-session ids (they have none in the stored symbol — see SymbolText),
  // exactly like lines and arcs do.
  for (const text of geometry.texts ?? []) graph.addText(text.x, text.y, text.text, text.size, freshId(graph, 't'));
}

/** The inverse of `populateGraph`: the editing graph as the persisted symbol shape.
 * `ports` keeps the user's marking order, which is the connection order downstream. */
function graphToGeometry(graph: SceneGraph, ports: string[]): SymbolGeometry {
  const texts = [...graph.texts.values()].map((t) => ({ x: t.x, y: t.y, text: t.text, size: t.fontSize }));
  return {
    points: Object.fromEntries([...graph.points.values()].map((p) => [p.id, { x: p.x, y: p.y }])),
    lines: [...graph.lines.values()].map((l) => (l.weight === undefined ? [l.startId, l.endId] : [l.startId, l.endId, l.weight]) as SymbolLine),
    arcs: [...graph.arcs.values()].map((a) => ({ a: a.startId, b: a.endId, bulge: a.bulge, ...(a.weight === undefined ? {} : { weight: a.weight }) })),
    ports: ports.filter((id) => graph.points.has(id)),
    // Absent rather than `[]` when there are none, so an unlabelled symbol serializes the
    // same way every symbol authored before labels existed does (see symbolFormat.ts).
    ...(texts.length > 0 ? { texts } : {}),
  };
}

interface EditorColors {
  bg: string;
  grid: string;
  axis: string;
  line: string;
  point: string;
  accent: string;
}

/** Pulls the app's own theme tokens out of CSS custom properties so the mini canvas
 * follows the light/dark toggle without the editor needing to read the sketch store. */
function editorColors(): EditorColors {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    bg: read('--bg-input', '#1a1b20'),
    grid: read('--border', '#414450'),
    axis: read('--text-muted', '#9aa0ab'),
    line: read('--text', '#dfe3ea'),
    point: read('--text', '#dfe3ea'),
    accent: read('--accent', '#5ab4ff'),
  };
}

/** Sizes the backing store for the device pixel ratio and resets the transform — the
 * fixed-scale equivalent of what SketchCanvas does for the main canvas. */
function prepareCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  const backing = Math.round(CANVAS_PX * dpr);
  if (canvas.width !== backing) {
    canvas.width = backing;
    canvas.height = backing;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX);
  return ctx;
}

function drawBackdrop(ctx: CanvasRenderingContext2D, colors: EditorColors) {
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);

  const spacing = GRID_UNITS * PX_PER_UNIT;
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = (CANVAS_PX / 2) % spacing; x < CANVAS_PX; x += spacing) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CANVAS_PX);
  }
  for (let y = (CANVAS_PX / 2) % spacing; y < CANVAS_PX; y += spacing) {
    ctx.moveTo(0, y);
    ctx.lineTo(CANVAS_PX, y);
  }
  ctx.stroke();

  // Origin crosshair — the symbol's local (0,0), i.e. where the instance's position lands.
  ctx.strokeStyle = colors.axis;
  ctx.beginPath();
  ctx.moveTo(CANVAS_PX / 2, 0);
  ctx.lineTo(CANVAS_PX / 2, CANVAS_PX);
  ctx.moveTo(0, CANVAS_PX / 2);
  ctx.lineTo(CANVAS_PX, CANVAS_PX / 2);
  ctx.stroke();
}

/** Local-screen-space arc stroke. renderer.ts's `strokeArc` is coupled to
 * CameraState/worldToScreen, so this fixed-scale editor keeps its own tiny equivalent
 * rather than dragging camera machinery in. */
function strokeLocalArc(ctx: CanvasRenderingContext2D, start: Vec2, end: Vec2, bulge: number) {
  const geo = arcGeometry(start, end, bulge);
  if (geo.isStraight) {
    const sa = localToScreen(start);
    const sb = localToScreen(end);
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
    return;
  }
  const center = localToScreen(geo.center);
  ctx.beginPath();
  ctx.arc(center.x, center.y, geo.radius * PX_PER_UNIT, geo.startAngle, geo.endAngle, geo.anticlockwise);
  ctx.stroke();
}

/** Ports are drawn as larger accent-coloured rings so it's obvious at a glance which
 * points a pipe will be able to attach to. */
/** A plain point is a small dot; a port is its own kind of object, drawn as a larger ring with
 * its connection order (1, 2, …) beside it, so the two can never be mistaken for each other. */
function drawPointMarker(ctx: CanvasRenderingContext2D, p: Vec2, colors: EditorColors, portNumber: number | null, isSelected: boolean) {
  const s = localToScreen(p);
  ctx.beginPath();
  if (portNumber !== null) {
    ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = colors.bg;
    ctx.fill();
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = colors.accent;
    ctx.fill();
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(String(portNumber), s.x + 8, s.y - 6);
  } else {
    ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = colors.point;
    ctx.fill();
  }
  if (isSelected) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, 9, 0, Math.PI * 2);
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

/** Nearest point/line/arc within the pick tolerance, points first (they're what the user
 * is usually aiming at, and they sit on top of the edges that reference them). */
function hitTest(graph: SceneGraph, local: Vec2): DrawHit {
  const tol = PICK_PX / PX_PER_UNIT;
  let best: { sel: DrawHit; d: number } | null = null;
  for (const p of graph.points.values()) {
    const d = distance(local, p);
    if (d <= tol && (!best || d < best.d)) best = { sel: { kind: 'point', id: p.id }, d };
  }
  if (best) return best.sel;
  // A label is grabbed anywhere inside its box (it has no stroke or anchor to aim at), and
  // wins over the edges it may sit on top of — same rule as the main canvas's select tool.
  for (const t of graph.texts.values()) {
    const half = textHalfExtent(t.text, t.fontSize);
    if (Math.abs(local.x - t.x) > half.x || Math.abs(local.y - t.y) > half.y) continue;
    const d = distance(local, t);
    if (!best || d < best.d) best = { sel: { kind: 'text', id: t.id }, d };
  }
  if (best) return best.sel;
  for (const line of graph.lines.values()) {
    const a = graph.points.get(line.startId);
    const b = graph.points.get(line.endId);
    if (!a || !b) continue;
    const d = projectPointOnSegment(local, a, b).distance;
    if (d <= tol && (!best || d < best.d)) best = { sel: { kind: 'line', id: line.id }, d };
  }
  for (const arc of graph.arcs.values()) {
    const a = graph.points.get(arc.startId);
    const b = graph.points.get(arc.endId);
    if (!a || !b) continue;
    const d = projectPointOnArc(local, a, b, arc.bulge).distance;
    if (d <= tol && (!best || d < best.d)) best = { sel: { kind: 'arc', id: arc.id }, d };
  }
  return best ? best.sel : null;
}

/** Applies one click to the selection: replace by default, toggle when `additive`
 * (Shift/Ctrl/Cmd) — the same convention as the main app's selectTool. */
function withHit(prev: DrawSelection, hit: NonNullable<DrawHit>, additive: boolean): DrawSelection {
  const next = additive
    ? { points: new Set(prev.points), lines: new Set(prev.lines), arcs: new Set(prev.arcs), texts: new Set(prev.texts) }
    : emptySelection();
  const bucket = hit.kind === 'point' ? next.points : hit.kind === 'line' ? next.lines : hit.kind === 'arc' ? next.arcs : next.texts;
  if (additive && bucket.has(hit.id)) bucket.delete(hit.id);
  else bucket.add(hit.id);
  return next;
}

/** Marquee result: every point inside the rect, plus every edge with BOTH endpoints
 * inside it (partial overlaps are left out — same "fully inside" rule as the main app's
 * `selectOnPointerUp`). `base` is the selection being extended, or an empty one. */
function selectInsideRect(graph: SceneGraph, rect: LocalRect, base: DrawSelection): DrawSelection {
  const next = { points: new Set(base.points), lines: new Set(base.lines), arcs: new Set(base.arcs), texts: new Set(base.texts) };
  for (const p of graph.points.values()) if (pointInRect(p, rect)) next.points.add(p.id);
  for (const line of graph.lines.values()) {
    const a = graph.points.get(line.startId);
    const b = graph.points.get(line.endId);
    if (a && b && pointInRect(a, rect) && pointInRect(b, rect)) next.lines.add(line.id);
  }
  for (const arc of graph.arcs.values()) {
    const a = graph.points.get(arc.startId);
    const b = graph.points.get(arc.endId);
    if (a && b && pointInRect(a, rect) && pointInRect(b, rect)) next.arcs.add(arc.id);
  }
  // A label is caught by its anchor, not its whole box — the same "where the thing is"
  // rule the main canvas's marquee uses for components and notes.
  for (const t of graph.texts.values()) if (pointInRect(t, rect)) next.texts.add(t.id);
  return next;
}

/** Every point id referenced by a selection, directly or via a selected line/arc's
 * endpoints — shared by copy (clipboardFromSelection) and dragging a selection as a
 * group (a selected edge's endpoints move with it even though the edge itself isn't a
 * point). */
function selectionPointIds(graph: SceneGraph, sel: DrawSelection): Set<Id> {
  const pointIds = new Set(sel.points);
  for (const id of sel.lines) {
    const line = graph.lines.get(id);
    if (line) {
      pointIds.add(line.startId);
      pointIds.add(line.endId);
    }
  }
  for (const id of sel.arcs) {
    const arc = graph.arcs.get(id);
    if (arc) {
      pointIds.add(arc.startId);
      pointIds.add(arc.endId);
    }
  }
  return pointIds;
}

/**
 * The clipboard payload for a selection. Edges come along when both their endpoints are
 * copied — selecting two connected points and copying should bring their connector, which
 * is what a user means by "copy these". Explicitly selected edges pull their own endpoints
 * in first, so selecting just a line copies a usable line rather than nothing.
 */
function clipboardFromSelection(graph: SceneGraph, sel: DrawSelection): DrawClipboard | null {
  const pointIds = selectionPointIds(graph, sel);

  const points = [...pointIds]
    .map((id) => graph.points.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ id: p.id, x: p.x, y: p.y }));
  const texts = [...sel.texts]
    .map((id) => graph.texts.get(id))
    .filter((t): t is NonNullable<typeof t> => !!t)
    .map((t) => ({ x: t.x, y: t.y, text: t.text, size: t.fontSize }));
  if (points.length === 0 && texts.length === 0) return null;

  const lines: [Id, Id, number?][] = [];
  for (const line of graph.lines.values()) {
    if (pointIds.has(line.startId) && pointIds.has(line.endId)) lines.push([line.startId, line.endId, line.weight]);
  }
  const arcs = [...graph.arcs.values()]
    .filter((arc) => pointIds.has(arc.startId) && pointIds.has(arc.endId))
    .map((arc) => ({ a: arc.startId, b: arc.endId, bulge: arc.bulge, weight: arc.weight }));

  return { points, lines, arcs, texts };
}

/** Trims float noise out of a derived dimension so the width/height inputs stay readable. */
function formatUnits(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Pins a typed label height into the drawable/renderable range. Clamping rather than
 * rejecting, so an out-of-range number still does the nearest sensible thing (and the field
 * is rewritten to the clamped value on commit, so it never claims a size that wasn't
 * applied). The `size > 0` guard in SceneGraph.setTextFontSize stays the last line of
 * defence — this is the editor's own, tighter policy. */
function clampTextSize(size: number): number {
  return Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, size));
}

/** One-line description of what's selected, for the Properties column. A selected port says
 * where it sits in the connection order. */
function describeSelection(sel: DrawSelection, ports: string[]): string {
  const selectedPorts = [...sel.points].filter((id) => ports.includes(id));
  if (selectedPorts.length === 1 && selectionCount(sel) === 1) {
    return `Port ${ports.indexOf(selectedPorts[0]) + 1} of ${ports.length}`;
  }
  const parts: string[] = [];
  const add = (n: number, noun: string) => n > 0 && parts.push(`${n} ${noun}${n === 1 ? '' : 's'}`);
  add(sel.points.size - selectedPorts.length, 'point');
  add(selectedPorts.length, 'port');
  add(sel.lines.size, 'line');
  add(sel.arcs.size, 'arc');
  add(sel.texts.size, 'label');
  return parts.length > 0 ? `Selected: ${parts.join(', ')}` : 'Nothing selected';
}

export function SymbolEditor({ category, onClose, onSaved }: { category: db.Category; onClose: () => void; onSaved: () => void }) {
  // One isolated graph per editor session — deliberately NOT the app's document graph;
  // this is a throwaway scratch scene that only ever becomes a SymbolGeometry. Undo/redo
  // reassigns graphRef.current wholesale (see undo/redo below), so every other read of
  // the graph inside this component goes through the `graph` const re-derived each
  // render — only undo/redo itself needs to read graphRef.current directly, since it's
  // a stable (rarely-recreated) callback that must never operate on a stale reference.
  const graphRef = useRef<SceneGraph | null>(null);
  const graph = (graphRef.current ??= new SceneGraph());

  /** The component's name, editable in the header and saved along with the drawing. */
  const [nameText, setNameText] = useState(category.name);
  /** Whether the "delete this component?" confirmation is up. */
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /** The family it belongs to — changing it here moves the component when the drawing is saved. */
  const [familyId, setFamilyId] = useState(category.familyId);
  const [families, setFamilies] = useState<db.Family[]>([]);
  useEffect(() => {
    void db.listFamilies().then(setFamilies);
  }, []);
  /** Displayed canvas size, kept to what fits the window (see fitViewPx). */
  const [viewPx, setViewPx] = useState(fitViewPx);
  useEffect(() => {
    const onResize = () => setViewPx(fitViewPx());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  /** Display scale relative to the drawing canvas, for positioning the label editor. */
  const viewScale = viewPx / CANVAS_PX;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Transient confirmation for the file actions (exported / imported, and whether the
   * import had to be rescaled) — the same muted-status idiom the library panel's sync row
   * uses. Distinct from `error`: these aren't failures. */
  const [notice, setNotice] = useState<string | null>(null);
  /** Bumped after every graph mutation — the graph lives in a ref, so this is what tells
   * React (and the draw effect) that the canvas is stale. */
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const [tool, setTool] = useState<DrawTool>('select');
  const [selection, setSelection] = useState<DrawSelection>(emptySelection);
  const [pendingLine, setPendingLine] = useState<Id | null>(null);
  const [pendingArc, setPendingArc] = useState<{ startId: Id; endId: Id | null } | null>(null);
  /** Circle click 1: the centre is a bare position, not a graph point — the finished
   * circle is only its two rim points, so a centre point would be stray saved geometry. */
  const [pendingCircle, setPendingCircle] = useState<{ center: Vec2 } | null>(null);
  /** Snapped cursor while a circle is pending, purely for the radius preview. */
  const [circleCursor, setCircleCursor] = useState<Vec2 | null>(null);
  /** In-flight marquee drag (Select tool on empty space); null when not dragging. */
  const [marquee, setMarquee] = useState<{ origin: Vec2; current: Vec2; additive: boolean } | null>(null);
  /** In-flight point/edge/group drag (Select tool on a hit); null when not dragging. */
  const [groupDrag, setGroupDrag] = useState<GroupDrag | null>(null);
  /** The open inline label editor, or null. Mirrored into a ref for the same reason
   * `ports` is (and the same reason SketchCanvas mirrors its own): the commit path is
   * driven by the input's `blur`, so "is an editor still open?" has to be answerable
   * synchronously mid-handler rather than from the last render's closure. */
  const [textEditor, setTextEditor] = useState<TextEditorState | null>(null);
  const textEditorRef = useRef<TextEditorState | null>(null);
  const putTextEditor = useCallback((next: TextEditorState | null) => {
    textEditorRef.current = next;
    setTextEditor(next);
  }, []);
  /** The toolbar's label-height field, held as raw text (not a number) for the same reason
   * the image tab's width/height are: a half-typed "" or "1." has to survive keystroke to
   * keystroke without the field fighting back. It doubles as the "pen" setting — the size
   * the next placed label gets — and as the readout for whichever label is in hand, which
   * is why it's re-pointed at a label whenever one is clicked or opened for editing. */
  const [textSizeText, setTextSizeText] = useState(String(DEFAULT_TEXT_SIZE));
  const [clipboard, setClipboard] = useState<DrawClipboard | null>(null);
  /** How many times the current clipboard has been pasted, so repeats cascade instead of
   * stacking on top of each other. Reset by every copy. */
  const [pasteCount, setPasteCount] = useState(0);
  const [ports, setPorts] = useState<string[]>([]);
  /** Mirrors `ports` synchronously (state updates aren't visible until the next render,
   * but undo/redo history snapshots need the true current value at the moment they're
   * taken, mid-handler) — every write to `ports` goes through setPortsSynced below so
   * this never drifts out of sync. */
  const portsRef = useRef<string[]>([]);
  const setPortsSynced = (next: string[]) => {
    portsRef.current = next;
    setPorts(next);
  };

  /** Undo/redo history for this editing session, local to this modal (not the app's own
   * document undo stack). Snapshots the graph plus `ports`, since ports live outside the
   * graph in React state. Refs, not state — history bookkeeping shouldn't itself trigger
   * renders; `bump()` after every mutation already does that. */
  const pastRef = useRef<EditorSnapshot[]>([]);
  const futureRef = useRef<EditorSnapshot[]>([]);
  /** Always reads graphRef.current directly (not the `graph` const) so this stays correct
   * even when called from a long-lived callback (undo/redo) whose closure predates a
   * later graph swap. */
  const captureSnapshot = (): EditorSnapshot => ({ scene: graphRef.current!.toJSON(), ports: [...portsRef.current] });
  const pushHistoryIfChanged = (before: EditorSnapshot) => {
    const after = captureSnapshot();
    if (!snapshotsEqual(before, after)) {
      pastRef.current.push(before);
      futureRef.current = [];
    }
  };

  /** A picture the symbol carries as its body, if it came in with one (an imported file can).
   * There's no way to add one here any more, but an existing one is kept and shown behind the
   * drawing, and saved back untouched. */
  const [bodyImage, setBodyImage] = useState<NonNullable<SymbolGeometry['image']> | null>(null);
  const [bodyImageEl, setBodyImageEl] = useState<HTMLImageElement | null>(null);

  const drawCanvasRef = useRef<HTMLCanvasElement>(null);

  /** Makes a `SymbolGeometry` the thing being edited — the initial content, or an imported
   * file. Replaces the graph wholesale (the same swap undo/redo does) rather than merging
   * into whatever's there. */
  const applyGeometry = (geometry: SymbolGeometry, isStale: () => boolean = () => false) => {
    const nextGraph = new SceneGraph();
    graphRef.current = nextGraph;
    populateGraph(nextGraph, geometry);
    setPortsSynced(geometry.ports.filter((id) => nextGraph.points.has(id)));
    // The image decodes asynchronously and may outlive the editor, hence the staleness check.
    setBodyImage(geometry.image ?? null);
    setBodyImageEl(null);
    if (geometry.image) {
      const img = new Image();
      img.onload = () => {
        if (!isStale()) setBodyImageEl(img);
      };
      img.src = geometry.image.dataUrl;
    }
    bump();
  };

  // Initial content: the category's own stored symbol if it has one, otherwise the
  // built-in/placeholder symbol it currently renders as — so "Edit Drawing" always opens
  // on what the user already sees on the canvas, as an editable starting point.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const stored = category.symbolId ? await db.getSymbol(category.symbolId) : null;
        const geometry = stored?.geometry ?? resolveSymbol(category.subtype, category.actuation, category.portCount);
        if (cancelled) return;
        applyGeometry(geometry, () => cancelled);
      } catch (e) {
        if (!cancelled) setError(describeError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Abandons whatever multi-click/drag gesture is in flight — shared by Escape and by
   * every tool switch, so a half-placed line can't leak into the next tool. */
  const cancelPending = useCallback(() => {
    setPendingLine(null);
    setPendingArc(null);
    setPendingCircle(null);
    setCircleCursor(null);
    setMarquee(null);
    setGroupDrag(null);
    putTextEditor(null); // an abandoned label was never in the graph, so there's nothing to undo
  }, [putTextEditor]);

  const deleteSelected = useCallback(() => {
    if (selectionCount(selection) === 0) return;
    setError(null);
    const before = captureSnapshot();
    // Edges before points, matching useSketchStore's deleteSelection: dropping the
    // selected lines/arcs first frees up their endpoints, so a selection containing both
    // an edge and its endpoints deletes cleanly in one go.
    for (const id of selection.arcs) graph.removeArc(id);
    for (const id of selection.lines) graph.removeLine(id);
    for (const id of selection.texts) graph.removeText(id);

    const removed: Id[] = [];
    const blocked: Id[] = [];
    for (const id of selection.points) {
      if (graph.removePoint(id)) removed.push(id);
      else blocked.push(id);
    }
    if (removed.length > 0) {
      const gone = new Set(removed);
      setPortsSynced(ports.filter((id) => !gone.has(id)));
    }
    // SceneGraph refuses to orphan an edge's endpoint — surface that instead of a silent
    // no-op, since the point visibly stays put. Blocked points stay selected so it's clear
    // which ones the message is about.
    if (blocked.length > 0) {
      setError(
        blocked.length === 1
          ? 'That point is still used by a line or arc — delete those first.'
          : `${blocked.length} points are still used by a line or arc — delete those first.`,
      );
    }
    setSelection({ points: new Set(blocked), lines: new Set(), arcs: new Set(), texts: new Set() });
    pushHistoryIfChanged(before);
    bump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, selection, ports]);

  const copySelection = useCallback(() => {
    const payload = clipboardFromSelection(graph, selection);
    if (!payload) return;
    setClipboard(payload);
    setPasteCount(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, selection]);

  /** Pastes at a cascading offset with fresh ids throughout, then selects the copy so it
   * can immediately be deleted, dragged, or pasted again. Ports are intentionally not
   * carried over. */
  const pasteClipboard = useCallback(() => {
    if (!clipboard) return;
    setError(null);
    const before = captureSnapshot();
    const offset = PASTE_OFFSET * (pasteCount + 1);
    const idMap = new Map<Id, Id>();
    const points = new Set<Id>();
    for (const p of clipboard.points) {
      const created = graph.addPoint(p.x + offset, p.y + offset, freshId(graph, 'p'));
      idMap.set(p.id, created.id);
      points.add(created.id);
    }
    const lines = new Set<Id>();
    for (const [a, b, weight] of clipboard.lines) {
      const created = graph.addLine(idMap.get(a)!, idMap.get(b)!, null, freshId(graph, 'l'), weight);
      if (created) lines.add(created.id);
    }
    const arcs = new Set<Id>();
    for (const arc of clipboard.arcs) {
      const created = graph.addArc(idMap.get(arc.a)!, idMap.get(arc.b)!, arc.bulge, freshId(graph, 'a'), arc.weight);
      if (created) arcs.add(created.id);
    }
    const texts = new Set<Id>();
    for (const t of clipboard.texts) {
      texts.add(graph.addText(t.x + offset, t.y + offset, t.text, t.size, freshId(graph, 't')).id);
    }
    setPasteCount((n) => n + 1);
    setSelection({ points, lines, arcs, texts });
    pushHistoryIfChanged(before);
    bump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipboard, graph, pasteCount]);

  /** The height a label placed right now would get: what's in the size field, clamped, or
   * the default while that field is empty/mid-edit. Clamped here as well as on commit so a
   * value typed but never committed still can't place an unusable label. */
  const currentTextSize = (): number => {
    const parsed = parseFloat(textSizeText);
    return Number.isFinite(parsed) ? clampTextSize(parsed) : DEFAULT_TEXT_SIZE;
  };

  /** Points the size field at a label the user has just taken in hand (clicked, or opened
   * for editing), so it reads as that label's height rather than as a stale pen setting. */
  const showTextSize = (size: number) => setTextSizeText(formatUnits(size));

  /** Applies the size field to every selected label, as one undo entry. Also normalizes the
   * field itself, so a typed "0" or "999" visibly becomes the size that was really used.
   * With nothing selected this is purely the pen setting for the next label — no graph
   * mutation, and so nothing to undo. */
  const commitTextSize = () => {
    const size = currentTextSize();
    setTextSizeText(formatUnits(size));
    if (selection.texts.size === 0) return;
    const before = captureSnapshot();
    for (const id of selection.texts) graph.setTextFontSize(id, size);
    pushHistoryIfChanged(before);
    bump();
  };

  /** Writes the open label editor into the editing graph and closes it. Closes *first*, so
   * the blur that follows a click elsewhere finds nothing left to commit instead of
   * committing the same label twice. Blank content places nothing (and deletes the label
   * being edited) — an empty label would be invisible and unclickable. */
  const commitTextEditor = useCallback(() => {
    const editor = textEditorRef.current;
    if (!editor) return;
    putTextEditor(null);
    const before = captureSnapshot();
    if (editor.id === null) {
      if (editor.value.trim()) {
        const created = graph.addText(editor.local.x, editor.local.y, editor.value, editor.size, freshId(graph, 't'));
        setSelection({ points: new Set(), lines: new Set(), arcs: new Set(), texts: new Set([created.id]) });
      }
    } else {
      graph.setTextContent(editor.id, editor.value);
      // The editor carries the label's height as well as its content (it's what the inline
      // input is sized by), so both land in the same history entry.
      graph.setTextFontSize(editor.id, editor.size);
      // Leaving the edited label selected is what keeps the toolbar's size field acting on
      // it after the editor closes: reaching that field necessarily blurs — and therefore
      // commits — the inline input. Blank content deleted the label, so check it survived.
      if (graph.texts.has(editor.id)) {
        setSelection({ points: new Set(), lines: new Set(), arcs: new Set(), texts: new Set([editor.id]) });
      }
    }
    pushHistoryIfChanged(before);
    bump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, putTextEditor]);

  /** Undo/redo are deliberately near-static callbacks (their only real dependency is
   * `cancelPending`, itself static) — everything they touch is a ref or a React state
   * setter, both stable regardless of which render's closure is calling them, so they
   * stay correct even though they're essentially never recreated. */
  const undo = useCallback(() => {
    if (pastRef.current.length === 0) return;
    const current = captureSnapshot();
    const previous = pastRef.current.pop()!;
    futureRef.current.push(current);
    graphRef.current = SceneGraph.fromJSON(previous.scene);
    setPortsSynced(previous.ports);
    setSelection(emptySelection());
    cancelPending();
    setError(null);
    bump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelPending]);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const current = captureSnapshot();
    const next = futureRef.current.pop()!;
    pastRef.current.push(current);
    graphRef.current = SceneGraph.fromJSON(next.scene);
    setPortsSynced(next.ports);
    setSelection(emptySelection());
    cancelPending();
    setError(null);
    bump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelPending]);

  // Scoped key handling, same pattern as RealHardwareModal. This is a full lockout, not a
  // filter: while the modal is open EVERY keystroke is stopped in the capture phase so
  // SketchCanvas's global handler can't switch tools or delete geometry behind it. Typing
  // in a text field is the one exemption — those keys are the field's, not the editor's.
  // Escape never closes the modal (Cancel/Save/backdrop-click do that) — it only backs
  // out of whatever's in progress, exactly like the main app's own Escape: cancel a
  // pending gesture, then fall back to the Select tool (or clear its selection if
  // already selecting).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditingText = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (e.key === 'Escape') {
        e.stopPropagation();
        // Clearing the editor before the blur means the blur has nothing left to commit —
        // Escape abandons a half-typed label rather than saving it.
        if (textEditorRef.current) {
          putTextEditor(null);
          return;
        }
        if (isEditingText) (target as HTMLElement).blur();
        if (pendingLine || pendingArc || pendingCircle || marquee || groupDrag) cancelPending();
        else if (tool === 'select') setSelection(emptySelection());
        else setTool('select');
        return;
      }
      if (isEditingText) return;
      e.stopPropagation();

      const key = e.key.toLowerCase();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected();
      } else if (e.metaKey || e.ctrlKey) {
        // preventDefault so the browser's own copy/paste/undo doesn't fire alongside ours.
        if (key === 'c') {
          e.preventDefault();
          copySelection();
        } else if (key === 'v') {
          e.preventDefault();
          pasteClipboard();
        } else if (key === 'z') {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
        } else if (key === 'y') {
          e.preventDefault();
          redo();
        }
      } else if (!e.altKey && HOTKEY_TOOLS[key]) {
        setTool(HOTKEY_TOOLS[key]);
        cancelPending();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [
    cancelPending,
    copySelection,
    deleteSelected,
    groupDrag,
    marquee,
    pasteClipboard,
    pendingArc,
    pendingCircle,
    pendingLine,
    putTextEditor,
    redo,
    tool,
    undo,
  ]);

  // ------------------------------------------------------------------------- Canvas

  useEffect(() => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = prepareCanvas(canvas);
    if (!ctx) return;
    const colors = editorColors();
    drawBackdrop(ctx, colors);

    // A picture body the symbol came with sits behind everything, as it will on the schematic.
    if (bodyImage && bodyImageEl) {
      const w = bodyImage.width * PX_PER_UNIT;
      const h = bodyImage.height * PX_PER_UNIT;
      ctx.drawImage(bodyImageEl, CANVAS_PX / 2 - w / 2, CANVAS_PX / 2 - h / 2, w, h);
    }

    for (const line of graph.lines.values()) {
      const a = graph.points.get(line.startId);
      const b = graph.points.get(line.endId);
      if (!a || !b) continue;
      ctx.strokeStyle = selection.lines.has(line.id) ? colors.accent : colors.line;
      ctx.lineWidth = strokeWidth(line.weight, selection.lines.has(line.id));
      const sa = localToScreen(a);
      const sb = localToScreen(b);
      ctx.beginPath();
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
      ctx.stroke();
    }

    for (const arc of graph.arcs.values()) {
      const a = graph.points.get(arc.startId);
      const b = graph.points.get(arc.endId);
      if (!a || !b) continue;
      ctx.strokeStyle = selection.arcs.has(arc.id) ? colors.accent : colors.line;
      ctx.lineWidth = strokeWidth(arc.weight, selection.arcs.has(arc.id));
      strokeLocalArc(ctx, a, b, arc.bulge);
    }

    // Labels, centered on their anchor exactly like renderer.ts draws them on the main
    // canvas — same size convention too (local units, scaled by PX_PER_UNIT here).
    for (const label of graph.texts.values()) {
      const s = localToScreen(label);
      ctx.fillStyle = selection.texts.has(label.id) ? colors.accent : colors.line;
      ctx.font = `${label.fontSize * PX_PER_UNIT}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label.text, s.x, s.y);
    }

    // Live radius preview between the centre click and the cursor, dashed so it reads as
    // not-yet-committed (the pending line/arc endpoints get the same "in progress" accent).
    if (pendingCircle) {
      const center = localToScreen(pendingCircle.center);
      const radius = circleCursor ? distance(pendingCircle.center, circleCursor) : 0;
      ctx.save();
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      if (radius > 1e-6) {
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius * PX_PER_UNIT, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(center.x, center.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = colors.accent;
      ctx.fill();
      ctx.restore();
    }

    const portSet = new Set(ports);
    for (const p of graph.points.values()) {
      const isPending = p.id === pendingLine || p.id === pendingArc?.startId || p.id === pendingArc?.endId;
      drawPointMarker(ctx, p, colors, portSet.has(p.id) ? ports.indexOf(p.id) + 1 : null, isPending || selection.points.has(p.id));
    }

    if (marquee) {
      const a = localToScreen(marquee.origin);
      const b = localToScreen(marquee.current);
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(a.x - b.x);
      const h = Math.abs(a.y - b.y);
      ctx.save();
      // globalAlpha rather than an rgba() literal: the accent comes from a CSS token, so
      // its colour space isn't something this file can safely take apart.
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = colors.accent;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }
  }, [graph, ports, selection, marquee, pendingArc, pendingCircle, circleCursor, pendingLine, version, bodyImageEl, bodyImage]);

  const onDrawPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // A click on the canvas finishes an open label editor and does nothing else — same
    // reason as the main canvas: committing *and* starting the next gesture in one click
    // would depend on whether the input's blur lands before or after this handler.
    if (textEditorRef.current) {
      commitTextEditor();
      return;
    }
    const local = screenToLocal(pointerPx(e));
    setError(null);

    if (tool === 'select') {
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      const hit = hitTest(graph, local);

      if (!hit) {
        // Empty space starts a marquee. A plain click is just a zero-size one, which on
        // pointer-up clears the selection — so click-to-deselect still works.
        e.currentTarget.setPointerCapture(e.pointerId);
        setMarquee({ origin: local, current: local, additive });
        bump();
        return;
      }

      // Clicking a label — additively or not — makes it the one the size field reads out
      // and (on commit) resizes.
      if (hit.kind === 'text') {
        const label = graph.texts.get(hit.id);
        if (label) showTextSize(label.fontSize);
      }

      if (additive) {
        setSelection((prev) => withHit(prev, hit, true));
        bump();
        return;
      }

      // Non-additive click on something: drag it immediately. Clicking a member of the
      // *current* multi-selection drags the whole group together — what makes a pasted
      // multi-piece shape (or any multi-select) draggable as one unit while it's still
      // selected. Clicking anything else replaces the selection with just that item first.
      const alreadyIn =
        (hit.kind === 'point' && selection.points.has(hit.id)) ||
        (hit.kind === 'line' && selection.lines.has(hit.id)) ||
        (hit.kind === 'arc' && selection.arcs.has(hit.id)) ||
        (hit.kind === 'text' && selection.texts.has(hit.id));

      let dragSelection: DrawSelection;
      if (alreadyIn && selectionCount(selection) > 1) {
        dragSelection = selection;
      } else {
        dragSelection = withHit(emptySelection(), hit, false);
        setSelection(dragSelection);
        if (hit.kind === 'line' || hit.kind === 'arc') {
          // A freshly-selected lone line/arc only drags as a rigid pair when neither
          // endpoint is shared with other geometry — otherwise this would silently tear
          // that joint (same rule as the main app's select tool / endpointsAreUnshared).
          const edge = hit.kind === 'line' ? graph.lines.get(hit.id) : graph.arcs.get(hit.id);
          if (edge && !(graph.pointDegree(edge.startId) === 1 && graph.pointDegree(edge.endId) === 1)) {
            bump();
            return; // selected, but not drag-eligible this click
          }
        }
      }

      const dragPointIds = selectionPointIds(graph, dragSelection);
      const pointOrigins = new Map<Id, Vec2>();
      for (const id of dragPointIds) {
        const p = graph.points.get(id);
        if (p) pointOrigins.set(id, { x: p.x, y: p.y });
      }
      const textOrigins = new Map<Id, Vec2>();
      for (const id of dragSelection.texts) {
        const t = graph.texts.get(id);
        if (t) textOrigins.set(id, { x: t.x, y: t.y });
      }
      if (pointOrigins.size + textOrigins.size > 0) {
        e.currentTarget.setPointerCapture(e.pointerId);
        setGroupDrag({
          grabLocal: local,
          pointOrigins,
          textOrigins,
          singlePointId: hit.kind === 'point' && pointOrigins.size === 1 ? hit.id : null,
          before: captureSnapshot(),
        });
      }
      bump();
      return;
    }

    if (tool === 'text') {
      // Same flow as the main canvas's Text tool: click where the label goes and type it
      // in place, or click an existing label to re-open it. Nothing reaches the graph
      // until the editor commits. preventDefault for the same reason SketchCanvas does —
      // the click's default focus change would blur the editor as it opens.
      e.preventDefault();
      const hit = hitTest(graph, local);
      const existing = hit?.kind === 'text' ? graph.texts.get(hit.id) : undefined;
      if (existing) {
        showTextSize(existing.fontSize);
        putTextEditor({ id: existing.id, local: { x: existing.x, y: existing.y }, size: existing.fontSize, value: existing.text });
      } else {
        // No endpoint snap, matching the main canvas's Text tool: a label is not a vertex,
        // so landing it on a point would bury it under the geometry it annotates.
        const placement = editorSnap({ cursor: local, graph, allowEndpoint: false, disabled: e.altKey });
        putTextEditor({ id: null, local: placement.point, size: currentTextSize(), value: '' });
      }
      return;
    }

    const snap = editorSnap({ cursor: local, graph, disabled: e.altKey });
    const pointAt = (): Id => snap.snappedPointId ?? graph.addPoint(snap.point.x, snap.point.y, freshId(graph, 'p')).id;
    const before = captureSnapshot();

    if (tool === 'port') {
      // A port is a distinct object you place — never an existing point re-labelled. Clicking
      // a port that's already there just selects it, rather than stacking a second on top.
      const existingPort = snap.snappedPointId && ports.includes(snap.snappedPointId) ? snap.snappedPointId : null;
      const id = existingPort ?? graph.addPoint(snap.point.x, snap.point.y, freshId(graph, 'port')).id;
      if (!existingPort) setPortsSynced([...ports, id]);
      setSelection({ points: new Set([id]), lines: new Set(), arcs: new Set(), texts: new Set() });
    } else if (tool === 'point') {
      setSelection({ points: new Set([pointAt()]), lines: new Set(), arcs: new Set(), texts: new Set() });
    } else if (tool === 'line') {
      const id = pointAt();
      if (pendingLine === null) {
        setPendingLine(id);
      } else {
        if (pendingLine !== id) graph.addLine(pendingLine, id, null, freshId(graph, 'l'));
        setPendingLine(null);
      }
    } else if (tool === 'arc') {
      // Three clicks: start, end, then a point the curve should bow towards (the same
      // sagitta-from-cursor convention the main arc tool uses).
      if (!pendingArc) {
        setPendingArc({ startId: pointAt(), endId: null });
      } else if (!pendingArc.endId) {
        const id = pointAt();
        if (id !== pendingArc.startId) setPendingArc({ startId: pendingArc.startId, endId: id });
      } else {
        const start = graph.points.get(pendingArc.startId);
        const end = graph.points.get(pendingArc.endId);
        if (start && end) graph.addArc(start.id, end.id, bulgeFromSagittaCursor(start, end, local), freshId(graph, 'a'));
        setPendingArc(null);
      }
    } else if (tool === 'circle') {
      // Two clicks: centre, then any point on the circumference.
      if (!pendingCircle) {
        setPendingCircle({ center: snap.point });
        setCircleCursor(snap.point);
      } else {
        const { radius, a, b } = circleArcEndpoints(pendingCircle.center, snap.point);
        if (radius > 1e-6) {
          const pa = graph.addPoint(a.x, a.y, freshId(graph, 'p'));
          const pb = graph.addPoint(b.x, b.y, freshId(graph, 'p'));
          // bulge 1 = tan(90°) per the DXF convention, i.e. a semicircle each way.
          const top = graph.addArc(pa.id, pb.id, 1, freshId(graph, 'a'));
          const bottom = graph.addArc(pb.id, pa.id, 1, freshId(graph, 'a'));
          setSelection({
            points: new Set(),
            lines: new Set(),
            arcs: new Set([top?.id, bottom?.id].filter((id): id is Id => !!id)),
            texts: new Set(),
          });
        }
        setPendingCircle(null);
        setCircleCursor(null);
      }
    }
    pushHistoryIfChanged(before);
    bump();
  };

  const onDrawPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!marquee && !pendingCircle && !groupDrag) return;
    const local = screenToLocal(pointerPx(e));

    if (groupDrag) {
      let delta: Vec2 = { x: local.x - groupDrag.grabLocal.x, y: local.y - groupDrag.grabLocal.y };
      if (groupDrag.singlePointId) {
        // The one case with an unambiguous point to run a real snap search against.
        const origin = groupDrag.pointOrigins.get(groupDrag.singlePointId)!;
        const target = { x: origin.x + delta.x, y: origin.y + delta.y };
        const snap = editorSnap({ cursor: target, graph, excludePointId: groupDrag.singlePointId, disabled: e.altKey });
        delta = { x: snap.point.x - origin.x, y: snap.point.y - origin.y };
      } else {
        delta = editorSnap({ cursor: delta, graph, gridMode: 'delta', disabled: e.altKey }).point;
      }
      for (const [id, origin] of groupDrag.pointOrigins) {
        graph.movePoint(id, origin.x + delta.x, origin.y + delta.y);
      }
      for (const [id, origin] of groupDrag.textOrigins) {
        graph.moveText(id, origin.x + delta.x, origin.y + delta.y);
      }
      bump();
      return;
    }

    if (marquee) {
      setMarquee((prev) => (prev ? { ...prev, current: local } : prev));
    } else if (pendingCircle) {
      // Preview against the snapped cursor, so what's drawn is the circle a click commits.
      const snap = editorSnap({ cursor: local, graph, disabled: e.altKey });
      setCircleCursor(snap.point);
    }
  };

  const onDrawPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (groupDrag) {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      pushHistoryIfChanged(groupDrag.before);
      setGroupDrag(null);
      bump();
      return;
    }
    if (!marquee) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const rect = normalizeRect(marquee.origin, marquee.current);
    setSelection((prev) => selectInsideRect(graph, rect, marquee.additive ? prev : emptySelection()));
    setMarquee(null);
    bump();
  };

  const onDrawDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== 'select') return;
    const local = screenToLocal(pointerPx(e));
    const hit = hitTest(graph, local);
    const existing = hit?.kind === 'text' ? graph.texts.get(hit.id) : undefined;
    if (!existing) return;
    showTextSize(existing.fontSize);
    putTextEditor({ id: existing.id, local: { x: existing.x, y: existing.y }, size: existing.fontSize, value: existing.text });
  };

  /** Sets the line weight of every selected line and arc (null = back to the default). */
  const applyWeight = (weight: number | null) => {
    const before = captureSnapshot();
    graph.setWeight({ lineIds: selection.lines, arcIds: selection.arcs }, weight);
    pushHistoryIfChanged(before);
    bump();
  };
  const strokeWeights = [
    ...[...selection.lines].map((id) => graph.lines.get(id)?.weight),
    ...[...selection.arcs].map((id) => graph.arcs.get(id)?.weight),
  ];

  // ------------------------------------------------------------------------ Persisting

  /** Writes the geometry (overwriting the category's existing symbol row in place when it has
   * one), then points the category at it. */
  const persist = async (geometry: SymbolGeometry) => {
    setError(null);
    setSaving(true);
    try {
      const stored = await db.upsertSymbol({ id: category.symbolId ?? undefined, geometry });
      await db.upsertCategory({ ...category, name: nameText.trim() || category.name, familyId, symbolId: stored.id });
      setSaving(false);
      onSaved();
      onClose();
    } catch (e) {
      setError(describeError(e));
      setSaving(false);
    }
  };

  /** The symbol as the editor currently has it — what Save, Export and Share all write, so
   * exporting always matches what's on screen, unsaved edits included. A picture body the
   * symbol came in with is carried through untouched. */
  const currentGeometry = (): SymbolGeometry | null => ({
    ...graphToGeometry(graph, ports),
    ...(bodyImage ? { image: bodyImage } : {}),
  });

  const saveSymbol = () => {
    const geometry = currentGeometry();
    return geometry ? persist(geometry) : Promise.resolve();
  };

  const runDelete = async () => {
    setConfirmingDelete(false);
    setError(null);
    try {
      await db.deleteCategory(category.id);
      onSaved();
      onClose();
    } catch (e) {
      setError(describeError(e));
    }
  };

  // ------------------------------------------------------- Exchanging symbols with files

  /** Writes what's on screen out as a `.pnidsym.json` part drawing — vector or raster
   * alike, since both are the same `SymbolGeometry` (see io/symbolFormat.ts). */
  const runExport = async () => {
    setError(null);
    setNotice(null);
    const geometry = currentGeometry();
    if (!geometry) return;
    try {
      const meta = { name: category.name, subtype: category.subtype, actuation: category.actuation };
      if (await exportSymbol(geometry, meta)) setNotice(`Exported "${category.name}" as a .${SYMBOL_FILE_EXTENSION} file.`);
    } catch (e) {
      setError(describeError(e));
    }
  };

  /** Loads a part drawing from a file into this editing session rather than straight into
   * the library: an import is then reviewable (and undoable) like any other edit, and
   * nothing overwrites the category's saved symbol until Save Symbol. */
  const runImport = async () => {
    setError(null);
    setNotice(null);
    try {
      const imported = await importSymbol();
      if (!imported) return;
      const before = captureSnapshot();
      applyGeometry(imported.file.geometry);
      pushHistoryIfChanged(before);
      setNotice(
        imported.scale === 1
          ? `Imported "${imported.file.name}" — Save Symbol to keep it.`
          : `Imported "${imported.file.name}", resized ×${formatUnits(imported.scale)} to this library's symbol scale — Save Symbol to keep it.`,
      );
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel symbol-editor" onClick={(e) => e.stopPropagation()}>
        <div className="library-header">
          <label className="symbol-editor-name-wrap" title="Click to rename this component — saved with Save Symbol">
            <input
              className="symbol-editor-name"
              value={nameText}
              placeholder="Component name"
              onChange={(e) => setNameText(e.target.value)}
              aria-label="Component name"
            />
            <svg className="symbol-editor-name-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
            </svg>
          </label>
          <label className="symbol-editor-family" title="Which family this component is listed under">
            Family
            <select value={familyId} onChange={(e) => setFamilyId(e.target.value)}>
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loading ? (
          <p className="library-muted">Loading symbol…</p>
        ) : (
          <div className="symbol-editor-body">
            {/* The same icon-and-shortcut tool rail the main window has, plus Port. */}
            <ToolRailView
              compact
              tools={EDITOR_TOOLS}
              active={tool}
              onSelect={(t) => {
                setTool(t);
                cancelPending();
              }}
            />
            {/* Positioned wrapper so the inline label editor and the properties popup can sit
                over the canvas, the way SketchCanvas's do. */}
            <div className="symbol-editor-canvas-wrap" style={{ width: viewPx, height: viewPx }}>
              <canvas
                ref={drawCanvasRef}
                className="symbol-editor-canvas"
                style={{ width: viewPx, height: viewPx }}
                onPointerDown={onDrawPointerDown}
                onPointerMove={onDrawPointerMove}
                onPointerUp={onDrawPointerUp}
                onDoubleClick={onDrawDoubleClick}
              />
              {textEditor && (
                <input
                  className="canvas-text-editor"
                  autoFocus
                  value={textEditor.value}
                  placeholder="Label…"
                  style={{
                    left: localToScreen(textEditor.local).x * viewScale,
                    top: localToScreen(textEditor.local).y * viewScale,
                    fontSize: `${textEditor.size * PX_PER_UNIT * viewScale}px`,
                  }}
                  onChange={(e) => putTextEditor({ ...textEditor, value: e.target.value })}
                  onBlur={commitTextEditor}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                />
              )}
              <span className="symbol-editor-port-count">
                {ports.length} port{ports.length === 1 ? '' : 's'}
                {ports.length === 0 ? ' — add one with the Port tool' : ''}
              </span>
              {/* Properties appear only when there's something to show, like the main window's
                  popup, so the drawing gets all the room the rest of the time. */}
              {(selectionCount(selection) > 0 || tool === 'text') && (
                <div className="symbol-props">
                  {selectionCount(selection) > 0 && (
                    <button className="props-popup-close" onClick={() => setSelection(emptySelection())} title="Close (Esc)" aria-label="Close properties">
                      ×
                    </button>
                  )}
                  <h3>Properties</h3>
                  <p className="symbol-props-summary">{describeSelection(selection, ports)}</p>
                  {strokeWeights.length > 0 && <WeightField value={commonWeight(strokeWeights)} onChange={applyWeight} />}
                  {(tool === 'text' || selection.texts.size > 0) && (
                    <label
                      className="field"
                      title={`Label height in drawing units (${MIN_TEXT_SIZE}–${MAX_TEXT_SIZE}; a built-in symbol is about 28 units wide). Sets the next label placed, and resizes the selected ones.`}
                    >
                      <span>Text size</span>
                      <input
                        type="number"
                        step="any"
                        min={MIN_TEXT_SIZE}
                        max={MAX_TEXT_SIZE}
                        value={textSizeText}
                        onChange={(e) => setTextSizeText(e.target.value)}
                        onBlur={commitTextSize}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                      />
                    </label>
                  )}
                  {selectionCount(selection) > 0 && (
                    <button className="symbol-props-button library-icon-button--danger" onClick={deleteSelected}>
                      Delete selected
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {error && <p className="field-error">{error}</p>}
        {notice && <p className="library-muted">{notice}</p>}

        <div className="symbol-editor-footer">
          {/* File actions sit apart from Cancel/Save: they move this drawing between
              instances, they don't end the editing session. */}
          <div className="symbol-editor-footer-files">
            <button
              disabled={saving || loading}
              onClick={() => void runImport()}
              title={`Import a drawing from a .${SYMBOL_FILE_EXTENSION} file, replacing what's in this editor (Save Symbol still has to confirm it)`}
            >
              Import drawing…
            </button>
            <button
              disabled={saving || loading}
              onClick={() => void runExport()}
              title={`Export just this drawing to a .${SYMBOL_FILE_EXTENSION} file`}
            >
              Export drawing…
            </button>
            <button
              className="symbol-editor-trash"
              disabled={saving || loading}
              onClick={() => setConfirmingDelete(true)}
              title="Delete this component from your library"
              aria-label="Delete this component"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18" />
                <path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2" />
                <path d="M6 6l1 14a1 1 0 001 1h8a1 1 0 001-1l1-14" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </button>
          </div>
          <button onClick={onClose}>Cancel</button>
          <button className="symbol-editor-save" disabled={saving || loading} onClick={() => void saveSymbol()}>
            {saving ? 'Saving…' : 'Save Symbol'}
          </button>
        </div>
      </div>
      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete "${category.name}"?`}
          message="This removes the component and its drawing from your library. Drawings that already use it keep their own copy. This can't be undone."
          confirmLabel="Delete"
          onConfirm={() => void runDelete()}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}

export {
  circleArcEndpoints,
  clampTextSize,
  DEFAULT_TEXT_SIZE,
  graphToGeometry,
  localToScreen,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  normalizeRect,
  pointInRect,
  populateGraph,
  screenToLocal,
  selectInsideRect,
  selectionPointIds,
};
