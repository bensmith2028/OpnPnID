import type { Vec2 } from '../../types/geometry';
import { computeSnap } from '../snapping';
import { useSketchStore } from '../store/useSketchStore';
import type { ToolCtx } from './drawLineTool';
import { worldThreshold } from './drawLineTool';

/**
 * The Text tool's share of the pointer handling: where a click would put a note, and the
 * hover feedback that shows it. Committing the note itself lives in SketchCanvas, because
 * a click opens the inline editor (a React-rendered input over the canvas) rather than
 * writing to the graph — nothing goes into the document until the typed content is
 * confirmed. Keeping the snap logic here anyway means the Text tool lands notes on the
 * grid exactly like every other tool places geometry.
 *
 * Endpoint snapping is opted out of on both paths below, matching the note *drag* in
 * selectTool: a note is not a vertex, so snapping it onto an existing point would land it
 * exactly on top of the geometry it's there to label. Placing and dragging have to agree
 * on that, or a note moves the moment you nudge it.
 */
function textSnap(world: Vec2, ctx: ToolCtx) {
  const { graph, gridSize } = useSketchStore.getState();
  return computeSnap({
    cursor: world,
    graph,
    threshold: worldThreshold(),
    gridSize,
    allowEndpoint: false,
    disabled: ctx.interaction.altHeld,
  });
}

export function textPlacementPoint(world: Vec2, ctx: ToolCtx): Vec2 {
  return textSnap(world, ctx).point;
}

export function textOnPointerMove(world: Vec2, ctx: ToolCtx) {
  ctx.interaction.hoverSnap = textSnap(world, ctx);
  ctx.requestRedraw();
}

/** Puts the Text tool away (tool switch or Escape), the same way drawLineCancel and
 * friends do for their gestures. The Text tool's only ephemeral state is the placement
 * preview, which lives in the shared `hoverSnap` slot rather than a text-owned field — and
 * the incoming tool only repaints that slot on its *next* pointer move, so without this
 * the snapped preview box sits frozen on the canvas long after the Text tool is gone. */
export function textCancel(ctx: ToolCtx) {
  ctx.interaction.hoverSnap = null;
  ctx.requestRedraw();
}
