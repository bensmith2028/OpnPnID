import type { Id, Vec2 } from '../../types/geometry';
import { distance, midpoint, pointAtArcFraction, projectPointOnArc, projectPointOnSegment } from '../geometry';
import { computeSnap } from '../snapping';
import { useSketchStore } from '../store/useSketchStore';
import type { ToolCtx } from './drawLineTool';
import { worldThreshold } from './drawLineTool';

/** Snapping onto a line/arc's exact midpoint is intentionally more forgiving than the
 * general pick threshold, so it's easy to land precisely on it. */
const MIDPOINT_SNAP_MULTIPLIER = 1.5;

interface EdgeHit {
  kind: 'line' | 'arc';
  id: Id;
  point: Vec2;
  distance: number;
}

function nearestEdgeMidpoint(cursor: Vec2, threshold: number): EdgeHit | null {
  const { graph } = useSketchStore.getState();
  let best: EdgeHit | null = null;
  const consider = (kind: 'line' | 'arc', id: Id, mid: Vec2) => {
    const d = distance(mid, cursor);
    if (d <= threshold && (!best || d < best.distance)) best = { kind, id, point: mid, distance: d };
  };
  for (const line of graph.lines.values()) {
    const a = graph.points.get(line.startId);
    const b = graph.points.get(line.endId);
    if (a && b) consider('line', line.id, midpoint(a, b));
  }
  for (const arc of graph.arcs.values()) {
    const a = graph.points.get(arc.startId);
    const b = graph.points.get(arc.endId);
    if (!a || !b) continue;
    const geo = graph.getArcGeometry(arc);
    consider('arc', arc.id, geo.isStraight ? midpoint(a, b) : pointAtArcFraction(geo, 0.5));
  }
  return best;
}

function nearestEdgePoint(cursor: Vec2, threshold: number): EdgeHit | null {
  const { graph } = useSketchStore.getState();
  let best: EdgeHit | null = null;
  for (const line of graph.lines.values()) {
    const a = graph.points.get(line.startId);
    const b = graph.points.get(line.endId);
    if (!a || !b) continue;
    const proj = projectPointOnSegment(cursor, a, b);
    if (proj.distance <= threshold && (!best || proj.distance < best.distance)) {
      best = { kind: 'line', id: line.id, point: proj.point, distance: proj.distance };
    }
  }
  for (const arc of graph.arcs.values()) {
    const a = graph.points.get(arc.startId);
    const b = graph.points.get(arc.endId);
    if (!a || !b) continue;
    const proj = projectPointOnArc(cursor, a, b, arc.bulge);
    if (proj.distance <= threshold && (!best || proj.distance < best.distance)) {
      best = { kind: 'arc', id: arc.id, point: proj.point, distance: proj.distance };
    }
  }
  return best;
}

/** In priority order: select an existing point (no duplicate); snap onto & split a
 * line/arc's exact midpoint; split a line/arc at wherever else was clicked on it;
 * otherwise place a standalone (grid/free-snapped) point. */
export function pointOnPointerDown(world: Vec2, ctx: ToolCtx) {
  const { graph, gridSize, commit, setSelection } = useSketchStore.getState();
  const threshold = worldThreshold();

  const nearestPoint = graph.nearestPoint(world);
  if (nearestPoint && nearestPoint.distance <= threshold) {
    setSelection({
      pointIds: new Set([nearestPoint.point.id]),
      lineIds: new Set(),
      arcIds: new Set(),
      componentIds: new Set(),
      textIds: new Set(),
    });
    ctx.requestRedraw();
    return;
  }

  const edgeHit = nearestEdgeMidpoint(world, threshold * MIDPOINT_SNAP_MULTIPLIER) ?? nearestEdgePoint(world, threshold);
  if (edgeHit) {
    const before = graph.toJSON();
    const newPoint = edgeHit.kind === 'line' ? graph.splitLine(edgeHit.id, edgeHit.point) : graph.splitArc(edgeHit.id, edgeHit.point);
    if (newPoint) {
      commit(before);
      setSelection({ pointIds: new Set([newPoint.id]), lineIds: new Set(), arcIds: new Set(), componentIds: new Set(), textIds: new Set() });
    }
    ctx.requestRedraw();
    return;
  }

  const snap = computeSnap({ cursor: world, graph, threshold, gridSize, disabled: ctx.interaction.altHeld });
  const before = graph.toJSON();
  const newPoint = graph.addPoint(snap.point.x, snap.point.y);
  commit(before);
  setSelection({ pointIds: new Set([newPoint.id]), lineIds: new Set(), arcIds: new Set(), componentIds: new Set(), textIds: new Set() });
  ctx.requestRedraw();
}

export function pointOnPointerMove(world: Vec2, ctx: ToolCtx) {
  const { graph, gridSize } = useSketchStore.getState();
  const threshold = worldThreshold();

  const nearestPoint = graph.nearestPoint(world);
  if (nearestPoint && nearestPoint.distance <= threshold) {
    ctx.interaction.hoverSnap = { point: { x: nearestPoint.point.x, y: nearestPoint.point.y }, type: 'endpoint', snappedPointId: nearestPoint.point.id };
    ctx.requestRedraw();
    return;
  }

  const edgeHit = nearestEdgeMidpoint(world, threshold * MIDPOINT_SNAP_MULTIPLIER) ?? nearestEdgePoint(world, threshold);
  if (edgeHit) {
    ctx.interaction.hoverSnap = { point: edgeHit.point, type: 'midpoint' };
    ctx.requestRedraw();
    return;
  }

  ctx.interaction.hoverSnap = computeSnap({ cursor: world, graph, threshold, gridSize, disabled: ctx.interaction.altHeld });
  ctx.requestRedraw();
}
