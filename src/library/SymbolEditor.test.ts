import { describe, expect, it } from 'vitest';
import { SceneGraph } from '../canvas/sceneGraph';
import type { SymbolGeometry } from '../types/geometry';
import {
  circleArcEndpoints,
  graphToGeometry,
  localToScreen,
  normalizeRect,
  pointInRect,
  populateGraph,
  screenToLocal,
  selectInsideRect,
} from './SymbolEditor';

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

describe('circleArcEndpoints', () => {
  it('returns a diameter through the clicked rim point', () => {
    const { radius, a, b } = circleArcEndpoints({ x: 2, y: -3 }, { x: 6, y: -3 });
    expect(radius).toBeCloseTo(4);
    // The clicked point survives verbatim, so the circle passes exactly through it.
    expect(a).toEqual({ x: 6, y: -3 });
    // ...and its opposite is the reflection through the centre.
    expect(b).toEqual({ x: -2, y: -3 });
  });

  it('builds a full circle as two bulge=1 arcs sharing both endpoints', () => {
    const graph = new SceneGraph();
    const { radius, a, b } = circleArcEndpoints({ x: 0, y: 0 }, { x: 0, y: -5 });
    const pa = graph.addPoint(a.x, a.y, 'p0');
    const pb = graph.addPoint(b.x, b.y, 'p1');
    graph.addArc(pa.id, pb.id, 1, 'a0');
    graph.addArc(pb.id, pa.id, 1, 'a1');

    expect(radius).toBeCloseTo(5);
    for (const arc of graph.arcs.values()) {
      const geo = graph.getArcGeometry(arc);
      expect(geo.center.x).toBeCloseTo(0);
      expect(geo.center.y).toBeCloseTo(0);
      expect(geo.radius).toBeCloseTo(5);
    }
  });
});

describe('marquee selection', () => {
  const rect = normalizeRect({ x: 6, y: 6 }, { x: -6, y: -6 }); // dragged up-left

  it('normalizes corner order', () => {
    expect(rect).toEqual({ x0: -6, y0: -6, x1: 6, y1: 6 });
  });

  it('counts the boundary as inside', () => {
    expect(pointInRect({ x: 6, y: -6 }, rect)).toBe(true);
    expect(pointInRect({ x: 6.01, y: 0 }, rect)).toBe(false);
  });

  it('takes only edges with both endpoints inside', () => {
    const graph = new SceneGraph();
    populateGraph(graph, {
      points: { a: { x: -2, y: 0 }, b: { x: 2, y: 0 }, far: { x: 20, y: 0 } },
      lines: [
        ['a', 'b'],
        ['b', 'far'],
      ],
      arcs: [{ a: 'a', b: 'far', bulge: 0.5 }],
      ports: [],
    });
    const sel = selectInsideRect(graph, rect, { points: new Set(), lines: new Set(), arcs: new Set() });

    expect([...sel.points].sort()).toEqual(['a', 'b']);
    // 'b'->'far' only half overlaps the marquee, so neither it nor the arc is picked up.
    expect(sel.lines.size).toBe(1);
    expect(sel.arcs.size).toBe(0);
  });

  it('extends the selection it is given rather than replacing it', () => {
    const graph = new SceneGraph();
    graph.addPoint(0, 0, 'inside');
    const base = { points: new Set(['kept']), lines: new Set<string>(), arcs: new Set<string>() };
    expect([...selectInsideRect(graph, rect, base).points].sort()).toEqual(['inside', 'kept']);
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
