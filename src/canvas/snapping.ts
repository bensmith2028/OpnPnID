import type { Id, Vec2 } from '../types/geometry';
import { nearestGridPoint } from './geometry';
import type { SceneGraph } from './sceneGraph';

export type SnapType = 'endpoint' | 'grid' | 'horizontal' | 'vertical' | 'midpoint' | 'free';

export interface SnapResult {
  point: Vec2;
  type: SnapType;
  /** Set when type === 'endpoint': the existing point the result snapped onto. */
  snappedPointId?: Id;
  /** Set when type === 'horizontal' | 'vertical': draw a dashed inference line from here. */
  inferenceFrom?: Vec2;
}

export interface SnapOptions {
  /** The position to snap — or, under `gridMode: 'delta'`, the drag offset to snap. */
  cursor: Vec2;
  graph: SceneGraph;
  /** World-space distance under which an *endpoint* or axis-inference candidate wins.
   * Scale this with 1/zoom upstream. The grid snap is deliberately ungated — see below. */
  threshold: number;
  /** Grid spacing in world units. */
  gridSize: number;
  /** The point we're drawing/dragging from, for H/V axis inference. Omit to skip inference. */
  originPoint?: Vec2;
  /** Exclude this point from endpoint-snap candidates (e.g. the point currently being dragged). */
  excludePointId?: Id;
  /** Exclude every point owned by this component (its own ports) — used while dragging a
   * component so it doesn't snap to its own connection points. */
  excludeComponentId?: Id;
  /** Search existing points for an endpoint snap (default true). Callers that have nothing
   * to usefully land on opt out: a note is not a vertex, so snapping one onto a point would
   * bury it under the very geometry it's there to label. */
  allowEndpoint?: boolean;
  /** 'absolute' (the default) snaps `cursor` as a position. 'delta' treats it as a drag
   * *offset* and snaps that instead, for callers moving several things at once — see the
   * note in computeSnap. The returned `point` is then an offset too, not a world position,
   * so don't hand it to the snap indicator. */
  gridMode?: 'absolute' | 'delta';
  /** Holding a modifier (Alt) disables all snapping for a fully freehand placement. */
  disabled?: boolean;
}

/**
 * Computes the best snap for the current cursor position, in priority order:
 * endpoint > axis inference (H/V off the origin point) > grid.
 *
 * Endpoint and axis inference are gated on `threshold` because each answers a question
 * about one specific target — "did you mean *this* point / *this* axis?" — which is only
 * a yes while the cursor is near it. The grid asks no such question, so it isn't gated:
 * it's the floor every position lands on rather than one more candidate. A gated grid
 * silently stopped snapping the further you zoomed in (the threshold is a fixed number of
 * screen pixels, the grid a fixed number of world units, so the snapping fraction of the
 * canvas shrinks as zoom grows) and gave no sign that it had.
 *
 * `free` is therefore reachable only by holding Alt (`disabled`) or by turning the grid
 * off outright (`gridSize <= 0`): placing freehand is now a deliberate act, not something
 * you fall into by being a few pixels off a grid line.
 */
export function computeSnap(opts: SnapOptions): SnapResult {
  const { cursor, graph, threshold, gridSize, originPoint, excludePointId, excludeComponentId, disabled } = opts;

  if (disabled) {
    return { point: cursor, type: 'free' };
  }

  if (opts.gridMode === 'delta') {
    // `cursor` is a drag offset here, not a position: there's no geometry sitting at that
    // coordinate to endpoint-snap or axis-infer against, so the grid is the only snap that
    // means anything. Quantizing the offset moves the whole group by a whole number of
    // cells, preserving its internal shape (on-grid or not) instead of collapsing every
    // member onto its own nearest grid point.
    if (gridSize <= 0) return { point: cursor, type: 'free' };
    return { point: nearestGridPoint(cursor, gridSize), type: 'grid' };
  }

  if (opts.allowEndpoint ?? true) {
    const nearest = graph.nearestPoint(cursor, excludePointId, excludeComponentId);
    if (nearest && nearest.distance <= threshold) {
      return { point: { x: nearest.point.x, y: nearest.point.y }, type: 'endpoint', snappedPointId: nearest.point.id };
    }
  }

  if (originPoint) {
    const dx = Math.abs(cursor.x - originPoint.x);
    const dy = Math.abs(cursor.y - originPoint.y);
    // Angular threshold expressed as a distance ratio: within `threshold` world units of
    // the pure horizontal/vertical line through the origin point. The free coordinate
    // (how far along that line) still grid-snaps — being axis-locked shouldn't cost you
    // the grid snap on the other axis.
    if (dy <= threshold && dx > threshold) {
      const x = gridSize > 0 ? Math.round(cursor.x / gridSize) * gridSize : cursor.x;
      return { point: { x, y: originPoint.y }, type: 'horizontal', inferenceFrom: originPoint };
    }
    if (dx <= threshold && dy > threshold) {
      const y = gridSize > 0 ? Math.round(cursor.y / gridSize) * gridSize : cursor.y;
      return { point: { x: originPoint.x, y }, type: 'vertical', inferenceFrom: originPoint };
    }
  }

  if (gridSize > 0) {
    return { point: nearestGridPoint(cursor, gridSize), type: 'grid' };
  }

  // Grid turned off and nothing else claimed the cursor: there's nothing left to land on.
  return { point: cursor, type: 'free' };
}
