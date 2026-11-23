import { beforeEach, describe, expect, it } from 'vitest';
import { generatePlaceholderSymbol } from '../library/builtinSymbols';
import { graphToGeometry, populateGraph } from '../library/SymbolEditor';
import { parseSymbolFile, serializeSymbol } from '../io/symbolFormat';
import { parseProjectFile, serializeProject } from '../io/projectFormat';
import type { SymbolGeometry } from '../types/geometry';
import { SceneGraph } from './sceneGraph';
import { strokeWidth } from './renderer';
import { useSketchStore } from './store/useSketchStore';

function twoLineGraph() {
  const g = new SceneGraph();
  const a = g.addPoint(0, 0);
  const b = g.addPoint(10, 0);
  const c = g.addPoint(10, 10);
  const l1 = g.addLine(a.id, b.id)!;
  const l2 = g.addLine(b.id, c.id)!;
  return { g, l1, l2, a, b, c };
}

describe('scene graph line weight', () => {
  it('sets, clears and reports changes', () => {
    const { g, l1, l2 } = twoLineGraph();
    expect(g.setWeight({ lineIds: [l1.id, l2.id] }, 4)).toBe(true);
    expect(g.lines.get(l1.id)!.weight).toBe(4);
    expect(g.setWeight({ lineIds: [l1.id] }, 4)).toBe(false); // already 4
    expect(g.setWeight({ lineIds: [l1.id] }, null)).toBe(true);
    expect('weight' in g.lines.get(l1.id)!).toBe(false); // back to "absent", not undefined
  });

  it('survives toJSON / fromJSON and cloning', () => {
    const { g, l1 } = twoLineGraph();
    g.setWeight({ lineIds: [l1.id] }, 3.5);
    expect(SceneGraph.fromJSON(g.toJSON()).lines.get(l1.id)!.weight).toBe(3.5);
    expect(g.clone().lines.get(l1.id)!.weight).toBe(3.5);
  });

  it('is kept when a line is split', () => {
    const { g, l1 } = twoLineGraph();
    g.setWeight({ lineIds: [l1.id] }, 6);
    g.splitLine(l1.id, { x: 5, y: 0 });
    const weights = [...g.lines.values()].filter((l) => l.id !== undefined).map((l) => l.weight);
    expect(weights.filter((w) => w === 6)).toHaveLength(2);
  });

  it('applies to arcs and component overrides too', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(10, 0);
    const arc = g.addArc(a.id, b.id, 0.5)!;
    const comp = g.addComponent({ categoryId: 'c', tag: 'V-1', position: { x: 50, y: 50 }, rotation: 0, snapshot: { familyName: 'F', categoryName: 'C', symbol: generatePlaceholderSymbol(2) } });
    g.setWeight({ arcIds: [arc.id], componentIds: [comp.id] }, 5);
    expect(g.arcs.get(arc.id)!.weight).toBe(5);
    expect(g.components.get(comp.id)!.lineWeight).toBe(5);
    expect(SceneGraph.fromJSON(g.toJSON()).components.get(comp.id)!.lineWeight).toBe(5);
  });
});

describe('strokeWidth', () => {
  it('defaults to 2 and is a touch heavier when selected', () => {
    expect(strokeWidth(undefined, false)).toBe(2);
    expect(strokeWidth(undefined, true)).toBe(2.5);
    expect(strokeWidth(4, false)).toBe(4);
    expect(strokeWidth(4, true)).toBe(4.5);
  });
});

describe('setSelectionWeight (store)', () => {
  beforeEach(() => useSketchStore.getState().newProject());

  it('changes every selected line and arc in one undoable step', () => {
    const { g, l1, l2 } = twoLineGraph();
    useSketchStore.setState({ graph: g });
    useSketchStore.setState((s) => ({ selection: { ...s.selection, lineIds: new Set([l1.id, l2.id]) } }));
    useSketchStore.getState().setSelectionWeight(4);
    expect(g.lines.get(l1.id)!.weight).toBe(4);
    expect(g.lines.get(l2.id)!.weight).toBe(4);
    useSketchStore.getState().undo();
    const after = useSketchStore.getState().graph;
    expect(after.lines.get(l1.id)!.weight).toBeUndefined();
    expect(after.lines.get(l2.id)!.weight).toBeUndefined();
  });

  it('does not add an undo step when nothing changes', () => {
    const { g, l1 } = twoLineGraph();
    useSketchStore.setState({ graph: g, past: [] });
    useSketchStore.setState((s) => ({ selection: { ...s.selection, lineIds: new Set([l1.id]) } }));
    useSketchStore.getState().setSelectionWeight(null); // already default
    expect(useSketchStore.getState().past).toHaveLength(0);
  });

  it('is carried by copy/paste', () => {
    const { g, l1, a, b } = twoLineGraph();
    g.setWeight({ lineIds: [l1.id] }, 3);
    useSketchStore.setState({ graph: g });
    useSketchStore.setState((s) => ({ selection: { ...s.selection, pointIds: new Set([a.id, b.id]), lineIds: new Set([l1.id]) } }));
    useSketchStore.getState().copySelection();
    useSketchStore.getState().pasteSelection();
    const weights = [...useSketchStore.getState().graph.lines.values()].map((l) => l.weight);
    expect(weights.filter((w) => w === 3)).toHaveLength(2);
  });
});

describe('symbols carry line weight', () => {
  const symbol: SymbolGeometry = {
    points: { a: { x: -10, y: 0 }, b: { x: 10, y: 0 }, c: { x: 0, y: -8 } },
    lines: [['a', 'b', 4], ['b', 'c']],
    arcs: [{ a: 'b', b: 'c', bulge: 0.5, weight: 1 }],
    ports: ['a', 'b'],
  };

  it('round-trips through the editing graph', () => {
    const g = new SceneGraph();
    populateGraph(g, symbol);
    const out = graphToGeometry(g, symbol.ports);
    expect(out.lines).toEqual([['a', 'b', 4], ['b', 'c']]);
    expect(out.arcs[0].weight).toBe(1);
  });

  it('round-trips through a symbol file, and ignores nonsense weights', () => {
    const { file } = parseSymbolFile(serializeSymbol(symbol, { name: 'X', subtype: null, actuation: null }));
    expect(file.geometry.lines).toEqual([['a', 'b', 4], ['b', 'c']]);
    expect(file.geometry.arcs[0].weight).toBe(1);

    const bad = JSON.parse(serializeSymbol(symbol, { name: 'X', subtype: null, actuation: null }));
    bad.geometry.lines[0][2] = 9999;
    bad.geometry.arcs[0].weight = 'thick';
    const parsed = parseSymbolFile(JSON.stringify(bad)).file.geometry;
    expect(parsed.lines[0]).toEqual(['a', 'b']);
    expect(parsed.arcs[0].weight).toBeUndefined();
  });
});

describe('drawings keep weights when saved', () => {
  it('writes and reads them back', () => {
    const { g, l1 } = twoLineGraph();
    g.setWeight({ lineIds: [l1.id] }, 5);
    const file = parseProjectFile(serializeProject(g.toJSON(), 1));
    expect(file.scene.lines.find((l) => l.id === l1.id)!.weight).toBe(5);
  });
});

describe('rotateSelectedComponents', () => {
  beforeEach(() => useSketchStore.getState().newProject());

  const place = () => {
    useSketchStore.getState().placeComponent({ categoryId: 'c', position: { x: 0, y: 0 }, tag: 'V-1', snapshot: { familyName: 'F', categoryName: 'C', symbol: generatePlaceholderSymbol(2) } });
    return [...useSketchStore.getState().graph.components.values()][0];
  };

  it('turns the selected component 45° per call, and a full circle wraps back to 0', () => {
    const c = place();
    useSketchStore.setState((s) => ({ selection: { ...s.selection, componentIds: new Set([c.id]) } }));
    useSketchStore.getState().rotateSelectedComponents(45);
    expect(useSketchStore.getState().graph.components.get(c.id)!.rotation).toBeCloseTo(Math.PI / 4);
    for (let i = 0; i < 7; i++) useSketchStore.getState().rotateSelectedComponents(45);
    expect(useSketchStore.getState().graph.components.get(c.id)!.rotation).toBeCloseTo(0);
    useSketchStore.getState().rotateSelectedComponents(-45);
    expect(useSketchStore.getState().graph.components.get(c.id)!.rotation).toBeCloseTo((7 * Math.PI) / 4);
  });

  it('moves the ports with it, and is one undo step', () => {
    const c = place();
    useSketchStore.setState((s) => ({ selection: { ...s.selection, componentIds: new Set([c.id]) } }));
    const g = () => useSketchStore.getState().graph;
    const portPos = () => {
      const conn = g().components.get(c.id)!.connections[0];
      const p = g().points.get(conn.pointId)!;
      return { x: p.x, y: p.y };
    };
    const start = portPos();
    useSketchStore.getState().rotateSelectedComponents(90);
    const turned = portPos();
    expect(turned.x).toBeCloseTo(-start.y);
    expect(turned.y).toBeCloseTo(start.x);
    useSketchStore.getState().undo();
    expect(portPos().x).toBeCloseTo(start.x);
    expect(g().components.get(c.id)!.rotation).toBeCloseTo(0);
  });

  it('does nothing, and adds no undo step, with no component selected', () => {
    place();
    useSketchStore.setState({ past: [] });
    useSketchStore.setState((s) => ({ selection: { ...s.selection, componentIds: new Set() } }));
    useSketchStore.getState().rotateSelectedComponents(45);
    expect(useSketchStore.getState().past).toHaveLength(0);
  });
});
