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
  /** A single point being dragged. `grabWorld`/`origin` are the cursor and the point's
   * position at pointer-down, so the drag preserves the grab offset like every other kind
   * here: a point is picked anywhere within the hit-test radius, and without them the point
   * jumped that far to meet the cursor on the first move — enough, with the grid ungated,
   * to land an already-on-grid point a whole cell away from a nudge that meant nothing. */
  | { kind: 'point'; pointId: Id; grabWorld: Vec2; origin: Vec2; before: SceneGraphJSON; mergeCandidate?: Id }
  /** An edge being dragged by its *body* (only offered when neither endpoint is shared —
   * see endpointsAreUnshared). Both of its anchors move at once, so like the group drag
   * below it grid-quantizes the delta rather than snap-searching from a single point;
   * that also keeps the edge's own length and angle intact. */
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
  /** A text annotation being dragged. Nothing propagates from it (a note has no
   * connectivity), so unlike a point drag this is a plain grid-quantized translate. */
  | { kind: 'text'; textId: Id; grabWorld: Vec2; origin: Vec2; before: SceneGraphJSON }
  | { kind: 'marquee'; originWorld: Vec2; currentWorld: Vec2; additive: boolean }
  /** Rigid-translate drag of an entire multi-item selection (e.g. a just-pasted batch of
   * components) — started when the pointer goes down on something already part of a
   * selection with more than one item, instead of the usual "click replaces selection
   * with just this one thing" behavior. Grid-quantizes the whole-group delta rather than
   * doing a per-point endpoint-snap search, which doesn't generalize to multiple
   * simultaneously-moving anchors — same tradeoff as the symbol editor's group drag. */
  | {
      kind: 'group';
      grabWorld: Vec2;
      pointOrigins: Map<Id, Vec2>;
      componentOrigins: Map<Id, { position: Vec2; rotation: number }>;
      textOrigins: Map<Id, Vec2>;
      before: SceneGraphJSON;
    };

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
