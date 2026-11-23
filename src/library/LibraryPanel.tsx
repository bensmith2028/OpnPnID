import { useEffect, useState } from 'react';
import { CategorySection } from './CategoryForm';
import * as db from './db';
import { describeError } from './errors';
import { FamilyManager } from './FamilyManager';

const GEAR = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z" />
  </svg>
);

/** The Library tab: families as tabs across the top, the components in the selected family
 * below. Everything about *moving* components in and out (import, export, reset) lives in the
 * File menu; renaming, redrawing, sharing and deleting one component is done from the pencil
 * on its row. The gear at the end of the tab row manages the families themselves. */
export function LibraryPanel() {
  const [families, setFamilies] = useState<db.Family[]>([]);
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(null);
  const [managingFamilies, setManagingFamilies] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    db
      .listFamilies()
      .then((fams) => {
        setFamilies(fams);
        // Keep the current tab if it still exists (an import may have added others).
        setSelectedFamilyId((current) => (current && fams.some((f) => f.id === current) ? current : fams[0]?.id ?? null));
        setError(null);
      })
      .catch((e: unknown) => setError(describeError(e)));

  useEffect(() => {
    void load();
    return db.onLibraryChange(() => void load());
  }, []);

  return (
    <div className="properties-panel library-panel">
      {error && <p className="field-error">Couldn't load the library: {error}</p>}

      <div className="library-category-tabs">
        {families.map((f) => (
          <button
            key={f.id}
            className={!managingFamilies && selectedFamilyId === f.id ? 'active' : ''}
            onClick={() => {
              setManagingFamilies(false);
              setSelectedFamilyId(f.id);
            }}
          >
            {f.name}
          </button>
        ))}
        <button
          className={`library-gear${managingFamilies ? ' active' : ''}`}
          onClick={() => setManagingFamilies((m) => !m)}
          title="Manage families — add, rename or delete the groups components are sorted into"
          aria-label="Manage families"
        >
          {GEAR}
        </button>
      </div>

      {managingFamilies ? (
        <FamilyManager families={families} onChange={() => void load()} />
      ) : families.length === 0 ? (
        !error && <p className="properties-panel--empty">No families yet — use the gear to add one, or File ▸ Import components.</p>
      ) : (
        selectedFamilyId && <CategorySection key={selectedFamilyId} familyId={selectedFamilyId} />
      )}
    </div>
  );
}
