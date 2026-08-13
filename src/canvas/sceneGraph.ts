import type { Arc, AxisLock, ComponentInstance, ComponentSnapshot, Id, Line, Point, SceneGraphJSON, TextAnnotation, Vec2 } from '../types/geometry';
import {
  add,
  angleOf,
  arcGeometry,
  type ArcGeometry,
  arcSweepFraction,
  arcTangentDirection,
  bulgeForTangentAtEnd,
  bulgeForTangentAtStart,
  distance,
  dot,
  normalize,
  pointAtAngleLength,
  projectPointOnArc,
  projectPointOnSegment,
  rotate,
  scale,
  subtract,
} from './geometry';

let idCounter = 0;
/** Sequential, sortable ids — fine for a local single-user document, no coordination needed. */
function nextId(prefix: string): Id {
  idCounter += 1;
  return `${prefix}_${idCounter.toString(36)}`;
}

/**
 * The sketch's connectivity graph: points (shared vertices), lines, and arcs between them.
 *
 * This is intentionally NOT a numerical constraint solver. Three behaviors give it most
 * of the useful "relationship" feel of a CAD sketch without that complexity:
 *
 *  - Coincidence is real: a snapped endpoint IS the same Point object, referenced by every
 *    line/arc that touches it (see mergePoints).
 *  - Axis locks are enforced locally: moving a point walks its axis-locked line neighbors
 *    (a line-only concept — arcs have no axis lock) via breadth-first propagation
 *    (visited-set guarded, so cycles just stop rather than loop forever or get "solved").
 *  - Arc tangency is enforced by recomputing bulge (never moving a point) via a
 *    closed-form formula, re-run for every tangent arc whenever anything moves (see
 *    enforceAllTangents) — a few cheap passes to let short chains settle, not a solver.
 */
export class SceneGraph {
  points = new Map<Id, Point>();
  lines = new Map<Id, Line>();
  arcs = new Map<Id, Arc>();
  components = new Map<Id, ComponentInstance>();
  /** Free text annotations. Not part of the connectivity graph at all (see TextAnnotation)
   * — kept here so they travel with the scene through toJSON/fromJSON, which is what gives
   * them undo/redo, save/load and PDF export for free. */
  texts = new Map<Id, TextAnnotation>();
  /** pointId -> set of edge ids (line or arc) touching it. Kept in sync by every mutator. */
  private adjacency = new Map<Id, Set<Id>>();
  /** pointId -> owning component instance id, for connection points. A component's ports
   * are ordinary Points (full snapping/connectivity for free) but must never be
   * independently dragged/removed/merged-away — see pointDegree, removePoint, mergePoints. */
  private pointOwner = new Map<Id, Id>();

  private touch(pointId: Id, edgeId: Id) {
    let set = this.adjacency.get(pointId);
    if (!set) {
      set = new Set();
      this.adjacency.set(pointId, set);
    }
    set.add(edgeId);
  }

  private untouch(pointId: Id, edgeId: Id) {
    this.adjacency.get(pointId)?.delete(edgeId);
  }

  /** Lines only — used by movePoint's axis-lock BFS, which is a line-only concept. */
  linesOfPoint(pointId: Id): Line[] {
    const ids = this.adjacency.get(pointId);
    if (!ids) return [];
    const out: Line[] = [];
    for (const id of ids) {
      const line = this.lines.get(id);
      if (line) out.push(line);
    }
    return out;
  }

  arcsOfPoint(pointId: Id): Arc[] {
    const ids = this.adjacency.get(pointId);
    if (!ids) return [];
    const out: Arc[] = [];
    for (const id of ids) {
      const arc = this.arcs.get(id);
      if (arc) out.push(arc);
    }
    return out;
  }

  /** Any edge (line or arc) touching a point, for callers that don't care which kind. */
  edgeOfId(edgeId: Id): Line | Arc | undefined {
    return this.lines.get(edgeId) ?? this.arcs.get(edgeId);
  }

  /** Total number of lines + arcs touching a point, plus 1 if it's a component's
   * connection port. Used to gate whole-body rigid drag (only safe when an endpoint
   * isn't shared with any other edge *or* owned by a component) and to find corners
   * eligible for fillet/tangent operations. */
  pointDegree(pointId: Id): number {
    return (this.adjacency.get(pointId)?.size ?? 0) + (this.pointOwner.has(pointId) ? 1 : 0);
  }

  /** The component instance that owns this point as a connection port, if any. */
  componentOwning(pointId: Id): Id | undefined {
    return this.pointOwner.get(pointId);
  }

  otherEndpoint(edge: Line | Arc, pointId: Id): Id {
    return edge.startId === pointId ? edge.endId : edge.startId;
  }

  addPoint(x: number, y: number, id: Id = nextId('pt')): Point {
    const p: Point = { id, x, y };
    this.points.set(id, p);
    return p;
  }

  /** Creates a line between two existing points. Does not create points. */
  addLine(startId: Id, endId: Id, axisLock: AxisLock = null, id: Id = nextId('ln')): Line | null {
    if (startId === endId) return null; // degenerate
    const line: Line = { id, startId, endId, axisLock };
    this.lines.set(id, line);
    this.touch(startId, id);
    this.touch(endId, id);
    return line;
  }

  /** Creates an arc between two existing points. Does not create points. */
  addArc(startId: Id, endId: Id, bulge: number, id: Id = nextId('arc')): Arc | null {
    if (startId === endId) return null; // degenerate
    const arc: Arc = { id, startId, endId, bulge };
    this.arcs.set(id, arc);
    this.touch(startId, id);
    this.touch(endId, id);
    return arc;
  }

  removeLine(id: Id) {
    const line = this.lines.get(id);
    if (!line) return;
    this.untouch(line.startId, id);
    this.untouch(line.endId, id);
    this.lines.delete(id);
  }

  removeArc(id: Id) {
    const arc = this.arcs.get(id);
    if (!arc) return;
    this.untouch(arc.startId, id);
    this.untouch(arc.endId, id);
    this.arcs.delete(id);
  }

  /** Removes a point only if nothing references it. Returns false if it's still in use. */
  removePoint(id: Id): boolean {
    if (this.pointDegree(id) > 0) return false;
    this.points.delete(id);
    this.adjacency.delete(id);
    return true;
  }

  getLineLength(line: Line): number {
    return distance(this.points.get(line.startId)!, this.points.get(line.endId)!);
  }

  getLineAngle(line: Line): number {
    return angleOf(this.points.get(line.startId)!, this.points.get(line.endId)!);
  }

  /** Derives an arc's live center/radius/sweep from its current endpoint positions. */
  getArcGeometry(arc: Arc): ArcGeometry {
    return arcGeometry(this.points.get(arc.startId)!, this.points.get(arc.endId)!, arc.bulge);
  }

  /** The edge's unit "forward direction of travel" at one of its endpoints — constant
   * along a line, the sweep derivative for an arc. Two edges sharing a point are tangent
   * exactly when this vector agrees for both at that point. */
  getTangentDirectionAt(edge: Line | Arc, pointId: Id): Vec2 {
    const other = this.points.get(this.otherEndpoint(edge, pointId))!;
    const p = this.points.get(pointId)!;
    if (!('bulge' in edge)) return normalize(subtract(p, other)); // Line: constant direction
    const geo = this.getArcGeometry(edge);
    if (geo.isStraight) return normalize(subtract(p, other));
    return arcTangentDirection(geo, edge.startId === pointId);
  }

  /**
   * Moves a point and propagates the move through axis-locked line neighbors via BFS.
   * When line L (H or V locked) touches a point that moved, the OTHER endpoint of L is
   * adjusted so the line stays on-axis: H keeps y equal, V keeps x equal. That other
   * endpoint is then itself treated as "moved" and its own axis-locked lines are walked
   * the same way. A visited set prevents infinite loops on closed axis-locked loops
   * (e.g. a rectangle) — propagation simply stops when it reaches an already-visited point.
   * Afterward, every tangent-locked arc's bulge is recomputed (see enforceAllTangents).
   */
  movePoint(id: Id, x: number, y: number) {
    const start = this.points.get(id);
    if (!start) return;
    start.x = x;
    start.y = y;

    const visited = new Set<Id>([id]);
    const queue: Id[] = [id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const line of this.linesOfPoint(current)) {
        if (!line.axisLock) continue;
        const otherId = this.otherEndpoint(line, current);
        if (visited.has(otherId)) continue;
        const cur = this.points.get(current)!;
        const other = this.points.get(otherId)!;
        if (line.axisLock === 'H' && other.y !== cur.y) {
          other.y = cur.y;
        } else if (line.axisLock === 'V' && other.x !== cur.x) {
          other.x = cur.x;
        } else {
          continue; // already on-axis, no change to propagate further from this edge
        }
        visited.add(otherId);
        queue.push(otherId);
      }
    }

    this.enforceAllTangents();
  }

  /**
   * Merges `mergeId` into `keepId`: every line/arc referencing mergeId now references
   * keepId, and mergeId is discarded. Used when a drag ends near another point (endpoint
   * snap) — including a pipe snapping onto a component's connection port, which is how a
   * pipe "connects" to a component. Any edge that would become degenerate (both endpoints
   * equal) is dropped instead. A component-owned point is never the one discarded: if
   * `mergeId` is owned, the merge direction is swapped so the port id survives (and the
   * dragged point's identity is absorbed into it instead); if *both* are owned, the merge
   * is refused outright rather than corrupting either component.
   */
  mergePoints(keepId: Id, mergeId: Id) {
    if (keepId === mergeId) return;
    if (this.pointOwner.has(mergeId)) {
      if (this.pointOwner.has(keepId)) return; // both owned — refuse rather than corrupt either
      [keepId, mergeId] = [mergeId, keepId];
    }
    const edgeIds = [...(this.adjacency.get(mergeId) ?? [])];
    for (const edgeId of edgeIds) {
      const edge = this.edgeOfId(edgeId);
      if (!edge) continue;
      this.untouch(mergeId, edgeId);
      if (edge.startId === mergeId) edge.startId = keepId;
      if (edge.endId === mergeId) edge.endId = keepId;
      if (edge.startId === edge.endId) {
        // degenerate after merge (both endpoints collapsed onto the same point)
        this.untouch(edge.startId, edgeId);
        this.lines.delete(edgeId);
        this.arcs.delete(edgeId);
      } else {
        this.touch(keepId, edgeId);
      }
    }
    this.points.delete(mergeId);
    this.adjacency.delete(mergeId);
    this.enforceAllTangents();
  }

  /** Sets a line's length, keeping its start point fixed and moving (propagating) its end. */
  setLineLength(lineId: Id, newLength: number) {
    const line = this.lines.get(lineId);
    if (!line || newLength <= 0) return;
    const startPt = this.points.get(line.startId)!;
    const angle = this.getLineAngle(line);
    const next = pointAtAngleLength(startPt, angle, newLength);
    this.movePoint(line.endId, next.x, next.y);
  }

  /** Sets a line's angle (radians), keeping its start point fixed and moving its end. */
  setLineAngle(lineId: Id, newAngleRad: number) {
    const line = this.lines.get(lineId);
    if (!line) return;
    const startPt = this.points.get(line.startId)!;
    const len = this.getLineLength(line);
    const next = pointAtAngleLength(startPt, newAngleRad, len);
    this.movePoint(line.endId, next.x, next.y);
  }

  /** Sets a line's axis lock and, if turning one on, immediately snaps the line onto that
   * axis (end point matches start point's y/x) instead of waiting for a future drag to
   * reveal it — the lock should visibly take effect the moment it's applied. */
  setAxisLock(lineId: Id, axisLock: AxisLock) {
    const line = this.lines.get(lineId);
    if (!line) return;
    line.axisLock = axisLock;
    if (axisLock === 'H' || axisLock === 'V') {
      const start = this.points.get(line.startId)!;
      const end = this.points.get(line.endId)!;
      if (axisLock === 'H' && end.y !== start.y) this.movePoint(line.endId, end.x, start.y);
      else if (axisLock === 'V' && end.x !== start.x) this.movePoint(line.endId, start.x, end.y);
    }
  }

  /** Sets an arc's curvature directly, keeping both endpoints fixed (direct parametric
   * edit). If the arc is itself tangent-locked, the tangent constraint wins immediately
   * afterward (the Properties Panel keeps bulge read-only in that case to avoid a
   * confusing "typed a value and it snapped back" experience). */
  setArcBulge(arcId: Id, bulge: number) {
    const arc = this.arcs.get(arcId);
    if (arc) arc.bulge = bulge;
    this.enforceAllTangents();
  }

  /** Recomputes one tangent-locked arc's bulge from its current geometry. `tangentStart`
   * takes priority if both are set (see the plan's note on why freehand-drawn arcs can
   * only reliably honor one at a time — true two-reference tangency is built by
   * filletAtPoint instead, which constructs consistent geometry up front). */
  enforceTangent(arc: Arc) {
    const start = this.points.get(arc.startId);
    const end = this.points.get(arc.endId);
    if (!start || !end) return;
    if (arc.tangentStart) {
      const ref = this.edgeOfId(arc.tangentStart.edgeId);
      if (ref) {
        arc.bulge = bulgeForTangentAtStart(start, this.getTangentDirectionAt(ref, arc.startId), end);
        return;
      }
    }
    if (arc.tangentEnd) {
      const ref = this.edgeOfId(arc.tangentEnd.edgeId);
      if (ref) arc.bulge = bulgeForTangentAtEnd(start, end, this.getTangentDirectionAt(ref, arc.endId));
    }
  }

  /** Re-settles every tangent-locked arc's bulge. A few passes (not a solver) so short
   * tangent chains (arc tangent to an arc tangent to a line) converge reasonably. */
  enforceAllTangents() {
    for (let pass = 0; pass < 3; pass++) {
      for (const arc of this.arcs.values()) {
        if (arc.tangentStart || arc.tangentEnd) this.enforceTangent(arc);
      }
    }
  }

  /** Turns tangency at an arc's start on (locked to `edgeId`) or off (`null`), applying
   * immediately like setAxisLock does. */
  setTangentStart(arcId: Id, edgeId: Id | null) {
    const arc = this.arcs.get(arcId);
    if (!arc) return;
    if (edgeId === null) delete arc.tangentStart;
    else arc.tangentStart = { edgeId };
    this.enforceAllTangents();
  }

  setTangentEnd(arcId: Id, edgeId: Id | null) {
    const arc = this.arcs.get(arcId);
    if (!arc) return;
    if (edgeId === null) delete arc.tangentEnd;
    else arc.tangentEnd = { edgeId };
    this.enforceAllTangents();
  }

  /** `excludeComponentId` skips every point owned by that component (its own ports) —
   * used while dragging a component so it doesn't "snap" to itself. */
  nearestPoint(p: Vec2, excludeId?: Id, excludeComponentId?: Id): { point: Point; distance: number } | null {
    let best: { point: Point; distance: number } | null = null;
    for (const point of this.points.values()) {
      if (point.id === excludeId) continue;
      if (excludeComponentId && this.pointOwner.get(point.id) === excludeComponentId) continue;
      const d = distance(p, point);
      if (!best || d < best.distance) best = { point, distance: d };
    }
    return best;
  }

  /** Splits a line into two at `at`, inserting a new point there. Each half keeps the
   * original's axisLock. Returns the new point, or null if the line doesn't exist. */
  splitLine(lineId: Id, at: Vec2): Point | null {
    const line = this.lines.get(lineId);
    if (!line) return null;
    const { startId, endId, axisLock } = line;
    this.removeLine(lineId);
    const mid = this.addPoint(at.x, at.y);
    this.addLine(startId, mid.id, axisLock);
    this.addLine(mid.id, endId, axisLock);
    return mid;
  }

  /** Splits an arc into two at `at` (projected onto the arc if not exactly on it),
   * dividing its included angle proportionally so both halves are true sub-arcs of the
   * original circle. Returns the new point, or null if the arc doesn't exist. */
  splitArc(arcId: Id, at: Vec2): Point | null {
    const arc = this.arcs.get(arcId);
    if (!arc) return null;
    const start = this.points.get(arc.startId)!;
    const end = this.points.get(arc.endId)!;
    const geo = this.getArcGeometry(arc);

    let splitPos: Vec2;
    let bulge1: number;
    let bulge2: number;
    if (geo.isStraight) {
      splitPos = projectPointOnSegment(at, start, end).point;
      bulge1 = 0;
      bulge2 = 0;
    } else {
      splitPos = projectPointOnArc(at, start, end, arc.bulge).point;
      const t = arcSweepFraction(angleOf(geo.center, splitPos), geo.startAngle, geo.endAngle, geo.anticlockwise);
      const theta = 4 * Math.atan(arc.bulge);
      bulge1 = Math.tan((t * theta) / 4);
      bulge2 = Math.tan(((1 - t) * theta) / 4);
    }

    this.removeArc(arcId);
    const mid = this.addPoint(splitPos.x, splitPos.y);
    this.addArc(arc.startId, mid.id, bulge1);
    this.addArc(mid.id, arc.endId, bulge2);
    return mid;
  }

  /**
   * Fillets the corner at `pointId` where exactly two lines meet (and no arcs), replacing
   * it with a tangent arc of `radius`: both lines are trimmed back to new tangent points
   * at `radius / tan(angleBetween / 2)` from the corner (the standard fillet setback),
   * the corner point is discarded, and the new arc is created with tangentStart/tangentEnd
   * set to the two (now-trimmed) lines. Line+arc / arc+arc corners aren't supported here
   * (a meaningfully different construction — tangent-to-circle, not tangent-to-line).
   * Returns null (no-op) if the corner doesn't qualify or the radius doesn't fit.
   */
  filletAtPoint(pointId: Id, radius: number): Arc | null {
    if (radius <= 0) return null;
    if (this.pointOwner.has(pointId)) return null; // component port, not a plain corner
    if (this.arcsOfPoint(pointId).length !== 0) return null;
    const lines = this.linesOfPoint(pointId);
    if (lines.length !== 2) return null;
    const [lineA, lineB] = lines;
    const corner = this.points.get(pointId);
    if (!corner) return null;

    const otherA = this.points.get(this.otherEndpoint(lineA, pointId))!;
    const otherB = this.points.get(this.otherEndpoint(lineB, pointId))!;
    const lenA = distance(corner, otherA);
    const lenB = distance(corner, otherB);
    if (lenA < 1e-9 || lenB < 1e-9) return null;
    const dirA = normalize(subtract(otherA, corner));
    const dirB = normalize(subtract(otherB, corner));

    const angleBetween = Math.acos(Math.max(-1, Math.min(1, dot(dirA, dirB))));
    if (angleBetween < 1e-3 || angleBetween > Math.PI - 1e-3) return null; // ~collinear
    const setback = radius / Math.tan(angleBetween / 2);
    if (!Number.isFinite(setback) || setback <= 0 || setback >= lenA || setback >= lenB) return null;

    const tangentA = add(corner, scale(dirA, setback));
    const tangentB = add(corner, scale(dirB, setback));
    const pA = this.addPoint(tangentA.x, tangentA.y);
    const pB = this.addPoint(tangentB.x, tangentB.y);

    if (lineA.startId === pointId) lineA.startId = pA.id;
    else lineA.endId = pA.id;
    this.untouch(pointId, lineA.id);
    this.touch(pA.id, lineA.id);

    if (lineB.startId === pointId) lineB.startId = pB.id;
    else lineB.endId = pB.id;
    this.untouch(pointId, lineB.id);
    this.touch(pB.id, lineB.id);

    this.removePoint(pointId); // now unreferenced

    const arc = this.addArc(pA.id, pB.id, 1 /* placeholder, corrected below */)!;
    arc.tangentStart = { edgeId: lineA.id };
    arc.tangentEnd = { edgeId: lineB.id };
    this.enforceTangent(arc);
    return arc;
  }

  /**
   * Places a component instance: creates one connection Point per `snapshot.symbol.ports`
   * entry, transformed into world space by `position`/`rotation`. The decorative body
   * (the rest of `symbol`'s geometry) is not graph data at all — the renderer draws it
   * purely from the instance's transform, like a stamp (see the plan's "key design
   * decision" section).
   */
  addComponent(params: {
    categoryId: string;
    realPartId: string | null;
    tag: string;
    /** Optional descriptive name — only ever set by a caller reinstating one (paste); a
     * freshly placed component starts unnamed. */
    name?: string;
    position: Vec2;
    rotation: number;
    snapshot: ComponentSnapshot;
    id?: Id;
    /** Global component-size multiplier in effect at placement time — see moveComponent. */
    scaleFactor?: number;
  }): ComponentInstance {
    const id = params.id ?? nextId('cmp');
    const factor = params.scaleFactor ?? 1;
    const { symbol } = params.snapshot;
    const connections = symbol.ports.map((localId) => {
      const local = symbol.points[localId];
      const world = add(params.position, rotate(scale(local, factor), params.rotation));
      const point = this.addPoint(world.x, world.y);
      this.pointOwner.set(point.id, id);
      return { localId, pointId: point.id };
    });
    const instance = this.cloneComponent({
      id,
      categoryId: params.categoryId,
      realPartId: params.realPartId,
      tag: params.tag,
      ...(params.name ? { name: params.name } : {}),
      position: params.position,
      rotation: params.rotation,
      connections,
      snapshot: params.snapshot,
    });
    this.components.set(id, instance);
    return instance;
  }

  /** Moves/rotates/rescales a component instance as a rigid unit: recomputes each port's
   * world position from the new transform and runs it through movePoint, so any pipes
   * attached to those ports follow via the propagation that already exists — no separate
   * drag logic needed for "component connected to a pipe" vs. any other connected point.
   * `scaleFactor` defaults to 1 for callers that only mean to move/rotate; the global
   * component-scale setting passes its current value through on every call (including a
   * plain drag) so an instance always reflects the live scale, and the store's
   * `setComponentScale` action can rescale every placed instance in one pass by simply
   * re-calling this with each instance's *existing* position/rotation and the new scale. */
  moveComponent(id: Id, position: Vec2, rotation: number, scaleFactor = 1) {
    const instance = this.components.get(id);
    if (!instance) return;
    instance.position = { ...position };
    instance.rotation = rotation;
    const { symbol } = instance.snapshot;
    for (const conn of instance.connections) {
      const local = symbol.points[conn.localId] ?? { x: 0, y: 0 };
      const world = add(position, rotate(scale(local, scaleFactor), rotation));
      this.movePoint(conn.pointId, world.x, world.y);
    }
  }

  /** Removes a component instance, refusing (like removePoint/removeLine's callers
   * already expect) if any of its ports still has a pipe attached — forces an explicit
   * disconnect first rather than silently deleting connected geometry. */
  removeComponent(id: Id): boolean {
    const instance = this.components.get(id);
    if (!instance) return false;
    for (const conn of instance.connections) {
      if ((this.adjacency.get(conn.pointId)?.size ?? 0) > 0) return false;
    }
    for (const conn of instance.connections) {
      this.pointOwner.delete(conn.pointId);
      this.points.delete(conn.pointId);
      this.adjacency.delete(conn.pointId);
    }
    this.components.delete(id);
    return true;
  }

  private cloneSnapshot(s: ComponentSnapshot): ComponentSnapshot {
    return { ...s, realPart: s.realPart ? { ...s.realPart, specs: { ...s.realPart.specs } } : null };
  }

  private cloneComponent(c: ComponentInstance): ComponentInstance {
    return {
      ...c,
      position: { ...c.position },
      connections: c.connections.map((cc) => ({ ...cc })),
      snapshot: this.cloneSnapshot(c.snapshot),
    };
  }

  setComponentTag(id: Id, tag: string) {
    const instance = this.components.get(id);
    if (instance) instance.tag = tag;
  }

  /** Renames a placed instance. An empty/whitespace-only name drops the field entirely
   * (rather than storing ''), so "no name" is a single state everywhere downstream — the
   * renderer and the serialized project file both just see an absent `name`. */
  setComponentName(id: Id, name: string) {
    const instance = this.components.get(id);
    if (!instance) return;
    const trimmed = name.trim();
    if (trimmed) instance.name = trimmed;
    else delete instance.name;
  }

  /** Reassigns a placed instance's real part — the Properties Panel's "Change Part"
   * picker is scoped to the instance's own category (a category's port count/symbol are
   * fixed by construction, so real parts within it are always port-compatible), but this
   * still refuses if the port count would somehow differ, as a defensive backstop.
   * Returns whether it succeeded. */
  setComponentPart(id: Id, realPartId: string | null, snapshot: ComponentSnapshot): boolean {
    const instance = this.components.get(id);
    if (!instance) return false;
    if (snapshot.symbol.ports.length !== instance.connections.length) return false;
    instance.realPartId = realPartId;
    instance.snapshot = this.cloneSnapshot(snapshot);
    return true;
  }

  /** Places a free text annotation centered on (x, y). Content is stored trimmed, so
   * "blank" is a single state everywhere downstream — and callers never create one that's
   * blank to begin with, since an empty note would be invisible and unselectable. */
  addText(x: number, y: number, text: string, fontSize: number, id: Id = nextId('txt')): TextAnnotation {
    const annotation: TextAnnotation = { id, x, y, text: text.trim(), fontSize };
    this.texts.set(id, annotation);
    return annotation;
  }

  /** Rewrites a note's content. Emptying it deletes the note outright rather than leaving
   * an invisible one behind that could never be clicked again to fix — "delete the text"
   * is what clearing the field means. */
  setTextContent(id: Id, text: string) {
    const annotation = this.texts.get(id);
    if (!annotation) return;
    const trimmed = text.trim();
    if (trimmed) annotation.text = trimmed;
    else this.texts.delete(id);
  }

  /** Sets a note's height in world units. Non-positive sizes are ignored rather than
   * clamped to something arbitrary — the caller's input is simply not a size. */
  setTextFontSize(id: Id, fontSize: number) {
    const annotation = this.texts.get(id);
    if (annotation && fontSize > 0) annotation.fontSize = fontSize;
  }

  /** Moves a note. Nothing propagates: an annotation has no connectivity to carry a move
   * through, which is why this isn't movePoint. */
  moveText(id: Id, x: number, y: number) {
    const annotation = this.texts.get(id);
    if (!annotation) return;
    annotation.x = x;
    annotation.y = y;
  }

  removeText(id: Id) {
    this.texts.delete(id);
  }

  toJSON(): SceneGraphJSON {
    return {
      points: [...this.points.values()].map((p) => ({ ...p })),
      lines: [...this.lines.values()].map((l) => ({ ...l })),
      arcs: [...this.arcs.values()].map((a) => ({ ...a })),
      components: [...this.components.values()].map((c) => this.cloneComponent(c)),
      texts: [...this.texts.values()].map((t) => ({ ...t })),
    };
  }

  clone(): SceneGraph {
    return SceneGraph.fromJSON(this.toJSON());
  }

  static fromJSON(json: SceneGraphJSON): SceneGraph {
    const g = new SceneGraph();
    for (const p of json.points) g.addPoint(p.x, p.y, p.id);
    for (const l of json.lines) g.addLine(l.startId, l.endId, l.axisLock, l.id);
    for (const a of json.arcs ?? []) {
      const created = g.addArc(a.startId, a.endId, a.bulge, a.id);
      if (created) {
        if (a.tangentStart) created.tangentStart = a.tangentStart;
        if (a.tangentEnd) created.tangentEnd = a.tangentEnd;
      }
    }
    // Components' connection points already exist from the points loop above — just
    // reconstruct the instance and re-register port ownership (not addComponent, which
    // would create brand-new points instead of reusing the loaded ones).
    for (const c of json.components ?? []) {
      const instance = g.cloneComponent(c);
      g.components.set(instance.id, instance);
      for (const conn of instance.connections) g.pointOwner.set(conn.pointId, instance.id);
    }
    for (const t of json.texts ?? []) g.addText(t.x, t.y, t.text, t.fontSize, t.id);
    // Bump the id counter past anything loaded so freshly generated ids never collide.
    const allIds = [
      ...json.points.map((p) => p.id),
      ...json.lines.map((l) => l.id),
      ...(json.arcs ?? []).map((a) => a.id),
      ...(json.components ?? []).map((c) => c.id),
      ...(json.texts ?? []).map((t) => t.id),
    ];
    for (const id of allIds) {
      const suffix = id.split('_').pop() ?? '';
      const n = parseInt(suffix, 36);
      if (!Number.isNaN(n) && n > idCounter) idCounter = n;
    }
    return g;
  }
}

export { nextId };
