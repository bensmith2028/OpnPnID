/** Pure vector-math helpers. Framework-free and unit-testable in isolation. */
import type { Vec2 } from '../types/geometry';

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtract(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

export function length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function normalize(v: Vec2): Vec2 {
  const len = length(v);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

export function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Rotates a vector +90 degrees (in the same y-down, atan2(y,x) convention used throughout). */
export function rotate90(v: Vec2): Vec2 {
  return { x: -v.y, y: v.x };
}

/** Rotates a vector by an arbitrary angle (radians), same y-down convention. Used to
 * transform a component's local port layout into world space by its instance rotation. */
export function rotate(v: Vec2, angleRad: number): Vec2 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** 2D "cross product" (z-component of the 3D cross product of two planar vectors). */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function negate(v: Vec2): Vec2 {
  return { x: -v.x, y: -v.y };
}

/** Signed angle (radians) to rotate `a` onto `b`, in (-PI, PI]. */
export function signedAngleBetween(a: Vec2, b: Vec2): number {
  return Math.atan2(cross(a, b), dot(a, b));
}

/** Angle in radians of the vector from a to b, using screen/math convention atan2(dy, dx). */
export function angleOf(a: Vec2, b: Vec2): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export function pointAtAngleLength(origin: Vec2, angleRad: number, len: number): Vec2 {
  return { x: origin.x + Math.cos(angleRad) * len, y: origin.y + Math.sin(angleRad) * len };
}

/** Normalizes an angle to (-PI, PI]. */
export function normalizeAngle(angleRad: number): number {
  let a = angleRad % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/** Smallest absolute difference between two angles, result in [0, PI]. */
export function angleDelta(a: number, b: number): number {
  return Math.abs(normalizeAngle(a - b));
}

export function nearestGridPoint(p: Vec2, gridSize: number): Vec2 {
  if (gridSize <= 0) return p;
  return {
    x: Math.round(p.x / gridSize) * gridSize,
    y: Math.round(p.y / gridSize) * gridSize,
  };
}

/** Mean advance width of a sans-serif glyph as a fraction of the font's em size. */
const AVERAGE_GLYPH_ASPECT = 0.55;

/**
 * Half-width and half-height of a run of text drawn centered on its position at
 * `fontSize` — the box a text annotation occupies, for hit-testing and view-fitting.
 * Deliberately an estimate from the string's length rather than `measureText`: callers
 * (the select tool mid-drag, the symbol editor, the PDF export's camera fit) have no
 * canvas context in scope, and both canvases need the *same* box to agree on what a click
 * lands in — a stable approximation serves that better than exact ink extents that vary
 * with font and zoom.
 */
export function textHalfExtent(text: string, fontSize: number): Vec2 {
  return { x: (text.length * fontSize * AVERAGE_GLYPH_ASPECT) / 2, y: fontSize / 2 };
}

export interface Projection {
  point: Vec2;
  t: number; // 0..1 along segment, may fall outside if closest point is beyond an endpoint
  distance: number;
}

/** Closest point on segment a-b to p (clamped to the segment). */
export function projectPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Projection {
  const ab = subtract(b, a);
  const abLenSq = ab.x * ab.x + ab.y * ab.y;
  let t = abLenSq === 0 ? 0 : ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / abLenSq;
  t = Math.max(0, Math.min(1, t));
  const point = add(a, scale(ab, t));
  return { point, t, distance: distance(p, point) };
}

// ---------------------------------------------------------------------------------
// Arcs. An arc is defined by two endpoints (ordinary graph points) plus a `bulge`
// (the DXF/AutoCAD convention: bulge = tan(includedAngle / 4), sign = sweep direction).
// Center/radius are always *derived* from (start, end, bulge) rather than stored, so an
// arc's endpoints stay ordinary points with full connectivity/snapping/drag support.
// ---------------------------------------------------------------------------------

const BULGE_EPSILON = 1e-6;

export interface ArcGeometry {
  center: Vec2;
  radius: number;
  startAngle: number;
  endAngle: number;
  /** Matches CanvasRenderingContext2D.arc's `anticlockwise` param directly. */
  anticlockwise: boolean;
  /** True when bulge is ~0: no meaningful curve. center/radius/angles are unset (0). */
  isStraight: boolean;
}

/** Derives center/radius/sweep from two endpoints and a bulge factor. */
export function arcGeometry(start: Vec2, end: Vec2, bulge: number): ArcGeometry {
  const chord = subtract(end, start);
  const chordLen = length(chord);
  if (chordLen < 1e-9 || Math.abs(bulge) < BULGE_EPSILON) {
    return { center: midpoint(start, end), radius: 0, startAngle: 0, endAngle: 0, anticlockwise: false, isStraight: true };
  }
  const theta = 4 * Math.atan(bulge); // signed included angle
  const half = chordLen / 2;
  const radius = Math.abs(half / Math.sin(theta / 2));
  const apothem = half / Math.tan(theta / 2); // signed distance from chord midpoint to center
  const perp = normalize(rotate90(chord));
  const center = add(midpoint(start, end), scale(perp, apothem));
  return {
    center,
    radius,
    startAngle: angleOf(center, start),
    endAngle: angleOf(center, end),
    anticlockwise: bulge < 0,
    isStraight: false,
  };
}

function normalizeTau(a: number): number {
  const t = a % (Math.PI * 2);
  return t < 0 ? t + Math.PI * 2 : t;
}

/** Whether `angle` falls within the sweep from startAngle to endAngle in the given direction. */
export function isAngleInSweep(angle: number, startAngle: number, endAngle: number, anticlockwise: boolean): boolean {
  if (anticlockwise) return isAngleInSweep(angle, endAngle, startAngle, false);
  const a = normalizeTau(angle);
  const s = normalizeTau(startAngle);
  const e = normalizeTau(endAngle);
  return e >= s ? a >= s && a <= e : a >= s || a <= e;
}

/** Closest point *on the arc itself* to p (clamped to its two endpoints, like projectPointOnSegment). */
export function projectPointOnArc(p: Vec2, start: Vec2, end: Vec2, bulge: number): Projection {
  const geo = arcGeometry(start, end, bulge);
  if (geo.isStraight) return projectPointOnSegment(p, start, end);

  const angleP = angleOf(geo.center, p);
  if (isAngleInSweep(angleP, geo.startAngle, geo.endAngle, geo.anticlockwise)) {
    const point = pointAtAngleLength(geo.center, angleP, geo.radius);
    return { point, t: 0.5, distance: Math.abs(distance(p, geo.center) - geo.radius) };
  }
  const dStart = distance(p, start);
  const dEnd = distance(p, end);
  return dStart <= dEnd ? { point: start, t: 0, distance: dStart } : { point: end, t: 1, distance: dEnd };
}

/**
 * Recovers a bulge value from a cursor position while interactively curving an arc: the
 * cursor's signed perpendicular distance from the chord (the sagitta, h) determines
 * curvature via bulge = -2h / chordLength. (Negated: for `arcGeometry`'s specific
 * perp/apothem convention, the arc's true sagitta peak sits at `chordMidpoint - perp*s`
 * where s = bulge*halfChord, not `+ perp*s` — verified by the round-trip test below,
 * which feeds a bulge back through arcGeometry and checks the cursor lands back on the
 * resulting arc.) Used both by the arc draw tool (on commit) and the renderer (for the
 * live curve preview) so the formula lives in exactly one place.
 */
export function bulgeFromSagittaCursor(start: Vec2, end: Vec2, cursor: Vec2): number {
  const chord = subtract(end, start);
  const chordLen = length(chord);
  if (chordLen < 1e-9) return 0;
  const perp = normalize(rotate90(chord));
  const h = dot(subtract(cursor, midpoint(start, end)), perp);
  return (-2 * h) / chordLen;
}

/** Forward (start->end sense) unit tangent direction of an arc at one of its endpoints —
 * the derivative of the sweep parameterization, oriented by `anticlockwise`. Two edges
 * sharing a point are smoothly tangent exactly when this vector agrees for both of them
 * at that point (no sign-flip bookkeeping needed depending on which endpoint is shared). */
export function arcTangentDirection(geo: ArcGeometry, atStart: boolean): Vec2 {
  const angle = atStart ? geo.startAngle : geo.endAngle;
  const sign = geo.anticlockwise ? -1 : 1;
  return { x: sign * -Math.sin(angle), y: sign * Math.cos(angle) };
}

/** Position on the arc at sweep fraction t (0 = start, 1 = end) — the inverse of
 * arcSweepFraction. Callers should check `geo.isStraight` first (this returns the
 * center, which is meaningless, for a degenerate zero-bulge "arc"). */
export function pointAtArcFraction(geo: ArcGeometry, t: number): Vec2 {
  if (geo.isStraight) return geo.center;
  const twoPi = Math.PI * 2;
  const mod = (x: number) => ((x % twoPi) + twoPi) % twoPi;
  const total = geo.anticlockwise ? mod(geo.startAngle - geo.endAngle) : mod(geo.endAngle - geo.startAngle);
  const angle = geo.anticlockwise ? geo.startAngle - t * total : geo.startAngle + t * total;
  return pointAtAngleLength(geo.center, angle, geo.radius);
}

/**
 * Bulge for the arc from `start` to `end` whose forward tangent direction at `start`
 * equals `tangentDirAtStart` (closed-form via the tangent-chord angle theorem: the angle
 * between a circle's tangent at a point and the chord to another point on the circle is
 * exactly half the included angle subtended by that chord).
 */
export function bulgeForTangentAtStart(start: Vec2, tangentDirAtStart: Vec2, end: Vec2): number {
  const chordDir = normalize(subtract(end, start));
  const angle = signedAngleBetween(tangentDirAtStart, chordDir);
  return Math.tan(angle / 2);
}

/** Same as `bulgeForTangentAtStart`, but constraining the tangent direction at `end`
 * instead. Derived from the identity that arc(S,E,b) and arc(E,S,-b) are the same curve
 * traversed oppositely, so this reduces to the start-case with start/end swapped and the
 * direction negated (arriving-at-E forward direction == departing-from-E reversed direction). */
export function bulgeForTangentAtEnd(start: Vec2, end: Vec2, tangentDirAtEnd: Vec2): number {
  return -bulgeForTangentAtStart(end, negate(tangentDirAtEnd), start);
}

/** Fraction (0..1) of the way through the arc's sweep that `angle` falls, given the
 * sweep's direction. Used to split an arc at an arbitrary point along it. */
export function arcSweepFraction(angle: number, startAngle: number, endAngle: number, anticlockwise: boolean): number {
  const twoPi = Math.PI * 2;
  const mod = (x: number) => ((x % twoPi) + twoPi) % twoPi;
  const total = anticlockwise ? mod(startAngle - endAngle) : mod(endAngle - startAngle);
  const partial = anticlockwise ? mod(startAngle - angle) : mod(angle - startAngle);
  return total === 0 ? 0 : partial / total;
}
