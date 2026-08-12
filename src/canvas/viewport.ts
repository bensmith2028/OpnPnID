import { symbolBoundingRadius } from '../library/builtinSymbols';
import type { Vec2 } from '../types/geometry';
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

/** Picks a "nice" grid spacing (1-2-5 sequence) so lines stay a comfortable distance apart on screen. */
export function adaptiveGridSize(baseGridSize: number, zoom: number, minScreenPx = 14): number {
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
 * decorative body isn't graph data, so it wouldn't otherwise contribute to the box).
 * Falls back to a default camera when the graph is empty — there's no meaningful box to
 * fit, and dividing by a zero-size box would blow up the zoom.
 */
export function fitCameraToContent(graph: SceneGraph, size: CanvasSize, componentScale: number, marginFraction = 0.08): CameraState {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const expand = (x: number, y: number, r: number) => {
    if (x - r < minX) minX = x - r;
    if (x + r > maxX) maxX = x + r;
    if (y - r < minY) minY = y - r;
    if (y + r > maxY) maxY = y + r;
  };

  for (const p of graph.points.values()) expand(p.x, p.y, 0);
  for (const instance of graph.components.values()) {
    const radius = symbolBoundingRadius(instance.snapshot.symbol) * componentScale;
    expand(instance.position.x, instance.position.y, radius);
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
