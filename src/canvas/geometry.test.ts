import { describe, expect, it } from 'vitest';
import {
  add,
  angleDelta,
  angleOf,
  arcGeometry,
  arcSweepFraction,
  arcTangentDirection,
  pointAtArcFraction,
  bulgeForTangentAtEnd,
  bulgeForTangentAtStart,
  bulgeFromSagittaCursor,
  distance,
  isAngleInSweep,
  nearestGridPoint,
  normalize,
  normalizeAngle,
  pointAtAngleLength,
  projectPointOnArc,
  projectPointOnSegment,
  rotate,
  signedAngleBetween,
  subtract,
} from './geometry';

describe('vector math', () => {
  it('adds and subtracts', () => {
    expect(add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
    expect(subtract({ x: 3, y: 4 }, { x: 1, y: 2 })).toEqual({ x: 2, y: 2 });
  });

  it('computes distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('normalizes vectors, including the zero vector', () => {
    expect(normalize({ x: 5, y: 0 })).toEqual({ x: 1, y: 0 });
    expect(normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('computes angle between two points', () => {
    expect(angleOf({ x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0);
    expect(angleOf({ x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(Math.PI / 2);
  });

  it('round-trips angle + length back to a point', () => {
    const origin = { x: 10, y: 10 };
    const p = pointAtAngleLength(origin, Math.PI / 4, Math.SQRT2);
    expect(p.x).toBeCloseTo(11);
    expect(p.y).toBeCloseTo(11);
  });

  it('normalizes angles into (-PI, PI]', () => {
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(Math.PI);
  });

  it('computes the smallest delta between angles', () => {
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(0.2);
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
  });

  it('snaps to the nearest grid point', () => {
    expect(nearestGridPoint({ x: 12, y: 8 }, 10)).toEqual({ x: 10, y: 10 });
  });

  it('projects a point onto a segment, clamped to the segment', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(projectPointOnSegment({ x: 5, y: 3 }, a, b)).toMatchObject({ point: { x: 5, y: 0 }, t: 0.5 });
    expect(projectPointOnSegment({ x: -5, y: 3 }, a, b)).toMatchObject({ point: { x: 0, y: 0 }, t: 0 });
    expect(projectPointOnSegment({ x: 15, y: 3 }, a, b)).toMatchObject({ point: { x: 10, y: 0 }, t: 1 });
  });
});

describe('rotate', () => {
  it('rotates a vector by a given angle, matching the atan2(y,x) convention used throughout', () => {
    const v = { x: 1, y: 0 };
    const quarter = rotate(v, Math.PI / 2);
    expect(quarter.x).toBeCloseTo(0);
    expect(quarter.y).toBeCloseTo(1);
    const half = rotate(v, Math.PI);
    expect(half.x).toBeCloseTo(-1);
    expect(half.y).toBeCloseTo(0);
    const none = rotate(v, 0);
    expect(none.x).toBeCloseTo(1);
    expect(none.y).toBeCloseTo(0);
  });
});

describe('arcGeometry', () => {
  it('treats a semicircle (bulge=1) as centered on the chord midpoint, radius = half chord', () => {
    const geo = arcGeometry({ x: 0, y: 0 }, { x: 2, y: 0 }, 1);
    expect(geo.isStraight).toBe(false);
    expect(geo.center.x).toBeCloseTo(1);
    expect(geo.center.y).toBeCloseTo(0);
    expect(geo.radius).toBeCloseTo(1);
    expect(geo.anticlockwise).toBe(false);
  });

  it('matches hand-derived center/radius/angles for a quarter circle', () => {
    const bulge = Math.tan(Math.PI / 8);
    const geo = arcGeometry({ x: 0, y: 0 }, { x: 1, y: 0 }, bulge);
    expect(geo.center.x).toBeCloseTo(0.5);
    expect(geo.center.y).toBeCloseTo(0.5);
    expect(geo.radius).toBeCloseTo(Math.SQRT1_2);
    expect(geo.startAngle).toBeCloseTo((-3 * Math.PI) / 4);
    expect(geo.endAngle).toBeCloseTo(-Math.PI / 4);
    // Both endpoints must actually lie on the derived circle.
    expect(distance(geo.center, { x: 0, y: 0 })).toBeCloseTo(geo.radius);
    expect(distance(geo.center, { x: 1, y: 0 })).toBeCloseTo(geo.radius);
  });

  it('flips sweep direction for a negative bulge', () => {
    const bulge = -Math.tan(Math.PI / 8);
    const geo = arcGeometry({ x: 0, y: 0 }, { x: 1, y: 0 }, bulge);
    expect(geo.anticlockwise).toBe(true);
    // Mirrored across the chord relative to the positive-bulge case.
    expect(geo.center.y).toBeCloseTo(-0.5);
  });

  it('reports isStraight for a ~zero bulge instead of dividing by zero', () => {
    const geo = arcGeometry({ x: 0, y: 0 }, { x: 1, y: 0 }, 0);
    expect(geo.isStraight).toBe(true);
    expect(Number.isFinite(geo.radius)).toBe(true);
  });
});

describe('isAngleInSweep', () => {
  it('detects an angle inside a simple non-wrapping sweep', () => {
    expect(isAngleInSweep(0, -1, 1, false)).toBe(true);
    expect(isAngleInSweep(2, -1, 1, false)).toBe(false);
  });

  it('handles a sweep that wraps past +-PI', () => {
    expect(isAngleInSweep(Math.PI, Math.PI - 0.1, -Math.PI + 0.1, false)).toBe(true);
    expect(isAngleInSweep(0, Math.PI - 0.1, -Math.PI + 0.1, false)).toBe(false);
  });

  it('reverses direction when anticlockwise is set', () => {
    expect(isAngleInSweep(0, 1, -1, true)).toBe(true);
    expect(isAngleInSweep(2, 1, -1, true)).toBe(false);
  });
});

describe('projectPointOnArc', () => {
  it('returns ~zero distance for a point exactly on the arc', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 1, y: 0 };
    const bulge = Math.tan(Math.PI / 8);
    const geo = arcGeometry(start, end, bulge);
    const onArc = pointAtAngleLength(geo.center, (geo.startAngle + geo.endAngle) / 2, geo.radius);
    const proj = projectPointOnArc(onArc, start, end, bulge);
    expect(proj.distance).toBeCloseTo(0, 5);
  });

  it('clamps to the nearest endpoint when the closest point on the full circle is outside the sweep', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 1, y: 0 };
    const bulge = Math.tan(Math.PI / 8);
    // Far behind `start`, well outside the sweep.
    const proj = projectPointOnArc({ x: -5, y: 0 }, start, end, bulge);
    expect(proj.point).toEqual(start);
  });

  it('falls back to segment projection for a ~straight (zero-bulge) arc', () => {
    const proj = projectPointOnArc({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }, 0);
    expect(proj.point).toEqual({ x: 5, y: 0 });
  });
});

describe('bulgeFromSagittaCursor', () => {
  it('recovers bulge from a cursor offset perpendicular to the chord', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 1, y: 0 };
    // rotate90((1,0)) = (0,1), so a cursor at (0.5, -0.5) sits h=-0.5 along that normal.
    const bulge = bulgeFromSagittaCursor(start, end, { x: 0.5, y: -0.5 });
    expect(bulge).toBeCloseTo(1);
  });

  it('is fed back into arcGeometry consistently: the cursor point ends up ~on the resulting arc', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 1, y: 0 };
    const cursor = { x: 0.5, y: -0.3 };
    const bulge = bulgeFromSagittaCursor(start, end, cursor);
    const geo = arcGeometry(start, end, bulge);
    expect(distance(geo.center, cursor)).toBeCloseTo(geo.radius, 5);
  });
});

describe('signedAngleBetween', () => {
  it('is zero for parallel vectors and PI/2 for a +90 rotation', () => {
    expect(signedAngleBetween({ x: 1, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0);
    expect(signedAngleBetween({ x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(Math.PI / 2);
    expect(signedAngleBetween({ x: 1, y: 0 }, { x: 0, y: -1 })).toBeCloseTo(-Math.PI / 2);
  });
});

describe('arcTangentDirection', () => {
  it('matches the hand-derived tangent directions for the quarter-circle case', () => {
    // Same fixture as the arcGeometry quarter-circle test: (0,0) -> (1,0), bulge=tan(pi/8).
    const geo = arcGeometry({ x: 0, y: 0 }, { x: 1, y: 0 }, Math.tan(Math.PI / 8));
    const tStart = arcTangentDirection(geo, true);
    const tEnd = arcTangentDirection(geo, false);
    expect(tStart.x).toBeCloseTo(Math.SQRT1_2);
    expect(tStart.y).toBeCloseTo(-Math.SQRT1_2);
    expect(tEnd.x).toBeCloseTo(Math.SQRT1_2);
    expect(tEnd.y).toBeCloseTo(Math.SQRT1_2);
    // Both should be unit vectors.
    expect(Math.hypot(tStart.x, tStart.y)).toBeCloseTo(1);
  });
});

describe('bulgeForTangentAtStart / bulgeForTangentAtEnd', () => {
  const start = { x: 0, y: 0 };
  const end = { x: 1, y: 0 };
  const knownBulge = Math.tan(Math.PI / 8); // the quarter-circle fixture used throughout

  it('recovers the known bulge from the start tangent direction', () => {
    const geo = arcGeometry(start, end, knownBulge);
    const tStart = arcTangentDirection(geo, true);
    expect(bulgeForTangentAtStart(start, tStart, end)).toBeCloseTo(knownBulge);
  });

  it('recovers the known bulge from the end tangent direction', () => {
    const geo = arcGeometry(start, end, knownBulge);
    const tEnd = arcTangentDirection(geo, false);
    expect(bulgeForTangentAtEnd(start, end, tEnd)).toBeCloseTo(knownBulge);
  });

  it('round-trips for a negative bulge too', () => {
    const negBulge = -Math.tan(Math.PI / 6);
    const geo = arcGeometry(start, end, negBulge);
    expect(bulgeForTangentAtStart(start, arcTangentDirection(geo, true), end)).toBeCloseTo(negBulge);
    expect(bulgeForTangentAtEnd(start, end, arcTangentDirection(geo, false))).toBeCloseTo(negBulge);
  });

  it('two edges sharing a point are tangent exactly when their forward directions there agree', () => {
    // A horizontal line arriving at (0,0) from the left has forward direction (1,0) there.
    // An arc leaving (0,0) tangent to it should have that same forward direction at its start.
    const lineForwardAtSharedPoint = { x: 1, y: 0 };
    const arcEnd = { x: 1, y: 1 };
    const bulge = bulgeForTangentAtStart(start, lineForwardAtSharedPoint, arcEnd);
    const geo = arcGeometry(start, arcEnd, bulge);
    const arcForwardAtStart = arcTangentDirection(geo, true);
    expect(arcForwardAtStart.x).toBeCloseTo(lineForwardAtSharedPoint.x);
    expect(arcForwardAtStart.y).toBeCloseTo(lineForwardAtSharedPoint.y);
  });
});

describe('arcSweepFraction', () => {
  it('reports 0.5 at the midpoint of a simple sweep', () => {
    const geo = arcGeometry({ x: 0, y: 0 }, { x: 1, y: 0 }, Math.tan(Math.PI / 8));
    const midAngle = (geo.startAngle + geo.endAngle) / 2;
    expect(arcSweepFraction(midAngle, geo.startAngle, geo.endAngle, geo.anticlockwise)).toBeCloseTo(0.5);
  });

  it('reports 0 at the start and 1 at the end', () => {
    const geo = arcGeometry({ x: 0, y: 0 }, { x: 1, y: 0 }, Math.tan(Math.PI / 8));
    expect(arcSweepFraction(geo.startAngle, geo.startAngle, geo.endAngle, geo.anticlockwise)).toBeCloseTo(0);
    expect(arcSweepFraction(geo.endAngle, geo.startAngle, geo.endAngle, geo.anticlockwise)).toBeCloseTo(1);
  });

  it('handles a negative-bulge (anticlockwise) sweep the same way', () => {
    const geo = arcGeometry({ x: 0, y: 0 }, { x: 1, y: 0 }, -Math.tan(Math.PI / 8));
    const midAngle = arcTangentDirectionMidAngle(geo);
    expect(arcSweepFraction(midAngle, geo.startAngle, geo.endAngle, geo.anticlockwise)).toBeCloseTo(0.5);
  });
});

describe('pointAtArcFraction', () => {
  it('is the inverse of arcSweepFraction: round-trips t through and back', () => {
    const geo = arcGeometry({ x: 0, y: 0 }, { x: 1, y: 0 }, Math.tan(Math.PI / 8));
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const p = pointAtArcFraction(geo, t);
      const angle = Math.atan2(p.y - geo.center.y, p.x - geo.center.x);
      expect(arcSweepFraction(angle, geo.startAngle, geo.endAngle, geo.anticlockwise)).toBeCloseTo(t, 4);
    }
  });

  it('returns the endpoints at t=0 and t=1', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 1, y: 0 };
    const geo = arcGeometry(start, end, Math.tan(Math.PI / 8));
    const p0 = pointAtArcFraction(geo, 0);
    const p1 = pointAtArcFraction(geo, 1);
    expect(p0.x).toBeCloseTo(start.x);
    expect(p0.y).toBeCloseTo(start.y);
    expect(p1.x).toBeCloseTo(end.x);
    expect(p1.y).toBeCloseTo(end.y);
  });

  it('works for a negative (anticlockwise) bulge too', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 1, y: 0 };
    const geo = arcGeometry(start, end, -Math.tan(Math.PI / 8));
    const p1 = pointAtArcFraction(geo, 1);
    expect(p1.x).toBeCloseTo(end.x);
    expect(p1.y).toBeCloseTo(end.y);
  });
});

// Helper used only by the test above: the true angular midpoint of an anticlockwise sweep
// (can't just average start/end angles when the sweep direction is reversed/wraps).
function arcTangentDirectionMidAngle(geo: { startAngle: number; endAngle: number; anticlockwise: boolean }): number {
  const twoPi = Math.PI * 2;
  const mod = (x: number) => ((x % twoPi) + twoPi) % twoPi;
  if (!geo.anticlockwise) {
    const total = mod(geo.endAngle - geo.startAngle);
    return geo.startAngle + total / 2;
  }
  const total = mod(geo.startAngle - geo.endAngle);
  return geo.startAngle - total / 2;
}
