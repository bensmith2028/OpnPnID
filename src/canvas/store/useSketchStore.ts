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
 * original don't corrupt or invalidate the clipboard — see copySelectedComponents. */
interface ClipboardComponent {
  categoryId: string;
  realPartId: string | null;
  snapshot: ComponentSnapshot;
  tag: string;
  position: Vec2;
  rotation: number;
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
  /** Last-copied components (Ctrl/Cmd+C on the current selection), or null if nothing's
   * been copied yet this session. Not persisted with the project — an in-app clipboard,
   * not the OS one, so paste only ever targets this same document. */
  componentClipboard: ClipboardComponent[] | null;
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
  /** Copies the currently-selected components to the in-app clipboard. No-op if none are
   * selected (leaves any existing clipboard content untouched). */
  copySelectedComponents: () => void;
  /** Pastes the clipboard's components back in, offset from their original positions
   * (cascading further on each repeated paste — see PASTE_OFFSET) and re-tagged to avoid
   * duplicate tags, then selects the newly-pasted instances. No-op if the clipboard is
   * empty. */
  pasteComponents: () => void;
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
  componentClipboard: null,
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
  setSelection: (selection) => set({ selection }),
  setTheme: (theme) => {
    window.localStorage?.setItem(THEME_STORAGE_KEY, theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  clearSelection: () => set({ selection: emptySelection() }),
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

  copySelectedComponents: () => {
    const { graph, selection } = get();
    const clipboard: ClipboardComponent[] = [];
    for (const id of selection.componentIds) {
      const instance = graph.components.get(id);
      if (!instance) continue;
      // Deep-cloned, not a spread — snapshot.realPart.specs is a nested object, and the
      // clipboard must survive independently of any later edit to the original.
      clipboard.push({
        categoryId: instance.categoryId,
        realPartId: instance.realPartId,
        snapshot: cloneSnapshot(instance.snapshot),
        tag: instance.tag,
        position: { ...instance.position },
        rotation: instance.rotation,
      });
    }
    if (clipboard.length === 0) return;
    set({ componentClipboard: clipboard, pasteCount: 0 });
  },

  pasteComponents: () => {
    const { graph, componentClipboard, pasteCount, componentScale } = get();
    if (!componentClipboard || componentClipboard.length === 0) return;
    const before = graph.toJSON();
    const offset = PASTE_OFFSET * (pasteCount + 1);
    const existingTags = new Set([...graph.components.values()].map((c) => c.tag));
    const newIds: Id[] = [];
    for (const item of componentClipboard) {
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
      newIds.push(instance.id);
    }
    set({
      selection: { pointIds: new Set(), lineIds: new Set(), arcIds: new Set(), componentIds: new Set(newIds) },
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
