import { symbolLocalBounds } from '../../library/builtinSymbols';
import type { Arc, ComponentInstance, Id, Line, Vec2 } from '../../types/geometry';
import { distance, projectPointOnArc, projectPointOnSegment, rotate, subtract } from '../geometry';
import { computeSnap } from '../snapping';
import { useSketchStore } from '../store/useSketchStore';
import type { ToolCtx } from './drawLineTool';
import { worldThreshold } from './drawLineTool';

function hitTestPoint(world: Vec2, threshold: number) {
  const { graph } = useSketchStore.getState();
  const nearest = graph.nearestPoint(world);
  if (nearest && nearest.distance <= threshold) return nearest.point;
  return null;
}

type EdgeHit = { kind: 'line'; line: Line } | { kind: 'arc'; arc: Arc };

/** Combined line+arc hit test, keeping whichever candidate is closer to the cursor. */
function hitTestEdge(world: Vec2, threshold: number): EdgeHit | null {
  const { graph } = useSketchStore.getState();
  let best: (EdgeHit & { distance: number }) | null = null;

  for (const line of graph.lines.values()) {
    const a = graph.points.get(line.startId);
    const b = graph.points.get(line.endId);
    if (!a || !b) continue;
    const proj = projectPointOnSegment(world, a, b);
    if (proj.distance <= threshold && (!best || proj.distance < best.distance)) {
      best = { kind: 'line', line, distance: proj.distance };
    }
  }

  for (const arc of graph.arcs.values()) {
    const a = graph.points.get(arc.startId);
    const b = graph.points.get(arc.endId);
    if (!a || !b) continue;
    const proj = projectPointOnArc(world, a, b, arc.bulge);
    if (proj.distance <= threshold && (!best || proj.distance < best.distance)) {
      best = { kind: 'arc', arc, distance: proj.distance };
    }
  }

  return best;
}

/** Hit-tests a component's drawn body (a bounding box derived from its resolved
 * symbol's points, transformed by its rotation) — lets you grab a component anywhere on
 * its symbol, not just exactly on one of its ports. */
function hitTestComponent(world: Vec2, threshold: number): ComponentInstance | null {
  const { graph, componentScale } = useSketchStore.getState();
  let best: { instance: ComponentInstance; distance: number } | null = null;
  for (const instance of graph.components.values()) {
    // Undo scale as well as rotation so the bounds (in un-scaled symbol-local units)
    // compare correctly regardless of the current global component-size setting.
    const local = rotate(subtract(world, instance.position), -instance.rotation);
    const localUnscaled = { x: local.x / componentScale, y: local.y / componentScale };
    const scaledThreshold = threshold / componentScale;
    const bounds = symbolLocalBounds(instance.snapshot.symbol);
    if (localUnscaled.x < bounds.minX - scaledThreshold || localUnscaled.x > bounds.maxX + scaledThreshold) continue;
    if (localUnscaled.y < bounds.minY - scaledThreshold || localUnscaled.y > bounds.maxY + scaledThreshold) continue;
    const d = distance(world, instance.position);
    if (!best || d < best.distance) best = { instance, distance: d };
  }
  return best?.instance ?? null;
}

/** An edge's body can be dragged as a rigid unit only when neither endpoint is shared with
 * another line/arc (or owned by a component) — dragging a shared endpoint should be done
 * via the endpoint (or component) itself, so this avoids silently tearing a joint (MVP
 * restriction called out in the plan). */
function endpointsAreUnshared(startId: Id, endId: Id): boolean {
  const { graph } = useSketchStore.getState();
  return graph.pointDegree(startId) === 1 && graph.pointDegree(endId) === 1;
}

/** `additive` is true when the click should extend/toggle the existing selection rather
 * than replace it — Shift or Ctrl/Cmd, callers OR them together before calling in. */
export function selectOnPointerDown(world: Vec2, additive: boolean, ctx: ToolCtx) {
  const { selection, setSelection, graph } = useSketchStore.getState();
  const threshold = worldThreshold();
  const { interaction } = ctx;

  const point = hitTestPoint(world, threshold);
  const ownerComponentId = point ? graph.componentOwning(point.id) : undefined;

  // A component's connection port is a real point, but clicking it should move the whole
  // component (see SceneGraph's pointOwner doc) rather than dragging the port alone.
  if (point && !ownerComponentId) {
    const pointIds = new Set(additive ? selection.pointIds : []);
    if (additive && pointIds.has(point.id)) pointIds.delete(point.id);
    else pointIds.add(point.id);
    setSelection({
      pointIds,
      lineIds: additive ? selection.lineIds : new Set(),
      arcIds: additive ? selection.arcIds : new Set(),
      componentIds: additive ? selection.componentIds : new Set(),
    });
    interaction.drag = { kind: 'point', pointId: point.id, before: graph.toJSON() };
    ctx.requestRedraw();
    return;
  }

  const component = ownerComponentId ? graph.components.get(ownerComponentId) : hitTestComponent(world, threshold);
  if (component) {
    const componentIds = new Set(additive ? selection.componentIds : []);
    if (additive && componentIds.has(component.id)) componentIds.delete(component.id);
    else componentIds.add(component.id);
    setSelection({
      componentIds,
      pointIds: additive ? selection.pointIds : new Set(),
      lineIds: additive ? selection.lineIds : new Set(),
      arcIds: additive ? selection.arcIds : new Set(),
    });
    interaction.drag = {
      kind: 'component',
      componentId: component.id,
      grabWorld: world,
      originPosition: { x: component.position.x, y: component.position.y },
      rotation: component.rotation,
      before: graph.toJSON(),
    };
    ctx.requestRedraw();
    return;
  }

  const hit = hitTestEdge(world, threshold);
  if (hit) {
    if (hit.kind === 'line') {
      const { line } = hit;
      const lineIds = new Set(additive ? selection.lineIds : []);
      if (additive && lineIds.has(line.id)) lineIds.delete(line.id);
      else lineIds.add(line.id);
      setSelection({
        lineIds,
        pointIds: additive ? selection.pointIds : new Set(),
        arcIds: additive ? selection.arcIds : new Set(),
        componentIds: additive ? selection.componentIds : new Set(),
      });

      if (endpointsAreUnshared(line.startId, line.endId)) {
        const a = graph.points.get(line.startId)!;
        const b = graph.points.get(line.endId)!;
        interaction.drag = {
          kind: 'line',
          lineId: line.id,
          startId: line.startId,
          endId: line.endId,
          grabWorld: world,
          startOrigin: { x: a.x, y: a.y },
          endOrigin: { x: b.x, y: b.y },
          before: graph.toJSON(),
        };
      }
    } else {
      const { arc } = hit;
      const arcIds = new Set(additive ? selection.arcIds : []);
      if (additive && arcIds.has(arc.id)) arcIds.delete(arc.id);
      else arcIds.add(arc.id);
      setSelection({
        arcIds,
        pointIds: additive ? selection.pointIds : new Set(),
        lineIds: additive ? selection.lineIds : new Set(),
        componentIds: additive ? selection.componentIds : new Set(),
      });

      if (endpointsAreUnshared(arc.startId, arc.endId)) {
        const a = graph.points.get(arc.startId)!;
        const b = graph.points.get(arc.endId)!;
        interaction.drag = {
          kind: 'arc',
          arcId: arc.id,
          startId: arc.startId,
          endId: arc.endId,
          grabWorld: world,
          startOrigin: { x: a.x, y: a.y },
          endOrigin: { x: b.x, y: b.y },
          before: graph.toJSON(),
        };
      }
    }
    ctx.requestRedraw();
    return;
  }

  interaction.drag = { kind: 'marquee', originWorld: world, currentWorld: world, additive: additive };
  ctx.requestRedraw();
}

export function selectOnPointerMove(world: Vec2, ctx: ToolCtx) {
  const { graph, gridSize, bumpVersion } = useSketchStore.getState();
  const { drag } = ctx.interaction;
  if (!drag) return;

  if (drag.kind === 'point') {
    const snap = computeSnap({
      cursor: world,
      graph,
      threshold: worldThreshold(),
      gridSize,
      excludePointId: drag.pointId,
      disabled: ctx.interaction.altHeld,
    });
    graph.movePoint(drag.pointId, snap.point.x, snap.point.y);
    ctx.interaction.drag = { ...drag, mergeCandidate: snap.snappedPointId };
    ctx.interaction.hoverSnap = snap;
    bumpVersion();
    ctx.requestRedraw();
  } else if (drag.kind === 'line' || drag.kind === 'arc') {
    const dx = world.x - drag.grabWorld.x;
    const dy = world.y - drag.grabWorld.y;
    graph.movePoint(drag.startId, drag.startOrigin.x + dx, drag.startOrigin.y + dy);
    graph.movePoint(drag.endId, drag.endOrigin.x + dx, drag.endOrigin.y + dy);
    bumpVersion();
    ctx.requestRedraw();
  } else if (drag.kind === 'component') {
    const dx = world.x - drag.grabWorld.x;
    const dy = world.y - drag.grabWorld.y;
    const target = { x: drag.originPosition.x + dx, y: drag.originPosition.y + dy };
    const snap = computeSnap({
      cursor: target,
      graph,
      threshold: worldThreshold(),
      gridSize,
      disabled: ctx.interaction.altHeld,
      excludeComponentId: drag.componentId,
    });
    graph.moveComponent(drag.componentId, snap.point, drag.rotation, useSketchStore.getState().componentScale);
    ctx.interaction.hoverSnap = snap;
    bumpVersion();
    ctx.requestRedraw();
  } else if (drag.kind === 'marquee') {
    ctx.interaction.drag = { ...drag, currentWorld: world };
    ctx.requestRedraw();
  }
}

export function selectOnPointerUp(ctx: ToolCtx) {
  const { graph, commit, selection, setSelection } = useSketchStore.getState();
  const { drag } = ctx.interaction;
  if (!drag) return;

  if (drag.kind === 'point') {
    if (drag.mergeCandidate) graph.mergePoints(drag.pointId, drag.mergeCandidate);
    const after = graph.toJSON();
    if (JSON.stringify(after) !== JSON.stringify(drag.before)) commit(drag.before);
    ctx.interaction.hoverSnap = null;
  } else if (drag.kind === 'line' || drag.kind === 'arc' || drag.kind === 'component') {
    const after = graph.toJSON();
    if (JSON.stringify(after) !== JSON.stringify(drag.before)) commit(drag.before);
  } else if (drag.kind === 'marquee') {
    const x0 = Math.min(drag.originWorld.x, drag.currentWorld.x);
    const x1 = Math.max(drag.originWorld.x, drag.currentWorld.x);
    const y0 = Math.min(drag.originWorld.y, drag.currentWorld.y);
    const y1 = Math.max(drag.originWorld.y, drag.currentWorld.y);
    const inRect = (p: Vec2) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;

    const pointIds = new Set(drag.additive ? selection.pointIds : []);
    for (const p of graph.points.values()) if (inRect(p)) pointIds.add(p.id);

    const lineIds = new Set(drag.additive ? selection.lineIds : []);
    for (const line of graph.lines.values()) {
      const a = graph.points.get(line.startId);
      const b = graph.points.get(line.endId);
      if (a && b && inRect(a) && inRect(b)) lineIds.add(line.id);
    }

    const arcIds = new Set(drag.additive ? selection.arcIds : []);
    for (const arc of graph.arcs.values()) {
      const a = graph.points.get(arc.startId);
      const b = graph.points.get(arc.endId);
      if (a && b && inRect(a) && inRect(b)) arcIds.add(arc.id);
    }

    const componentIds = new Set(drag.additive ? selection.componentIds : []);
    for (const instance of graph.components.values()) {
      if (inRect(instance.position)) componentIds.add(instance.id);
    }

    setSelection({ pointIds, lineIds, arcIds, componentIds });
  }

  ctx.interaction.drag = null;
  ctx.requestRedraw();
}

/** Finds the placed component instance (if any) under a world point, using the same
 * body hit test as the select tool's own pointer-down handling. Exposed for callers
 * outside this module (e.g. SketchCanvas's double-click-to-open-the-real-hardware-modal
 * handler) that need "what component is here" without duplicating hitTestComponent. */
export function componentAtWorld(world: Vec2): ComponentInstance | null {
  return hitTestComponent(world, worldThreshold());
}

export function selectHitTestForCursor(world: Vec2): 'point' | 'line' | 'arc' | 'component' | null {
  const threshold = worldThreshold();
  const point = hitTestPoint(world, threshold);
  if (point) return 'point';
  if (hitTestComponent(world, threshold)) return 'component';
  const hit = hitTestEdge(world, threshold);
  return hit?.kind ?? null;
}
