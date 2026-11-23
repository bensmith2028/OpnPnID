import { LibraryPanel } from '../library/LibraryPanel';

/** The right-hand sidebar: always the component library. What you click on the canvas gets its
 * properties in a popup beside it (see PropertiesPopup), not in here. */
export function SidePanel() {
  return (
    <div className="side-panel">
      <LibraryPanel />
    </div>
  );
}
