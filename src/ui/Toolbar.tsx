import { useState } from 'react';
import { useSketchStore } from '../canvas/store/useSketchStore';
import { newProject, openProject, saveProject, saveProjectAs } from '../io/projectIO';

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
        <button onClick={() => newProject()}>New</button>
        <button onClick={() => openProject()}>Open</button>
        <button onClick={() => saveProject()}>Save</button>
        <button onClick={() => saveProjectAs()}>Save As</button>
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
  const setGridSize = useSketchStore((s) => s.setGridSize);
  const setGridVisible = useSketchStore((s) => s.setGridVisible);
  const setSnapThresholdPx = useSketchStore((s) => s.setSnapThresholdPx);

  // Local text buffers so partial/invalid typing (e.g. a bare "-") doesn't get clobbered
  // by the store's clamped value on every keystroke.
  const [gridText, setGridText] = useState(String(gridSize));
  const [snapText, setSnapText] = useState(String(snapThresholdPx));

  const commitGrid = () => {
    const value = parseFloat(gridText);
    if (Number.isFinite(value) && value > 0) setGridSize(value);
    else setGridText(String(gridSize));
  };

  const commitSnap = () => {
    const value = parseFloat(snapText);
    if (Number.isFinite(value) && value >= 0) setSnapThresholdPx(value);
    else setSnapText(String(snapThresholdPx));
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
      <label title="Snap/pick distance, in screen pixels">
        Snap px
        <input
          type="number"
          step="any"
          min="0"
          value={snapText}
          onChange={(e) => setSnapText(e.target.value)}
          onBlur={commitSnap}
          onKeyDown={onEnter(commitSnap)}
        />
      </label>
      <label className="grid-visible-toggle">
        <input type="checkbox" checked={gridVisible} onChange={(e) => setGridVisible(e.target.checked)} />
        Show grid
      </label>
    </div>
  );
}
