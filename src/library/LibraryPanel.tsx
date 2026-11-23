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

const EXPANDED_KEY = 'opnpnid.expandedFamilies';

/** Which families are open. Everything starts folded shut; what you open is remembered between
 * visits where the browser allows it, and simply not remembered where it doesn't (private
 * windows) — never worth failing over. */
function loadExpanded(): Set<string> {
  try {
    const raw = window.localStorage.getItem(EXPANDED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveExpanded(ids: Set<string>): void {
  try {
    window.localStorage.setItem(EXPANDED_KEY, JSON.stringify([...ids]));
  } catch {
    /* not remembered — fine */
  }
}

/** The Library: every family listed, each folding open or shut (all shut to begin with), with
 * its components indented beneath. Clicking a component's name picks it to place; its pencil opens the edit
 * view. Moving components in and out (import, export, reset) is in the File menu. The gear
 * manages the families themselves. */
export function LibraryPanel() {
  const [families, setFamilies] = useState<db.Family[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const [managingFamilies, setManagingFamilies] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    db
      .listFamilies()
      .then((fams) => {
        setFamilies(fams);
        setError(null);
      })
      .catch((e: unknown) => setError(describeError(e)));

  useEffect(() => {
    void load();
    return db.onLibraryChange(() => void load());
  }, []);

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (!next.delete(id)) next.add(id);
    setExpanded(next);
    saveExpanded(next);
  };

  return (
    <div className="properties-panel library-panel">
      {error && <p className="field-error">Couldn't load the library: {error}</p>}

      <div className="library-toolbar">
        <h3>Library</h3>
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
        <div className="library-tree">
          {families.map((f) => {
            const open = expanded.has(f.id);
            return (
              <div key={f.id} className="library-family">
                <button className="library-family-header" onClick={() => toggle(f.id)} aria-expanded={open} title={open ? 'Hide this family\'s components' : 'Show this family\'s components'}>
                  <span className="library-chevron" aria-hidden="true">
                    {open ? '▾' : '▸'}
                  </span>
                  <span className="library-family-name">{f.name}</span>
                </button>
                {open && (
                  <div className="library-family-body">
                    <CategorySection familyId={f.id} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
