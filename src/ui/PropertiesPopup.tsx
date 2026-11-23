import { useSketchStore } from '../canvas/store/useSketchStore';
import { PropertiesPanel } from './PropertiesPanel';

/** The properties of whatever is selected, in a small popup that sits just left of the library
 * when you click something on the canvas, and goes away when nothing is selected. It stays
 * out of the way while a component is armed for placing (placing selects each new component,
 * and a popup flashing up each time would cover the spot you're about to click next). */
export function PropertiesPopup() {
  const selection = useSketchStore((s) => s.selection);
  const placing = useSketchStore((s) => s.activeTool === 'component');
  const clearSelection = useSketchStore((s) => s.clearSelection);

  const total = selection.pointIds.size + selection.lineIds.size + selection.arcIds.size + selection.componentIds.size + selection.textIds.size;
  if (total === 0 || placing) return null;

  return (
    <div className="props-popup" role="dialog" aria-label="Properties">
      <button className="props-popup-close" onClick={clearSelection} title="Close (Esc)" aria-label="Close properties">
        ×
      </button>
      <PropertiesPanel />
    </div>
  );
}
