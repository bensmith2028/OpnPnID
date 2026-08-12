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
    ctx.requestRedraw();
    return;
  }

  const { anchor, snap } = interaction.drawLine;
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
  if (!interaction.drawLine) return;

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

export function drawLineCancel(ctx: ToolCtx) {
  ctx.interaction.drawLine = null;
  ctx.requestRedraw();
}
