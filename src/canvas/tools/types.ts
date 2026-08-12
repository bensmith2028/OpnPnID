import type { Id, SceneGraphJSON, Vec2 } from '../../types/geometry';
import type { SnapResult } from '../snapping';
import type { CameraState } from '../store/useSketchStore';

/** In-progress "draw a line" state, chained until Escape or a tool switch.
 * The anchor isn't written into the graph until the segment is actually committed (on the
 * second click) — `pointId` is set only when the anchor snapped onto an existing point. */
export interface DrawLineState {
  anchor: { pointId: Id | null; pos: Vec2 };
  cursorWorld: Vec2;
  snap: SnapResult;
}

/** In-progress "draw an arc" state: click 1 sets `start`, click 2 sets `end` (the chord)
 * and switches to curving — from then on `cursorWorld` drives a live bulge preview via
 * `bulgeFromSagittaCursor`, committed on click 3. Neither point is written into the graph
 * until commit, same as `DrawLineState`. `tangentEdgeId` is set when that click was made
 * with Shift held onto a point touching exactly one other line/arc — see drawArcTool. */
export interface DrawArcState {
  start: { pointId: Id | null; pos: Vec2; tangentEdgeId?: Id };
  end: { pointId: Id | null; pos: Vec2; tangentEdgeId?: Id } | null;
  cursorWorld: Vec2;
  snap: SnapResult;
}

/** In-progress "draw a circle" state: click 1 sets `center` (never written into the
 * graph — only the two seam points end up as real points), drag sets the live radius
 * preview, click 2 commits. */
export interface DrawCircleState {
  center: Vec2;
  cursorWorld: Vec2;
}

export type DragState =
  | { kind: 'point'; pointId: Id; before: SceneGraphJSON; mergeCandidate?: Id }
  | {
      kind: 'line';
      lineId: Id;
      startId: Id;
      endId: Id;
      grabWorld: Vec2;
      startOrigin: Vec2;
      endOrigin: Vec2;
      before: SceneGraphJSON;
    }
  | {
      kind: 'arc';
      arcId: Id;
      startId: Id;
      endId: Id;
      grabWorld: Vec2;
      startOrigin: Vec2;
      endOrigin: Vec2;
      before: SceneGraphJSON;
    }
  | {
      kind: 'component';
      componentId: Id;
      grabWorld: Vec2;
      originPosition: Vec2;
      rotation: number;
      before: SceneGraphJSON;
    }
  | { kind: 'marquee'; originWorld: Vec2; currentWorld: Vec2; additive: boolean };

export interface PanState {
  originScreen: Vec2;
  originCamera: CameraState;
}

/** Ephemeral, per-frame interaction state that lives in a ref (not the zustand store) so
 * dragging/panning/drawing previews never trigger a React re-render — only an imperative
 * canvas redraw. */
export interface InteractionState {
  drawLine: DrawLineState | null;
  drawArc: DrawArcState | null;
  drawCircle: DrawCircleState | null;
  drag: DragState | null;
  pan: PanState | null;
  hoverSnap: SnapResult | null;
  altHeld: boolean;
}

export function createInteractionState(): InteractionState {
  return { drawLine: null, drawArc: null, drawCircle: null, drag: null, pan: null, hoverSnap: null, altHeld: false };
}

export interface CanvasSize {
  width: number;
  height: number;
}
