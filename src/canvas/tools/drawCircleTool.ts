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
  if (!interaction.drawCircle) return;
  const snap = computeSnap({ cursor: world, graph, threshold: worldThreshold(), gridSize, disabled: interaction.altHeld });
  interaction.drawCircle = { ...interaction.drawCircle, cursorWorld: snap.point };
  interaction.hoverSnap = snap;
  ctx.requestRedraw();
}

export function drawCircleCancel(ctx: ToolCtx) {
  ctx.interaction.drawCircle = null;
  ctx.requestRedraw();
}
