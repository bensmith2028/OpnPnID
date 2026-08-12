import { describe, expect, it } from 'vitest';
import { SceneGraph } from './sceneGraph';
import { computeSnap } from './snapping';

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

  it('returns free placement when nothing is within threshold', () => {
    const g = new SceneGraph();
    const result = computeSnap({ cursor: { x: 43, y: 37 }, graph: g, threshold: 2, gridSize: 10 });
    expect(result.type).toBe('free');
    expect(result.point).toEqual({ x: 43, y: 37 });
  });

  it('disables all snapping when `disabled` is set', () => {
    const g = new SceneGraph();
    g.addPoint(50, 50);
    const result = computeSnap({ cursor: { x: 51, y: 50 }, graph: g, threshold: 8, gridSize: 10, disabled: true });
    expect(result.type).toBe('free');
    expect(result.point).toEqual({ x: 51, y: 50 });
  });
});
