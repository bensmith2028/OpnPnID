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

  it('carries the assigned real part (manufacturer/model/specs/datasheet) over to the pasted copy', () => {
    const withRealPart: ComponentSnapshot = {
      ...sampleSnapshot(),
      realPart: {
        manufacturer: 'Swagelok',
        modelNumber: 'SS-83XS6',
        datasheetUrl: 'https://example.com/ds.pdf',
        specs: { cv: 2.5, fail_position: 'FC' },
      },
    };
    const { placeComponent } = useSketchStore.getState();
    placeComponent({ categoryId: 'cat1', realPartId: 'rp1', position: { x: 0, y: 0 }, tag: 'V-101', snapshot: withRealPart });
    const placedId = [...useSketchStore.getState().selection.componentIds][0];
    useSketchStore.setState((s) => ({ selection: { ...s.selection, componentIds: new Set([placedId]) } }));

    useSketchStore.getState().copySelectedComponents();
    useSketchStore.getState().pasteComponents();
    const { graph, selection } = useSketchStore.getState();
    const pasted = graph.components.get([...selection.componentIds][0]!)!;

    expect(pasted.realPartId).toBe('rp1');
    expect(pasted.snapshot.realPart).toEqual(withRealPart.realPart);
    // Independent copy, not a shared reference — editing the pasted specs must not also
    // change the original's.
    expect(pasted.snapshot.realPart).not.toBe(graph.components.get(placedId)!.snapshot.realPart);
  });
});

describe('setSelection auto-closing the Library panel', () => {
  it('closes the Library panel when selecting something non-empty', () => {
    useSketchStore.setState({ libraryPanelOpen: true });
    useSketchStore.getState().setSelection({ pointIds: new Set(), lineIds: new Set(['ln1']), arcIds: new Set(), componentIds: new Set() });
    expect(useSketchStore.getState().libraryPanelOpen).toBe(false);
  });

  it('leaves the Library panel open when the resulting selection is empty', () => {
    useSketchStore.setState({ libraryPanelOpen: true });
    useSketchStore.getState().setSelection({ pointIds: new Set(), lineIds: new Set(), arcIds: new Set(), componentIds: new Set() });
    expect(useSketchStore.getState().libraryPanelOpen).toBe(true);
  });

  it('does not reopen the Library panel when it is already closed', () => {
    useSketchStore.setState({ libraryPanelOpen: false });
    useSketchStore.getState().setSelection({ pointIds: new Set(['pt1']), lineIds: new Set(), arcIds: new Set(), componentIds: new Set() });
    expect(useSketchStore.getState().libraryPanelOpen).toBe(false);
  });
});
