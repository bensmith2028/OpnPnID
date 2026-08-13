import { useState } from 'react';
import { MIN_SNAP_THRESHOLD_PX, useSketchStore } from '../canvas/store/useSketchStore';
import { exportBomDetailed, exportBomSummary } from '../io/bomExport';
import { exportPdf } from '../io/pdfExport';
import { saveProject, saveProjectAs } from '../io/projectIO';
import { describeError } from '../library/errors';
import { guardUnsaved } from './unsavedGuard';

/** Every file action (open/save/export) is a fire-and-forget async call from a plain
 * button — this runs it and surfaces a failure via a plain alert. There's no existing
 * lightweight toast/notification host in this codebase (the Library panels' inline
 * field-error text needs a persistent host component that doesn't fit a one-off Toolbar
 * action), so an alert is the simplest thing that reliably gets a failure — including
 * "that file isn't an OpnPnID project" on an import — in front of the user. */
function runFileAction(fn: () => Promise<void>) {
  fn().catch((e) => window.alert(describeError(e)));
}

export function Toolbar() {
  const activeTool = useSketchStore((s) => s.activeTool);
  const setTool = useSketchStore((s) => s.setTool);
  const canUndo = useSketchStore((s) => s.past.length > 0);
  const canRedo = useSketchStore((s) => s.future.length > 0);
  const undo = useSketchStore((s) => s.undo);
  const redo = useSketchStore((s) => s.redo);
  const filePath = useSketchStore((s) => s.filePath);
  const dirty = useSketchStore((s) => s.dirty);
  const theme = useSketchStore((s) => s.theme);
  const toggleTheme = useSketchStore((s) => s.toggleTheme);
  const libraryPanelOpen = useSketchStore((s) => s.libraryPanelOpen);
  const toggleLibraryPanel = useSketchStore((s) => s.toggleLibraryPanel);

  const fileName = filePath ? filePath.split(/[\\/]/).pop() : 'Untitled';

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button className={activeTool === 'select' ? 'active' : ''} onClick={() => setTool('select')} title="Select (V)">
          Select
        </button>
        <button className={activeTool === 'line' ? 'active' : ''} onClick={() => setTool('line')} title="Line (L)">
          Line
        </button>
        <button className={activeTool === 'arc' ? 'active' : ''} onClick={() => setTool('arc')} title="Arc (A) — hold Shift on a click to snap tangent to a connected line/arc">
          Arc
        </button>
        <button className={activeTool === 'point' ? 'active' : ''} onClick={() => setTool('point')} title="Point (P)">
          Point
        </button>
        <button className={activeTool === 'circle' ? 'active' : ''} onClick={() => setTool('circle')} title="Circle (C)">
          Circle
        </button>
        <button
          className={activeTool === 'text' ? 'active' : ''}
          onClick={() => setTool('text')}
          title="Text (T) — click where the note goes and type it; click an existing note to re-edit it"
        >
          Text
        </button>
      </div>
      <div className="toolbar-group">
        <button className={libraryPanelOpen ? 'active' : ''} onClick={toggleLibraryPanel} title="Browse/place components and manage the library">
          Library
        </button>
      </div>
      <div className="toolbar-group">
        <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
          Redo
        </button>
      </div>
      <div className="toolbar-group">
        {/* Both replace the current drawing outright, so they go through the same
            unsaved-changes prompt a close/quit does — see ui/unsavedGuard.ts. */}
        <button onClick={() => runFileAction(() => guardUnsaved('new'))} title="Start an empty drawing">
          New
        </button>
        <button
          onClick={() => runFileAction(() => guardUnsaved('open'))}
          title="Open a project file (.pnid.json) — including one exported from another machine"
        >
          Open
        </button>
        <button onClick={() => runFileAction(saveProject)} title="Save the whole drawing to its project file (.pnid.json)">
          Save
        </button>
        <button
          onClick={() => runFileAction(saveProjectAs)}
          title="Export the whole drawing to a new project file (.pnid.json), openable in any other instance of OpnPnID"
        >
          Save As
        </button>
      </div>
      <div className="toolbar-group">
        <button onClick={() => runFileAction(exportPdf)} title="Export the current schematic as a PDF (always light theme)">
          Export PDF
        </button>
        <button onClick={() => runFileAction(exportBomDetailed)} title="Export a Bill of Materials CSV with one row per placed component">
          Export BOM (Detailed)
        </button>
        <button onClick={() => runFileAction(exportBomSummary)} title="Export a Bill of Materials CSV grouped by part, with quantities">
          Export BOM (Summary)
        </button>
      </div>
      <GridControls />
      <div className="toolbar-spacer" />
      <button onClick={toggleTheme} title="Toggle light/dark theme (print/PDF export will always use light)">
        {theme === 'dark' ? '🌙 Dark' : '☀️ Light'}
      </button>
      <div className="toolbar-filename">
        {fileName}
        {dirty ? ' •' : ''}
      </div>
    </div>
  );
}

function GridControls() {
  const gridSize = useSketchStore((s) => s.gridSize);
  const gridVisible = useSketchStore((s) => s.gridVisible);
  const snapThresholdPx = useSketchStore((s) => s.snapThresholdPx);
  const componentScale = useSketchStore((s) => s.componentScale);
  const setGridSize = useSketchStore((s) => s.setGridSize);
  const setGridVisible = useSketchStore((s) => s.setGridVisible);
  const setSnapThresholdPx = useSketchStore((s) => s.setSnapThresholdPx);
  const setComponentScale = useSketchStore((s) => s.setComponentScale);

  // Local text buffers so partial/invalid typing (e.g. a bare "-") doesn't get clobbered
  // by the store's clamped value on every keystroke.
  const [gridText, setGridText] = useState(String(gridSize));
  const [snapText, setSnapText] = useState(String(snapThresholdPx));
  const [scaleText, setScaleText] = useState(String(componentScale));

  const commitGrid = () => {
    const value = parseFloat(gridText);
    if (Number.isFinite(value) && value > 0) setGridSize(value);
    else setGridText(String(gridSize));
  };

  // Below the floor is rejected outright (buffer snapped back to the live value) rather
  // than accepted-and-clamped, so the box never shows a number the app isn't using — same
  // shape as commitGrid's `> 0` rule. The floor itself exists because this value is also
  // the hit-test radius: see MIN_SNAP_THRESHOLD_PX.
  const commitSnap = () => {
    const value = parseFloat(snapText);
    if (Number.isFinite(value) && value >= MIN_SNAP_THRESHOLD_PX) setSnapThresholdPx(value);
    else setSnapText(String(snapThresholdPx));
  };

  const commitScale = () => {
    const value = parseFloat(scaleText);
    if (Number.isFinite(value) && value > 0) setComponentScale(value);
    else setScaleText(String(componentScale));
  };

  const onEnter = (commit: () => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    else if (e.key === 'Escape') commit();
  };

  return (
    <div className="toolbar-group grid-controls">
      <label title="Grid spacing, in drawing units">
        Grid
        <input
          type="number"
          step="any"
          min="0.1"
          value={gridText}
          onChange={(e) => setGridText(e.target.value)}
          onBlur={commitGrid}
          onKeyDown={onEnter(commitGrid)}
        />
      </label>
      <label title="How close (in screen pixels) the cursor must come to grab an existing point, pick an item, or lock to an axis. The grid always snaps — hold Alt to place freely.">
        Snap px
        <input
          type="number"
          step="any"
          min={MIN_SNAP_THRESHOLD_PX}
          value={snapText}
          onChange={(e) => setSnapText(e.target.value)}
          onBlur={commitSnap}
          onKeyDown={onEnter(commitSnap)}
        />
      </label>
      <label title="Global size multiplier applied to every placed component's symbol (1 = normal size)">
        Component scale
        <input
          type="number"
          step="any"
          min="0.1"
          value={scaleText}
          onChange={(e) => setScaleText(e.target.value)}
          onBlur={commitScale}
          onKeyDown={onEnter(commitScale)}
        />
      </label>
      <label className="grid-visible-toggle">
        <input type="checkbox" checked={gridVisible} onChange={(e) => setGridVisible(e.target.checked)} />
        Show grid
      </label>
    </div>
  );
}
