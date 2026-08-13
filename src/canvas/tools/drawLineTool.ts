import type { Vec2 } from '../../types/geometry';
import { distance } from '../geometry';
import { computeSnap } from '../snapping';
import { useSketchStore } from '../store/useSketchStore';
import type { InteractionState } from './types';

export interface ToolCtx {
  interaction: InteractionState;
  requestRedraw: () => void;
}

/** Pixel snap/pick threshold (from the store, user-adjustable) converted to world units
 * at the current zoom. Shared by every tool that needs snap/hit-test distances. */
export function worldThreshold(): number {
  const { camera, snapThresholdPx } = useSketchStore.getState();
  return snapThresholdPx / camera.zoom;
}

/** Click-click line drawing: first click sets/reuses an anchor, second click commits a
 * segment and immediately continues the chain from its end point (Escape to stop). */
export function drawLineOnPointerDown(world: Vec2, ctx: ToolCtx) {
  const { graph, gridSize, commit } = useSketchStore.getState();
  const { interaction } = ctx;

  if (!interaction.drawLine) {
    const snap = computeSnap({
      cursor: world,
      graph,
      threshold: worldThreshold(),
      gridSize,
      disabled: interaction.altHeld,
    });
    interaction.drawLine = {
      anchor: { pointId: snap.snappedPointId ?? null, pos: snap.point },
      cursorWorld: world,
      snap,
    };
    // From here the gesture's own `snap` drives the indicator (see the fallback chain in
    // renderer's drawSnapIndicator call), so drop the pre-gesture hover preview rather
    // than leaving a second, no-longer-updated marker to take priority over it.
    interaction.hoverSnap = null;
    ctx.requestRedraw();
    return;
  }

  // Recomputed from *this* click's position rather than reusing the snap the last
  // pointer-move left behind: with a mouse a move almost always precedes the down, but a
  // pen/touch tap or a click straight after a wheel-zoom has no such move, and would
  // otherwise commit the segment to wherever the cursor last was.
  const { anchor } = interaction.drawLine;
  const snap = computeSnap({
    cursor: world,
    graph,
    threshold: worldThreshold(),
    gridSize,
    originPoint: anchor.pos,
    excludePointId: anchor.pointId ?? undefined,
    disabled: interaction.altHeld,
  });
  if (distance(anchor.pos, snap.point) < 1e-6) return; // zero-length click, ignore

  const before = graph.toJSON();
  const startId = anchor.pointId ?? graph.addPoint(anchor.pos.x, anchor.pos.y).id;
  const endId = snap.snappedPointId ?? graph.addPoint(snap.point.x, snap.point.y).id;
  const axisLock = snap.type === 'horizontal' ? 'H' : snap.type === 'vertical' ? 'V' : null;
  graph.addLine(startId, endId, axisLock);
  commit(before);

  // Continue the chain from the just-placed end point.
  interaction.drawLine = {
    anchor: { pointId: endId, pos: { x: snap.point.x, y: snap.point.y } },
    cursorWorld: world,
    snap,
  };
  ctx.requestRedraw();
}

export function drawLineOnPointerMove(world: Vec2, ctx: ToolCtx) {
  const { graph, gridSize } = useSketchStore.getState();
  const { interaction } = ctx;

  if (!interaction.drawLine) {
    // Before the first click there's no gesture to preview, but the *landing spot* of that
    // click still needs showing — the same hover feedback the Point/Text/Component tools
    // give. It's also the only Alt feedback this tool has: a freehand placement is drawn as
    // no marker at all (see drawSnapIndicator), which reads as "Alt is doing something"
    // only if a marker was there to begin with.
    interaction.hoverSnap = computeSnap({
      cursor: world,
      graph,
      threshold: worldThreshold(),
      gridSize,
      disabled: interaction.altHeld,
    });
    ctx.requestRedraw();
    return;
  }

  const { anchor } = interaction.drawLine;
  const snap = computeSnap({
    cursor: world,
    graph,
    threshold: worldThreshold(),
    gridSize,
    originPoint: anchor.pos,
    excludePointId: anchor.pointId ?? undefined,
    disabled: interaction.altHeld,
  });
  interaction.drawLine = { anchor, cursorWorld: world, snap };
  ctx.requestRedraw();
}

/** Puts the line tool away (Escape or a tool switch): the chain *and* the hover preview,
 * which lives in the shared `hoverSnap` slot and would otherwise sit frozen on the canvas
 * until the incoming tool's next pointer move repaints it — same reasoning as textCancel. */
export function drawLineCancel(ctx: ToolCtx) {
  ctx.interaction.drawLine = null;
  ctx.interaction.hoverSnap = null;
  ctx.requestRedraw();
}
