import type { Vec2 } from '../types/geometry';
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
