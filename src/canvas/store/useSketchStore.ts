import { create } from 'zustand';
import { suggestTag } from '../../library/tagging';
import type { AxisLock, ComponentSnapshot, Id, SceneGraphJSON, Selection, Vec2 } from '../../types/geometry';
import { SceneGraph } from '../sceneGraph';

export type ToolName = 'select' | 'line' | 'arc' | 'point' | 'circle' | 'component';

/** The app's UI theme (canvas + chrome). Print/PDF export (a future feature) should
 * always render with 'light' regardless of this — see renderer.ts's palette comment. */
export type Theme = 'light' | 'dark';

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

interface HistoryEntry {
  scene: SceneGraphJSON;
}

const MAX_HISTORY = 100;
const DEFAULT_SNAP_THRESHOLD_PX = 10;
const THEME_STORAGE_KEY = 'opnpnid.theme';

function emptySelection(): Selection {
  return { pointIds: new Set(), lineIds: new Set(), arcIds: new Set(), componentIds: new Set() };
}

function loadInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const stored = window.localStorage?.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** Which category (and optionally a specific real part) the Component tool is "loaded"
 * with — set by picking one in the Library panel, cleared whenever the active tool
 * changes away from 'component'. */
export interface ArmedComponent {
  categoryId: string;
  realPartId: string | null;
}

/** One copied component, captured by value (not by id) so later edits/deletes of the
 * original don't corrupt or invalidate the clipboard — see copySelection. */
interface ClipboardComponent {
  categoryId: string;
  realPartId: string | null;
  snapshot: ComponentSnapshot;
  tag: string;
  position: Vec2;
  rotation: number;
}

/** The free-geometry (non-component) half of a copied selection — pipe segments, not
 * symbols. `points` carries every point a copied line/arc needs (its own endpoints get
 * pulled in automatically even if only the edge, not the point, was selected — see
 * copySelection), keyed by their *original* id so pasteSelection can remap line/arc
 * endpoints onto the freshly created points. */
interface ClipboardPoint {
  id: Id;
  x: number;
  y: number;
}
interface ClipboardLine {
  startId: Id;
  endId: Id;
  axisLock: AxisLock;
}
interface ClipboardArc {
  startId: Id;
  endId: Id;
  bulge: number;
}

interface SketchClipboard {
  components: ClipboardComponent[];
  points: ClipboardPoint[];
  lines: ClipboardLine[];
  arcs: ClipboardArc[];
}

/** World-unit offset applied to each successive paste of the same clipboard (a "cascade"
 * so repeated Ctrl/Cmd+V doesn't stack every copy exactly on top of the last one). */
const PASTE_OFFSET = 20;

/** Plain JSON round-trip rather than `structuredClone` — `ComponentSnapshot` is already
 * pure JSON data (no Dates/Maps/functions), and `structuredClone` is a fairly recent
 * global that isn't guaranteed present in every embedded webview runtime this app might
 * ship on; this has no such requirement. */
function cloneSnapshot(snapshot: ComponentSnapshot): ComponentSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as ComponentSnapshot;
}

interface SketchStoreState {
  graph: SceneGraph;
  /**
   * Bumped whenever the graph is mutated in place (e.g. every pointer-move frame of a
   * drag) so components that need to react to graph content can subscribe to a cheap
   * primitive instead of the (mutable, non-reactive-by-reference) graph object itself.
   */
  version: number;
  selection: Selection;
  activeTool: ToolName;
  camera: CameraState;
  gridSize: number;
  gridVisible: boolean;
  snapThresholdPx: number;
  /** Global multiplier applied to every placed component's symbol size (and thus its
   * ports' world positions) — one dial for "make all components bigger/smaller" rather
   * than a per-instance setting. Changing it re-lays-out every already-placed instance's
   * ports in place (see setComponentScale), so attached pipes follow immediately. */
  componentScale: number;
  theme: Theme;
  armedComponent: ArmedComponent | null;
  /** Whether the Library panel is shown (replaces the Properties Panel in the same
   * sidebar slot while open). */
  libraryPanelOpen: boolean;
  /** Id of the placed component the RealHardwareModal is open for, or null when closed —
   * opened by double-clicking a component on the canvas (see SketchCanvas) or from its
   * Properties Panel entry. */
  realHardwareModalComponentId: Id | null;
  /** Last-copied selection (Ctrl/Cmd+C — components *and* any selected lines/arcs/points),
   * or null if nothing's been copied yet this session. Not persisted with the project — an
   * in-app clipboard, not the OS one, so paste only ever targets this same document. */
  clipboard: SketchClipboard | null;
  /** How many times the current clipboard has been pasted, so each successive paste can
   * cascade its offset instead of landing exactly on the previous paste. Reset on copy. */
  pasteCount: number;
  filePath: string | null;
  dirty: boolean;
  past: HistoryEntry[];
  future: HistoryEntry[];

  setTool: (tool: ToolName) => void;
  /** Loads the Component tool with a category (+ optional real part) and switches to it
   * in one step — what the Library panel's "Place" action calls. */
  armComponent: (categoryId: string, realPartId: string | null) => void;
  toggleLibraryPanel: () => void;
  /** Opens the real-hardware assignment modal for a placed component instance. */
  openRealHardwareModal: (componentId: Id) => void;
  closeRealHardwareModal: () => void;
  setCamera: (camera: CameraState) => void;
  setSelection: (selection: Selection) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  clearSelection: () => void;
  /** Selects every point, line, arc and component currently in the document (Cmd/Ctrl+A). */
  selectAll: () => void;
  setGridSize: (size: number) => void;
  setGridVisible: (visible: boolean) => void;
  setSnapThresholdPx: (px: number) => void;
  /** Sets the global component-size multiplier and immediately re-lays-out every placed
   * component's ports at the new scale (see SceneGraph.moveComponent's scaleFactor). */
  setComponentScale: (scale: number) => void;
  /** Call after mutating `graph` in place, to trigger reactive redraws (no history push). */
  bumpVersion: () => void;
  /**
   * Finalizes a discrete edit / gesture. Pass the scene snapshot captured *before* the
   * mutation started (from `graph.toJSON()`) so undo can restore it.
   */
  commit: (before: SceneGraphJSON) => void;
  undo: () => void;
  redo: () => void;
  newProject: () => void;
  loadProject: (scene: SceneGraphJSON) => void;
  setLineLength: (lineId: Id, length: number) => void;
  setLineAngleDeg: (lineId: Id, angleDeg: number) => void;
  setAxisLock: (lineId: Id, axisLock: AxisLock) => void;
  setArcBulge: (arcId: Id, bulge: number) => void;
  setTangentStart: (arcId: Id, edgeId: Id | null) => void;
  setTangentEnd: (arcId: Id, edgeId: Id | null) => void;
  setPointPosition: (pointId: Id, x: number, y: number) => void;
  /** Line-line fillet: replaces the corner point with a tangent arc of `radius`, trimming
   * both lines. Returns whether it succeeded (false = didn't qualify / radius too big). */
  applyFillet: (pointId: Id, radius: number) => boolean;
  placeComponent: (params: {
    categoryId: string;
    realPartId: string | null;
    position: Vec2;
    tag: string;
    snapshot: ComponentSnapshot;
  }) => void;
  setComponentTag: (componentId: Id, tag: string) => void;
  setComponentRotationDeg: (componentId: Id, degrees: number) => void;
  /** Copies the current selection to the in-app clipboard — components, plus any selected
   * lines/arcs/points (a selected edge pulls its own endpoints in even if they weren't
   * individually selected). No-op if nothing's selected (leaves any existing clipboard
   * content untouched). */
  copySelection: () => void;
  /** Pastes the clipboard back in — components re-tagged to avoid duplicate tags, free
   * geometry with fresh point/line/arc ids — offset from its original position (cascading
   * further on each repeated paste — see PASTE_OFFSET), then selects the newly-pasted
   * items so the whole batch can be dragged as a group right away. No-op if the clipboard
   * is empty. */
  pasteSelection: () => void;
  /** Reassigns a placed instance to a different real part within the same category.
   * Refuses (returns false) if the port count would differ from what's currently placed
   * — see SceneGraph.setComponentPart. */
  setComponentPart: (componentId: Id, realPartId: string | null, snapshot: ComponentSnapshot) => boolean;
  deleteSelection: () => void;
  setFilePath: (path: string | null) => void;
  markSaved: () => void;
}

export const useSketchStore = create<SketchStoreState>((set, get) => ({
  graph: new SceneGraph(),
  version: 0,
  selection: emptySelection(),
  activeTool: 'select',
  camera: { x: 0, y: 0, zoom: 1 },
  gridSize: 20,
  gridVisible: true,
  snapThresholdPx: DEFAULT_SNAP_THRESHOLD_PX,
  componentScale: 1,
  theme: loadInitialTheme(),
  armedComponent: null,
  libraryPanelOpen: false,
  realHardwareModalComponentId: null,
  clipboard: null,
  pasteCount: 0,
  filePath: null,
  dirty: false,
  past: [],
  future: [],

  setTool: (tool) => set({ activeTool: tool, selection: emptySelection(), armedComponent: tool === 'component' ? get().armedComponent : null }),
  armComponent: (categoryId, realPartId) =>
    set({ activeTool: 'component', armedComponent: { categoryId, realPartId }, selection: emptySelection() }),
  toggleLibraryPanel: () => set((s) => ({ libraryPanelOpen: !s.libraryPanelOpen })),
  openRealHardwareModal: (componentId) => set({ realHardwareModalComponentId: componentId }),
  closeRealHardwareModal: () => set({ realHardwareModalComponentId: null }),
  setCamera: (camera) => set({ camera }),
  // Selecting a point/line/arc/component (to edit its length/angle/etc. in the
  // Properties Panel) auto-closes the Library panel if it's open, since the two share
  // the same sidebar slot — otherwise clicking something to edit it would be hidden
  // behind whatever the Library panel happened to be showing. Only closes on a
  // non-empty selection: clearing a selection (Escape, deselect-click) shouldn't also
  // yank the Library panel out from under someone actively browsing it. Placing/pasting
  // a component sets `selection` directly via `set()` rather than through this action,
  // so that flow (deliberately used *while* the Library panel is open) is unaffected.
  setSelection: (selection) =>
    set((s) => {
      const hasSelection = selection.pointIds.size + selection.lineIds.size + selection.arcIds.size + selection.componentIds.size > 0;
      return { selection, libraryPanelOpen: hasSelection ? false : s.libraryPanelOpen };
    }),
  setTheme: (theme) => {
    window.localStorage?.setItem(THEME_STORAGE_KEY, theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  clearSelection: () => set({ selection: emptySelection() }),
  selectAll: () => {
    const { graph } = get();
    get().setSelection({
      pointIds: new Set(graph.points.keys()),
      lineIds: new Set(graph.lines.keys()),
      arcIds: new Set(graph.arcs.keys()),
      componentIds: new Set(graph.components.keys()),
    });
  },
  setGridSize: (size) => set({ gridSize: Math.max(0.1, size) }),
  setGridVisible: (visible) => set({ gridVisible: visible }),
  setSnapThresholdPx: (px) => set({ snapThresholdPx: Math.max(0, px) }),

  setComponentScale: (rawScale) => {
    const scale = Math.max(0.1, rawScale);
    const { graph } = get();
    const before = graph.toJSON();
    for (const instance of graph.components.values()) {
      graph.moveComponent(instance.id, instance.position, instance.rotation, scale);
    }
    set({ componentScale: scale });
    get().commit(before);
  },

  bumpVersion: () => set((s) => ({ version: s.version + 1, dirty: true })),

  commit: (before) =>
    set((s) => ({
      past: [...s.past, { scene: before }].slice(-MAX_HISTORY),
      future: [],
      version: s.version + 1,
      dirty: true,
    })),

  undo: () => {
    const { graph, past, future } = get();
    if (past.length === 0) return;
    const current: HistoryEntry = { scene: graph.toJSON() };
    const previous = past[past.length - 1];
    set({
      graph: SceneGraph.fromJSON(previous.scene),
      past: past.slice(0, -1),
      future: [current, ...future],
      selection: emptySelection(),
      version: get().version + 1,
      dirty: true,
    });
  },

  redo: () => {
    const { graph, past, future } = get();
    if (future.length === 0) return;
    const current: HistoryEntry = { scene: graph.toJSON() };
    const next = future[0];
    set({
      graph: SceneGraph.fromJSON(next.scene),
      past: [...past, current],
      future: future.slice(1),
      selection: emptySelection(),
      version: get().version + 1,
      dirty: true,
    });
  },

  newProject: () =>
    set((s) => ({
      graph: new SceneGraph(),
      past: [],
      future: [],
      selection: emptySelection(),
      version: s.version + 1,
      filePath: null,
      dirty: false,
    })),

  loadProject: (scene) =>
    set((s) => ({
      graph: SceneGraph.fromJSON(scene),
      past: [],
      future: [],
      selection: emptySelection(),
      version: s.version + 1,
      dirty: false,
    })),

  setLineLength: (lineId, length) => {
    const before = get().graph.toJSON();
    get().graph.setLineLength(lineId, length);
    get().commit(before);
  },

  setLineAngleDeg: (lineId, angleDeg) => {
    const before = get().graph.toJSON();
    get().graph.setLineAngle(lineId, (angleDeg * Math.PI) / 180);
    get().commit(before);
  },

  setAxisLock: (lineId, axisLock) => {
    const before = get().graph.toJSON();
    get().graph.setAxisLock(lineId, axisLock);
    get().commit(before);
  },

  setArcBulge: (arcId, bulge) => {
    const before = get().graph.toJSON();
    get().graph.setArcBulge(arcId, bulge);
    get().commit(before);
  },

  setTangentStart: (arcId, edgeId) => {
    const before = get().graph.toJSON();
    get().graph.setTangentStart(arcId, edgeId);
    get().commit(before);
  },

  setTangentEnd: (arcId, edgeId) => {
    const before = get().graph.toJSON();
    get().graph.setTangentEnd(arcId, edgeId);
    get().commit(before);
  },

  setPointPosition: (pointId, x, y) => {
    const before = get().graph.toJSON();
    get().graph.movePoint(pointId, x, y);
    get().commit(before);
  },

  applyFillet: (pointId, radius) => {
    const { graph } = get();
    const before = graph.toJSON();
    const arc = graph.filletAtPoint(pointId, radius);
    if (!arc) return false;
    set({ selection: { pointIds: new Set(), lineIds: new Set(), arcIds: new Set([arc.id]), componentIds: new Set() } });
    get().commit(before);
    return true;
  },

  placeComponent: ({ categoryId, realPartId, position, tag, snapshot }) => {
    const { graph, componentScale } = get();
    const before = graph.toJSON();
    const instance = graph.addComponent({ categoryId, realPartId, tag, position, rotation: 0, snapshot, scaleFactor: componentScale });
    set({ selection: { pointIds: new Set(), lineIds: new Set(), arcIds: new Set(), componentIds: new Set([instance.id]) } });
    get().commit(before);
  },

  setComponentTag: (componentId, tag) => {
    const before = get().graph.toJSON();
    get().graph.setComponentTag(componentId, tag);
    get().commit(before);
  },

  setComponentRotationDeg: (componentId, degrees) => {
    const { graph, componentScale } = get();
    const instance = graph.components.get(componentId);
    if (!instance) return;
    const before = graph.toJSON();
    graph.moveComponent(componentId, instance.position, (degrees * Math.PI) / 180, componentScale);
    get().commit(before);
  },

  setComponentPart: (componentId, realPartId, snapshot) => {
    const before = get().graph.toJSON();
    const ok = get().graph.setComponentPart(componentId, realPartId, snapshot);
    if (ok) get().commit(before);
    return ok;
  },

  copySelection: () => {
    const { graph, selection } = get();
    const components: ClipboardComponent[] = [];
    for (const id of selection.componentIds) {
      const instance = graph.components.get(id);
      if (!instance) continue;
      // Deep-cloned, not a spread — snapshot.realPart.specs is a nested object, and the
      // clipboard must survive independently of any later edit to the original.
      components.push({
        categoryId: instance.categoryId,
        realPartId: instance.realPartId,
        snapshot: cloneSnapshot(instance.snapshot),
        tag: instance.tag,
        position: { ...instance.position },
        rotation: instance.rotation,
      });
    }

    // Free geometry (pipe segments): every directly-selected point, plus the endpoints of
    // every selected line/arc — an edge comes along once *both* its endpoints are copied,
    // so selecting just a line (without its endpoints individually selected) still copies
    // a usable line rather than nothing. Ports (component-owned points) are never copied
    // on their own; a copied component brings its own ports along when it's pasted.
    const pointIds = new Set(selection.pointIds);
    for (const id of selection.lineIds) {
      const line = graph.lines.get(id);
      if (line) {
        pointIds.add(line.startId);
        pointIds.add(line.endId);
      }
    }
    for (const id of selection.arcIds) {
      const arc = graph.arcs.get(id);
      if (arc) {
        pointIds.add(arc.startId);
        pointIds.add(arc.endId);
      }
    }
    for (const id of pointIds) if (graph.componentOwning(id)) pointIds.delete(id);

    const points: ClipboardPoint[] = [];
    for (const id of pointIds) {
      const p = graph.points.get(id);
      if (p) points.push({ id: p.id, x: p.x, y: p.y });
    }
    const lines: ClipboardLine[] = [];
    for (const line of graph.lines.values()) {
      if (pointIds.has(line.startId) && pointIds.has(line.endId)) {
        lines.push({ startId: line.startId, endId: line.endId, axisLock: line.axisLock });
      }
    }
    const arcs: ClipboardArc[] = [];
    for (const arc of graph.arcs.values()) {
      if (pointIds.has(arc.startId) && pointIds.has(arc.endId)) {
        arcs.push({ startId: arc.startId, endId: arc.endId, bulge: arc.bulge });
      }
    }

    if (components.length === 0 && points.length === 0) return;
    set({ clipboard: { components, points, lines, arcs }, pasteCount: 0 });
  },

  pasteSelection: () => {
    const { graph, clipboard, pasteCount, componentScale } = get();
    if (!clipboard || (clipboard.components.length === 0 && clipboard.points.length === 0)) return;
    const before = graph.toJSON();
    const offset = PASTE_OFFSET * (pasteCount + 1);

    const existingTags = new Set([...graph.components.values()].map((c) => c.tag));
    const newComponentIds: Id[] = [];
    for (const item of clipboard.components) {
      // Re-tag rather than reuse the copied tag verbatim — placed components should have
      // unique ISA-lite tags, and pasting a duplicate would silently break that.
      const letter = item.tag.split('-')[0] || 'X';
      const tag = suggestTag(existingTags, letter);
      existingTags.add(tag);
      const instance = graph.addComponent({
        categoryId: item.categoryId,
        realPartId: item.realPartId,
        tag,
        position: { x: item.position.x + offset, y: item.position.y + offset },
        rotation: item.rotation,
        snapshot: cloneSnapshot(item.snapshot),
        scaleFactor: componentScale,
      });
      newComponentIds.push(instance.id);
    }

    // Fresh ids throughout (SceneGraph's own counter — already bumped past every id in the
    // loaded document by fromJSON, so plain `addPoint`/`addLine`/`addArc` calls can't
    // collide with anything already on the canvas).
    const idMap = new Map<Id, Id>();
    const newPointIds: Id[] = [];
    for (const p of clipboard.points) {
      const created = graph.addPoint(p.x + offset, p.y + offset);
      idMap.set(p.id, created.id);
      newPointIds.push(created.id);
    }
    const newLineIds: Id[] = [];
    for (const l of clipboard.lines) {
      const startId = idMap.get(l.startId);
      const endId = idMap.get(l.endId);
      if (!startId || !endId) continue;
      const created = graph.addLine(startId, endId, l.axisLock);
      if (created) newLineIds.push(created.id);
    }
    const newArcIds: Id[] = [];
    for (const a of clipboard.arcs) {
      const startId = idMap.get(a.startId);
      const endId = idMap.get(a.endId);
      if (!startId || !endId) continue;
      const created = graph.addArc(startId, endId, a.bulge);
      if (created) newArcIds.push(created.id);
    }

    // Select the whole freshly-pasted batch — points, lines, arcs *and* components
    // together — so it can be dragged into place as one group right away (see
    // selectTool.ts's group drag).
    set({
      selection: {
        pointIds: new Set(newPointIds),
        lineIds: new Set(newLineIds),
        arcIds: new Set(newArcIds),
        componentIds: new Set(newComponentIds),
      },
      pasteCount: pasteCount + 1,
    });
    get().commit(before);
  },

  deleteSelection: () => {
    const { graph, selection } = get();
    const before = graph.toJSON();
    const lineIds = new Set(selection.lineIds);
    const arcIds = new Set(selection.arcIds);
    for (const pointId of selection.pointIds) {
      for (const line of graph.linesOfPoint(pointId)) lineIds.add(line.id);
      for (const arc of graph.arcsOfPoint(pointId)) arcIds.add(arc.id);
    }
    // Deleting a component sweeps up any pipes attached to its ports too (same cascade a
    // plain point delete already does), so it can go in one step instead of requiring an
    // explicit disconnect first.
    for (const componentId of selection.componentIds) {
      const instance = graph.components.get(componentId);
      if (!instance) continue;
      for (const conn of instance.connections) {
        for (const line of graph.linesOfPoint(conn.pointId)) lineIds.add(line.id);
        for (const arc of graph.arcsOfPoint(conn.pointId)) arcIds.add(arc.id);
      }
    }
    for (const lineId of lineIds) graph.removeLine(lineId);
    for (const arcId of arcIds) graph.removeArc(arcId);
    for (const pointId of selection.pointIds) graph.removePoint(pointId);
    for (const componentId of selection.componentIds) graph.removeComponent(componentId);
    set({ selection: emptySelection() });
    get().commit(before);
  },

  setFilePath: (path) => set({ filePath: path }),
  markSaved: () => set({ dirty: false }),
}));
