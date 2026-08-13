import { beforeEach, describe, expect, it } from 'vitest';
import { useSketchStore } from '../store/useSketchStore';
import { drawArcCancel, drawArcOnPointerDown, drawArcOnPointerMove } from './drawArcTool';
import { drawCircleCancel, drawCircleOnPointerDown, drawCircleOnPointerMove } from './drawCircleTool';
import { drawLineCancel, drawLineOnPointerDown, drawLineOnPointerMove } from './drawLineTool';
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

/** Fresh document and a neutral camera before every test — the store is a module-level
 * singleton, and `newProject` deliberately leaves the camera alone. */
beforeEach(() => {
  useSketchStore.getState().newProject();
  useSketchStore.getState().setCamera({ x: 0, y: 0, zoom: 1 });
});

/** The Point/Text/Component tools have always shown where a click would land; Line, Arc and
 * Circle showed nothing until a gesture was already under way. That gap matters more now
 * that the grid snap is ungated: a freehand (Alt) placement is drawn as *no* marker, so a
 * tool that never draws one has no way to say Alt is doing anything. */
describe('hover preview before the first click', () => {
  it('previews the line tool\'s first click, and drops it when the gesture takes over', () => {
    const ctx = newCtx();
    drawLineOnPointerMove({ x: 23, y: 7 }, ctx); // grid is 20 -> quantizes to (20, 0)

    expect(ctx.interaction.hoverSnap?.type).toBe('grid');
    expect(ctx.interaction.hoverSnap?.point).toEqual({ x: 20, y: 0 });

    // Once the chain is live, its own `snap` is what the renderer draws (hoverSnap wins the
    // fallback chain, so a leftover one would freeze the marker mid-gesture).
    drawLineOnPointerDown({ x: 23, y: 7 }, ctx);
    expect(ctx.interaction.hoverSnap).toBeNull();
    expect(ctx.interaction.drawLine?.snap.point).toEqual({ x: 20, y: 0 });
  });

  it("previews the arc tool's first click, and drops it when the gesture takes over", () => {
    const ctx = newCtx();
    drawArcOnPointerMove({ x: 23, y: 7 }, ctx);

    expect(ctx.interaction.hoverSnap?.type).toBe('grid');
    expect(ctx.interaction.hoverSnap?.point).toEqual({ x: 20, y: 0 });

    drawArcOnPointerDown({ x: 23, y: 7 }, false, ctx);
    expect(ctx.interaction.hoverSnap).toBeNull();
    expect(ctx.interaction.drawArc?.start.pos).toEqual({ x: 20, y: 0 });
  });

  it("previews the circle tool's centre, then keeps the slot for the radius handle", () => {
    const ctx = newCtx();
    drawCircleOnPointerMove({ x: 23, y: 7 }, ctx);
    expect(ctx.interaction.hoverSnap?.point).toEqual({ x: 20, y: 0 });

    // Unlike the line/arc previews there's no per-gesture snap on DrawCircleState for the
    // renderer to fall back to, so this one slot serves both phases.
    drawCircleOnPointerDown({ x: 23, y: 7 }, ctx);
    drawCircleOnPointerMove({ x: 63, y: 7 }, ctx);
    expect(ctx.interaction.hoverSnap?.point).toEqual({ x: 60, y: 0 });
    expect(ctx.interaction.drawCircle?.cursorWorld).toEqual({ x: 60, y: 0 });
  });

  it('previews nothing under Alt — the missing marker is what tells you the click is freehand', () => {
    const ctx = newCtx();
    ctx.interaction.altHeld = true;
    for (const move of [drawLineOnPointerMove, drawCircleOnPointerMove, drawArcOnPointerMove]) {
      move({ x: 23, y: 7 }, ctx);
      expect(ctx.interaction.hoverSnap?.type).toBe('free'); // drawn as nothing at all
      expect(ctx.interaction.hoverSnap?.point).toEqual({ x: 23, y: 7 });
    }
  });
});

/** Every tool that paints into the shared `hoverSnap` slot has to clear it on the way out:
 * the incoming tool only repaints that slot on its *next* pointer move, so otherwise the
 * marker sits frozen on the canvas long after the tool that drew it is gone (the bug
 * textCancel was added for). */
describe('putting a draw tool away', () => {
  it.each([
    ['line', drawLineOnPointerMove, drawLineCancel],
    ['circle', drawCircleOnPointerMove, drawCircleCancel],
    ['arc', drawArcOnPointerMove, drawArcCancel],
  ])('clears the %s tool\'s preview and asks for a repaint', (_name, move, cancel) => {
    const ctx = newCtx();
    move({ x: 23, y: 7 }, ctx);
    expect(ctx.interaction.hoverSnap).not.toBeNull();
    const before = ctx.redraws;

    cancel(ctx);

    expect(ctx.interaction.hoverSnap).toBeNull();
    expect(ctx.redraws).toBeGreaterThan(before);
  });
});

/** The line tool used to commit the snap left behind by the previous pointer-move rather
 * than one computed from the click itself. With a mouse a move almost always precedes the
 * down, so it stayed hidden; a pen/touch tap, or a click straight after a wheel-zoom, has no
 * such move. The arc tool always recomputed — this brings the two in line. */
describe('the line tool commits where the click is', () => {
  it('uses the pointer-down position, not the last pointer-move, for the second click', () => {
    const ctx = newCtx();
    drawLineOnPointerDown({ x: 0, y: 0 }, ctx); // anchor
    drawLineOnPointerMove({ x: 100, y: 0 }, ctx); // a move that the tap below does not repeat
    drawLineOnPointerDown({ x: 43, y: 62 }, ctx); // -> (40, 60): both axes clear of inference

    const { graph } = useSketchStore.getState();
    expect(graph.lines.size).toBe(1);
    const line = [...graph.lines.values()][0];
    expect(graph.points.get(line.startId)).toMatchObject({ x: 0, y: 0 });
    expect(graph.points.get(line.endId)).toMatchObject({ x: 40, y: 60 });
    // ...and the chain continues from the committed end, not from the stale move.
    expect(ctx.interaction.drawLine?.anchor).toMatchObject({ pointId: line.endId, pos: { x: 40, y: 60 } });
  });

  it('still axis-infers and endpoint-snaps from the click position', () => {
    const { graph } = useSketchStore.getState();
    const target = graph.addPoint(37, 0); // off-grid, so an endpoint snap is unmistakable

    const ctx = newCtx();
    drawLineOnPointerDown({ x: 0, y: 60 }, ctx);
    drawLineOnPointerDown({ x: 3, y: 20 }, ctx); // 3 world units off the vertical through the anchor
    expect(graph.points.get([...graph.lines.values()][0].endId)).toMatchObject({ x: 0, y: 20 });
    expect([...graph.lines.values()][0].axisLock).toBe('V');

    drawLineOnPointerDown({ x: 41, y: 4 }, ctx); // within the 10px threshold of the loose point
    const committed = [...graph.lines.values()][1];
    expect(committed.endId).toBe(target.id); // reused the existing point rather than a new one
  });
});
