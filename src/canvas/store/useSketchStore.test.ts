import { beforeEach, describe, expect, it } from 'vitest';
import type { ComponentSnapshot } from '../../types/geometry';
import { generatePlaceholderSymbol } from '../../library/builtinSymbols';
import { useSketchStore } from './useSketchStore';

function sampleSnapshot(portCount = 2): ComponentSnapshot {
  return { familyName: 'Valve', categoryName: 'Test Valve', symbol: generatePlaceholderSymbol(portCount), realPart: null };
}

/** Fresh document + clipboard before every test — the store is a module-level singleton,
 * so state from one test would otherwise leak into the next. */
beforeEach(() => {
  useSketchStore.getState().newProject();
  useSketchStore.setState({ componentClipboard: null, pasteCount: 0 });
});

describe('copySelectedComponents / pasteComponents', () => {
  it('does nothing when no components are selected', () => {
    useSketchStore.getState().copySelectedComponents();
    expect(useSketchStore.getState().componentClipboard).toBeNull();
  });

  it('copies the selected components and pastes them back offset, with fresh unique tags', () => {
    const { placeComponent } = useSketchStore.getState();
    placeComponent({ categoryId: 'cat1', realPartId: null, position: { x: 0, y: 0 }, tag: 'V-101', snapshot: sampleSnapshot() });
    const placedId = [...useSketchStore.getState().selection.componentIds][0];
    useSketchStore.setState((s) => ({ selection: { ...s.selection, componentIds: new Set([placedId]) } }));

    useSketchStore.getState().copySelectedComponents();
    expect(useSketchStore.getState().componentClipboard).toHaveLength(1);

    useSketchStore.getState().pasteComponents();
    const { graph, selection } = useSketchStore.getState();
    expect(graph.components.size).toBe(2);
    expect(selection.componentIds.size).toBe(1);

    const pastedId = [...selection.componentIds][0];
    const pasted = graph.components.get(pastedId)!;
    const original = graph.components.get(placedId)!;
    expect(pasted.position).toEqual({ x: original.position.x + 20, y: original.position.y + 20 });
    expect(pasted.tag).not.toBe(original.tag); // re-tagged, not a duplicate
    expect(pasted.categoryId).toBe(original.categoryId);
  });

  it('cascades the offset further on each repeated paste', () => {
    const { placeComponent } = useSketchStore.getState();
    placeComponent({ categoryId: 'cat1', realPartId: null, position: { x: 0, y: 0 }, tag: 'V-101', snapshot: sampleSnapshot() });
    const placedId = [...useSketchStore.getState().selection.componentIds][0];
    useSketchStore.setState((s) => ({ selection: { ...s.selection, componentIds: new Set([placedId]) } }));
    useSketchStore.getState().copySelectedComponents();

    useSketchStore.getState().pasteComponents();
    useSketchStore.getState().pasteComponents();
    const { graph, selection } = useSketchStore.getState();
    expect(graph.components.size).toBe(3);
    const secondPasteId = [...selection.componentIds][0];
    expect(graph.components.get(secondPasteId)!.position).toEqual({ x: 40, y: 40 });
  });

  it('does nothing when the clipboard is empty', () => {
    const before = useSketchStore.getState().graph.components.size;
    useSketchStore.getState().pasteComponents();
    expect(useSketchStore.getState().graph.components.size).toBe(before);
  });
});
