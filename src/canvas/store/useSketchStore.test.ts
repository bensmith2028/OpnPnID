import { beforeEach, describe, expect, it } from 'vitest';
import type { ComponentSnapshot } from '../../types/geometry';
import { generatePlaceholderSymbol } from '../../library/builtinSymbols';
import { MIN_SNAP_THRESHOLD_PX, useSketchStore } from './useSketchStore';

function sampleSnapshot(portCount = 2): ComponentSnapshot {
  return { familyName: 'Valve', categoryName: 'Test Valve', symbol: generatePlaceholderSymbol(portCount), realPart: null };
}

/** Fresh document + clipboard before every test — the store is a module-level singleton,
 * so state from one test would otherwise leak into the next. The grid and snap settings are
 * reset for the same reason: `newProject` deliberately leaves them alone (they're workspace
 * preferences, not document content), and the paste offset now depends on the grid. */
beforeEach(() => {
  useSketchStore.getState().newProject();
  useSketchStore.setState({ clipboard: null, pasteCount: 0 });
  useSketchStore.getState().setGridSize(20);
  useSketchStore.getState().setSnapThresholdPx(10);
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

  /** The cascade used to be a hardcoded 20 world units, so on any other grid a copy of
   * on-grid geometry landed off-grid — and the only way back on was to drag it. */
  it('offsets by a whole number of grid cells, so a pasted copy stays on the grid', () => {
    useSketchStore.getState().setGridSize(30);
    const { graph } = useSketchStore.getState();
    const p = graph.addPoint(30, 60); // on the 30 grid
    useSketchStore.setState((s) => ({ selection: { ...s.selection, pointIds: new Set([p.id]) } }));
    useSketchStore.getState().copySelection();

    useSketchStore.getState().pasteSelection();
    const pasted = useSketchStore.getState().graph.points.get([...useSketchStore.getState().selection.pointIds][0]!)!;
    // One cell (30) clears the 20-unit minimum on its own, so that's the whole offset.
    expect(pasted).toMatchObject({ x: 60, y: 90 });
  });

  it('takes as many cells as it needs to stay visible on a fine grid', () => {
    useSketchStore.getState().setGridSize(3);
    const { graph } = useSketchStore.getState();
    const p = graph.addPoint(0, 0);
    useSketchStore.setState((s) => ({ selection: { ...s.selection, pointIds: new Set([p.id]) } }));
    useSketchStore.getState().copySelection();

    useSketchStore.getState().pasteSelection();
    const pasted = useSketchStore.getState().graph.points.get([...useSketchStore.getState().selection.pointIds][0]!)!;
    // 7 cells of 3 = 21, the smallest whole number of cells clearing the 20-unit minimum.
    expect(pasted).toMatchObject({ x: 21, y: 21 });
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

  it('reconnects a copied line to the pasted copy of the component it was attached to (regression: a line touching a component port used to be dropped from the clipboard entirely)', () => {
    const { graph, placeComponent } = useSketchStore.getState();
    placeComponent({ categoryId: 'cat1', realPartId: null, position: { x: 0, y: 0 }, tag: 'V-101', snapshot: sampleSnapshot() });
    const componentId = [...useSketchStore.getState().selection.componentIds][0];
    const instance = graph.components.get(componentId)!;
    const portPointId = instance.connections[0].pointId;

    const free = graph.addPoint(50, 0);
    const line = graph.addLine(portPointId, free.id)!;

    useSketchStore.setState((s) => ({
      selection: { ...s.selection, componentIds: new Set([componentId]), lineIds: new Set([line.id]) },
    }));
    useSketchStore.getState().copySelection();
    expect(useSketchStore.getState().clipboard?.lines).toHaveLength(1); // no longer dropped
    expect(useSketchStore.getState().clipboard?.portRefs).toHaveLength(1);
    // The port itself isn't duplicated as a free point — only the detached end is.
    expect(useSketchStore.getState().clipboard?.points).toHaveLength(1);

    useSketchStore.getState().pasteSelection();
    const { selection } = useSketchStore.getState();
    const pastedComponentId = [...selection.componentIds][0];
    const pastedLine = graph.lines.get([...selection.lineIds][0]!)!;
    const pastedEndIds = [pastedLine.startId, pastedLine.endId];

    // One end of the pasted line is owned by the pasted component (reconnected), the
    // other is a plain detached point (the original free point's pasted copy).
    const ownedEnds = pastedEndIds.filter((id) => graph.componentOwning(id) === pastedComponentId);
    expect(ownedEnds).toHaveLength(1);
    const pastedInstance = graph.components.get(pastedComponentId)!;
    expect(pastedInstance.connections.map((c) => c.pointId)).toContain(ownedEnds[0]);
  });

  it('still copies a line attached to a component port as a (now detached) line when only the line is selected, not the component', () => {
    const { graph, placeComponent } = useSketchStore.getState();
    placeComponent({ categoryId: 'cat1', realPartId: null, position: { x: 0, y: 0 }, tag: 'V-101', snapshot: sampleSnapshot() });
    const componentId = [...useSketchStore.getState().selection.componentIds][0];
    const portPointId = graph.components.get(componentId)!.connections[0].pointId;
    const free = graph.addPoint(50, 0);
    const line = graph.addLine(portPointId, free.id)!;

    useSketchStore.setState((s) => ({ selection: { ...s.selection, componentIds: new Set(), lineIds: new Set([line.id]) } }));
    useSketchStore.getState().copySelection();
    expect(useSketchStore.getState().clipboard?.lines).toHaveLength(1);
    expect(useSketchStore.getState().clipboard?.components).toHaveLength(0);
    expect(useSketchStore.getState().clipboard?.points).toHaveLength(2); // both ends copied as plain points

    useSketchStore.getState().pasteSelection();
    const { selection, graph: g } = useSketchStore.getState();
    const pastedLine = g.lines.get([...selection.lineIds][0]!)!;
    // Neither end is owned by any component — the original component wasn't copied.
    expect(g.componentOwning(pastedLine.startId)).toBeUndefined();
    expect(g.componentOwning(pastedLine.endId)).toBeUndefined();
  });
});

describe('setComponentName', () => {
  /** Places one component and returns its id, selected — the starting point for both
   * tests below. */
  function placeOne(): string {
    useSketchStore.getState().placeComponent({ categoryId: 'cat1', realPartId: null, position: { x: 0, y: 0 }, tag: 'V-101', snapshot: sampleSnapshot() });
    return [...useSketchStore.getState().selection.componentIds][0];
  }

  it('renames through history, so undo/redo restores the previous name', () => {
    const componentId = placeOne();
    useSketchStore.getState().setComponentName(componentId, 'Reactor feed pump');
    expect(useSketchStore.getState().graph.components.get(componentId)!.name).toBe('Reactor feed pump');

    useSketchStore.getState().undo();
    expect(useSketchStore.getState().graph.components.get(componentId)!.name).toBeUndefined();

    useSketchStore.getState().redo();
    expect(useSketchStore.getState().graph.components.get(componentId)!.name).toBe('Reactor feed pump');
  });

  it('carries the name onto a pasted copy verbatim (unlike the tag, which is regenerated)', () => {
    const componentId = placeOne();
    useSketchStore.getState().setComponentName(componentId, 'Reactor feed pump');
    useSketchStore.setState((s) => ({ selection: { ...s.selection, componentIds: new Set([componentId]) } }));

    useSketchStore.getState().copySelection();
    useSketchStore.getState().pasteSelection();
    const { graph, selection } = useSketchStore.getState();
    expect(graph.components.get([...selection.componentIds][0]!)!.name).toBe('Reactor feed pump');
  });
});

/** `snapThresholdPx` is also every tool's hit-test radius (worldThreshold), so the old
 * `Math.max(0, px)` clamp let the toolbar's "Snap px" field lock the user out of their own
 * canvas: at 0 nothing could be picked — no point, edge, component or note — including the
 * field's own value to put it back. */
describe('setSnapThresholdPx', () => {
  it('refuses to go below the floor that keeps things pickable', () => {
    useSketchStore.getState().setSnapThresholdPx(0);
    expect(useSketchStore.getState().snapThresholdPx).toBe(MIN_SNAP_THRESHOLD_PX);
    useSketchStore.getState().setSnapThresholdPx(-5);
    expect(useSketchStore.getState().snapThresholdPx).toBe(MIN_SNAP_THRESHOLD_PX);
  });

  it('passes any value at or above the floor straight through', () => {
    useSketchStore.getState().setSnapThresholdPx(MIN_SNAP_THRESHOLD_PX);
    expect(useSketchStore.getState().snapThresholdPx).toBe(MIN_SNAP_THRESHOLD_PX);
    useSketchStore.getState().setSnapThresholdPx(25);
    expect(useSketchStore.getState().snapThresholdPx).toBe(25);
  });
});

/** Arming is now the *only* thing a category row does while browsing the library — its
 * name button calls this directly (there's no separate "Place" button any more), so what
 * one click leaves behind is worth pinning down. */
describe('armComponent', () => {
  it('switches to the component tool and remembers what to place', () => {
    useSketchStore.getState().armComponent('cat1', null);
    expect(useSketchStore.getState().activeTool).toBe('component');
    expect(useSketchStore.getState().armedComponent).toEqual({ categoryId: 'cat1', realPartId: null });
  });

  it('clears the selection, so the armed click lands on the canvas instead of dragging whatever was selected', () => {
    useSketchStore.setState((s) => ({ selection: { ...s.selection, lineIds: new Set(['ln1']) } }));
    useSketchStore.getState().armComponent('cat1', null);
    expect(useSketchStore.getState().selection.lineIds.size).toBe(0);
  });

  it('re-arms to the newest category when a second row is clicked without placing the first', () => {
    useSketchStore.getState().armComponent('cat1', null);
    useSketchStore.getState().armComponent('cat2', 'part9');
    expect(useSketchStore.getState().armedComponent).toEqual({ categoryId: 'cat2', realPartId: 'part9' });
  });

  it('is disarmed by picking any other tool, so a stray canvas click can\'t drop a component later', () => {
    useSketchStore.getState().armComponent('cat1', null);
    useSketchStore.getState().setTool('select');
    expect(useSketchStore.getState().armedComponent).toBeNull();
  });
});

describe('setSelection auto-closing the Library panel', () => {
  it('closes the Library panel when selecting something non-empty', () => {
    useSketchStore.setState({ libraryPanelOpen: true });
    useSketchStore.getState().setSelection({ pointIds: new Set(), lineIds: new Set(['ln1']), arcIds: new Set(), componentIds: new Set(), textIds: new Set() });
    expect(useSketchStore.getState().libraryPanelOpen).toBe(false);
  });

  it('leaves the Library panel open when the resulting selection is empty', () => {
    useSketchStore.setState({ libraryPanelOpen: true });
    useSketchStore.getState().setSelection({ pointIds: new Set(), lineIds: new Set(), arcIds: new Set(), componentIds: new Set(), textIds: new Set() });
    expect(useSketchStore.getState().libraryPanelOpen).toBe(true);
  });

  it('does not reopen the Library panel when it is already closed', () => {
    useSketchStore.setState({ libraryPanelOpen: false });
    useSketchStore.getState().setSelection({ pointIds: new Set(['pt1']), lineIds: new Set(), arcIds: new Set(), componentIds: new Set(), textIds: new Set() });
    expect(useSketchStore.getState().libraryPanelOpen).toBe(false);
  });
});

describe('selectAll', () => {
  it('selects every point, line, arc, component and text annotation in the document', () => {
    const { placeComponent, graph } = useSketchStore.getState();
    placeComponent({ categoryId: 'cat1', realPartId: null, position: { x: 0, y: 0 }, tag: 'V-101', snapshot: sampleSnapshot() });
    graph.addPoint(5, 5);
    const [a, b] = [graph.addPoint(0, 10), graph.addPoint(10, 10)];
    graph.addLine(a.id, b.id);
    graph.addText(30, 30, 'Feed header', 12);

    useSketchStore.getState().selectAll();
    const { selection } = useSketchStore.getState();
    expect(selection.componentIds.size).toBe(1);
    expect(selection.pointIds.size).toBe(graph.points.size);
    expect(selection.lineIds.size).toBe(graph.lines.size);
    expect(selection.textIds.size).toBe(1);
  });

  it('closes the Library panel, same as any other non-empty selection', () => {
    useSketchStore.setState({ libraryPanelOpen: true });
    useSketchStore.getState().placeComponent({ categoryId: 'cat1', realPartId: null, position: { x: 0, y: 0 }, tag: 'V-101', snapshot: sampleSnapshot() });
    useSketchStore.setState({ libraryPanelOpen: true }); // placeComponent bypasses the auto-close; reset for this test
    useSketchStore.getState().selectAll();
    expect(useSketchStore.getState().libraryPanelOpen).toBe(false);
  });
});

describe('text annotations', () => {
  it('places a note, selects it, and makes the placement undoable', () => {
    useSketchStore.getState().addText({ x: 10, y: 20 }, 'Feed header');
    const { graph, selection } = useSketchStore.getState();
    expect(graph.texts.size).toBe(1);
    expect(selection.textIds.size).toBe(1);

    useSketchStore.getState().undo();
    expect(useSketchStore.getState().graph.texts.size).toBe(0);
    useSketchStore.getState().redo();
    expect(useSketchStore.getState().graph.texts.size).toBe(1);
  });

  it('ignores a blank note rather than placing an invisible one', () => {
    useSketchStore.getState().addText({ x: 0, y: 0 }, '   ');
    expect(useSketchStore.getState().graph.texts.size).toBe(0);
    expect(useSketchStore.getState().past).toHaveLength(0);
  });

  it('deletes selected notes along with the rest of the selection', () => {
    const { graph } = useSketchStore.getState();
    const a = graph.addPoint(0, 0);
    const b = graph.addPoint(10, 0);
    const line = graph.addLine(a.id, b.id)!;
    const note = graph.addText(30, 30, 'Feed header', 12);
    useSketchStore.getState().setSelection({
      pointIds: new Set(),
      lineIds: new Set([line.id]),
      arcIds: new Set(),
      componentIds: new Set(),
      textIds: new Set([note.id]),
    });

    useSketchStore.getState().deleteSelection();
    expect(useSketchStore.getState().graph.texts.size).toBe(0);
    expect(useSketchStore.getState().graph.lines.size).toBe(0);
  });

  it('copies and pastes a note at the cascading offset, with its own size preserved', () => {
    const { graph } = useSketchStore.getState();
    const note = graph.addText(0, 0, 'Feed header', 8);
    useSketchStore.setState((s) => ({ selection: { ...s.selection, textIds: new Set([note.id]) } }));

    useSketchStore.getState().copySelection();
    expect(useSketchStore.getState().clipboard?.texts).toHaveLength(1);

    useSketchStore.getState().pasteSelection();
    const { selection } = useSketchStore.getState();
    expect(graph.texts.size).toBe(2);
    const pasted = graph.texts.get([...selection.textIds][0])!;
    expect(pasted).toMatchObject({ x: 20, y: 20, text: 'Feed header', fontSize: 8 });
  });
});
