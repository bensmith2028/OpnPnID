import { symbolBoundingRadius } from '../library/builtinSymbols';
import type { Vec2 } from '../types/geometry';
import { textHalfExtent } from './geometry';
import type { SceneGraph } from './sceneGraph';
import type { CameraState } from './store/useSketchStore';

export interface CanvasSize {
  width: number;
  height: number;
}

export function worldToScreen(p: Vec2, camera: CameraState, size: CanvasSize): Vec2 {
  return {
    x: (p.x - camera.x) * camera.zoom + size.width / 2,
    y: (p.y - camera.y) * camera.zoom + size.height / 2,
  };
}

export function screenToWorld(p: Vec2, camera: CameraState, size: CanvasSize): Vec2 {
  return {
    x: (p.x - size.width / 2) / camera.zoom + camera.x,
    y: (p.y - size.height / 2) / camera.zoom + camera.y,
  };
}

/** Zooms the camera by `factor`, keeping the world point under `screenAnchor` fixed on screen. */
export function zoomAround(
  camera: CameraState,
  screenAnchor: Vec2,
  factor: number,
  size: CanvasSize,
  minZoom = 0.05,
  maxZoom = 20,
): CameraState {
  const worldBefore = screenToWorld(screenAnchor, camera, size);
  const zoom = Math.min(maxZoom, Math.max(minZoom, camera.zoom * factor));
  const next = { ...camera, zoom };
  const worldAfter = screenToWorld(screenAnchor, next, size);
  return {
    zoom,
    x: camera.x + (worldBefore.x - worldAfter.x),
    y: camera.y + (worldBefore.y - worldAfter.y),
  };
}

/** Screen spacing the *major* (emphasized) grid lines aim to stay at least this far apart. */
export const GRID_MIN_SCREEN_PX = 14;

/**
 * Picks the spacing for the emphasized "major" grid lines: the base grid doubled until the
 * lines sit at least `minScreenPx` apart on screen, so a zoomed-out drawing keeps a
 * readable structure instead of a solid wash.
 *
 * Doubling (rather than a 1-2-5 sequence) is load-bearing, not incidental: it guarantees
 * every major line is also a real grid line, so the renderer can draw the true snap grid
 * underneath and merely emphasize a subset of it. The major spacing is a *drawing* concern
 * only — snapping always uses the true `gridSize` (see computeSnap), because what you snap
 * to must not change with how far you happen to be zoomed in.
 */
export function adaptiveGridSize(baseGridSize: number, zoom: number, minScreenPx = GRID_MIN_SCREEN_PX): number {
  let size = baseGridSize;
  while (size * zoom < minScreenPx) size *= 2;
  return size;
}

/**
 * Computes a camera that frames the *entire* drawn scene (not just whatever the live
 * viewport currently shows) into a canvas of `size`, centered with a margin on every
 * side. Used by PDF export, which renders the whole schematic rather than reusing the
 * on-screen pan/zoom. The bounding box covers every point (lines/arcs are just edges
 * between points, so their extent is covered by the points loop) plus each placed
 * component's position expanded by its resolved symbol's bounding radius (a component's
 * decorative body isn't graph data, so it wouldn't otherwise contribute to the box), plus
 * each text annotation's own box.
 * Falls back to a default camera when the graph is empty — there's no meaningful box to
 * fit, and dividing by a zero-size box would blow up the zoom.
 */
export function fitCameraToContent(graph: SceneGraph, size: CanvasSize, componentScale: number, marginFraction = 0.08): CameraState {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const expandBox = (x: number, y: number, halfWidth: number, halfHeight: number) => {
    if (x - halfWidth < minX) minX = x - halfWidth;
    if (x + halfWidth > maxX) maxX = x + halfWidth;
    if (y - halfHeight < minY) minY = y - halfHeight;
    if (y + halfHeight > maxY) maxY = y + halfHeight;
  };
  const expand = (x: number, y: number, r: number) => expandBox(x, y, r, r);

  for (const p of graph.points.values()) expand(p.x, p.y, 0);
  for (const instance of graph.components.values()) {
    const radius = symbolBoundingRadius(instance.snapshot.symbol) * componentScale;
    expand(instance.position.x, instance.position.y, radius);
  }
  // A note is far wider than it is tall, so it needs the rectangular form — folding it into
  // the radius version would pad the drawing's height by the length of its longest note.
  for (const annotation of graph.texts.values()) {
    const half = textHalfExtent(annotation.text, annotation.fontSize);
    expandBox(annotation.x, annotation.y, half.x, half.y);
  }

  if (!Number.isFinite(minX)) return { x: 0, y: 0, zoom: 1 }; // empty graph

  const contentWidth = Math.max(maxX - minX, 1e-6);
  const contentHeight = Math.max(maxY - minY, 1e-6);
  const usableWidth = size.width * (1 - marginFraction * 2);
  const usableHeight = size.height * (1 - marginFraction * 2);
  const zoom = Math.min(usableWidth / contentWidth, usableHeight / contentHeight, 50);

  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    zoom,
  };
}
