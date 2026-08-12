import type { Id, SceneGraphJSON, Vec2 } from '../../types/geometry';
import { bulgeForTangentAtEnd, bulgeForTangentAtStart, bulgeFromSagittaCursor, distance } from '../geometry';
import type { SceneGraph } from '../sceneGraph';
import { computeSnap } from '../snapping';
import { useSketchStore } from '../store/useSketchStore';
import type { ToolCtx } from './drawLineTool';
import { worldThreshold } from './drawLineTool';

/** A click qualifies for Shift-tangent if it snapped onto an existing point that touches
 * exactly one other line/arc (unambiguous reference edge). */
function tangentCandidateAt(pointId: Id | undefined): Id | undefined {
  if (!pointId) return undefined;
  const { graph } = useSketchStore.getState();
  if (graph.pointDegree(pointId) !== 1) return undefined;
  const edge = graph.linesOfPoint(pointId)[0] ?? graph.arcsOfPoint(pointId)[0];
  return edge?.id;
}

/**
 * Three clicks: 1) start point, 2) end point / chord, 3) curvature (drag then click to
 * set the bulge via the cursor's perpendicular offset from the chord). No chaining
 * afterward (unlike the line tool) — each arc is its own gesture.
 *
 * Holding Shift on click 1 or click 2, if that click landed on a qualifying point (see
 * `tangentCandidateAt`), locks the arc's tangent direction there to match the existing
 * line/arc — the bulge is then fully determined already, so the arc commits immediately
 * on click 2 instead of waiting for a third click. `tangentStart` takes priority if,
 * unusually, both ends would qualify — true two-reference tangency (a fillet) is built
 * by SceneGraph.filletAtPoint instead, not the freehand draw tool (see the plan).
 */
export function drawArcOnPointerDown(world: Vec2, shiftKey: boolean, ctx: ToolCtx) {
  const { graph, gridSize, commit } = useSketchStore.getState();
  const { interaction } = ctx;

  if (!interaction.drawArc) {
    const snap = computeSnap({
      cursor: world,
      graph,
      threshold: worldThreshold(),
      gridSize,
      disabled: interaction.altHeld,
    });
    const tangentEdgeId = shiftKey ? tangentCandidateAt(snap.snappedPointId) : undefined;
    interaction.drawArc = {
      start: { pointId: snap.snappedPointId ?? null, pos: snap.point, tangentEdgeId },
      end: null,
      cursorWorld: world,
      snap,
    };
    ctx.requestRedraw();
    return;
  }

  const { start, end } = interaction.drawArc;

  if (!end) {
    const snap = computeSnap({
      cursor: world,
      graph,
      threshold: worldThreshold(),
      gridSize,
      originPoint: start.pos,
      excludePointId: start.pointId ?? undefined,
      disabled: interaction.altHeld,
    });
    if (distance(start.pos, snap.point) < 1e-6) return; // zero-length chord click, ignore
    const tangentEdgeId = shiftKey && !start.tangentEdgeId ? tangentCandidateAt(snap.snappedPointId) : undefined;
    const newEnd = { pointId: snap.snappedPointId ?? null, pos: snap.point, tangentEdgeId };

    if (start.tangentEdgeId || tangentEdgeId) {
      commitTangentArc(graph, commit, start, newEnd);
      interaction.drawArc = null;
      ctx.requestRedraw();
      return;
    }

    interaction.drawArc = { start, end: newEnd, cursorWorld: world, snap };
    ctx.requestRedraw();
    return;
  }

  // Third click (only reached when neither end got a tangent lock): commit with the
  // bulge implied by the current cursor position (grid/endpoint-snapped, same as any
  // other click).
  const curveSnap = computeSnap({ cursor: world, graph, threshold: worldThreshold(), gridSize, disabled: interaction.altHeld });
  const bulge = bulgeFromSagittaCursor(start.pos, end.pos, curveSnap.point);
  if (Math.abs(bulge) < 1e-6) {
    interaction.drawArc = null; // essentially a straight chord — not a useful arc, cancel
    ctx.requestRedraw();
    return;
  }

  const before = graph.toJSON();
  const startId = start.pointId ?? graph.addPoint(start.pos.x, start.pos.y).id;
  const endId = end.pointId ?? graph.addPoint(end.pos.x, end.pos.y).id;
  graph.addArc(startId, endId, bulge);
  commit(before);

  interaction.drawArc = null;
  ctx.requestRedraw();
}

type EndpointSpec = { pointId: Id | null; pos: Vec2; tangentEdgeId?: Id };

function commitTangentArc(graph: SceneGraph, commit: (before: SceneGraphJSON) => void, start: EndpointSpec, end: EndpointSpec) {
  const before = graph.toJSON();
  const startId = start.pointId ?? graph.addPoint(start.pos.x, start.pos.y).id;
  const endId = end.pointId ?? graph.addPoint(end.pos.x, end.pos.y).id;
  const startPt = graph.points.get(startId)!;
  const endPt = graph.points.get(endId)!;

  let bulge = 0;
  if (start.tangentEdgeId) {
    const ref = graph.edgeOfId(start.tangentEdgeId);
    if (ref) bulge = bulgeForTangentAtStart(startPt, graph.getTangentDirectionAt(ref, startId), endPt);
  } else if (end.tangentEdgeId) {
    const ref = graph.edgeOfId(end.tangentEdgeId);
    if (ref) bulge = bulgeForTangentAtEnd(startPt, endPt, graph.getTangentDirectionAt(ref, endId));
  }

  const arc = graph.addArc(startId, endId, bulge);
  if (arc) {
    if (start.tangentEdgeId) arc.tangentStart = { edgeId: start.tangentEdgeId };
    else if (end.tangentEdgeId) arc.tangentEnd = { edgeId: end.tangentEdgeId };
  }
  commit(before);
}

export function drawArcOnPointerMove(world: Vec2, ctx: ToolCtx) {
  const { graph, gridSize } = useSketchStore.getState();
  const { interaction } = ctx;
  if (!interaction.drawArc) return;

  const { start, end } = interaction.drawArc;
  if (!end) {
    const snap = computeSnap({
      cursor: world,
      graph,
      threshold: worldThreshold(),
      gridSize,
      originPoint: start.pos,
      excludePointId: start.pointId ?? undefined,
      disabled: interaction.altHeld,
    });
    interaction.drawArc = { start, end: null, cursorWorld: world, snap };
  } else {
    // Curving: the sagitta/curvature point grid/endpoint-snaps too, same as any other
    // click (no H/V axis inference here — that's not a meaningful concept for a curve).
    const snap = computeSnap({ cursor: world, graph, threshold: worldThreshold(), gridSize, disabled: interaction.altHeld });
    interaction.drawArc = { start, end, cursorWorld: world, snap };
  }
  ctx.requestRedraw();
}

export function drawArcCancel(ctx: ToolCtx) {
  ctx.interaction.drawArc = null;
  ctx.requestRedraw();
}
