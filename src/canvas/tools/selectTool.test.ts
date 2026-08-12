import { beforeEach, describe, expect, it } from 'vitest';
import { generatePlaceholderSymbol } from '../../library/builtinSymbols';
import type { ComponentSnapshot } from '../../types/geometry';
import { useSketchStore } from '../store/useSketchStore';
import { createInteractionState } from './types';
import { selectOnPointerDown, selectOnPointerMove, selectOnPointerUp } from './selectTool';

function sampleSnapshot(): ComponentSnapshot {
  return { familyName: 'Valve', categoryName: 'Test Valve', symbol: generatePlaceholderSymbol(2), realPart: null };
}

function newCtx() {
  return { interaction: createInteractionState(), requestRedraw: () => {} };
}

/** Fresh document before every test — the store is a module-level singleton. */
beforeEach(() => {
  useSketchStore.getState().newProject();
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
