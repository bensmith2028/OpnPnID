import { beforeEach, describe, expect, it } from 'vitest';
import { generatePlaceholderSymbol } from '../../library/builtinSymbols';
import type { ComponentSnapshot, Vec2 } from '../../types/geometry';
import { componentLabelAnchor } from '../componentLabels';
import { useSketchStore } from '../store/useSketchStore';
import { createInteractionState } from './types';
import { selectOnPointerDown, selectOnPointerMove, selectOnPointerUp } from './selectTool';
import { textPlacementPoint } from './textTool';

function sampleSnapshot(): ComponentSnapshot {
  return { familyName: 'Valve', categoryName: 'Test Valve', symbol: generatePlaceholderSymbol(2), realPart: null };
}

function newCtx() {
  return { interaction: createInteractionState(), requestRedraw: () => {} };
}

/** Fresh document, neutral camera and default snap threshold before every test — the store
 * is a module-level singleton, and `newProject` deliberately leaves all three alone (a new
 * drawing keeps your view and your preferences), so a zoom or threshold test would otherwise
 * leak into everything after it. */
beforeEach(() => {
  useSketchStore.getState().newProject();
  useSketchStore.getState().setCamera({ x: 0, y: 0, zoom: 1 });
  useSketchStore.getState().setSnapThresholdPx(10);
});

describe('multi-component group drag (regression: copy/paste then dragging used to move only one of the pasted components)', () => {
  it('drags every selected component together by the same delta, and leaves the selection intact', () => {
    const { placeComponent } = useSketchStore.getState();
    placeComponent({ categoryId: 'cat1', realPartId: null, position: { x: 0, y: 0 }, tag: 'V-101', snapshot: sampleSnapshot() });
    const id1 = [...useSketchStore.getState().selection.componentIds][0];
    placeComponent({ categoryId: 'cat1', realPartId: null, position: { x: 50, y: 0 }, tag: 'V-102', snapshot: sampleSnapshot() });
    const id2 = [...useSketchStore.getState().selection.componentIds][0];

    // Simulate "select both" (what copySelection/pasteSelection leaves behind).
    useSketchStore.setState((s) => ({ selection: { ...s.selection, componentIds: new Set([id1, id2]) } }));

    const ctx = newCtx();
    selectOnPointerDown({ x: 0, y: 0 }, false, ctx); // clicks directly on component 1
    // Clicking a member of a multi-selection must not collapse it down to just that one.
    expect(useSketchStore.getState().selection.componentIds).toEqual(new Set([id1, id2]));

    selectOnPointerMove({ x: 23, y: 7 }, ctx); // grid is 20 -> quantizes to (20, 0)
    selectOnPointerUp(ctx);

    const { graph, selection } = useSketchStore.getState();
    expect(graph.components.get(id1)!.position).toEqual({ x: 20, y: 0 });
    expect(graph.components.get(id2)!.position).toEqual({ x: 70, y: 0 }); // moved by the same delta
    expect(selection.componentIds).toEqual(new Set([id1, id2])); // still both selected afterward
  });

  it('still does a normal single-component drag when clicking something outside the current selection', () => {
    const { placeComponent } = useSketchStore.getState();
    placeComponent({ categoryId: 'cat1', realPartId: null, position: { x: 0, y: 0 }, tag: 'V-101', snapshot: sampleSnapshot() });
    const id1 = [...useSketchStore.getState().selection.componentIds][0];
    placeComponent({ categoryId: 'cat1', realPartId: null, position: { x: 50, y: 0 }, tag: 'V-102', snapshot: sampleSnapshot() });
    const id2 = [...useSketchStore.getState().selection.componentIds][0];

    useSketchStore.setState((s) => ({ selection: { ...s.selection, componentIds: new Set([id1, id2]) } }));

    const ctx = newCtx();
    // Clicking empty space first, then component 1, mimics a plain (non-multi) click.
    useSketchStore.getState().clearSelection();
    selectOnPointerDown({ x: 0, y: 0 }, false, ctx);
    expect(useSketchStore.getState().selection.componentIds).toEqual(new Set([id1])); // collapsed to just this one

    selectOnPointerMove({ x: 23, y: 7 }, ctx);
    selectOnPointerUp(ctx);

    const { graph } = useSketchStore.getState();
    expect(graph.components.get(id1)!.position).not.toEqual({ x: 0, y: 0 });
    expect(graph.components.get(id2)!.position).toEqual({ x: 50, y: 0 }); // untouched
  });
});

describe('text annotations under the Select tool', () => {
  it('selects a note by clicking its glyphs and drags it, grid-quantized, in one undoable step', () => {
    const { graph } = useSketchStore.getState();
    const note = graph.addText(0, 0, 'Feed header', 12);

    const ctx = newCtx();
    // Well right of the anchor but still inside the note's box — a note is grabbed
    // anywhere on its text, not only at its centre.
    selectOnPointerDown({ x: 20, y: 0 }, false, ctx);
    expect(useSketchStore.getState().selection.textIds).toEqual(new Set([note.id]));

    selectOnPointerMove({ x: 43, y: 7 }, ctx); // grid is 20 -> quantizes to (20, 0)
    selectOnPointerUp(ctx);

    expect(graph.texts.get(note.id)).toMatchObject({ x: 20, y: 0 });
    useSketchStore.getState().undo();
    expect(useSketchStore.getState().graph.texts.get(note.id)).toMatchObject({ x: 0, y: 0 });
  });

  it('drags a note along with the rest of a multi-item selection', () => {
    const { graph } = useSketchStore.getState();
    const point = graph.addPoint(0, 0);
    const note = graph.addText(0, 0, 'Feed header', 12);
    useSketchStore.setState((s) => ({ selection: { ...s.selection, pointIds: new Set([point.id]), textIds: new Set([note.id]) } }));

    const ctx = newCtx();
    selectOnPointerDown({ x: 0, y: 0 }, false, ctx); // on both; a multi-selection drags as a group
    selectOnPointerMove({ x: 23, y: 7 }, ctx);
    selectOnPointerUp(ctx);

    expect(graph.points.get(point.id)).toMatchObject({ x: 20, y: 0 });
    expect(graph.texts.get(note.id)).toMatchObject({ x: 20, y: 0 });
  });

  it('never drops a dragged note onto an existing point, and lands it where placing it there would have', () => {
    const { graph } = useSketchStore.getState();
    // Off-grid and well inside the snap threshold of where the note is headed: if either
    // path endpoint-snapped, the note would land on (23, 5) and bury the vertex it labels.
    graph.addPoint(23, 5);
    const note = graph.addText(0, 0, 'Feed header', 12);

    const ctx = newCtx();
    selectOnPointerDown({ x: 0, y: 0 }, false, ctx);
    selectOnPointerMove({ x: 23, y: 7 }, ctx);
    selectOnPointerUp(ctx);

    expect(graph.texts.get(note.id)).toMatchObject({ x: 20, y: 0 });
    // Dragging a note and placing one have to give the same answer, or a note jumps the
    // first time you nudge it.
    expect(textPlacementPoint({ x: 23, y: 7 }, ctx)).toEqual({ x: 20, y: 0 });
  });

  it('catches notes in a marquee by their anchor, like components', () => {
    const { graph } = useSketchStore.getState();
    const inside = graph.addText(10, 10, 'Inside', 12);
    graph.addText(500, 500, 'Outside', 12);

    const ctx = newCtx();
    selectOnPointerDown({ x: -5, y: -5 }, false, ctx); // empty space -> marquee
    selectOnPointerMove({ x: 100, y: 100 }, ctx);
    selectOnPointerUp(ctx);

    expect(useSketchStore.getState().selection.textIds).toEqual(new Set([inside.id]));
  });
});

describe('dragging a component label out of the way', () => {
  /** Places a component and returns it plus the world point its tag is currently drawn at,
   * so a test can click the label where it actually appears rather than hard-coding an
   * offset that the automatic placement is free to change. */
  function placedWithTagAt(position: Vec2, tag = 'V-101') {
    useSketchStore.getState().placeComponent({ categoryId: 'cat1', realPartId: null, position, tag, snapshot: sampleSnapshot() });
    const id = [...useSketchStore.getState().selection.componentIds][0];
    const { graph, componentScale, camera } = useSketchStore.getState();
    const instance = graph.components.get(id)!;
    return { id, instance, tagAt: componentLabelAnchor(instance, 'tag', componentScale, camera.zoom) };
  }

  it('moves the label alone, leaving the component and its ports where they were', () => {
    const { id, tagAt } = placedWithTagAt({ x: 0, y: 0 });
    const portsBefore = useSketchStore
      .getState()
      .graph.components.get(id)!
      .connections.map((c) => ({ ...useSketchStore.getState().graph.points.get(c.pointId)! }));

    const ctx = newCtx();
    selectOnPointerDown(tagAt, false, ctx);
    expect(useSketchStore.getState().selection.componentIds).toEqual(new Set([id])); // the component, not "the label"

    selectOnPointerMove({ x: tagAt.x + 33, y: tagAt.y - 7 }, ctx);
    selectOnPointerUp(ctx);

    const instance = useSketchStore.getState().graph.components.get(id)!;
    expect(instance.position).toEqual({ x: 0, y: 0 });
    expect(instance.connections.map((c) => ({ ...useSketchStore.getState().graph.points.get(c.pointId)! }))).toEqual(portsBefore);
    // Free positioning, not grid-quantized: the raw delta is what a label needs to clear
    // something by less than a grid cell.
    const { componentScale, camera } = useSketchStore.getState();
    expect(componentLabelAnchor(instance, 'tag', componentScale, camera.zoom)).toEqual({ x: tagAt.x + 33, y: tagAt.y - 7 });
  });

  it('is grabbed from where it is drawn, so the first move does not jump it onto the component', () => {
    const { id, tagAt } = placedWithTagAt({ x: 0, y: 0 });

    const ctx = newCtx();
    selectOnPointerDown(tagAt, false, ctx);
    selectOnPointerMove(tagAt, ctx); // pointer hasn't actually moved

    const { graph, componentScale, camera } = useSketchStore.getState();
    expect(componentLabelAnchor(graph.components.get(id)!, 'tag', componentScale, camera.zoom)).toEqual(tagAt);
  });

  it('takes the click ahead of the body when a dragged label ends up over one, and undoes in one step', () => {
    const { id, tagAt } = placedWithTagAt({ x: 0, y: 0 });

    const ctx = newCtx();
    // Drag the tag right onto the component's own body — the case where the two hit tests
    // genuinely compete.
    selectOnPointerDown(tagAt, false, ctx);
    selectOnPointerMove({ x: 0, y: 0 }, ctx);
    selectOnPointerUp(ctx);
    expect(useSketchStore.getState().graph.components.get(id)!.tagOffset).toEqual({ x: 0, y: 0 });

    // Now clicking there grabs the label again, not the component underneath it.
    selectOnPointerDown({ x: 0, y: 0 }, false, ctx);
    selectOnPointerMove({ x: 12, y: 0 }, ctx);
    selectOnPointerUp(ctx);
    expect(useSketchStore.getState().graph.components.get(id)!.position).toEqual({ x: 0, y: 0 });
    expect(useSketchStore.getState().graph.components.get(id)!.tagOffset).toEqual({ x: 12, y: 0 });

    // One undo per drag, and the offsets in the history are snapshots — not aliases of the
    // live instance the drag mutated.
    useSketchStore.getState().undo();
    expect(useSketchStore.getState().graph.components.get(id)!.tagOffset).toEqual({ x: 0, y: 0 });
    useSketchStore.getState().undo();
    expect(useSketchStore.getState().graph.components.get(id)!.tagOffset).toBeUndefined();
  });

  it('drags a name label independently of the tag', () => {
    const { id, tagAt } = placedWithTagAt({ x: 0, y: 0 });
    useSketchStore.getState().setComponentName(id, 'Feed pump');
    const { graph, componentScale, camera } = useSketchStore.getState();
    const nameAt = componentLabelAnchor(graph.components.get(id)!, 'name', componentScale, camera.zoom);

    const ctx = newCtx();
    selectOnPointerDown(nameAt, false, ctx);
    selectOnPointerMove({ x: nameAt.x + 15, y: nameAt.y + 4 }, ctx);
    selectOnPointerUp(ctx);

    const instance = useSketchStore.getState().graph.components.get(id)!;
    expect(instance.nameOffset).toBeTruthy();
    expect(instance.tagOffset).toBeUndefined(); // the tag stayed on its automatic placement
    expect(componentLabelAnchor(instance, 'tag', componentScale, camera.zoom)).toEqual(tagAt);
  });

  it('resets a dragged label back to the automatic placement', () => {
    const { id, tagAt } = placedWithTagAt({ x: 0, y: 0 });

    const ctx = newCtx();
    selectOnPointerDown(tagAt, false, ctx);
    selectOnPointerMove({ x: tagAt.x + 40, y: tagAt.y }, ctx);
    selectOnPointerUp(ctx);

    useSketchStore.getState().resetComponentLabelOffsets(id);
    const { graph, componentScale, camera } = useSketchStore.getState();
    expect(componentLabelAnchor(graph.components.get(id)!, 'tag', componentScale, camera.zoom)).toEqual(tagAt);
  });

  it('carries custom label placements through copy/paste', () => {
    const { id, tagAt } = placedWithTagAt({ x: 0, y: 0 });

    const ctx = newCtx();
    selectOnPointerDown(tagAt, false, ctx);
    selectOnPointerMove({ x: tagAt.x + 40, y: tagAt.y }, ctx);
    selectOnPointerUp(ctx);
    const offset = { ...useSketchStore.getState().graph.components.get(id)!.tagOffset! };

    useSketchStore.getState().copySelection();
    useSketchStore.getState().pasteSelection();

    const pastedId = [...useSketchStore.getState().selection.componentIds][0];
    expect(pastedId).not.toBe(id);
    expect(useSketchStore.getState().graph.components.get(pastedId)!.tagOffset).toEqual(offset);
  });

  it('leaves labels alone when a click lands on the component body itself', () => {
    const { id } = placedWithTagAt({ x: 0, y: 0 });

    const ctx = newCtx();
    selectOnPointerDown({ x: 0, y: 0 }, false, ctx);
    selectOnPointerMove({ x: 23, y: 7 }, ctx);
    selectOnPointerUp(ctx);

    const instance = useSketchStore.getState().graph.components.get(id)!;
    expect(instance.position).toEqual({ x: 20, y: 0 }); // the component moved, as before
    expect(instance.tagOffset).toBeUndefined(); // and its labels came along on the automatic placement
  });
});

/** Dragging a line/arc by its *body* used to apply the raw pointer delta while dragging the
 * same edge's *endpoint* ran a full snap search — so an edge nudged sideways came off the
 * grid entirely and could never be put back except by dragging each end. It now quantizes
 * the delta, the same way a group drag does, and for the same reason: two anchors move at
 * once, so there's no single point to search from. */
describe('dragging a line or arc by its body', () => {
  function lineFromOriginTo(x: number, y: number) {
    const { graph } = useSketchStore.getState();
    const a = graph.addPoint(0, 0);
    const b = graph.addPoint(x, y);
    const line = graph.addLine(a.id, b.id, null)!;
    return { graph, a, b, line };
  }

  it('grid-snaps the drag delta instead of applying the raw pointer offset', () => {
    const { graph, a, b } = lineFromOriginTo(60, 0);

    const ctx = newCtx();
    selectOnPointerDown({ x: 30, y: 0 }, false, ctx); // on the body, far from both endpoints
    selectOnPointerMove({ x: 43, y: 7 }, ctx); // delta (13, 7) -> quantizes to (20, 0)
    selectOnPointerUp(ctx);

    expect(graph.points.get(a.id)).toMatchObject({ x: 20, y: 0 });
    expect(graph.points.get(b.id)).toMatchObject({ x: 80, y: 0 });
  });

  it('snaps the offset, not each endpoint, so an off-grid edge keeps its length and angle', () => {
    const { graph, a, b } = lineFromOriginTo(37, 11); // neither end sits on the grid

    const ctx = newCtx();
    selectOnPointerDown({ x: 18.5, y: 5.5 }, false, ctx);
    selectOnPointerMove({ x: 38.5, y: 5.5 }, ctx); // delta (20, 0) — already a whole cell
    selectOnPointerUp(ctx);

    expect(graph.points.get(a.id)).toMatchObject({ x: 20, y: 0 });
    expect(graph.points.get(b.id)).toMatchObject({ x: 57, y: 11 }); // shape preserved
  });

  it('places freehand under Alt, the only escape hatch left now that the grid is ungated', () => {
    const { graph, a, b } = lineFromOriginTo(60, 0);

    const ctx = newCtx();
    ctx.interaction.altHeld = true;
    selectOnPointerDown({ x: 30, y: 0 }, false, ctx);
    selectOnPointerMove({ x: 43, y: 7 }, ctx);
    selectOnPointerUp(ctx);

    expect(graph.points.get(a.id)).toMatchObject({ x: 13, y: 7 });
    expect(graph.points.get(b.id)).toMatchObject({ x: 73, y: 7 });
  });
});

/** The grid snap used to be gated on the same world threshold as the endpoint snap, so it
 * quietly stopped firing as you zoomed in — the threshold is a fixed screen-pixel count
 * divided by zoom, the grid a fixed world-unit spacing. These drive the real store camera so
 * `worldThreshold()` is genuinely exercised at zoom ≠ 1. */
describe('snapping under zoom, and the Alt escape hatch', () => {
  it('grid-snaps a dragged point at a zoom where the old threshold could never reach', () => {
    const { graph } = useSketchStore.getState();
    const p = graph.addPoint(0, 0);
    useSketchStore.getState().setCamera({ x: 0, y: 0, zoom: 4 }); // threshold: 10px -> 2.5 world units

    const ctx = newCtx();
    selectOnPointerDown({ x: 0, y: 0 }, false, ctx);
    selectOnPointerMove({ x: 10, y: 10 }, ctx); // 14.1 world units from (20, 20): far outside 2.5

    expect(ctx.interaction.hoverSnap?.type).toBe('grid'); // read before pointer-up clears it
    selectOnPointerUp(ctx);
    expect(graph.points.get(p.id)).toMatchObject({ x: 20, y: 20 });
  });

  it('keeps the endpoint snap zoom-sensitive: the same gap that snaps at 1x is out of reach at 4x', () => {
    const { graph } = useSketchStore.getState();
    const target = graph.addPoint(37, 0); // off-grid, so an endpoint snap is unmistakable
    const dragged = graph.addPoint(200, 200);

    const ctx = newCtx();
    selectOnPointerDown({ x: 200, y: 200 }, false, ctx);
    selectOnPointerMove({ x: 43, y: 0 }, ctx); // 6 world units from the target point
    expect(graph.points.get(dragged.id)).toMatchObject({ x: 37, y: 0 }); // 6 <= 10 -> endpoint

    useSketchStore.getState().setCamera({ x: 0, y: 0, zoom: 4 });
    selectOnPointerMove({ x: 43, y: 0 }, ctx); // 24px away on screen now — too far to mean it
    expect(graph.points.get(dragged.id)).toMatchObject({ x: 40, y: 0 }); // grid catches it instead
    expect(graph.points.get(target.id)).toMatchObject({ x: 37, y: 0 }); // untouched
    selectOnPointerUp(ctx);
  });

  it('honours Alt end-to-end for a point drag and a group drag', () => {
    const { graph } = useSketchStore.getState();
    const p = graph.addPoint(0, 0);

    const ctx = newCtx();
    ctx.interaction.altHeld = true;
    selectOnPointerDown({ x: 0, y: 0 }, false, ctx);
    selectOnPointerMove({ x: 13, y: 7 }, ctx);
    // No indicator under Alt is the signal that the next placement is freehand; pointer-up
    // clears the slot, so this has to be read mid-drag.
    expect(ctx.interaction.hoverSnap?.type).toBe('free');
    selectOnPointerUp(ctx);
    expect(graph.points.get(p.id)).toMatchObject({ x: 13, y: 7 });

    const q = graph.addPoint(100, 100);
    useSketchStore.setState((s) => ({ selection: { ...s.selection, pointIds: new Set([p.id, q.id]) } }));
    selectOnPointerDown({ x: 13, y: 7 }, false, ctx); // member of a multi-selection -> group drag
    selectOnPointerMove({ x: 16, y: 10 }, ctx);
    selectOnPointerUp(ctx);
    expect(graph.points.get(p.id)).toMatchObject({ x: 16, y: 10 });
    expect(graph.points.get(q.id)).toMatchObject({ x: 103, y: 103 });
  });
});

/** A point is picked anywhere within the hit-test radius, so the click that grabs it is
 * usually a few pixels off it. The drag used to hand the raw cursor to computeSnap, which
 * teleported the point onto the cursor on the first move — a jump of up to the whole pick
 * radius, and with the grid ungated enough to fling an already-on-grid point into the next
 * cell for a nudge that meant nothing. Every other drag kind keeps its grab offset. */
describe('dragging a point keeps the grab offset', () => {
  it('moves the point by the pointer delta, not onto the pointer', () => {
    const { graph } = useSketchStore.getState();
    const p = graph.addPoint(0, 0);

    const ctx = newCtx();
    selectOnPointerDown({ x: 9, y: 0 }, false, ctx); // grabbed 9 units off-centre, inside the 10px radius
    selectOnPointerMove({ x: 13, y: 0 }, ctx); // a 4-unit nudge: the point should not move a whole cell
    expect(graph.points.get(p.id)).toMatchObject({ x: 0, y: 0 });

    selectOnPointerMove({ x: 31, y: 3 }, ctx); // delta (22, 3) -> grid-snaps to (20, 0)
    selectOnPointerUp(ctx);
    expect(graph.points.get(p.id)).toMatchObject({ x: 20, y: 0 });
  });

  it('endpoint-snaps on where the dragged point lands, not on where the cursor is', () => {
    const { graph } = useSketchStore.getState();
    graph.addPoint(103, 1); // off-grid, so an endpoint snap is unmistakable
    const dragged = graph.addPoint(0, 0);

    const ctx = newCtx();
    selectOnPointerDown({ x: 9, y: 0 }, false, ctx);
    selectOnPointerMove({ x: 112, y: 2 }, ctx); // point lands at (103, 2) — 1 unit from the target
    expect(graph.points.get(dragged.id)).toMatchObject({ x: 103, y: 1 });

    selectOnPointerUp(ctx); // the merge the endpoint snap set up still happens
    expect(graph.points.size).toBe(1); // the two collapsed into one
    expect(graph.points.get(dragged.id)).toMatchObject({ x: 103, y: 1 });
  });
});

/** "Snap px" is the hit-test radius as well as the snap radius, and used to accept 0 —
 * which left nothing on the canvas selectable, including the setting itself. It's now
 * floored; this is the end-to-end half of the store's clamp test. */
describe('picking things at the smallest allowed snap threshold', () => {
  it('still selects a point, an edge and a note after "Snap px" is driven to zero', () => {
    const { graph } = useSketchStore.getState();
    const a = graph.addPoint(0, 0);
    const b = graph.addPoint(60, 0);
    const line = graph.addLine(a.id, b.id, null)!;
    const note = graph.addText(0, 60, 'Feed header', 12);
    useSketchStore.getState().setSnapThresholdPx(0);

    const ctx = newCtx();
    selectOnPointerDown({ x: 0, y: 0 }, false, ctx); // dead on the point
    expect(useSketchStore.getState().selection.pointIds).toEqual(new Set([a.id]));
    selectOnPointerUp(ctx);

    selectOnPointerDown({ x: 30, y: 0 }, false, ctx); // on the line's body
    expect(useSketchStore.getState().selection.lineIds).toEqual(new Set([line.id]));
    selectOnPointerUp(ctx);

    selectOnPointerDown({ x: 0, y: 60 }, false, ctx); // on the note's anchor
    expect(useSketchStore.getState().selection.textIds).toEqual(new Set([note.id]));
    selectOnPointerUp(ctx);
  });
});

/** `hoverSnap` is shared by every tool that previews a position, and the Select tool has no
 * hover preview of its own to repaint it — so a marker left behind after a drag stayed on
 * screen, pointing at where that drag ended, until another tool took the slot over. The
 * point drag already cleared it; the component drag (the other kind that writes it) didn't. */
describe('the snap indicator after a drag', () => {
  it('clears the leftover marker on pointer-up for a component drag, like a point drag', () => {
    const { placeComponent } = useSketchStore.getState();
    placeComponent({ categoryId: 'cat1', realPartId: null, position: { x: 0, y: 0 }, tag: 'V-101', snapshot: sampleSnapshot() });

    const ctx = newCtx();
    selectOnPointerDown({ x: 0, y: 0 }, false, ctx);
    selectOnPointerMove({ x: 23, y: 7 }, ctx);
    expect(ctx.interaction.hoverSnap).not.toBeNull(); // drawn while the drag is live

    selectOnPointerUp(ctx);
    expect(ctx.interaction.hoverSnap).toBeNull();
  });
});
