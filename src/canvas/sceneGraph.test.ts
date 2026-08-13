import { describe, expect, it } from 'vitest';
import type { ComponentSnapshot } from '../types/geometry';
import { generatePlaceholderSymbol } from '../library/builtinSymbols';
import { arcTangentDirection, isAngleInSweep } from './geometry';
import { SceneGraph } from './sceneGraph';

function sampleSnapshot(portCount = 2): ComponentSnapshot {
  return { familyName: 'Valve', categoryName: 'Test Valve', symbol: generatePlaceholderSymbol(portCount), realPart: null };
}

describe('SceneGraph', () => {
  it('adds points and lines and tracks adjacency', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(10, 0);
    const line = g.addLine(a.id, b.id);
    expect(line).not.toBeNull();
    expect(g.linesOfPoint(a.id)).toHaveLength(1);
    expect(g.linesOfPoint(b.id)).toHaveLength(1);
    expect(g.getLineLength(line!)).toBe(10);
  });

  it('refuses to create a degenerate (zero-length-by-identity) line', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    expect(g.addLine(a.id, a.id)).toBeNull();
  });

  it('moving a point with no axis locks does not affect unrelated points', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(10, 0);
    g.addLine(a.id, b.id);
    g.movePoint(a.id, 5, 5);
    expect(g.points.get(a.id)).toMatchObject({ x: 5, y: 5 });
    expect(g.points.get(b.id)).toMatchObject({ x: 10, y: 0 });
  });

  it('propagates a horizontal axis lock: moving one endpoint keeps the other at the same y', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(10, 0);
    g.addLine(a.id, b.id, 'H');
    g.movePoint(a.id, 0, 7);
    expect(g.points.get(b.id)).toMatchObject({ x: 10, y: 7 });
  });

  it('propagates a vertical axis lock: moving one endpoint keeps the other at the same x', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(0, 10);
    g.addLine(a.id, b.id, 'V');
    g.movePoint(a.id, 4, 0);
    expect(g.points.get(b.id)).toMatchObject({ x: 4, y: 10 });
  });

  it('propagates through a chain of axis-locked segments', () => {
    // a --H-- b --V-- c : moving a's y should carry through to b (same y) and then to c (same x, unaffected by y)
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(10, 0);
    const c = g.addPoint(10, 10);
    g.addLine(a.id, b.id, 'H');
    g.addLine(b.id, c.id, 'V');
    g.movePoint(a.id, 0, 3);
    expect(g.points.get(b.id)).toMatchObject({ x: 10, y: 3 });
    expect(g.points.get(c.id)).toMatchObject({ x: 10, y: 10 }); // V-lock keeps x equal; y is untouched by this edge
  });

  it('stops propagation on a closed axis-locked loop instead of looping forever', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(10, 0);
    const c = g.addPoint(10, 10);
    const d = g.addPoint(0, 10);
    g.addLine(a.id, b.id, 'H');
    g.addLine(b.id, c.id, 'V');
    g.addLine(c.id, d.id, 'H');
    g.addLine(d.id, a.id, 'V');
    expect(() => g.movePoint(a.id, 0, 2)).not.toThrow();
  });

  it('merges two points, redirecting lines and dropping the merged-away point', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(10, 0);
    const c = g.addPoint(10, 10);
    const line = g.addLine(b.id, c.id)!;
    g.mergePoints(a.id, b.id);
    expect(g.points.has(b.id)).toBe(false);
    expect(g.lines.get(line.id)).toMatchObject({ startId: a.id });
    expect(g.linesOfPoint(a.id)).toHaveLength(1);
  });

  it('drops a line that becomes degenerate after a merge', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(10, 0);
    const line = g.addLine(a.id, b.id)!;
    g.mergePoints(a.id, b.id);
    expect(g.lines.has(line.id)).toBe(false);
    expect(g.linesOfPoint(a.id)).toHaveLength(0);
  });

  it('setLineLength keeps the start fixed and moves the end along the same angle', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(10, 0);
    const line = g.addLine(a.id, b.id)!;
    g.setLineLength(line.id, 20);
    expect(g.points.get(a.id)).toMatchObject({ x: 0, y: 0 });
    expect(g.points.get(b.id)!.x).toBeCloseTo(20);
    expect(g.points.get(b.id)!.y).toBeCloseTo(0);
  });

  it('setLineAngle keeps the start fixed and length constant while rotating the end', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(10, 0);
    const line = g.addLine(a.id, b.id)!;
    g.setLineAngle(line.id, Math.PI / 2);
    expect(g.points.get(b.id)!.x).toBeCloseTo(0);
    expect(g.points.get(b.id)!.y).toBeCloseTo(10);
  });

  it('setAxisLock snaps the line onto that axis immediately, not just on the next drag', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(10, 4); // not horizontal or vertical yet
    const line = g.addLine(a.id, b.id)!;
    g.setAxisLock(line.id, 'H');
    expect(g.points.get(b.id)).toMatchObject({ x: 10, y: 0 }); // snapped to start's y right away
    expect(g.points.get(a.id)).toMatchObject({ x: 0, y: 0 }); // start untouched

    const c = g.addPoint(20, 0);
    const d = g.addPoint(25, 8);
    const line2 = g.addLine(c.id, d.id)!;
    g.setAxisLock(line2.id, 'V');
    expect(g.points.get(d.id)).toMatchObject({ x: 20, y: 8 });
  });

  it('round-trips through toJSON/fromJSON, preserving ids and connectivity', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(10, 0);
    g.addLine(a.id, b.id, 'H');
    const restored = SceneGraph.fromJSON(g.toJSON());
    expect(restored.points.size).toBe(2);
    expect(restored.lines.size).toBe(1);
    expect(restored.linesOfPoint(a.id)).toHaveLength(1);
  });

  it('removePoint refuses to remove a point still referenced by a line', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(10, 0);
    g.addLine(a.id, b.id);
    expect(g.removePoint(a.id)).toBe(false);
    expect(g.points.has(a.id)).toBe(true);
  });
});

describe('SceneGraph arcs', () => {
  it('adds an arc between two existing points and tracks adjacency', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(1, 0);
    const arc = g.addArc(a.id, b.id, 1);
    expect(arc).not.toBeNull();
    expect(g.arcsOfPoint(a.id)).toHaveLength(1);
    expect(g.pointDegree(a.id)).toBe(1);
  });

  it('refuses to create a degenerate arc (same start and end point)', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    expect(g.addArc(a.id, a.id, 1)).toBeNull();
  });

  it('pointDegree counts lines and arcs together', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(1, 0);
    const c = g.addPoint(2, 0);
    g.addLine(a.id, b.id);
    g.addArc(b.id, c.id, 1);
    expect(g.pointDegree(b.id)).toBe(2);
    expect(g.linesOfPoint(b.id)).toHaveLength(1);
    expect(g.arcsOfPoint(b.id)).toHaveLength(1);
  });

  it('reshapes live when an endpoint moves, preserving bulge', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(1, 0);
    const arc = g.addArc(a.id, b.id, 1)!;
    g.movePoint(b.id, 2, 0);
    expect(arc.bulge).toBe(1); // bulge unchanged...
    expect(g.getArcGeometry(arc).radius).toBeCloseTo(1); // ...but radius grows with the new chord
  });

  it('moving an arc endpoint does not propagate to unrelated points (arcs have no axis lock)', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(1, 0);
    g.addArc(a.id, b.id, 1);
    g.movePoint(a.id, 5, 5);
    expect(g.points.get(b.id)).toMatchObject({ x: 1, y: 0 });
  });

  it('merges points, redirecting arcs and dropping degenerate ones', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(1, 0);
    const c = g.addPoint(2, 0);
    const arc = g.addArc(b.id, c.id, 1)!;
    g.mergePoints(a.id, b.id);
    expect(g.arcs.get(arc.id)).toMatchObject({ startId: a.id });

    const g2 = new SceneGraph();
    const p1 = g2.addPoint(0, 0);
    const p2 = g2.addPoint(1, 0);
    const degenerateArc = g2.addArc(p1.id, p2.id, 1)!;
    g2.mergePoints(p1.id, p2.id);
    expect(g2.arcs.has(degenerateArc.id)).toBe(false);
  });

  it('setArcBulge changes curvature while keeping both endpoints fixed', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(1, 0);
    const arc = g.addArc(a.id, b.id, 1)!;
    g.setArcBulge(arc.id, 0.5);
    expect(arc.bulge).toBe(0.5);
    expect(g.points.get(a.id)).toMatchObject({ x: 0, y: 0 });
    expect(g.points.get(b.id)).toMatchObject({ x: 1, y: 0 });
  });

  it('round-trips arcs through toJSON/fromJSON', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(1, 0);
    g.addArc(a.id, b.id, 0.75);
    const restored = SceneGraph.fromJSON(g.toJSON());
    expect(restored.arcs.size).toBe(1);
    expect([...restored.arcs.values()][0].bulge).toBe(0.75);
    expect(restored.arcsOfPoint(a.id)).toHaveLength(1);
  });

  it('removePoint refuses to remove a point still referenced by an arc', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(1, 0);
    g.addArc(a.id, b.id, 1);
    expect(g.removePoint(a.id)).toBe(false);
  });
});

describe('SceneGraph splitting', () => {
  it('splitLine divides a line into two, each inheriting the original axisLock', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(10, 0);
    const line = g.addLine(a.id, b.id, 'H')!;
    const mid = g.splitLine(line.id, { x: 4, y: 0 })!;
    expect(g.lines.has(line.id)).toBe(false);
    expect(mid.x).toBe(4);
    expect(g.linesOfPoint(mid.id)).toHaveLength(2);
    for (const l of g.linesOfPoint(mid.id)) expect(l.axisLock).toBe('H');
    expect(g.linesOfPoint(a.id)).toHaveLength(1);
    expect(g.linesOfPoint(b.id)).toHaveLength(1);
  });

  it('splitArc divides an arc into two true sub-arcs of the same circle', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(1, 0);
    const arc = g.addArc(a.id, b.id, 1)!; // semicircle
    const geo = g.getArcGeometry(arc);
    const midAngle = (geo.startAngle + geo.endAngle) / 2;
    const splitAt = {
      x: geo.center.x + geo.radius * Math.cos(midAngle),
      y: geo.center.y + geo.radius * Math.sin(midAngle),
    };
    const mid = g.splitArc(arc.id, splitAt)!;
    expect(g.arcs.has(arc.id)).toBe(false);
    expect(g.arcsOfPoint(mid.id)).toHaveLength(2);
    for (const half of g.arcsOfPoint(mid.id)) {
      const halfGeo = g.getArcGeometry(half);
      expect(halfGeo.center.x).toBeCloseTo(geo.center.x);
      expect(halfGeo.center.y).toBeCloseTo(geo.center.y);
      expect(halfGeo.radius).toBeCloseTo(geo.radius);
    }
  });
});

describe('SceneGraph circle composition (two arcs, no dedicated Circle entity)', () => {
  it('two addArc calls with the same bulge but reversed endpoints exactly partition a full circle', () => {
    const g = new SceneGraph();
    const center = { x: 0, y: 0 };
    const radius = 5;
    const a = g.addPoint(center.x + radius, center.y);
    const b = g.addPoint(center.x - radius, center.y);
    const top = g.addArc(a.id, b.id, 1)!;
    const bottom = g.addArc(b.id, a.id, 1)!;
    const topGeo = g.getArcGeometry(top);
    const bottomGeo = g.getArcGeometry(bottom);
    expect(topGeo.center.x).toBeCloseTo(center.x);
    expect(topGeo.center.y).toBeCloseTo(center.y);
    expect(topGeo.radius).toBeCloseTo(radius);
    expect(bottomGeo.radius).toBeCloseTo(radius);

    // Every interior angle (avoiding the exact shared seam angles) is covered by exactly
    // one of the two sweeps — no gap, no overlap.
    for (const angle of [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]) {
      const inTop = isAngleInSweep(angle, topGeo.startAngle, topGeo.endAngle, topGeo.anticlockwise);
      const inBottom = isAngleInSweep(angle, bottomGeo.startAngle, bottomGeo.endAngle, bottomGeo.anticlockwise);
      expect(inTop !== inBottom).toBe(true);
    }
  });
});

describe('SceneGraph tangency', () => {
  it('an arc tangent-locked to a line updates its curvature when the line is redirected', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(10, 0);
    const line = g.addLine(a.id, b.id)!;
    const c = g.addPoint(20, 5);
    const arc = g.addArc(b.id, c.id, 0.1)!;
    g.setTangentStart(arc.id, line.id);
    const bulgeAfterFirstSet = arc.bulge;

    g.movePoint(a.id, 0, -10); // redirect the line; its direction at b changes
    expect(arc.bulge).not.toBeCloseTo(bulgeAfterFirstSet);

    const dirLine = g.getTangentDirectionAt(line, b.id);
    const dirArc = arcTangentDirection(g.getArcGeometry(arc), true);
    expect(dirArc.x).toBeCloseTo(dirLine.x, 4);
    expect(dirArc.y).toBeCloseTo(dirLine.y, 4);
  });

  it('setTangentStart(null) turns it off, leaving bulge freely editable again', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(10, 0);
    const line = g.addLine(a.id, b.id)!;
    const c = g.addPoint(20, 5);
    const arc = g.addArc(b.id, c.id, 0.1)!;
    g.setTangentStart(arc.id, line.id);
    expect(arc.tangentStart).toEqual({ edgeId: line.id });
    g.setTangentStart(arc.id, null);
    expect(arc.tangentStart).toBeUndefined();
    g.setArcBulge(arc.id, 0.75);
    expect(arc.bulge).toBe(0.75);
  });
});

describe('SceneGraph filletAtPoint', () => {
  it('rounds a perpendicular (H+V) corner with the expected tangent points', () => {
    const g = new SceneGraph();
    const corner = g.addPoint(0, 0);
    const right = g.addPoint(10, 0);
    const up = g.addPoint(0, 10);
    const lineH = g.addLine(corner.id, right.id, 'H')!;
    const lineV = g.addLine(corner.id, up.id, 'V')!;
    const arc = g.filletAtPoint(corner.id, 2)!;
    expect(arc).not.toBeNull();
    expect(g.points.has(corner.id)).toBe(false);

    const startPt = g.points.get(arc.startId)!;
    const endPt = g.points.get(arc.endId)!;
    const trimDistances = [startPt, endPt].map((p) => Math.hypot(p.x, p.y)).sort();
    expect(trimDistances[0]).toBeCloseTo(2);
    expect(trimDistances[1]).toBeCloseTo(2);

    expect(g.lines.has(lineH.id)).toBe(true);
    expect(g.lines.has(lineV.id)).toBe(true);
    expect(g.getLineLength(lineH)).toBeCloseTo(8);
    expect(g.getLineLength(lineV)).toBeCloseTo(8);

    expect(g.getArcGeometry(arc).radius).toBeCloseTo(2);
  });

  it('rejects a corner that is not exactly two lines', () => {
    const g = new SceneGraph();
    const corner = g.addPoint(0, 0);
    const right = g.addPoint(10, 0);
    g.addLine(corner.id, right.id);
    expect(g.filletAtPoint(corner.id, 2)).toBeNull();
  });

  it('rejects a radius too large for the available line length', () => {
    const g = new SceneGraph();
    const corner = g.addPoint(0, 0);
    const right = g.addPoint(3, 0);
    const up = g.addPoint(0, 3);
    g.addLine(corner.id, right.id);
    g.addLine(corner.id, up.id);
    expect(g.filletAtPoint(corner.id, 10)).toBeNull();
  });

  it('rejects a near-collinear corner', () => {
    const g = new SceneGraph();
    const corner = g.addPoint(0, 0);
    const right = g.addPoint(10, 0);
    const left = g.addPoint(-10, 0);
    g.addLine(corner.id, right.id);
    g.addLine(corner.id, left.id);
    expect(g.filletAtPoint(corner.id, 2)).toBeNull();
  });
});

describe('SceneGraph components', () => {
  it('addComponent creates portCount connection points at the transformed layout', () => {
    const g = new SceneGraph();
    const instance = g.addComponent({
      categoryId: 'gc1',
      realPartId: null,
      tag: 'V-101',
      position: { x: 100, y: 50 },
      rotation: 0,
      snapshot: sampleSnapshot(2),
    });
    expect(instance.connections).toHaveLength(2);
    const [p0, p1] = instance.connections.map((c) => g.points.get(c.pointId)!);
    expect(p0).toMatchObject({ x: 88, y: 50 }); // 100 + (-12, 0)
    expect(p1).toMatchObject({ x: 112, y: 50 }); // 100 + (12, 0)
    expect(g.componentOwning(p0.id)).toBe(instance.id);
  });

  it('rotates the port layout with the instance rotation', () => {
    const g = new SceneGraph();
    const instance = g.addComponent({
      categoryId: 'gc1',
      realPartId: null,
      tag: 'V-102',
      position: { x: 0, y: 0 },
      rotation: Math.PI / 2,
      snapshot: sampleSnapshot(2),
    });
    const [p0, p1] = instance.connections.map((c) => g.points.get(c.pointId)!);
    expect(p0.x).toBeCloseTo(0);
    expect(p0.y).toBeCloseTo(-12);
    expect(p1.x).toBeCloseTo(0);
    expect(p1.y).toBeCloseTo(12);
  });

  it('addComponent scales the port layout by scaleFactor (global component-scale setting)', () => {
    const g = new SceneGraph();
    const instance = g.addComponent({
      categoryId: 'gc1',
      realPartId: null,
      tag: 'V-102b',
      position: { x: 100, y: 50 },
      rotation: 0,
      snapshot: sampleSnapshot(2),
      scaleFactor: 2,
    });
    const [p0, p1] = instance.connections.map((c) => g.points.get(c.pointId)!);
    expect(p0).toMatchObject({ x: 76, y: 50 }); // 100 + 2*(-12, 0)
    expect(p1).toMatchObject({ x: 124, y: 50 }); // 100 + 2*(12, 0)
  });

  it('moveComponent with a new scaleFactor rescales ports in place at the same position/rotation', () => {
    const g = new SceneGraph();
    const instance = g.addComponent({
      categoryId: 'gc1',
      realPartId: null,
      tag: 'V-102c',
      position: { x: 0, y: 0 },
      rotation: 0,
      snapshot: sampleSnapshot(2),
    });
    g.moveComponent(instance.id, instance.position, instance.rotation, 0.5);
    const [p0, p1] = instance.connections.map((c) => g.points.get(c.pointId)!);
    expect(p0).toMatchObject({ x: -6, y: 0 }); // 0.5 * (-12, 0)
    expect(p1).toMatchObject({ x: 6, y: 0 }); // 0.5 * (12, 0)
  });

  it('moveComponent relocates every port; an attached pipe follows via movePoint', () => {
    const g = new SceneGraph();
    const instance = g.addComponent({
      categoryId: 'gc1',
      realPartId: null,
      tag: 'V-103',
      position: { x: 0, y: 0 },
      rotation: 0,
      snapshot: sampleSnapshot(2),
    });
    const portId = instance.connections[0].pointId;
    const far = g.addPoint(-50, 0);
    g.addLine(portId, far.id);

    g.moveComponent(instance.id, { x: 100, y: 100 }, 0);
    expect(g.points.get(portId)).toMatchObject({ x: 88, y: 100 });
    expect(g.points.get(far.id)).toMatchObject({ x: -50, y: 0 }); // no axis lock, unaffected
  });

  it('removeComponent refuses while a port still has a pipe attached, succeeds once freed', () => {
    const g = new SceneGraph();
    const instance = g.addComponent({
      categoryId: 'gc1',
      realPartId: null,
      tag: 'V-104',
      position: { x: 0, y: 0 },
      rotation: 0,
      snapshot: sampleSnapshot(2),
    });
    const portId = instance.connections[0].pointId;
    const far = g.addPoint(-50, 0);
    const line = g.addLine(portId, far.id)!;
    expect(g.removeComponent(instance.id)).toBe(false);
    expect(g.components.has(instance.id)).toBe(true);

    g.removeLine(line.id);
    expect(g.removeComponent(instance.id)).toBe(true);
    expect(g.components.has(instance.id)).toBe(false);
    expect(g.points.has(portId)).toBe(false);
  });

  it('pointDegree counts component ownership, so an attached edge is correctly "shared"', () => {
    const g = new SceneGraph();
    const instance = g.addComponent({
      categoryId: 'gc1',
      realPartId: null,
      tag: 'V-105',
      position: { x: 0, y: 0 },
      rotation: 0,
      snapshot: sampleSnapshot(2),
    });
    const portId = instance.connections[0].pointId;
    expect(g.pointDegree(portId)).toBe(1); // owned, no lines yet
    const far = g.addPoint(-50, 0);
    g.addLine(portId, far.id);
    expect(g.pointDegree(portId)).toBe(2); // 1 line + component ownership
  });

  it('removePoint refuses to remove a component-owned point directly', () => {
    const g = new SceneGraph();
    const instance = g.addComponent({
      categoryId: 'gc1',
      realPartId: null,
      tag: 'V-106',
      position: { x: 0, y: 0 },
      rotation: 0,
      snapshot: sampleSnapshot(1),
    });
    expect(g.removePoint(instance.connections[0].pointId)).toBe(false);
  });

  it('mergePoints never discards a component-owned point — swaps direction instead', () => {
    const g = new SceneGraph();
    const instance = g.addComponent({
      categoryId: 'gc1',
      realPartId: null,
      tag: 'V-107',
      position: { x: 0, y: 0 },
      rotation: 0,
      snapshot: sampleSnapshot(1),
    });
    const portId = instance.connections[0].pointId;
    const dragged = g.addPoint(50, 50);
    const line = g.addLine(dragged.id, g.addPoint(80, 80).id)!;

    // Simulates a pipe endpoint (dragged) snapping onto the component's port: the port
    // must survive, since the component's `connections` array references its id.
    g.mergePoints(dragged.id, portId);
    expect(g.points.has(portId)).toBe(true);
    expect(g.points.has(dragged.id)).toBe(false);
    expect(g.lines.get(line.id)!.startId).toBe(portId);
    expect(g.componentOwning(portId)).toBe(instance.id);
  });

  it('nearestPoint excludeComponentId skips a component\'s own ports (so dragging it never "snaps" to itself)', () => {
    const g = new SceneGraph();
    const instance = g.addComponent({
      categoryId: 'gc1',
      realPartId: null,
      tag: 'V-107b',
      position: { x: 0, y: 0 },
      rotation: 0,
      snapshot: sampleSnapshot(2),
    });
    const far = g.addPoint(1000, 1000);
    // Without the exclusion, the nearest point to (0,0) is one of the component's own
    // ports (distance 12); with it, only the unrelated far-away point is a candidate.
    const nearest = g.nearestPoint({ x: 0, y: 0 }, undefined, instance.id);
    expect(nearest!.point.id).toBe(far.id);
  });

  it('filletAtPoint refuses a component-owned point even with exactly two lines attached', () => {
    const g = new SceneGraph();
    const instance = g.addComponent({
      categoryId: 'gc1',
      realPartId: null,
      tag: 'V-108',
      position: { x: 0, y: 0 },
      rotation: 0,
      snapshot: sampleSnapshot(1),
    });
    const portId = instance.connections[0].pointId;
    g.addLine(portId, g.addPoint(50, 0).id);
    g.addLine(portId, g.addPoint(0, 50).id);
    expect(g.filletAtPoint(portId, 2)).toBeNull();
  });

  it('round-trips components through toJSON/fromJSON, preserving connectivity and ownership', () => {
    const g = new SceneGraph();
    g.addComponent({
      categoryId: 'gc1',
      realPartId: 'rp1',
      tag: 'V-109',
      position: { x: 10, y: 20 },
      rotation: 0.5,
      snapshot: sampleSnapshot(2),
    });
    const restored = SceneGraph.fromJSON(g.toJSON());
    expect(restored.components.size).toBe(1);
    const restoredInstance = [...restored.components.values()][0];
    expect(restoredInstance.tag).toBe('V-109');
    expect(restoredInstance.position).toEqual({ x: 10, y: 20 });
    for (const conn of restoredInstance.connections) {
      expect(restored.points.has(conn.pointId)).toBe(true);
      expect(restored.componentOwning(conn.pointId)).toBe(restoredInstance.id);
    }
  });

  it('setComponentName trims, survives a JSON round-trip, and clears back to absent when emptied', () => {
    const g = new SceneGraph();
    const instance = g.addComponent({
      categoryId: 'gc1',
      realPartId: null,
      tag: 'V-110',
      position: { x: 0, y: 0 },
      rotation: 0,
      snapshot: sampleSnapshot(2),
    });
    expect(instance.name).toBeUndefined(); // freshly placed components are unnamed

    g.setComponentName(instance.id, '  Reactor feed pump  ');
    expect(instance.name).toBe('Reactor feed pump');
    const restored = [...SceneGraph.fromJSON(g.toJSON()).components.values()][0];
    expect(restored.name).toBe('Reactor feed pump');

    g.setComponentName(instance.id, '   ');
    expect('name' in instance).toBe(false);
  });
});

describe('SceneGraph text annotations', () => {
  it('places a note centered on its position, with its content trimmed', () => {
    const g = new SceneGraph();
    const note = g.addText(10, 20, '  Feed header  ', 12);
    expect(g.texts.get(note.id)).toMatchObject({ x: 10, y: 20, text: 'Feed header', fontSize: 12 });
  });

  it('keeps notes out of the point graph, so nothing snaps to or connects with one', () => {
    const g = new SceneGraph();
    const note = g.addText(0, 0, 'Note', 12);
    expect(g.points.size).toBe(0);
    expect(g.nearestPoint({ x: 0, y: 0 })).toBeNull();
    expect(g.pointDegree(note.id)).toBe(0);
  });

  it('moves and resizes a note; a non-positive size is ignored rather than applied', () => {
    const g = new SceneGraph();
    const note = g.addText(0, 0, 'Note', 12);
    g.moveText(note.id, -5, 7);
    g.setTextFontSize(note.id, 20);
    expect(g.texts.get(note.id)).toMatchObject({ x: -5, y: 7, fontSize: 20 });
    g.setTextFontSize(note.id, 0);
    expect(g.texts.get(note.id)!.fontSize).toBe(20);
  });

  it('deletes a note when its content is cleared, rather than keeping an invisible one', () => {
    const g = new SceneGraph();
    const note = g.addText(0, 0, 'Note', 12);
    g.setTextContent(note.id, '   ');
    expect(g.texts.has(note.id)).toBe(false);
  });

  it('round-trips notes through toJSON/fromJSON (which is what gives them undo and save/load)', () => {
    const g = new SceneGraph();
    const note = g.addText(3, 4, 'Reactor loop', 8);
    const restored = SceneGraph.fromJSON(g.toJSON());
    expect(restored.texts.get(note.id)).toEqual({ id: note.id, x: 3, y: 4, text: 'Reactor loop', fontSize: 8 });
  });

  it('loads a scene saved before notes existed (no texts list at all)', () => {
    const g = new SceneGraph();
    const a = g.addPoint(0, 0);
    const b = g.addPoint(10, 0);
    g.addLine(a.id, b.id);
    const legacy = g.toJSON() as Partial<ReturnType<SceneGraph['toJSON']>>;
    delete legacy.texts;
    const restored = SceneGraph.fromJSON(legacy as ReturnType<SceneGraph['toJSON']>);
    expect(restored.texts.size).toBe(0);
    expect(restored.lines.size).toBe(1);
  });

  it('bumps the id counter past loaded note ids, so a freshly placed note cannot collide', () => {
    const g = new SceneGraph();
    g.addText(0, 0, 'Loaded', 12, 'txt_zzz');
    const restored = SceneGraph.fromJSON(g.toJSON());
    const fresh = restored.addText(1, 1, 'Fresh', 12);
    expect(fresh.id).not.toBe('txt_zzz');
    expect(restored.texts.size).toBe(2);
  });
});
