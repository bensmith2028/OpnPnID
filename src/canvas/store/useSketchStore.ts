import { create } from 'zustand';
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
  theme: Theme;
  armedComponent: ArmedComponent | null;
  /** Whether the Library panel is shown (replaces the Properties Panel in the same
   * sidebar slot while open). */
  libraryPanelOpen: boolean;
  filePath: string | null;
  dirty: boolean;
  past: HistoryEntry[];
  future: HistoryEntry[];

  setTool: (tool: ToolName) => void;
  /** Loads the Component tool with a category (+ optional real part) and switches to it
   * in one step — what the Library panel's "Place" action calls. */
  armComponent: (categoryId: string, realPartId: string | null) => void;
  toggleLibraryPanel: () => void;
  setCamera: (camera: CameraState) => void;
  setSelection: (selection: Selection) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  clearSelection: () => void;
  setGridSize: (size: number) => void;
  setGridVisible: (visible: boolean) => void;
  setSnapThresholdPx: (px: number) => void;
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
  theme: loadInitialTheme(),
  armedComponent: null,
  libraryPanelOpen: false,
  filePath: null,
  dirty: false,
  past: [],
  future: [],

  setTool: (tool) => set({ activeTool: tool, selection: emptySelection(), armedComponent: tool === 'component' ? get().armedComponent : null }),
  armComponent: (categoryId, realPartId) =>
    set({ activeTool: 'component', armedComponent: { categoryId, realPartId }, selection: emptySelection() }),
  toggleLibraryPanel: () => set((s) => ({ libraryPanelOpen: !s.libraryPanelOpen })),
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
    const { graph } = get();
    const before = graph.toJSON();
    const instance = graph.addComponent({ categoryId, realPartId, tag, position, rotation: 0, snapshot });
    set({ selection: { pointIds: new Set(), lineIds: new Set(), arcIds: new Set(), componentIds: new Set([instance.id]) } });
    get().commit(before);
  },

  setComponentTag: (componentId, tag) => {
    const before = get().graph.toJSON();
    get().graph.setComponentTag(componentId, tag);
    get().commit(before);
  },

  setComponentRotationDeg: (componentId, degrees) => {
    const { graph } = get();
    const instance = graph.components.get(componentId);
    if (!instance) return;
    const before = graph.toJSON();
    graph.moveComponent(componentId, instance.position, (degrees * Math.PI) / 180);
    get().commit(before);
  },

  setComponentPart: (componentId, realPartId, snapshot) => {
    const before = get().graph.toJSON();
    const ok = get().graph.setComponentPart(componentId, realPartId, snapshot);
    if (ok) get().commit(before);
    return ok;
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
