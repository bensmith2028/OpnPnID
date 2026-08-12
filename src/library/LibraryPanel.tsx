import { useEffect, useState } from 'react';
import { CategorySection } from './CategoryForm';
import * as db from './db';
import { describeError } from './errors';
import { FamilyManager } from './FamilyManager';

/** Toggleable sidebar (replaces the Properties Panel in the same slot while open — see
 * App.tsx) for browsing/placing components and managing the library: families (loose
 * groupings like Valve/Pump), categories (the symbol-owning classification, each with
 * its own configurable attribute schema), and real parts. */
export function LibraryPanel() {
  const [families, setFamilies] = useState<db.Family[]>([]);
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(null);
  const [managingFamilies, setManagingFamilies] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    db.listFamilies()
      .then((fams) => {
        if (cancelled) return;
        setFamilies(fams);
        setSelectedFamilyId((current) => current ?? fams[0]?.id ?? null);
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

  return (
    <div className="properties-panel library-panel">
      <div className="library-header">
        <h3>Component Library</h3>
        <div className="library-header-buttons">
          <button
            className={editMode ? 'active' : ''}
            onClick={() => setEditMode((m) => !m)}
            title="Reveals Delete buttons throughout the library — off by default so browsing/placing can't accidentally delete anything"
          >
            {editMode ? 'Done Editing' : 'Edit'}
          </button>
          <button onClick={() => setManagingFamilies((m) => !m)}>{managingFamilies ? 'Done' : 'Manage Families'}</button>
        </div>
      </div>

      {error && <p className="field-error">Couldn't load the library: {error}</p>}

      {managingFamilies ? (
        <FamilyManager families={families} onChange={refresh} editMode={editMode} />
      ) : families.length === 0 ? (
        !error && <p className="properties-panel--empty">No families yet — use "Manage Families" to add one.</p>
      ) : (
        <>
          <div className="library-category-tabs">
            {families.map((f) => (
              <button key={f.id} className={selectedFamilyId === f.id ? 'active' : ''} onClick={() => setSelectedFamilyId(f.id)}>
                {f.name}
              </button>
            ))}
          </div>
          {selectedFamilyId && <CategorySection familyId={selectedFamilyId} editMode={editMode} />}
        </>
      )}
    </div>
  );
}
