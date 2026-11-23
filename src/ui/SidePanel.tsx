import { useSketchStore } from '../canvas/store/useSketchStore';
import { LibraryPanel } from '../library/LibraryPanel';
import { PropertiesPanel } from './PropertiesPanel';

/** The right-hand sidebar: Properties (for whatever's selected) and Library (components to
 * place) as two tabs, so switching between them is one click on a label you can see —
 * rather than a toolbar toggle that swaps the panel out from under you. Selecting something
 * on the canvas switches to Properties on its own (see the store's setSelection). */
export function SidePanel() {
  const libraryOpen = useSketchStore((s) => s.libraryPanelOpen);
  const setLibraryPanelOpen = useSketchStore((s) => s.setLibraryPanelOpen);
  return (
    <div className="side-panel">
      <div className="side-tabs" role="tablist">
        <button role="tab" aria-selected={!libraryOpen} className={!libraryOpen ? 'active' : ''} onClick={() => setLibraryPanelOpen(false)}>
          Properties
        </button>
        <button role="tab" aria-selected={libraryOpen} className={libraryOpen ? 'active' : ''} onClick={() => setLibraryPanelOpen(true)}>
          Library
        </button>
      </div>
      {libraryOpen ? <LibraryPanel /> : <PropertiesPanel />}
    </div>
  );
}
