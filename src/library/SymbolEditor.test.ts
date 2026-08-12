import { describe, expect, it } from 'vitest';
import { SceneGraph } from '../canvas/sceneGraph';
import type { SymbolGeometry } from '../types/geometry';
import { graphToGeometry, localToScreen, populateGraph, screenToLocal } from './SymbolEditor';

/** The editor's persistence path is `SymbolGeometry -> SceneGraph -> SymbolGeometry`:
 * anything lost in that round trip is silently lost from the user's saved symbol, so it's
 * worth pinning down even though the surrounding UI isn't practically unit-testable. */
describe('populateGraph / graphToGeometry', () => {
  const original: SymbolGeometry = {
    points: { a: { x: -10, y: 0 }, b: { x: 10, y: 0 }, c: { x: 0, y: -8 } },
    lines: [['a', 'b']],
    arcs: [{ a: 'b', b: 'c', bulge: 0.5 }],
    ports: ['b', 'a'],
  };

  it('round-trips points, lines, arcs and port order', () => {
    const graph = new SceneGraph();
    populateGraph(graph, original);
    const result = graphToGeometry(graph, original.ports);

    expect(result.points).toEqual(original.points);
    expect(result.lines).toEqual(original.lines);
    expect(result.arcs).toEqual(original.arcs);
    // Port order is connection order downstream, so it must survive verbatim (not sorted).
    expect(result.ports).toEqual(['b', 'a']);
  });

  it('skips edges referencing points that do not exist', () => {
    const graph = new SceneGraph();
    populateGraph(graph, { ...original, lines: [['a', 'b'], ['a', 'missing']] });
    expect(graphToGeometry(graph, original.ports).lines).toEqual([['a', 'b']]);
  });

  it('drops ports whose point was deleted in the editor', () => {
    const graph = new SceneGraph();
    populateGraph(graph, original);
    graph.removePoint('c'); // still used by the arc — refused, so 'c' survives
    expect(graphToGeometry(graph, ['a', 'gone']).ports).toEqual(['a']);
  });
});

describe('localToScreen / screenToLocal', () => {
  it('puts the symbol origin at the canvas centre', () => {
    expect(localToScreen({ x: 0, y: 0 })).toEqual({ x: 240, y: 240 });
  });

  it('inverts itself', () => {
    const local = { x: -7.25, y: 3.5 };
    const round = screenToLocal(localToScreen(local));
    expect(round.x).toBeCloseTo(local.x, 10);
    expect(round.y).toBeCloseTo(local.y, 10);
  });
});
