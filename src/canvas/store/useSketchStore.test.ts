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
  useSketchStore.setState({ clipboard: null, pasteCount: 0 });
});

describe('copySelection / pasteSelection', () => {
  it('does nothing when nothing is selected', () => {
    useSketchStore.getState().copySelection();
    expect(useSketchStore.getState().clipboard).toBeNull();
  });

  it('copies the selected components and pastes them back offset, with fresh unique tags', () => {
    const { placeComponent } = useSketchStore.getState();
    placeComponent({ categoryId: 'cat1', realPartId: null, position: { x: 0, y: 0 }, tag: 'V-101', snapshot: sampleSnapshot() });
    const placedId = [...useSketchStore.getState().selection.componentIds][0];
    useSketchStore.setState((s) => ({ selection: { ...s.selection, componentIds: new Set([placedId]) } }));

    useSketchStore.getState().copySelection();
    expect(useSketchStore.getState().clipboard?.components).toHaveLength(1);

    useSketchStore.getState().pasteSelection();
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
    useSketchStore.getState().copySelection();

    useSketchStore.getState().pasteSelection();
    useSketchStore.getState().pasteSelection();
    const { graph, selection } = useSketchStore.getState();
    expect(graph.components.size).toBe(3);
    const secondPasteId = [...selection.componentIds][0];
    expect(graph.components.get(secondPasteId)!.position).toEqual({ x: 40, y: 40 });
  });

  it('does nothing when the clipboard is empty', () => {
    const before = useSketchStore.getState().graph.components.size;
    useSketchStore.getState().pasteSelection();
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

    useSketchStore.getState().copySelection();
    useSketchStore.getState().pasteSelection();
    const { graph, selection } = useSketchStore.getState();
    const pasted = graph.components.get([...selection.componentIds][0]!)!;

    expect(pasted.realPartId).toBe('rp1');
    expect(pasted.snapshot.realPart).toEqual(withRealPart.realPart);
    // Independent copy, not a shared reference — editing the pasted specs must not also
    // change the original's.
    expect(pasted.snapshot.realPart).not.toBe(graph.components.get(placedId)!.snapshot.realPart);
  });

  it('copies a selected line along with its endpoints (regression: copy/paste used to only carry components, dropping any pipe segments)', () => {
    const { graph } = useSketchStore.getState();
    const a = graph.addPoint(0, 0);
    const b = graph.addPoint(10, 0);
    const line = graph.addLine(a.id, b.id)!;
    useSketchStore.setState((s) => ({ selection: { ...s.selection, lineIds: new Set([line.id]) } }));

    useSketchStore.getState().copySelection();
    expect(useSketchStore.getState().clipboard?.points).toHaveLength(2);
    expect(useSketchStore.getState().clipboard?.lines).toHaveLength(1);

    useSketchStore.getState().pasteSelection();
    const { selection } = useSketchStore.getState();
    expect(selection.lineIds.size).toBe(1);
    expect(selection.pointIds.size).toBe(2);

    const pastedLine = graph.lines.get([...selection.lineIds][0]!)!;
    const pastedA = graph.points.get(pastedLine.startId)!;
    const pastedB = graph.points.get(pastedLine.endId)!;
    // Offset, fresh ids, but the same relative shape as the original.
    expect(pastedA.id).not.toBe(a.id);
    expect(Math.abs(pastedB.x - pastedA.x)).toBeCloseTo(10);
    expect(pastedA).toMatchObject({ x: 20, y: 20 });
  });

  it('copies an arc, and a mixed component+line selection together as one pasted batch', () => {
    const { graph, placeComponent } = useSketchStore.getState();
    const a = graph.addPoint(0, 0);
    const b = graph.addPoint(10, 0);
    const arc = graph.addArc(a.id, b.id, 0.5)!;
    placeComponent({ categoryId: 'cat1', realPartId: null, position: { x: 100, y: 100 }, tag: 'V-101', snapshot: sampleSnapshot() });
    const componentId = [...useSketchStore.getState().selection.componentIds][0];

    useSketchStore.setState((s) => ({
      selection: { ...s.selection, arcIds: new Set([arc.id]), componentIds: new Set([componentId]) },
    }));
    useSketchStore.getState().copySelection();
    expect(useSketchStore.getState().clipboard?.arcs).toHaveLength(1);
    expect(useSketchStore.getState().clipboard?.components).toHaveLength(1);

    useSketchStore.getState().pasteSelection();
    const { selection } = useSketchStore.getState();
    expect(selection.arcIds.size).toBe(1);
    expect(selection.componentIds.size).toBe(1);
    expect(selection.componentIds.has(componentId)).toBe(false); // a fresh pasted instance, not the original
  });

  it("does not copy a line whose other endpoint isn't also selected/implied", () => {
    const { graph } = useSketchStore.getState();
    const a = graph.addPoint(0, 0);
    const b = graph.addPoint(10, 0);
    const c = graph.addPoint(20, 0);
    graph.addLine(a.id, b.id);
    graph.addLine(b.id, c.id);
    // Select only point b — neither line has *both* endpoints selected.
    useSketchStore.setState((s) => ({ selection: { ...s.selection, pointIds: new Set([b.id]) } }));

    useSketchStore.getState().copySelection();
    expect(useSketchStore.getState().clipboard?.points).toHaveLength(1);
    expect(useSketchStore.getState().clipboard?.lines).toHaveLength(0);
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

describe('selectAll', () => {
  it('selects every point, line, arc and component in the document', () => {
    const { placeComponent, graph } = useSketchStore.getState();
    placeComponent({ categoryId: 'cat1', realPartId: null, position: { x: 0, y: 0 }, tag: 'V-101', snapshot: sampleSnapshot() });
    graph.addPoint(5, 5);
    const [a, b] = [graph.addPoint(0, 10), graph.addPoint(10, 10)];
    graph.addLine(a.id, b.id);

    useSketchStore.getState().selectAll();
    const { selection } = useSketchStore.getState();
    expect(selection.componentIds.size).toBe(1);
    expect(selection.pointIds.size).toBe(graph.points.size);
    expect(selection.lineIds.size).toBe(graph.lines.size);
  });

  it('closes the Library panel, same as any other non-empty selection', () => {
    useSketchStore.setState({ libraryPanelOpen: true });
    useSketchStore.getState().placeComponent({ categoryId: 'cat1', realPartId: null, position: { x: 0, y: 0 }, tag: 'V-101', snapshot: sampleSnapshot() });
    useSketchStore.setState({ libraryPanelOpen: true }); // placeComponent bypasses the auto-close; reset for this test
    useSketchStore.getState().selectAll();
    expect(useSketchStore.getState().libraryPanelOpen).toBe(false);
  });
});
