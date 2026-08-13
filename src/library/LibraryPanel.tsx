import { useEffect, useState } from 'react';
import { CategorySection } from './CategoryForm';
import * as db from './db';
import { describeError } from './errors';
import { FamilyManager } from './FamilyManager';
import { chooseLibraryRoot, getLibraryRoot } from './libraryRoot';
import { syncLibraryFromDisk } from './librarySync';

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
  const [libraryRoot, setLibraryRootState] = useState<string | null>(() => getLibraryRoot());
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

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

  // Pick up anything a teammate (or the catalog-import pipeline) added to the shared
  // folder since this app last ran, without requiring a manual "Sync Now" every time.
  useEffect(() => {
    if (!libraryRoot) return;
    void runSync(libraryRoot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = () => setReloadKey((k) => k + 1);

  const runSync = async (root: string) => {
    setSyncing(true);
    setSyncStatus(null);
    try {
      const result = await syncLibraryFromDisk(root);
      setSyncStatus(
        `Synced ${result.families} families, ${result.categories} categories, ${result.parts} parts from disk.`,
      );
      refresh();
    } catch (e) {
      setSyncStatus(`Sync failed: ${describeError(e)}`);
    } finally {
      setSyncing(false);
    }
  };

  const connectFolder = async () => {
    const picked = await chooseLibraryRoot().catch((e: unknown) => {
      setSyncStatus(`Couldn't open folder picker: ${describeError(e)}`);
      return null;
    });
    if (!picked) return;
    setLibraryRootState(picked);
    await runSync(picked);
  };

  return (
    <div className="properties-panel library-panel">
      <div className="library-header">
        <h3>Component Library</h3>
        <div className="library-header-buttons">
          <button
            className={editMode ? 'active' : ''}
            onClick={() => setEditMode((m) => !m)}
            title="Reveals the library-authoring actions — rename, attribute schema, symbol drawing, Delete — off by default so browsing/placing can't accidentally change anything"
          >
            {editMode ? 'Done Editing' : 'Edit'}
          </button>
          <button onClick={() => setManagingFamilies((m) => !m)}>{managingFamilies ? 'Done' : 'Manage Families'}</button>
        </div>
      </div>

      <div className="library-sync-row">
        {libraryRoot ? (
          <>
            <span className="library-sync-path library-muted" title={libraryRoot}>
              📁 {libraryRoot}
            </span>
            <button onClick={() => void runSync(libraryRoot)} disabled={syncing} title="Re-read the connected folder and apply any changes">
              {syncing ? 'Syncing…' : 'Sync Now'}
            </button>
            <button onClick={() => void connectFolder()} title="Connect a different library-data folder">
              Change…
            </button>
          </>
        ) : (
          <button onClick={() => void connectFolder()} title="Connect this library to a shared library-data folder so families/categories/parts are read from (and saved to) disk instead of only this machine">
            Connect Library Folder…
          </button>
        )}
      </div>
      {syncStatus && <p className="library-muted">{syncStatus}</p>}

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
