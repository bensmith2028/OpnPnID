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
  cursor: Vec2;
  graph: SceneGraph;
  /** World-space distance under which a candidate snap wins. Scale this with 1/zoom upstream. */
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
  /** Holding a modifier (Alt) disables all snapping for a fully freehand placement. */
  disabled?: boolean;
}

/**
 * Computes the best snap for the current cursor position, in priority order:
 * endpoint > axis inference (H/V off the origin point) > grid > free (raw cursor).
 */
export function computeSnap(opts: SnapOptions): SnapResult {
  const { cursor, graph, threshold, gridSize, originPoint, excludePointId, excludeComponentId, disabled } = opts;

  if (disabled) {
    return { point: cursor, type: 'free' };
  }

  const nearest = graph.nearestPoint(cursor, excludePointId, excludeComponentId);
  if (nearest && nearest.distance <= threshold) {
    return { point: { x: nearest.point.x, y: nearest.point.y }, type: 'endpoint', snappedPointId: nearest.point.id };
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
    const grid = nearestGridPoint(cursor, gridSize);
    if (Math.hypot(grid.x - cursor.x, grid.y - cursor.y) <= threshold) {
      return { point: grid, type: 'grid' };
    }
  }

  return { point: cursor, type: 'free' };
}
