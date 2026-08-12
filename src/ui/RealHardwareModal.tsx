import { openUrl } from '@tauri-apps/plugin-opener';
import { useEffect, useState } from 'react';
import { useSketchStore } from '../canvas/store/useSketchStore';
import { buildComponentSnapshot } from '../library/db';
import { describeError } from '../library/errors';
import { RealPartSection } from '../library/RealPartForm';
import type { Id } from '../types/geometry';

/** Pop-up modal for assigning "real hardware" (a manufacturer/model real part, with its
 * spec values) to one already-placed component instance. This is the sole place real
 * parts get browsed/added now — LibraryPanel only manages Family/Category/attribute
 * *schema* and always places the bare category symbol (see CategoryForm). Opened by
 * double-clicking a component on the canvas (SketchCanvas) or its "Real Hardware…"
 * button in the Properties Panel. */
export function RealHardwareModal({ componentId, onClose }: { componentId: Id; onClose: () => void }) {
  const [editMode, setEditMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bump on every store version change so the summary reflects a just-applied assignment
  // without needing to re-mount the modal.
  const version = useSketchStore((s) => s.version);

  const instance = useSketchStore.getState().graph.components.get(componentId);

  // If the instance disappears from under us (e.g. deleted while the modal is open),
  // close rather than render against stale/missing data.
  useEffect(() => {
    if (!instance) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance]);

  // Scoped Escape handling: stop propagation so SketchCanvas's global Escape listener
  // (which switches tools / clears selection) doesn't also fire while this modal is open.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  if (!instance) return null;

  const handleSelect = async (realPartId: string) => {
    setError(null);
    try {
      const snapshot = await buildComponentSnapshot(instance.categoryId, realPartId);
      if (!snapshot) {
        setError("Couldn't build this part's snapshot — its category may have been deleted.");
        return;
      }
      useSketchStore.getState().setComponentPart(componentId, realPartId, snapshot);
      onClose();
    } catch (e) {
      setError(describeError(e));
    }
  };

  const handleClear = async () => {
    setError(null);
    try {
      const snapshot = await buildComponentSnapshot(instance.categoryId, null);
      if (!snapshot) {
        setError("Couldn't build a snapshot to clear this assignment.");
        return;
      }
      // Doesn't close the modal — lets the user immediately pick a replacement part.
      useSketchStore.getState().setComponentPart(componentId, null, snapshot);
    } catch (e) {
      setError(describeError(e));
    }
  };

  void version; // re-render trigger only
  const realPart = instance.snapshot.realPart;
  const specEntries = realPart ? Object.entries(realPart.specs) : [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel real-hardware-modal" onClick={(e) => e.stopPropagation()}>
        <div className="library-header">
          <h3>
            {instance.snapshot.familyName} — {instance.snapshot.categoryName}
          </h3>
          <div className="library-header-buttons">
            <button
              className={editMode ? 'active' : ''}
              onClick={() => setEditMode((m) => !m)}
              title="Reveals Delete buttons in the parts list — off by default so browsing/selecting can't accidentally delete anything"
            >
              {editMode ? 'Done Editing' : 'Edit'}
            </button>
            <button onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="field">
          <span>Current assignment</span>
          {realPart ? (
            <>
              <div className="readonly-value">
                {realPart.manufacturer} {realPart.modelNumber}
              </div>
              {specEntries.length > 0 && (
                <ul className="component-specs">
                  {specEntries.map(([key, value]) => (
                    <li key={key}>
                      <span>{key}</span>
                      <span>{String(value)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {realPart.datasheetUrl && <button onClick={() => void openUrl(realPart.datasheetUrl!)}>View Datasheet</button>}
              <div className="fillet-row">
                <button onClick={() => void handleClear()}>Clear Assignment</button>
              </div>
            </>
          ) : (
            <div className="readonly-value">No part assigned yet</div>
          )}
        </div>

        {error && <p className="field-error">{error}</p>}

        <RealPartSection categoryId={instance.categoryId} editMode={editMode} onSelect={(id) => void handleSelect(id)} />
      </div>
    </div>
  );
}
