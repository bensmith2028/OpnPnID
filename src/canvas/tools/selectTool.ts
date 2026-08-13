import { symbolLocalBounds } from '../../library/builtinSymbols';
import type { Arc, ComponentInstance, Id, Line, Selection, TextAnnotation, Vec2 } from '../../types/geometry';
import {
  COMPONENT_LABEL_KINDS,
  componentLabelAnchor,
  componentLabelHalfExtent,
  type ComponentLabelKind,
  componentLabelOffset,
  componentLabelText,
} from '../componentLabels';
import { distance, projectPointOnArc, projectPointOnSegment, rotate, subtract, textHalfExtent } from '../geometry';
import type { SceneGraph } from '../sceneGraph';
import { computeSnap } from '../snapping';
import { useSketchStore } from '../store/useSketchStore';
import type { ToolCtx } from './drawLineTool';
import { worldThreshold } from './drawLineTool';

/** Total item count across every selection set — used to tell "one thing selected" (the
 * usual click-replaces-selection-and-drag-just-that behavior) from "part of a bigger
 * selection" (click-and-drag should move the whole group instead). */
function selectionSize(selection: Selection): number {
  return selection.pointIds.size + selection.lineIds.size + selection.arcIds.size + selection.componentIds.size + selection.textIds.size;
}

/** All point ids a group drag should move directly: every selected point, plus the
 * endpoints of every selected line/arc. Excludes anything owned by a component (a
 * connection port) — those move only via their owning component's `moveComponent`, which
 * is handled separately so a port doesn't get moved twice or torn from its component. */
function groupPointIds(selection: Selection, graph: SceneGraph): Set<Id> {
  const ids = new Set<Id>(selection.pointIds);
  for (const lineId of selection.lineIds) {
    const line = graph.lines.get(lineId);
    if (line) {
      ids.add(line.startId);
      ids.add(line.endId);
    }
  }
  for (const arcId of selection.arcIds) {
    const arc = graph.arcs.get(arcId);
    if (arc) {
      ids.add(arc.startId);
      ids.add(arc.endId);
    }
  }
  for (const id of ids) if (graph.componentOwning(id)) ids.delete(id);
  return ids;
}

/** Snapshots the current selection's points/components and starts a rigid group drag —
 * used instead of the usual single-item drag when the pointer went down on something
 * already part of a multi-item selection. Leaves the selection itself untouched. */
function startGroupDrag(world: Vec2, ctx: ToolCtx) {
  const { selection, graph } = useSketchStore.getState();

  const pointOrigins = new Map<Id, Vec2>();
  for (const id of groupPointIds(selection, graph)) {
    const p = graph.points.get(id);
    if (p) pointOrigins.set(id, { x: p.x, y: p.y });
  }

  const componentOrigins = new Map<Id, { position: Vec2; rotation: number }>();
  for (const id of selection.componentIds) {
    const c = graph.components.get(id);
    if (c) componentOrigins.set(id, { position: { x: c.position.x, y: c.position.y }, rotation: c.rotation });
  }

  const textOrigins = new Map<Id, Vec2>();
  for (const id of selection.textIds) {
    const t = graph.texts.get(id);
    if (t) textOrigins.set(id, { x: t.x, y: t.y });
  }

  ctx.interaction.drag = { kind: 'group', grabWorld: world, pointOrigins, componentOrigins, textOrigins, before: graph.toJSON() };
}

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

/** Hit-tests a text annotation's drawn box (the same estimated box the renderer outlines
 * when one is selected — see textHalfExtent). A note is grabbed anywhere on its glyphs:
 * unlike every other entity here it has no anchor point or stroke to aim at. */
function hitTestText(world: Vec2, threshold: number): TextAnnotation | null {
  const { graph } = useSketchStore.getState();
  let best: { annotation: TextAnnotation; distance: number } | null = null;
  for (const annotation of graph.texts.values()) {
    const half = textHalfExtent(annotation.text, annotation.fontSize);
    if (Math.abs(world.x - annotation.x) > half.x + threshold) continue;
    if (Math.abs(world.y - annotation.y) > half.y + threshold) continue;
    const d = distance(world, annotation);
    if (!best || d < best.distance) best = { annotation, distance: d };
  }
  return best?.annotation ?? null;
}

/** Hit-tests the tag/name labels of every placed component, against the same boxes the
 * renderer draws them in (see componentLabels). Returns the closest hit — labels are
 * small and fixed-size on screen, so overlaps between two of them are near enough to a
 * tie that "whichever centre is nearer the cursor" is as good a rule as any. */
function hitTestComponentLabel(world: Vec2, threshold: number): { instance: ComponentInstance; kind: ComponentLabelKind } | null {
  const { graph, componentScale, camera } = useSketchStore.getState();
  let best: { instance: ComponentInstance; kind: ComponentLabelKind; distance: number } | null = null;
  for (const instance of graph.components.values()) {
    for (const kind of COMPONENT_LABEL_KINDS) {
      const text = componentLabelText(instance, kind);
      if (!text) continue;
      const anchor = componentLabelAnchor(instance, kind, componentScale, camera.zoom);
      const half = componentLabelHalfExtent(text, camera.zoom);
      if (Math.abs(world.x - anchor.x) > half.x + threshold) continue;
      if (Math.abs(world.y - anchor.y) > half.y + threshold) continue;
      const d = distance(world, anchor);
      if (!best || d < best.distance) best = { instance, kind, distance: d };
    }
  }
  return best ? { instance: best.instance, kind: best.kind } : null;
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
    // Clicking something already part of a bigger selection (e.g. a just-pasted batch of
    // components, or a marquee-selected group) drags the whole group as a rigid unit
    // instead of collapsing the selection down to just this one point.
    if (!additive && selection.pointIds.has(point.id) && selectionSize(selection) > 1) {
      startGroupDrag(world, ctx);
      ctx.requestRedraw();
      return;
    }
    const pointIds = new Set(additive ? selection.pointIds : []);
    if (additive && pointIds.has(point.id)) pointIds.delete(point.id);
    else pointIds.add(point.id);
    setSelection({
      pointIds,
      lineIds: additive ? selection.lineIds : new Set(),
      arcIds: additive ? selection.arcIds : new Set(),
      componentIds: additive ? selection.componentIds : new Set(),
      textIds: additive ? selection.textIds : new Set(),
    });
    interaction.drag = {
      kind: 'point',
      pointId: point.id,
      grabWorld: world,
      origin: { x: point.x, y: point.y },
      before: graph.toJSON(),
    };
    ctx.requestRedraw();
    return;
  }

  // Notes are drawn on top of everything, so a click inside one's box takes it ahead of
  // whatever it overlaps — but never ahead of a component's own connection port, which
  // belongs to that component no matter what happens to sit over it.
  const annotation = ownerComponentId ? null : hitTestText(world, threshold);
  if (annotation) {
    if (!additive && selection.textIds.has(annotation.id) && selectionSize(selection) > 1) {
      startGroupDrag(world, ctx);
      ctx.requestRedraw();
      return;
    }
    const textIds = new Set(additive ? selection.textIds : []);
    if (additive && textIds.has(annotation.id)) textIds.delete(annotation.id);
    else textIds.add(annotation.id);
    setSelection({
      textIds,
      pointIds: additive ? selection.pointIds : new Set(),
      lineIds: additive ? selection.lineIds : new Set(),
      arcIds: additive ? selection.arcIds : new Set(),
      componentIds: additive ? selection.componentIds : new Set(),
    });
    interaction.drag = {
      kind: 'text',
      textId: annotation.id,
      grabWorld: world,
      origin: { x: annotation.x, y: annotation.y },
      before: graph.toJSON(),
    };
    ctx.requestRedraw();
    return;
  }

  // A label is grabbed ahead of the bodies/edges it may be sitting over — it's drawn on
  // top of them, and it's the only thing here whose whole purpose is to be moved out of
  // the way of the geometry it overlaps. Notes still win over it, matching the draw order.
  const labelHit = ownerComponentId ? null : hitTestComponentLabel(world, threshold);
  if (labelHit) {
    const { instance, kind } = labelHit;
    // Selects the owning component rather than the label itself: a label isn't an entity
    // (it has no id, and nothing but the component can be done with it), and selecting the
    // component is what puts its tag/name in the Properties Panel. Never toggles the
    // component off, unlike a click on the body — you can't drag what you just deselected.
    const componentIds = new Set(additive ? selection.componentIds : []);
    componentIds.add(instance.id);
    setSelection({
      componentIds,
      pointIds: additive ? selection.pointIds : new Set(),
      lineIds: additive ? selection.lineIds : new Set(),
      arcIds: additive ? selection.arcIds : new Set(),
      textIds: additive ? selection.textIds : new Set(),
    });
    interaction.drag = {
      kind: 'componentLabel',
      componentId: instance.id,
      label: kind,
      grabWorld: world,
      originOffset: componentLabelOffset(instance, kind, useSketchStore.getState().componentScale, useSketchStore.getState().camera.zoom),
      before: graph.toJSON(),
    };
    ctx.requestRedraw();
    return;
  }

  const component = ownerComponentId ? graph.components.get(ownerComponentId) : hitTestComponent(world, threshold);
  if (component) {
    // Same "drag the whole group" carve-out as above — this is the common case right
    // after a multi-component paste, where the pasted batch is selected and the user just
    // wants to drag it into place.
    if (!additive && selection.componentIds.has(component.id) && selectionSize(selection) > 1) {
      startGroupDrag(world, ctx);
      ctx.requestRedraw();
      return;
    }
    const componentIds = new Set(additive ? selection.componentIds : []);
    if (additive && componentIds.has(component.id)) componentIds.delete(component.id);
    else componentIds.add(component.id);
    setSelection({
      componentIds,
      pointIds: additive ? selection.pointIds : new Set(),
      lineIds: additive ? selection.lineIds : new Set(),
      arcIds: additive ? selection.arcIds : new Set(),
      textIds: additive ? selection.textIds : new Set(),
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
      if (!additive && selection.lineIds.has(line.id) && selectionSize(selection) > 1) {
        startGroupDrag(world, ctx);
        ctx.requestRedraw();
        return;
      }
      const lineIds = new Set(additive ? selection.lineIds : []);
      if (additive && lineIds.has(line.id)) lineIds.delete(line.id);
      else lineIds.add(line.id);
      setSelection({
        lineIds,
        pointIds: additive ? selection.pointIds : new Set(),
        arcIds: additive ? selection.arcIds : new Set(),
        componentIds: additive ? selection.componentIds : new Set(),
        textIds: additive ? selection.textIds : new Set(),
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
      if (!additive && selection.arcIds.has(arc.id) && selectionSize(selection) > 1) {
        startGroupDrag(world, ctx);
        ctx.requestRedraw();
        return;
      }
      const arcIds = new Set(additive ? selection.arcIds : []);
      if (additive && arcIds.has(arc.id)) arcIds.delete(arc.id);
      else arcIds.add(arc.id);
      setSelection({
        arcIds,
        pointIds: additive ? selection.pointIds : new Set(),
        lineIds: additive ? selection.lineIds : new Set(),
        componentIds: additive ? selection.componentIds : new Set(),
        textIds: additive ? selection.textIds : new Set(),
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
    // The point follows the cursor's *movement*, not the cursor itself — it's grabbed
    // wherever the click landed within the hit-test radius, exactly like a component or a
    // note is (see `origin` in DragState). No H/V axis inference: `originPoint` means "the
    // point we're drawing away from", and a drag has no such thing — the pre-drag position
    // would only ever infer alignment with where this very point already was, pinning the
    // coordinate the user is trying to change and drawing an inference line to nothing.
    // Aligning a dragged endpoint with its *neighbours* is what axis locks are for (they
    // are stored on the line and propagated by movePoint).
    const snap = computeSnap({
      cursor: { x: drag.origin.x + (world.x - drag.grabWorld.x), y: drag.origin.y + (world.y - drag.grabWorld.y) },
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
    // Delta-quantized for the same reason the group drag below is: an edge dragged by its
    // body moves two anchors at once, so there's no single point to run a snap search from.
    // Snapping the *offset* keeps the edge's own length and angle while still landing it on
    // the grid — whereas snapping each endpoint independently would stretch it.
    const delta = computeSnap({
      cursor: { x: world.x - drag.grabWorld.x, y: world.y - drag.grabWorld.y },
      graph,
      threshold: worldThreshold(),
      gridSize,
      gridMode: 'delta',
      disabled: ctx.interaction.altHeld,
    }).point;
    graph.movePoint(drag.startId, drag.startOrigin.x + delta.x, drag.startOrigin.y + delta.y);
    graph.movePoint(drag.endId, drag.endOrigin.x + delta.x, drag.endOrigin.y + delta.y);
    bumpVersion();
    ctx.requestRedraw();
  } else if (drag.kind === 'text') {
    const dx = world.x - drag.grabWorld.x;
    const dy = world.y - drag.grabWorld.y;
    // Endpoint snapping is opted out of, not merely skipped: a note is not a vertex, so
    // snapping it onto an existing point would land it exactly on top of the geometry it
    // is there to label. The grid snap is the same one textPlacementPoint uses, so a note
    // dragged somewhere ends up where placing it there would have.
    const snap = computeSnap({
      cursor: { x: drag.origin.x + dx, y: drag.origin.y + dy },
      graph,
      threshold: worldThreshold(),
      gridSize,
      allowEndpoint: false,
      disabled: ctx.interaction.altHeld,
    });
    graph.moveText(drag.textId, snap.point.x, snap.point.y);
    bumpVersion();
    ctx.requestRedraw();
  } else if (drag.kind === 'componentLabel') {
    // Free positioning, no snap search at all: a label is not geometry, so there is nothing
    // it could usefully land *on* — grid-quantizing it would only take away the sub-cell
    // nudge that clears a label from the pipe running under it.
    graph.setComponentLabelOffset(drag.componentId, drag.label, {
      x: drag.originOffset.x + (world.x - drag.grabWorld.x),
      y: drag.originOffset.y + (world.y - drag.grabWorld.y),
    });
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
  } else if (drag.kind === 'group') {
    // No per-point endpoint-snap search here — with several points/components moving at
    // once there's no single anchor to search against, so the whole group's delta is
    // quantized to the grid instead, same tradeoff as the symbol editor's group drag.
    const delta = computeSnap({
      cursor: { x: world.x - drag.grabWorld.x, y: world.y - drag.grabWorld.y },
      graph,
      threshold: worldThreshold(),
      gridSize,
      gridMode: 'delta',
      disabled: ctx.interaction.altHeld,
    }).point;
    for (const [id, origin] of drag.pointOrigins) graph.movePoint(id, origin.x + delta.x, origin.y + delta.y);
    for (const [id, origin] of drag.componentOrigins) {
      graph.moveComponent(id, { x: origin.position.x + delta.x, y: origin.position.y + delta.y }, origin.rotation, useSketchStore.getState().componentScale);
    }
    for (const [id, origin] of drag.textOrigins) graph.moveText(id, origin.x + delta.x, origin.y + delta.y);
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
  } else if (
    drag.kind === 'line' ||
    drag.kind === 'arc' ||
    drag.kind === 'text' ||
    drag.kind === 'component' ||
    drag.kind === 'componentLabel' ||
    drag.kind === 'group'
  ) {
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

    // A note is caught by its position (its centre), the same "where the thing is" rule
    // the components loop above uses — not by requiring its whole box inside the marquee.
    const textIds = new Set(drag.additive ? selection.textIds : []);
    for (const annotation of graph.texts.values()) if (inRect(annotation)) textIds.add(annotation.id);

    setSelection({ pointIds, lineIds, arcIds, componentIds, textIds });
  }

  ctx.interaction.drag = null;
  // Cleared for every drag kind, not just the point drag that used to do it here: the
  // component drag writes `hoverSnap` too, and the Select tool has no hover preview of its
  // own to repaint the slot afterward — so any marker left behind stayed on screen,
  // pointing at where a finished drag happened to end, until another tool took over.
  ctx.interaction.hoverSnap = null;
  ctx.requestRedraw();
}

/** Finds the placed component instance (if any) under a world point, using the same
 * body hit test as the select tool's own pointer-down handling. Exposed for callers
 * outside this module (e.g. SketchCanvas's double-click-to-open-the-real-hardware-modal
 * handler) that need "what component is here" without duplicating hitTestComponent. */
export function componentAtWorld(world: Vec2): ComponentInstance | null {
  return hitTestComponent(world, worldThreshold());
}

/** Finds the text annotation (if any) under a world point, using the same box hit test as
 * the select tool's own pointer-down handling — exposed for SketchCanvas's
 * double-click-to-re-edit handler, which needs "what note is here" without duplicating it. */
export function textAtWorld(world: Vec2): TextAnnotation | null {
  return hitTestText(world, worldThreshold());
}

/** Finds the component label (if any) under a world point, using the same box hit test as
 * the select tool's own pointer-down handling — exposed for SketchCanvas's
 * double-click-to-reset-a-dragged-label handler. */
export function componentLabelAtWorld(world: Vec2): { instance: ComponentInstance; kind: ComponentLabelKind } | null {
  return hitTestComponentLabel(world, worldThreshold());
}

export function selectHitTestForCursor(world: Vec2): 'point' | 'line' | 'arc' | 'text' | 'label' | 'component' | null {
  const threshold = worldThreshold();
  const point = hitTestPoint(world, threshold);
  if (point) return 'point';
  if (hitTestText(world, threshold)) return 'text';
  if (hitTestComponentLabel(world, threshold)) return 'label';
  if (hitTestComponent(world, threshold)) return 'component';
  const hit = hitTestEdge(world, threshold);
  return hit?.kind ?? null;
}
