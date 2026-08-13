import type { Vec2 } from '../../types/geometry';
import { distance } from '../geometry';
import { computeSnap } from '../snapping';
import { useSketchStore } from '../store/useSketchStore';
import type { ToolCtx } from './drawLineTool';
import { worldThreshold } from './drawLineTool';

/** Click 1 = center, drag = live radius preview, click 2 commits. No dedicated Circle
 * entity: builds two points (a diameter's endpoints) + two bulge=1 arcs between them,
 * which exactly partitions a full circle (verified in sceneGraph.test.ts) — so pipes can
 * snap to the two seam points like any other endpoint. The radius-defining point
 * grid/endpoint-snaps the same as any other click. */
export function drawCircleOnPointerDown(world: Vec2, ctx: ToolCtx) {
  const { graph, gridSize, commit } = useSketchStore.getState();
  const { interaction } = ctx;

  if (!interaction.drawCircle) {
    const snap = computeSnap({
      cursor: world,
      graph,
      threshold: worldThreshold(),
      gridSize,
      disabled: interaction.altHeld,
    });
    interaction.drawCircle = { center: snap.point, cursorWorld: snap.point };
    ctx.requestRedraw();
    return;
  }

  const { center } = interaction.drawCircle;
  const snap = computeSnap({ cursor: world, graph, threshold: worldThreshold(), gridSize, disabled: interaction.altHeld });
  const radius = distance(center, snap.point);
  interaction.drawCircle = null;
  interaction.hoverSnap = null;
  if (radius < 1e-6) {
    ctx.requestRedraw();
    return;
  }

  const before = graph.toJSON();
  const a = graph.addPoint(center.x + radius, center.y);
  const b = graph.addPoint(center.x - radius, center.y);
  graph.addArc(a.id, b.id, 1);
  graph.addArc(b.id, a.id, 1);
  commit(before);
  ctx.requestRedraw();
}

export function drawCircleOnPointerMove(world: Vec2, ctx: ToolCtx) {
  const { graph, gridSize } = useSketchStore.getState();
  const { interaction } = ctx;
  const snap = computeSnap({ cursor: world, graph, threshold: worldThreshold(), gridSize, disabled: interaction.altHeld });
  // Written whether or not a circle is in progress: before click 1 this is the same "where
  // your click lands" preview the Point/Text/Component tools give (and, under Alt, the
  // absence of it is the only sign the placement will be freehand — see drawSnapIndicator);
  // after it, it's the radius handle. Unlike the line/arc previews there's no per-gesture
  // snap on DrawCircleState for the renderer to fall back to, so this slot serves both.
  if (interaction.drawCircle) interaction.drawCircle = { ...interaction.drawCircle, cursorWorld: snap.point };
  interaction.hoverSnap = snap;
  ctx.requestRedraw();
}

/** Puts the circle tool away (Escape or a tool switch), preview included — the commit path
 * already clears `hoverSnap` for the same reason (see drawLineCancel). */
export function drawCircleCancel(ctx: ToolCtx) {
  ctx.interaction.drawCircle = null;
  ctx.interaction.hoverSnap = null;
  ctx.requestRedraw();
}
