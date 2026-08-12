import type { Vec2 } from '../../types/geometry';
import { buildComponentSnapshot, getCategory, getFamily } from '../../library/db';
import { suggestTag, suggestTagLetter } from '../../library/tagging';
import { computeSnap } from '../snapping';
import { useSketchStore } from '../store/useSketchStore';
import type { ToolCtx } from './drawLineTool';
import { worldThreshold } from './drawLineTool';

/** Click-to-place, like the Point/Circle tools, using whichever category (and optional
 * real part) is "armed" via the Library panel. Unlike those tools this needs a couple of
 * DB reads (the snapshot + tag-letter lookup) before it can commit, so it's async — React
 * event handlers tolerate that fine (fire-and-forget). Stays armed after placing so you
 * can drop several of the same component in a row; Escape/switching tools clears it (see
 * useSketchStore.setTool). */
export async function componentOnPointerDown(world: Vec2, ctx: ToolCtx) {
  const armed = useSketchStore.getState().armedComponent;
  if (!armed) return;

  const { graph, gridSize } = useSketchStore.getState();
  const snap = computeSnap({ cursor: world, graph, threshold: worldThreshold(), gridSize, disabled: ctx.interaction.altHeld });

  const [snapshot, category] = await Promise.all([
    buildComponentSnapshot(armed.categoryId, armed.realPartId),
    getCategory(armed.categoryId),
  ]);
  if (!snapshot || !category) return;
  const family = await getFamily(category.familyId);

  // The user may have switched tools while these awaits were in flight.
  const state = useSketchStore.getState();
  if (state.activeTool !== 'component' || state.armedComponent?.categoryId !== armed.categoryId) return;

  const letter = suggestTagLetter({ tagLetter: family?.tagLetter ?? null }, { subtype: category.subtype });
  const existingTags = [...state.graph.components.values()].map((c) => c.tag);
  const tag = suggestTag(existingTags, letter);

  state.placeComponent({ categoryId: armed.categoryId, realPartId: armed.realPartId, position: snap.point, tag, snapshot });
  ctx.requestRedraw();
}

export function componentOnPointerMove(world: Vec2, ctx: ToolCtx) {
  const { graph, gridSize } = useSketchStore.getState();
  ctx.interaction.hoverSnap = computeSnap({ cursor: world, graph, threshold: worldThreshold(), gridSize, disabled: ctx.interaction.altHeld });
  ctx.requestRedraw();
}
