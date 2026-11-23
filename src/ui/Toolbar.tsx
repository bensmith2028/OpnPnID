import { useEffect, useState } from 'react';
import { MIN_SNAP_THRESHOLD_PX, useSketchStore } from '../canvas/store/useSketchStore';
import { exportBomDetailed, exportBomSummary } from '../io/bomExport';
import { exportPdf } from '../io/pdfExport';
import { describeImport, exportLibrary, importLibraryFile } from '../io/libraryIO';
import { saveProjectAs } from '../io/projectIO';
import { resetToDefaultLibrary } from '../library/db';
import { describeError } from '../library/errors';
import { Menu, MenuItem, MenuSeparator } from './Menu';
import { CatalogDialog } from './CatalogDialog';
import { notify } from './notice';
import { guardUnsaved } from './unsavedGuard';

/** Every file action (open/save/export) is a fire-and-forget async call from a menu item —
 * this runs it and shows a failure (including "that file isn't an OpnPnID project" on an
 * open) as a notification. */
function runFileAction(fn: () => Promise<void>) {
  fn().catch((e) => notify(describeError(e), 'error'));
}

async function importComponents(): Promise<void> {
  const summary = await importLibraryFile();
  if (summary) notify(describeImport(summary));
}

async function exportAllComponents(): Promise<void> {
  const n = await exportLibrary();
  notify(n > 0 ? `Exported ${n} component${n === 1 ? '' : 's'}.` : 'There are no components to export yet.');
}

async function resetComponents(): Promise<void> {
  if (!window.confirm('Replace your whole component library with the built-in default? Components you added or changed will be lost. Export them first if you want to keep them.')) return;
  await resetToDefaultLibrary();
  notify('Component library reset to the default.');
}

const ICON = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';

/** The slim bar across the top: the app name and file, the File and View menus, and
 * undo/redo. Drawing tools live in the ToolRail down the left side. */
export function TopBar() {
  const canUndo = useSketchStore((s) => s.past.length > 0);
  const canRedo = useSketchStore((s) => s.future.length > 0);
  const undo = useSketchStore((s) => s.undo);
  const redo = useSketchStore((s) => s.redo);
  const filePath = useSketchStore((s) => s.filePath);
  const dirty = useSketchStore((s) => s.dirty);
  const theme = useSketchStore((s) => s.theme);
  const toggleTheme = useSketchStore((s) => s.toggleTheme);
  const [catalogOpen, setCatalogOpen] = useState(false);

  const fileName = filePath ? filePath.split(/[\\/]/).pop() : 'Untitled';

  // Cmd/Ctrl+S saves. Without this the browser would offer to save the web page itself.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        runFileAction(saveProjectAs);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
    <div className="toolbar">
      <div className="toolbar-brand">OpnPnID</div>
      <Menu label="File">
        {() => (
          <>
            <MenuItem onClick={() => runFileAction(() => guardUnsaved('new'))}>New drawing</MenuItem>
            <MenuItem onClick={() => runFileAction(() => guardUnsaved('open'))}>Open…</MenuItem>
            <MenuItem onClick={() => runFileAction(saveProjectAs)} hint={`${MOD}S`}>
              Save As…
            </MenuItem>
            <MenuSeparator />
            <MenuItem onClick={() => runFileAction(exportPdf)}>Export PDF</MenuItem>
            <MenuItem onClick={() => runFileAction(exportBomDetailed)}>Export parts list (every component)</MenuItem>
            <MenuItem onClick={() => runFileAction(exportBomSummary)}>Export parts list (counts)</MenuItem>
            <MenuSeparator />
            <MenuItem onClick={() => runFileAction(importComponents)}>Import components…</MenuItem>
            <MenuItem onClick={() => runFileAction(exportAllComponents)}>Export all components…</MenuItem>
            <MenuItem onClick={() => runFileAction(resetComponents)}>Reset component library…</MenuItem>
          </>
        )}
      </Menu>
      <Menu label="View" keepOpen>
        {() => (
          <div className="menu-form">
            <GridControls />
            <MenuSeparator />
            <button className="menu-item" onClick={toggleTheme} title="Print/PDF export is always light">
              <span>{theme === 'dark' ? '🌙 Dark theme' : '☀️ Light theme'}</span>
              <span className="menu-hint">switch</span>
            </button>
          </div>
        )}
      </Menu>
      <button className={catalogOpen ? 'active' : ''} onClick={() => setCatalogOpen(true)} title="The hardware catalog — every saved piece of hardware, editable and deletable">
        Catalog
      </button>
      <div className="toolbar-group">
        <button className="icon-button" onClick={undo} disabled={!canUndo} title={`Undo (${MOD}Z)`} aria-label="Undo">
          <svg {...ICON} aria-hidden="true">
            <path d="M9 14L4 9l5-5" />
            <path d="M4 9h10.5a5.5 5.5 0 010 11H11" />
          </svg>
        </button>
        <button className="icon-button" onClick={redo} disabled={!canRedo} title={`Redo (${MOD}Shift+Z)`} aria-label="Redo">
          <svg {...ICON} aria-hidden="true">
            <path d="M15 14l5-5-5-5" />
            <path d="M20 9H9.5a5.5 5.5 0 000 11H13" />
          </svg>
        </button>
      </div>
      <div className="toolbar-spacer" />
      <div className="toolbar-filename" title={dirty ? 'Unsaved changes — use File ▸ Save As…' : undefined}>
        {fileName}
        {dirty ? ' •' : ''}
      </div>
    </div>
    {/* Outside the bar so the bar's own button styling doesn't reach into the dialog. */}
    {catalogOpen && <CatalogDialog onClose={() => setCatalogOpen(false)} />}
    </>
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
