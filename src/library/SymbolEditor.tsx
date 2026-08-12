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
} from '../canvas/geometry';
import { SceneGraph } from '../canvas/sceneGraph';
import { computeSnap } from '../canvas/snapping';
import type { Id, SymbolGeometry, Vec2 } from '../types/geometry';
import { resolveSymbol } from './builtinSymbols';
import * as db from './db';
import { describeError } from './errors';

const CANVAS_PX = 480;
/** Fixed zoom: a ±14-unit symbol (the built-in convention) fills roughly 2/3 of the canvas. */
const PX_PER_UNIT = 12;
const GRID_UNITS = 2;
/** Click/snap tolerance in screen pixels, converted to local units where needed. */
const PICK_PX = 8;
/** Roughly the width of a built-in symbol, so an uploaded image lands at a comparable scale. */
const DEFAULT_IMAGE_WIDTH = 28;

type EditorTab = 'draw' | 'image';
type DrawTool = 'point' | 'line' | 'arc' | 'select';
type DrawSelection = { kind: 'point' | 'line' | 'arc'; id: Id } | null;

/** A port placed on an uploaded image. Image symbols have no other geometry, so every
 * point the user places here IS a port — no separate marking step. */
interface ImagePort {
  id: string;
  x: number;
  y: number;
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
  while (graph.points.has(`${prefix}${n}`) || graph.lines.has(`${prefix}${n}`) || graph.arcs.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** Loads a `SymbolGeometry` into an (empty) editing graph, preserving point ids so a
 * re-saved symbol keeps stable port ids. Lines/arcs referencing a missing point are
 * skipped rather than trusted — stored geometry is user data, not an invariant. */
function populateGraph(graph: SceneGraph, geometry: SymbolGeometry) {
  for (const [id, p] of Object.entries(geometry.points)) graph.addPoint(p.x, p.y, id);
  for (const [a, b] of geometry.lines) {
    if (graph.points.has(a) && graph.points.has(b)) graph.addLine(a, b, null, freshId(graph, 'l'));
  }
  for (const arc of geometry.arcs) {
    if (graph.points.has(arc.a) && graph.points.has(arc.b)) graph.addArc(arc.a, arc.b, arc.bulge, freshId(graph, 'a'));
  }
}

/** The inverse of `populateGraph`: the editing graph as the persisted symbol shape.
 * `ports` keeps the user's marking order, which is the connection order downstream. */
function graphToGeometry(graph: SceneGraph, ports: string[]): SymbolGeometry {
  return {
    points: Object.fromEntries([...graph.points.values()].map((p) => [p.id, { x: p.x, y: p.y }])),
    lines: [...graph.lines.values()].map((l) => [l.startId, l.endId] as [string, string]),
    arcs: [...graph.arcs.values()].map((a) => ({ a: a.startId, b: a.endId, bulge: a.bulge })),
    ports: ports.filter((id) => graph.points.has(id)),
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
function drawPointMarker(ctx: CanvasRenderingContext2D, p: Vec2, colors: EditorColors, isPort: boolean, isSelected: boolean) {
  const s = localToScreen(p);
  ctx.beginPath();
  ctx.arc(s.x, s.y, isPort ? 5.5 : 3.5, 0, Math.PI * 2);
  ctx.fillStyle = isPort ? colors.accent : colors.point;
  ctx.fill();
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
function hitTest(graph: SceneGraph, local: Vec2): DrawSelection {
  const tol = PICK_PX / PX_PER_UNIT;
  let best: { sel: DrawSelection; d: number } | null = null;
  for (const p of graph.points.values()) {
    const d = distance(local, p);
    if (d <= tol && (!best || d < best.d)) best = { sel: { kind: 'point', id: p.id }, d };
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

/** Trims float noise out of a derived dimension so the width/height inputs stay readable. */
function formatUnits(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export function SymbolEditor({ category, onClose, onSaved }: { category: db.Category; onClose: () => void; onSaved: () => void }) {
  // One isolated graph per editor session — deliberately NOT the app's document graph;
  // this is a throwaway scratch scene that only ever becomes a SymbolGeometry.
  const graphRef = useRef<SceneGraph | null>(null);
  const graph = (graphRef.current ??= new SceneGraph());

  const [tab, setTab] = useState<EditorTab>('draw');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped after every graph mutation — the graph lives in a ref, so this is what tells
   * React (and the draw effect) that the canvas is stale. */
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const [tool, setTool] = useState<DrawTool>('point');
  const [selected, setSelected] = useState<DrawSelection>(null);
  const [pendingLine, setPendingLine] = useState<Id | null>(null);
  const [pendingArc, setPendingArc] = useState<{ startId: Id; endId: Id | null } | null>(null);
  const [ports, setPorts] = useState<string[]>([]);

  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const [widthText, setWidthText] = useState(String(DEFAULT_IMAGE_WIDTH));
  const [heightText, setHeightText] = useState(String(DEFAULT_IMAGE_WIDTH));
  const [lockAspect, setLockAspect] = useState(true);
  const [imagePorts, setImagePorts] = useState<ImagePort[]>([]);
  const imagePortCounter = useRef(0);

  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);

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
        populateGraph(graph, geometry);
        setPorts(geometry.ports.filter((id) => graph.points.has(id)));
        if (geometry.image) {
          // Stored image symbol: open on the tab that made it, prefilled.
          setTab('image');
          setImageDataUrl(geometry.image.dataUrl);
          setWidthText(formatUnits(geometry.image.width));
          setHeightText(formatUnits(geometry.image.height));
          setImagePorts(
            geometry.ports
              .filter((id) => geometry.points[id])
              .map((id) => ({ id, x: geometry.points[id].x, y: geometry.points[id].y })),
          );
          // Past the highest existing suffix, not just the count — ports removed before a
          // previous save leave gaps, and reusing a gap id would collide.
          imagePortCounter.current = geometry.ports.reduce((max, id) => {
            const n = parseInt(id.replace(/^port/, ''), 10);
            return Number.isNaN(n) ? max : Math.max(max, n + 1);
          }, 0);
          const img = new Image();
          img.onload = () => {
            if (cancelled) return;
            setAspect(img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : null);
            setImageEl(img);
          };
          img.src = geometry.image.dataUrl;
        }
        bump();
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

  const cancelPending = useCallback(() => {
    setPendingLine(null);
    setPendingArc(null);
  }, []);

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    setError(null);
    if (selected.kind === 'line') graph.removeLine(selected.id);
    else if (selected.kind === 'arc') graph.removeArc(selected.id);
    else if (!graph.removePoint(selected.id)) {
      // SceneGraph refuses to orphan an edge's endpoint — surface that instead of a
      // silent no-op, since the point visibly stays put.
      setError('That point is still used by a line or arc — delete those first.');
      return;
    } else {
      setPorts((prev) => prev.filter((id) => id !== selected.id));
    }
    setSelected(null);
    bump();
  }, [graph, selected]);

  // Scoped key handling, same pattern as RealHardwareModal: capture Escape so the
  // canvas's global handler doesn't also switch tools behind the modal.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditingText = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (pendingLine || pendingArc) cancelPending();
        else onClose();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditingText) {
        // Swallowed even on the image tab: while this modal is open, Delete must never
        // reach SketchCanvas and delete the document's selection behind it.
        e.stopPropagation();
        if (tab === 'draw') deleteSelected();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [cancelPending, deleteSelected, onClose, pendingArc, pendingLine, tab]);

  // ------------------------------------------------------------------ Draw tab canvas

  useEffect(() => {
    if (tab !== 'draw') return;
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = prepareCanvas(canvas);
    if (!ctx) return;
    const colors = editorColors();
    drawBackdrop(ctx, colors);

    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 2;
    for (const line of graph.lines.values()) {
      const a = graph.points.get(line.startId);
      const b = graph.points.get(line.endId);
      if (!a || !b) continue;
      const selectedEdge = selected?.kind === 'line' && selected.id === line.id;
      ctx.strokeStyle = selectedEdge ? colors.accent : colors.line;
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
      ctx.strokeStyle = selected?.kind === 'arc' && selected.id === arc.id ? colors.accent : colors.line;
      strokeLocalArc(ctx, a, b, arc.bulge);
    }

    const portSet = new Set(ports);
    for (const p of graph.points.values()) {
      const isPending = p.id === pendingLine || p.id === pendingArc?.startId || p.id === pendingArc?.endId;
      drawPointMarker(ctx, p, colors, portSet.has(p.id), isPending || (selected?.kind === 'point' && selected.id === p.id));
    }
  }, [graph, ports, selected, pendingArc, pendingLine, tab, version]);

  const onDrawPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const local = screenToLocal({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setError(null);

    if (tool === 'select') {
      setSelected(hitTest(graph, local));
      bump();
      return;
    }

    const snap = computeSnap({ cursor: local, graph, threshold: PICK_PX / PX_PER_UNIT, gridSize: GRID_UNITS });
    const pointAt = (): Id => snap.snappedPointId ?? graph.addPoint(snap.point.x, snap.point.y, freshId(graph, 'p')).id;

    if (tool === 'point') {
      setSelected({ kind: 'point', id: pointAt() });
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
    }
    bump();
  };

  const togglePort = () => {
    if (selected?.kind !== 'point') return;
    const id = selected.id;
    setPorts((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  };

  // ----------------------------------------------------------------- Image tab canvas

  useEffect(() => {
    if (tab !== 'image') return;
    const canvas = imageCanvasRef.current;
    if (!canvas) return;
    const ctx = prepareCanvas(canvas);
    if (!ctx) return;
    const colors = editorColors();
    drawBackdrop(ctx, colors);

    const width = parseFloat(widthText);
    const height = parseFloat(heightText);
    if (imageEl && width > 0 && height > 0) {
      const w = width * PX_PER_UNIT;
      const h = height * PX_PER_UNIT;
      ctx.drawImage(imageEl, CANVAS_PX / 2 - w / 2, CANVAS_PX / 2 - h / 2, w, h);
    }
    for (const p of imagePorts) drawPointMarker(ctx, p, colors, true, false);
  }, [heightText, imageEl, imagePorts, tab, widthText]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    // Plain FileReader/Image rather than the Tauri dialog plugin: both work inside the
    // webview and this needs no extra capability grant.
    const reader = new FileReader();
    reader.onerror = () => setError("Couldn't read that file.");
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const img = new Image();
      img.onerror = () => setError("Couldn't decode that image.");
      img.onload = () => {
        const ratio = img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1;
        setImageEl(img);
        setImageDataUrl(dataUrl);
        setAspect(ratio);
        setWidthText(String(DEFAULT_IMAGE_WIDTH));
        setHeightText(formatUnits(DEFAULT_IMAGE_WIDTH / ratio));
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const onWidthChange = (text: string) => {
    setWidthText(text);
    const w = parseFloat(text);
    if (lockAspect && aspect && Number.isFinite(w) && w > 0) setHeightText(formatUnits(w / aspect));
  };

  const onHeightChange = (text: string) => {
    setHeightText(text);
    const h = parseFloat(text);
    if (lockAspect && aspect && Number.isFinite(h) && h > 0) setWidthText(formatUnits(h * aspect));
  };

  /** Click to add a port, click an existing one to remove it. Positions round to half a
   * unit so ports land predictably on the image's edges without needing a full snapper. */
  const onImagePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const local = screenToLocal({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    const tol = PICK_PX / PX_PER_UNIT;
    const existing = imagePorts.find((p) => Math.hypot(p.x - local.x, p.y - local.y) <= tol);
    if (existing) {
      setImagePorts((prev) => prev.filter((p) => p.id !== existing.id));
      return;
    }
    const id = `port${imagePortCounter.current++}`;
    setImagePorts((prev) => [...prev, { id, x: Math.round(local.x * 2) / 2, y: Math.round(local.y * 2) / 2 }]);
  };

  // ------------------------------------------------------------------------ Persisting

  /** Both tabs save the same way: write the geometry (overwriting the category's existing
   * symbol row in place when it has one), then point the category at it. */
  const persist = async (geometry: SymbolGeometry) => {
    setError(null);
    setSaving(true);
    try {
      const stored = await db.upsertSymbol({ id: category.symbolId ?? undefined, geometry });
      await db.upsertCategory({ ...category, symbolId: stored.id });
      setSaving(false);
      onSaved();
      onClose();
    } catch (e) {
      setError(describeError(e));
      setSaving(false);
    }
  };

  const saveDrawing = () => persist(graphToGeometry(graph, ports));

  const saveImage = () => {
    if (!imageDataUrl) {
      setError('Choose an image file first.');
      return Promise.resolve();
    }
    const width = parseFloat(widthText);
    const height = parseFloat(heightText);
    if (!(width > 0) || !(height > 0)) {
      setError('Width and height must be positive numbers.');
      return Promise.resolve();
    }
    const points: Record<string, Vec2> = {};
    for (const p of imagePorts) points[p.id] = { x: p.x, y: p.y };
    return persist({
      points,
      lines: [],
      arcs: [],
      ports: imagePorts.map((p) => p.id),
      image: { dataUrl: imageDataUrl, width, height },
    });
  };

  const drawHint =
    tool === 'point'
      ? 'Click to place a point (snaps to the grid and to existing points).'
      : tool === 'line'
        ? 'Click a start point, then an end point. Escape cancels.'
        : tool === 'arc'
          ? 'Click start, then end, then a third point to set how far the arc bows. Escape cancels.'
          : 'Click a point, line or arc to select it, then Delete Selected or Toggle Port.';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel symbol-editor" onClick={(e) => e.stopPropagation()}>
        <div className="library-header">
          <h3>Symbol — {category.name}</h3>
          <div className="library-header-buttons">
            <button
              className={tab === 'draw' ? 'active' : ''}
              onClick={() => setTab('draw')}
              title="Draw the symbol as lines, arcs and connection ports"
            >
              Draw
            </button>
            <button
              className={tab === 'image' ? 'active' : ''}
              onClick={() => setTab('image')}
              title="Use an image file as the symbol body and click its connection ports on"
            >
              Upload Image
            </button>
          </div>
        </div>

        {loading ? (
          <p className="library-muted">Loading symbol…</p>
        ) : tab === 'draw' ? (
          <>
            <div className="symbol-editor-toolbar">
              {(['point', 'line', 'arc', 'select'] as DrawTool[]).map((t) => (
                <button
                  key={t}
                  className={tool === t ? 'active' : ''}
                  onClick={() => {
                    setTool(t);
                    cancelPending();
                  }}
                >
                  {t === 'select' ? 'Select' : t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
              <span className="symbol-editor-toolbar-gap" />
              <button onClick={togglePort} disabled={selected?.kind !== 'point'} title="Mark/unmark the selected point as a connection port">
                Toggle Port
              </button>
              <button onClick={deleteSelected} disabled={!selected}>
                Delete Selected
              </button>
            </div>
            <canvas
              ref={drawCanvasRef}
              className="symbol-editor-canvas"
              style={{ width: CANVAS_PX, height: CANVAS_PX }}
              onPointerDown={onDrawPointerDown}
            />
            <p className="library-muted">{drawHint}</p>
            <p className="library-muted">
              {ports.length} port{ports.length === 1 ? '' : 's'}
              {ports.length > 0 ? ` (in order): ${ports.join(', ')}` : ' — mark at least one so pipes can attach.'}
            </p>
          </>
        ) : (
          <>
            <div className="field">
              <span>Image file</span>
              <input type="file" accept="image/*" onChange={onFileChange} />
            </div>
            {imageDataUrl && (
              <>
                <div className="symbol-editor-size-row">
                  <label>
                    Width
                    <input type="number" step="any" min="0.1" value={widthText} onChange={(e) => onWidthChange(e.target.value)} />
                  </label>
                  <label>
                    Height
                    <input type="number" step="any" min="0.1" value={heightText} onChange={(e) => onHeightChange(e.target.value)} />
                  </label>
                  <label className="library-spec-checkbox">
                    <input type="checkbox" checked={lockAspect} onChange={(e) => setLockAspect(e.target.checked)} />
                    Lock aspect
                  </label>
                </div>
                <canvas
                  ref={imageCanvasRef}
                  className="symbol-editor-canvas"
                  style={{ width: CANVAS_PX, height: CANVAS_PX }}
                  onPointerDown={onImagePointerDown}
                />
                <p className="library-muted">
                  Click the image to place a connection port; click a port again to remove it. Ports connect in the order placed.
                </p>
                <p className="library-muted">
                  {imagePorts.length} port{imagePorts.length === 1 ? '' : 's'} placed. Size is in drawing units (a built-in symbol is about
                  28 units wide).
                </p>
              </>
            )}
          </>
        )}

        {error && <p className="field-error">{error}</p>}

        <div className="symbol-editor-footer">
          <button onClick={onClose}>Cancel</button>
          <button
            className="symbol-editor-save"
            disabled={saving || loading}
            onClick={() => void (tab === 'draw' ? saveDrawing() : saveImage())}
          >
            {saving ? 'Saving…' : 'Save Symbol'}
          </button>
        </div>
      </div>
    </div>
  );
}

export { graphToGeometry, localToScreen, populateGraph, screenToLocal };
