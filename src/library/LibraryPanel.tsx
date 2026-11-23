import { useEffect, useState } from 'react';
import { describeImport, exportLibrary, importLibraryFile } from '../io/libraryIO';
import { CategorySection } from './CategoryForm';
import * as db from './db';
import { describeError } from './errors';
import { FamilyManager } from './FamilyManager';

/** Toggleable sidebar (replaces the Properties Panel in the same slot while open — see
 * App.tsx) for browsing/placing components and managing the library: families (loose
 * groupings like Valve/Pump) and the components inside them, each with its own drawing.
 *
 * Sharing is file-based: Export writes components out, Import adds someone else's to your
 * library without replacing anything you already have. */
export function LibraryPanel() {
  const [families, setFamilies] = useState<db.Family[]>([]);
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(null);
  const [managingFamilies, setManagingFamilies] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    db.listFamilies()
      .then((fams) => {
        if (cancelled) return;
        setFamilies(fams);
        // Keep the current tab if it still exists (an import may have added others).
        setSelectedFamilyId((current) => (current && fams.some((f) => f.id === current) ? current : fams[0]?.id ?? null));
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(describeError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const refresh = () => setReloadKey((k) => k + 1);

  const importFile = async () => {
    setStatus(null);
    try {
      const summary = await importLibraryFile();
      if (summary) {
        setStatus(describeImport(summary));
        refresh();
      }
    } catch (e) {
      setStatus(`Import failed: ${describeError(e)}`);
    }
  };

  const exportAll = async () => {
    setStatus(null);
    try {
      const n = await exportLibrary();
      setStatus(n > 0 ? `Exported ${n} component${n === 1 ? '' : 's'}.` : 'Nothing to export yet.');
    } catch (e) {
      setStatus(`Export failed: ${describeError(e)}`);
    }
  };

  const resetLibrary = async () => {
    if (!window.confirm('Replace your whole library with the built-in default? Components you added or changed will be lost. Export first if you want to keep them.')) return;
    setStatus(null);
    try {
      await db.resetToDefaultLibrary();
      setStatus('Library reset to the default.');
      refresh();
    } catch (e) {
      setStatus(`Reset failed: ${describeError(e)}`);
    }
  };

  return (
    <div className="properties-panel library-panel">
      <div className="library-header">
        <h3>Component Library</h3>
        <div className="library-header-buttons">
          <button
            className={editMode ? 'active' : ''}
            onClick={() => setEditMode((m) => !m)}
            title="Reveals the library-authoring actions — rename, draw, export, Delete — off by default so browsing/placing can't accidentally change anything"
          >
            {editMode ? 'Done Editing' : 'Edit'}
          </button>
          <button onClick={() => setManagingFamilies((m) => !m)}>{managingFamilies ? 'Done' : 'Manage Families'}</button>
        </div>
      </div>

      <div className="library-sync-row">
        <button onClick={() => void importFile()} title="Add components from a library file someone shared — nothing you already have is replaced">
          Import…
        </button>
        <button onClick={() => void exportAll()} title="Save your whole library to a file you can share or back up">
          Export All
        </button>
        {editMode && (
          <button className="library-icon-button--danger" onClick={() => void resetLibrary()} title="Replace your library with the built-in default">
            Reset
          </button>
        )}
      </div>
      {status && <p className="library-muted">{status}</p>}

      {error && <p className="field-error">Couldn't load the library: {error}</p>}

      {managingFamilies ? (
        <FamilyManager families={families} onChange={refresh} editMode={editMode} />
      ) : families.length === 0 ? (
        !error && <p className="properties-panel--empty">No families yet — use "Manage Families" to add one, or Import a library file.</p>
      ) : (
        <>
          <div className="library-category-tabs">
            {families.map((f) => (
              <button key={f.id} className={selectedFamilyId === f.id ? 'active' : ''} onClick={() => setSelectedFamilyId(f.id)}>
                {f.name}
              </button>
            ))}
          </div>
          {/* Keyed on the reload counter so an import or reset re-reads the list. */}
          {selectedFamilyId && <CategorySection key={`${selectedFamilyId}:${reloadKey}`} familyId={selectedFamilyId} editMode={editMode} />}
        </>
      )}
    </div>
  );
}
