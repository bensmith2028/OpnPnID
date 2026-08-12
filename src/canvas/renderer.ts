import { symbolBoundingRadius } from '../library/builtinSymbols';
import type { ComponentInstance, Selection, Vec2 } from '../types/geometry';
import { add, arcGeometry, type ArcGeometry, bulgeFromSagittaCursor, rotate } from './geometry';
import type { SceneGraph } from './sceneGraph';
import type { CameraState, Theme } from './store/useSketchStore';
import type { CanvasSize, InteractionState } from './tools/types';
import { adaptiveGridSize, worldToScreen } from './viewport';

interface Palette {
  background: string;
  grid: string;
  gridAxis: string;
  line: string;
  lineSelected: string;
  point: string;
  pointSelected: string;
  preview: string;
  inference: string;
  snapEndpoint: string;
  snapGrid: string;
  snapMidpoint: string;
  marquee: string;
  marqueeBorder: string;
  axisLockGlyph: string;
  componentTag: string;
}

const DARK_PALETTE: Palette = {
  background: '#1e1f24',
  grid: '#2a2c33',
  gridAxis: '#3a3d46',
  line: '#dfe3ea',
  lineSelected: '#5ab4ff',
  point: '#dfe3ea',
  pointSelected: '#5ab4ff',
  preview: '#5ab4ff',
  inference: '#ffb454',
  snapEndpoint: '#5eea6f',
  snapGrid: '#8a8f9c',
  snapMidpoint: '#c792ea',
  marquee: 'rgba(90, 180, 255, 0.15)',
  marqueeBorder: '#5ab4ff',
  axisLockGlyph: '#ffb454',
  componentTag: '#8ecdff',
};

/**
 * A future print/PDF export path should always call render() with theme: 'light'
 * regardless of the app's current UI theme — that's the whole reason `theme` is an
 * explicit render() parameter rather than a module-level/implicit setting.
 */
const LIGHT_PALETTE: Palette = {
  background: '#f7f8fa',
  grid: '#e3e5ea',
  gridAxis: '#c9cdd6',
  line: '#23262d',
  lineSelected: '#1a73e8',
  point: '#23262d',
  pointSelected: '#1a73e8',
  preview: '#1a73e8',
  inference: '#c96a12',
  snapEndpoint: '#1f9d4d',
  snapGrid: '#6b7280',
  snapMidpoint: '#8e3fb0',
  marquee: 'rgba(26, 115, 232, 0.12)',
  marqueeBorder: '#1a73e8',
  axisLockGlyph: '#c96a12',
  componentTag: '#0c5fc7',
};

function paletteFor(theme: Theme): Palette {
  return theme === 'light' ? LIGHT_PALETTE : DARK_PALETTE;
}

export interface RenderParams {
  ctx: CanvasRenderingContext2D;
  size: CanvasSize;
  camera: CameraState;
  graph: SceneGraph;
  selection: Selection;
  gridSize: number;
  gridVisible: boolean;
  interaction: InteractionState;
  theme: Theme;
}

export function render(params: RenderParams) {
  const { ctx, size, camera, graph, selection, gridSize, gridVisible, interaction, theme } = params;
  const colors = paletteFor(theme);
  const dpr = window.devicePixelRatio || 1;

  ctx.save();
  ctx.clearRect(0, 0, size.width * dpr, size.height * dpr);
  ctx.scale(dpr, dpr);

  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, size.width, size.height);

  if (gridVisible) drawGrid(ctx, size, camera, gridSize, colors);

  for (const line of graph.lines.values()) {
    const a = graph.points.get(line.startId);
    const b = graph.points.get(line.endId);
    if (!a || !b) continue;
    const sa = worldToScreen(a, camera, size);
    const sb = worldToScreen(b, camera, size);
    const selected = selection.lineIds.has(line.id);
    ctx.strokeStyle = selected ? colors.lineSelected : colors.line;
    ctx.lineWidth = selected ? 2.5 : 2;
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();

    if (line.axisLock) drawAxisLockGlyph(ctx, sa, sb, line.axisLock, colors);
  }

  for (const arc of graph.arcs.values()) {
    const a = graph.points.get(arc.startId);
    const b = graph.points.get(arc.endId);
    if (!a || !b) continue;
    const selected = selection.arcIds.has(arc.id);
    ctx.strokeStyle = selected ? colors.lineSelected : colors.line;
    ctx.lineWidth = selected ? 2.5 : 2;
    strokeArc(ctx, graph.getArcGeometry(arc), a, b, camera, size);
  }

  for (const instance of graph.components.values()) {
    drawComponentBody(ctx, instance, camera, size, colors, selection.componentIds.has(instance.id));
  }

  for (const point of graph.points.values()) {
    const s = worldToScreen(point, camera, size);
    const selected = selection.pointIds.has(point.id);
    ctx.fillStyle = selected ? colors.pointSelected : colors.point;
    ctx.beginPath();
    ctx.arc(s.x, s.y, selected ? 4.5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Tags render last (on top of everything) so they stay legible over overlapping geometry.
  for (const instance of graph.components.values()) {
    drawComponentTag(ctx, instance, camera, size, colors, selection.componentIds.has(instance.id));
  }

  if (interaction.drawLine) {
    const { anchor, cursorWorld, snap } = interaction.drawLine;
    drawDashedSegment(ctx, anchor.pos, snap.point ?? cursorWorld, camera, size, colors);
  }

  if (interaction.drawArc) {
    const { start, end, cursorWorld, snap } = interaction.drawArc;
    if (!end) {
      // Chord phase: same straight dashed preview as the line tool.
      drawDashedSegment(ctx, start.pos, snap.point ?? cursorWorld, camera, size, colors);
    } else {
      // Curving phase: live arc preview following the (grid/endpoint-snapped) cursor.
      const bulge = bulgeFromSagittaCursor(start.pos, end.pos, snap.point);
      if (Math.abs(bulge) < 1e-6) {
        drawDashedSegment(ctx, start.pos, end.pos, camera, size, colors);
      } else {
        ctx.save();
        ctx.strokeStyle = colors.preview;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        strokeArcByEndpoints(ctx, start.pos, end.pos, bulge, camera, size);
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  }

  if (interaction.drawCircle) {
    const { center, cursorWorld } = interaction.drawCircle;
    const radius = Math.hypot(cursorWorld.x - center.x, cursorWorld.y - center.y);
    if (radius > 1e-6) {
      const c = worldToScreen(center, camera, size);
      ctx.strokeStyle = colors.preview;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(c.x, c.y, radius * camera.zoom, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawSnapIndicator(
    ctx,
    camera,
    size,
    interaction.hoverSnap ?? interaction.drawLine?.snap ?? interaction.drawArc?.snap ?? null,
    colors,
  );

  if (interaction.drag?.kind === 'marquee') {
    const a = worldToScreen(interaction.drag.originWorld, camera, size);
    const b = worldToScreen(interaction.drag.currentWorld, camera, size);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x);
    const h = Math.abs(a.y - b.y);
    ctx.fillStyle = colors.marquee;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = colors.marqueeBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }

  ctx.restore();
}

function drawDashedSegment(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2, camera: CameraState, size: CanvasSize, colors: Palette) {
  const sa = worldToScreen(a, camera, size);
  const sb = worldToScreen(b, camera, size);
  ctx.strokeStyle = colors.preview;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(sa.x, sa.y);
  ctx.lineTo(sb.x, sb.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Strokes an arc from its derived geometry (falls back to a straight segment when
 * bulge is ~0). `zoom` is a uniform scale, so screen radius = world radius * zoom. */
function strokeArc(ctx: CanvasRenderingContext2D, geo: ArcGeometry, start: Vec2, end: Vec2, camera: CameraState, size: CanvasSize) {
  if (geo.isStraight) {
    const sa = worldToScreen(start, camera, size);
    const sb = worldToScreen(end, camera, size);
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
    return;
  }
  const center = worldToScreen(geo.center, camera, size);
  const radius = geo.radius * camera.zoom;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, geo.startAngle, geo.endAngle, geo.anticlockwise);
  ctx.stroke();
}

function strokeArcByEndpoints(ctx: CanvasRenderingContext2D, start: Vec2, end: Vec2, bulge: number, camera: CameraState, size: CanvasSize) {
  strokeArc(ctx, arcGeometry(start, end, bulge), start, end, camera, size);
}

function drawGrid(ctx: CanvasRenderingContext2D, size: CanvasSize, camera: CameraState, gridSize: number, colors: Palette) {
  if (gridSize <= 0) return;
  const spacing = adaptiveGridSize(gridSize, camera.zoom);
  const screenSpacing = spacing * camera.zoom;

  const originScreen = worldToScreen({ x: 0, y: 0 }, camera, size);
  const startX = originScreen.x % screenSpacing;
  const startY = originScreen.y % screenSpacing;

  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = startX; x < size.width; x += screenSpacing) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size.height);
  }
  for (let y = startY; y < size.height; y += screenSpacing) {
    ctx.moveTo(0, y);
    ctx.lineTo(size.width, y);
  }
  ctx.stroke();

  ctx.strokeStyle = colors.gridAxis;
  ctx.beginPath();
  if (originScreen.x >= 0 && originScreen.x <= size.width) {
    ctx.moveTo(originScreen.x, 0);
    ctx.lineTo(originScreen.x, size.height);
  }
  if (originScreen.y >= 0 && originScreen.y <= size.height) {
    ctx.moveTo(0, originScreen.y);
    ctx.lineTo(size.width, originScreen.y);
  }
  ctx.stroke();
}

/** Transforms a symbol-local point into world space by the instance's position and
 * rotation — the same transform SceneGraph uses when it derives port world-positions,
 * kept in sync so the drawn body lines up exactly with where pipes attach. */
function symbolPointToWorld(local: Vec2, instance: ComponentInstance): Vec2 {
  return add(instance.position, rotate(local, instance.rotation));
}

/** Draws the instance's real vector symbol (or the generic placeholder, resolved the
 * same way — see builtinSymbols.ts) by transforming its local points/lines/arcs into
 * world space and reusing the same line/arc stroking as the sketch geometry itself. */
function drawComponentBody(ctx: CanvasRenderingContext2D, instance: ComponentInstance, camera: CameraState, size: CanvasSize, colors: Palette, selected: boolean) {
  const { symbol } = instance.snapshot;
  ctx.strokeStyle = selected ? colors.lineSelected : colors.line;
  ctx.lineWidth = selected ? 2.5 : 2;

  for (const [aId, bId] of symbol.lines) {
    const aLocal = symbol.points[aId];
    const bLocal = symbol.points[bId];
    if (!aLocal || !bLocal) continue;
    const sa = worldToScreen(symbolPointToWorld(aLocal, instance), camera, size);
    const sb = worldToScreen(symbolPointToWorld(bLocal, instance), camera, size);
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
  }

  for (const arc of symbol.arcs) {
    const aLocal = symbol.points[arc.a];
    const bLocal = symbol.points[arc.b];
    if (!aLocal || !bLocal) continue;
    const aWorld = symbolPointToWorld(aLocal, instance);
    const bWorld = symbolPointToWorld(bLocal, instance);
    strokeArc(ctx, arcGeometry(aWorld, bWorld, arc.bulge), aWorld, bWorld, camera, size);
  }
}

function drawComponentTag(ctx: CanvasRenderingContext2D, instance: ComponentInstance, camera: CameraState, size: CanvasSize, colors: Palette, selected: boolean) {
  const center = worldToScreen(instance.position, camera, size);
  const offset = symbolBoundingRadius(instance.snapshot.symbol) * camera.zoom + 6;
  ctx.fillStyle = selected ? colors.lineSelected : colors.componentTag;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(instance.tag, center.x, center.y - offset);
}

function drawAxisLockGlyph(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2, axis: 'H' | 'V', colors: Palette) {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  ctx.fillStyle = colors.axisLockGlyph;
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(axis, mid.x, mid.y - 8);
}

function drawSnapIndicator(
  ctx: CanvasRenderingContext2D,
  camera: CameraState,
  size: CanvasSize,
  snap: RenderParams['interaction']['hoverSnap'],
  colors: Palette,
) {
  if (!snap || snap.type === 'free') return;
  const s = worldToScreen(snap.point, camera, size);

  if (snap.inferenceFrom) {
    const from = worldToScreen(snap.inferenceFrom, camera, size);
    ctx.strokeStyle = colors.inference;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(s.x, s.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const color =
    snap.type === 'endpoint'
      ? colors.snapEndpoint
      : snap.type === 'grid'
        ? colors.snapGrid
        : snap.type === 'midpoint'
          ? colors.snapMidpoint
          : colors.inference;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  const r = 6;
  ctx.beginPath();
  if (snap.type === 'endpoint') {
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  } else if (snap.type === 'midpoint') {
    // Diamond, to read as distinct from the square (grid/inference) and circle (endpoint).
    ctx.moveTo(s.x, s.y - r);
    ctx.lineTo(s.x + r, s.y);
    ctx.lineTo(s.x, s.y + r);
    ctx.lineTo(s.x - r, s.y);
    ctx.closePath();
  } else {
    ctx.rect(s.x - r, s.y - r, r * 2, r * 2);
  }
  ctx.stroke();
}
