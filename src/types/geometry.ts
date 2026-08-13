/** Shared geometry/domain types for the sketch scene graph. */

export type Id = string;

/** A bare 2D vector/coordinate, used for math that doesn't need entity identity. */
export interface Vec2 {
  x: number;
  y: number;
}

/** A shared vertex. Multiple lines/arcs can reference the same point id (real connectivity). */
export interface Point {
  id: Id;
  x: number;
  y: number;
}

/**
 * When set, the line is held horizontal ('H', constant y) or vertical ('V', constant x).
 * This is a lightweight per-line tag, not a solved constraint: it's enforced locally
 * whenever one of the line's endpoints moves (see SceneGraph.movePoint).
 */
export type AxisLock = 'H' | 'V' | null;

export interface Line {
  id: Id;
  startId: Id;
  endId: Id;
  axisLock: AxisLock;
}

/** A one-way "this endpoint's tangent direction is locked to match that edge's" relation.
 * Not a solved constraint either: `bulge` is recomputed via a closed-form formula
 * whenever anything relevant moves (see SceneGraph.enforceTangent). */
export interface TangentRef {
  edgeId: Id;
}

/**
 * A curved segment between two graph points. Center/radius are intentionally not stored:
 * they're derived on demand from start, end, and `bulge` (the DXF/AutoCAD convention,
 * bulge = tan(includedAngle / 4)) so an arc's endpoints are ordinary graph Points with
 * full connectivity/snapping/drag-propagation, and no separate "center" point needs
 * special-cased movement rules. See `arcGeometry` in `canvas/geometry.ts`.
 */
export interface Arc {
  id: Id;
  startId: Id;
  endId: Id;
  bulge: number;
  tangentStart?: TangentRef;
  tangentEnd?: TangentRef;
}

/**
 * A free text annotation placed directly on the drawing (a note, a title, a callout).
 * Deliberately NOT built on graph Points: nothing ever connects to a note, and every id in
 * `SceneGraph.points` being a real vertex is what lets the snapping/degree/merge machinery
 * stay simple — so annotations get their own top-level list instead.
 *
 * `x`/`y` is the text's *centre*, not a corner: the note then stays put as its content
 * grows or shrinks, and the inline editor can sit exactly over what it's replacing.
 * `fontSize` is a height in world units (like every other coordinate here), so a note
 * zooms with the geometry around it rather than staying a fixed number of screen pixels
 * the way a component's tag label does.
 */
export interface TextAnnotation {
  id: Id;
  x: number;
  y: number;
  text: string;
  fontSize: number;
}

/** A component's connection port, as placed: `localId` identifies the port within the
 * category's symbol geometry (see `SymbolGeometry.ports`), `pointId` is the real graph
 * Point a pipe can snap onto. */
export interface ComponentConnection {
  localId: string;
  pointId: Id;
}

export interface SymbolArc {
  a: string;
  b: string;
  bulge: number;
}

/** A text label drawn as part of a symbol's body ("NC", "PSV", a size marking), in the
 * same unscaled local coordinates as `SymbolGeometry.points` — `x`/`y` is the label's
 * centre and `size` its height, both scaled by the document's `componentScale` when a
 * placed instance is drawn. Ids are deliberately absent, like `SymbolArc`'s: a label is
 * nothing but its own content, so nothing else in the geometry ever refers to one. */
export interface SymbolText {
  x: number;
  y: number;
  text: string;
  size: number;
}

/** An uploaded raster image used as a symbol's body, drawn centered at the symbol's
 * local origin at `width`x`height` local units (same unscaled coordinate space as
 * `SymbolGeometry.points`) — ports are still ordinary points the user places by
 * clicking on the rendered image in the symbol editor, so nothing downstream needs to
 * know whether a symbol is image- or vector-based. */
export interface SymbolImage {
  /** A `data:` URL (the image is embedded, not referenced by path, so symbols stay
   * portable the same way ComponentSnapshot already is). */
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * A category's visual, in local/unscaled coordinates — a self-contained little scene
 * graph (points + lines + optional arcs, same shape as the sketch engine's own
 * geometry), plus which points are connection ports (ordered, so
 * SceneGraph.addComponent/moveComponent know where to put each `ComponentConnection`).
 * Built-in vector symbols and the generic N-port placeholder (for categories without a
 * hand-built one yet) are both just values of this type — see
 * `library/builtinSymbols.ts`'s `resolveSymbol`. A category can also have a
 * user-drawn/uploaded symbol stored in the `symbols` DB table (see `db.ts`'s
 * `getSymbol`/`upsertSymbol`), which takes priority when present (see
 * `buildComponentSnapshot`) — `image` is optional on all three kinds so lines/arcs and
 * an image can in principle coexist, though the symbol editor only ever populates one.
 * `texts` is optional for the same reason: most symbols carry no labels, and one authored
 * before labels existed is simply a symbol without them.
 */
export interface SymbolGeometry {
  points: Record<string, Vec2>;
  lines: [string, string][];
  arcs: SymbolArc[];
  ports: string[];
  image?: SymbolImage;
  texts?: SymbolText[];
}

/** A snapshot of the library data a placed instance referenced, embedded so the project
 * file stays meaningful even without the library present (moved machines, edited/deleted
 * library entries, shared files). `realPart` is null until a specific part is assigned —
 * placing a component only requires picking its category (see the plan). */
export interface RealPartSnapshot {
  manufacturer: string;
  modelNumber: string;
  datasheetUrl?: string;
  specs: Record<string, string | number | boolean>;
}

export interface ComponentSnapshot {
  familyName: string;
  categoryName: string;
  symbol: SymbolGeometry;
  realPart: RealPartSnapshot | null;
}

/**
 * A placed component. Its connection points are ordinary graph Points (see `connections`)
 * — that's what lets pipes snap onto a component port using all the existing
 * endpoint-snapping/drag-propagation machinery. The decorative symbol body is not part
 * of the point graph at all — it's rendered purely from `position`/`rotation`, like a
 * stamp (see `snapshot.symbol`).
 */
export interface ComponentInstance {
  id: Id;
  categoryId: string;
  realPartId: string | null;
  tag: string;
  /** Free-text descriptive name for this instance ("Reactor feed pump"), separate from
   * the ISA-lite `tag` that identifies it — a service description, not an id, so
   * duplicates are fine and it's never auto-generated. Absent until the user types one
   * (so older project files load unchanged, and the canvas stays uncluttered by default)
   * — see SceneGraph.setComponentName. */
  name?: string;
  position: Vec2;
  rotation: number;
  connections: ComponentConnection[];
  snapshot: ComponentSnapshot;
}

export interface Selection {
  pointIds: Set<Id>;
  lineIds: Set<Id>;
  arcIds: Set<Id>;
  componentIds: Set<Id>;
  textIds: Set<Id>;
}

export interface SceneGraphJSON {
  points: Point[];
  lines: Line[];
  arcs: Arc[];
  components: ComponentInstance[];
  texts: TextAnnotation[];
}

/** A saved/exported project document. See `io/projectFormat.ts` for the format itself —
 * what each field means, the schema version history, and how a file is validated on the
 * way back in. */
export interface ProjectFile {
  /** Marker identifying the file as this app's. Absent in version 1 files. */
  app?: string;
  /** Schema version of the document (not the app version). */
  version: number;
  /** Component-size multiplier the drawing was authored at. Absent in version 1 files. */
  componentScale?: number;
  scene: SceneGraphJSON;
}
