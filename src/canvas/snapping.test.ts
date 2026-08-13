import { describe, expect, it } from 'vitest';
import { SceneGraph } from './sceneGraph';
import { computeSnap } from './snapping';
import { adaptiveGridSize } from './viewport';

describe('computeSnap', () => {
  it('snaps to a nearby existing point over anything else', () => {
    const g = new SceneGraph();
    const p = g.addPoint(100, 100);
    const result = computeSnap({ cursor: { x: 102, y: 101 }, graph: g, threshold: 8, gridSize: 10 });
    expect(result.type).toBe('endpoint');
    expect(result.snappedPointId).toBe(p.id);
    expect(result.point).toEqual({ x: 100, y: 100 });
  });

  it('excludes a given point id from endpoint snapping (e.g. the point being dragged)', () => {
    const g = new SceneGraph();
    const p = g.addPoint(100, 100);
    const result = computeSnap({
      cursor: { x: 101, y: 100 },
      graph: g,
      threshold: 8,
      gridSize: 10,
      excludePointId: p.id,
    });
    expect(result.type).not.toBe('endpoint');
  });

  it('infers horizontal alignment relative to an origin point', () => {
    const g = new SceneGraph();
    const result = computeSnap({
      cursor: { x: 50, y: 2 },
      graph: g,
      threshold: 5,
      gridSize: 10,
      originPoint: { x: 0, y: 0 },
    });
    expect(result.type).toBe('horizontal');
    expect(result.point).toEqual({ x: 50, y: 0 });
  });

  it('infers vertical alignment relative to an origin point', () => {
    const g = new SceneGraph();
    const result = computeSnap({
      cursor: { x: 2, y: 50 },
      graph: g,
      threshold: 5,
      gridSize: 10,
      originPoint: { x: 0, y: 0 },
    });
    expect(result.type).toBe('vertical');
    expect(result.point).toEqual({ x: 0, y: 50 });
  });

  it('still grid-snaps the free coordinate while axis-inferring horizontal (regression: used to fall back to the raw cursor)', () => {
    const g = new SceneGraph();
    const result = computeSnap({
      cursor: { x: 53, y: 1 }, // 53 is not a multiple of the grid — should still round to 50
      graph: g,
      threshold: 5,
      gridSize: 10,
      originPoint: { x: 0, y: 0 },
    });
    expect(result.type).toBe('horizontal');
    expect(result.point).toEqual({ x: 50, y: 0 });
  });

  it('still grid-snaps the free coordinate while axis-inferring vertical', () => {
    const g = new SceneGraph();
    const result = computeSnap({
      cursor: { x: 1, y: 53 },
      graph: g,
      threshold: 5,
      gridSize: 10,
      originPoint: { x: 0, y: 0 },
    });
    expect(result.type).toBe('vertical');
    expect(result.point).toEqual({ x: 0, y: 50 });
  });

  it('falls back to grid snapping when nothing else is close', () => {
    const g = new SceneGraph();
    const result = computeSnap({ cursor: { x: 41, y: 39 }, graph: g, threshold: 5, gridSize: 10 });
    expect(result.type).toBe('grid');
    expect(result.point).toEqual({ x: 40, y: 40 });
  });

  it('disables all snapping when `disabled` is set', () => {
    const g = new SceneGraph();
    g.addPoint(50, 50);
    const result = computeSnap({ cursor: { x: 51, y: 50 }, graph: g, threshold: 8, gridSize: 10, disabled: true });
    expect(result.type).toBe('free');
    expect(result.point).toEqual({ x: 51, y: 50 });
  });
});

/** The grid snap used to be gated on the same world-space threshold as the endpoint snap.
 * Because that threshold is a fixed count of *screen* pixels divided by zoom while the grid
 * is a fixed count of *world* units, the snapping share of the canvas shrank as the user
 * zoomed in — grid snapping quietly stopped working, with no indicator to say so. It is now
 * ungated: the grid is the floor, and only Alt (or no grid at all) gets you off it. */
describe('computeSnap: the grid is ungated', () => {
  /** What worldThreshold() computes upstream, reproduced here so the zoom relationship is
   * exercised directly rather than assumed. */
  const worldThreshold = (px: number, zoom: number) => px / zoom;

  it('grid-snaps a cursor that is nowhere near a grid point (used to return free)', () => {
    const g = new SceneGraph();
    const result = computeSnap({ cursor: { x: 43, y: 37 }, graph: g, threshold: 2, gridSize: 10 });
    expect(result.type).toBe('grid');
    expect(result.point).toEqual({ x: 40, y: 40 });
  });

  it('grid-snaps identically at every zoom, even where the old threshold could never reach', () => {
    const g = new SceneGraph();
    // Dead centre of a grid cell: 7.07 world units from the nearest grid point at gridSize
    // 20, which the world threshold (10px / zoom) only ever cleared below zoom ~1.4.
    const cursor = { x: 10, y: 10 };
    for (const zoom of [0.5, 1, 2, 4, 8]) {
      const result = computeSnap({ cursor, graph: g, threshold: worldThreshold(10, zoom), gridSize: 20 });
      expect(result.type).toBe('grid');
      expect(result.point).toEqual({ x: 20, y: 20 });
    }
  });

  it('keeps the endpoint snap gated in screen space, so zooming in makes it more selective', () => {
    const g = new SceneGraph();
    g.addPoint(0, 0);
    const cursor = { x: 6, y: 0 }; // 6 world units from the point

    const zoomedOut = computeSnap({ cursor, graph: g, threshold: worldThreshold(10, 1), gridSize: 20 });
    expect(zoomedOut.type).toBe('endpoint'); // 6 <= 10 world units

    const zoomedIn = computeSnap({ cursor, graph: g, threshold: worldThreshold(10, 4), gridSize: 20 });
    expect(zoomedIn.type).toBe('grid'); // 6 > 2.5 world units — the point is 24px away on screen
    expect(zoomedIn.point).toEqual({ x: 0, y: 0 }); // ...and the grid still catches it
  });

  it('only returns free for Alt or a disabled grid', () => {
    const g = new SceneGraph();
    const cursor = { x: 43, y: 37 };
    expect(computeSnap({ cursor, graph: g, threshold: 2, gridSize: 0 }).type).toBe('free');
    expect(computeSnap({ cursor, graph: g, threshold: 2, gridSize: 10, disabled: true }).type).toBe('free');
    expect(computeSnap({ cursor, graph: g, threshold: 2, gridSize: 10 }).type).toBe('grid');
  });
});

/** "What you see is what you snap to": the renderer coarsens the drawn grid when zoomed out
 * (adaptiveGridSize) while snapping stays on the true gridSize, so the two only stay
 * coherent because every drawn major line is also a real snap line. drawGrid relies on that
 * to draw the true grid underneath and merely emphasize a subset of it. */
describe('drawn grid vs snap grid coherence', () => {
  it('always coarsens the drawn grid to an exact multiple of the snap grid', () => {
    const gridSize = 20;
    for (const zoom of [0.05, 0.1, 0.3, 0.7, 1, 2, 20]) {
      const drawn = adaptiveGridSize(gridSize, zoom);
      expect(drawn % gridSize).toBe(0);
      expect(drawn).toBeGreaterThanOrEqual(gridSize);
    }
  });

  it('puts every snapped position on a line of the drawn grid, at every zoom', () => {
    const g = new SceneGraph();
    const gridSize = 20;
    for (const zoom of [0.05, 0.5, 1, 4]) {
      const snapped = computeSnap({ cursor: { x: 137, y: -46 }, graph: g, threshold: 10 / zoom, gridSize }).point;
      // Not that it lands on a *major* line — the fine grid is drawn too — but that it lands
      // on a line of the same lattice the renderer lays down.
      expect(Math.abs(snapped.x % gridSize)).toBe(0);
      expect(Math.abs(snapped.y % gridSize)).toBe(0);
    }
  });
});

describe("computeSnap: gridMode 'delta'", () => {
  it('rounds each axis of a drag offset to the nearest grid multiple independently', () => {
    const g = new SceneGraph();
    const opts = { graph: g, threshold: 1, gridSize: 2, gridMode: 'delta' as const };
    expect(computeSnap({ ...opts, cursor: { x: 4.9, y: -3.1 } }).point).toEqual({ x: 4, y: -4 });
    expect(computeSnap({ ...opts, cursor: { x: 5.1, y: 0.9 } }).point).toEqual({ x: 6, y: 0 });
  });

  it('passes the offset through unchanged when the grid is off', () => {
    const g = new SceneGraph();
    const result = computeSnap({ cursor: { x: 3.456, y: -1.234 }, graph: g, threshold: 1, gridSize: 0, gridMode: 'delta' });
    expect(result.type).toBe('free');
    expect(result.point).toEqual({ x: 3.456, y: -1.234 });
  });

  it('never endpoint-snaps or axis-infers: a drag offset is not a position in the graph', () => {
    const g = new SceneGraph();
    g.addPoint(4, 4); // sits right where an absolute snap of this offset would be captured
    const result = computeSnap({
      cursor: { x: 5, y: 4 },
      graph: g,
      threshold: 8,
      gridSize: 10,
      gridMode: 'delta',
      originPoint: { x: 0, y: 0 },
    });
    expect(result.type).toBe('grid');
    expect(result.point).toEqual({ x: 10, y: 0 });
  });

  it('honours Alt, so a group drag can be placed freehand like everything else', () => {
    const g = new SceneGraph();
    const result = computeSnap({ cursor: { x: 3, y: 7 }, graph: g, threshold: 8, gridSize: 10, gridMode: 'delta', disabled: true });
    expect(result.type).toBe('free');
    expect(result.point).toEqual({ x: 3, y: 7 });
  });
});

describe('computeSnap: allowEndpoint', () => {
  it('skips the endpoint search but keeps the grid, for callers that must not land on a vertex', () => {
    const g = new SceneGraph();
    g.addPoint(103, 101); // deliberately off-grid, so the two answers can't be confused
    const result = computeSnap({ cursor: { x: 102, y: 101 }, graph: g, threshold: 8, gridSize: 10, allowEndpoint: false });
    expect(result.type).toBe('grid');
    expect(result.point).toEqual({ x: 100, y: 100 });
    expect(result.snappedPointId).toBeUndefined();
  });

  it('endpoint-snaps by default, so opting out has to be deliberate', () => {
    const g = new SceneGraph();
    g.addPoint(100, 100);
    expect(computeSnap({ cursor: { x: 103, y: 101 }, graph: g, threshold: 8, gridSize: 10 }).type).toBe('endpoint');
  });
});
