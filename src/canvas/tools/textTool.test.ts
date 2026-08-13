import { beforeEach, describe, expect, it } from 'vitest';
import { useSketchStore } from '../store/useSketchStore';
import { textCancel, textOnPointerMove, textPlacementPoint } from './textTool';
import { createInteractionState } from './types';

/** Counts redraw requests too: the canvas is imperative, so clearing interaction state
 * without asking for a frame would leave the stale pixels on screen regardless. */
function newCtx() {
  const ctx = { interaction: createInteractionState(), redraws: 0, requestRedraw: () => {} };
  ctx.requestRedraw = () => {
    ctx.redraws += 1;
  };
  return ctx;
}

/** Fresh document before every test — the store is a module-level singleton. */
beforeEach(() => {
  useSketchStore.getState().newProject();
});

describe('Text tool placement preview', () => {
  it('previews the grid-snapped spot the note would land on while hovering', () => {
    const ctx = newCtx();
    textOnPointerMove({ x: 23, y: 7 }, ctx); // grid is 20 -> quantizes to (20, 0)

    expect(ctx.interaction.hoverSnap?.type).toBe('grid');
    expect(ctx.interaction.hoverSnap?.point).toEqual({ x: 20, y: 0 });
    // The preview and the actual placement have to agree, or the note lands off the box.
    expect(textPlacementPoint({ x: 23, y: 7 }, ctx)).toEqual({ x: 20, y: 0 });
  });

  it('drops the preview when the tool is put away (regression: the box used to stay stuck on the canvas after switching tools or pressing Escape)', () => {
    const ctx = newCtx();
    textOnPointerMove({ x: 23, y: 7 }, ctx);
    expect(ctx.interaction.hoverSnap).not.toBeNull();
    const before = ctx.redraws;

    textCancel(ctx);

    expect(ctx.interaction.hoverSnap).toBeNull();
    expect(ctx.redraws).toBeGreaterThan(before);
  });
});
