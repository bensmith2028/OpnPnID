import { useEffect, useState } from 'react';
import { useSketchStore } from '../canvas/store/useSketchStore';
import * as db from './db';
import { describeError } from './errors';
import { SymbolEditor } from './SymbolEditor';

const PENCIL = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
  </svg>
);

/** The components in one family. Clicking a name picks that component to place; the pencil on
 * each row opens its edit view (see SymbolEditor), which is where a component is renamed,
 * redrawn, shared or deleted. "New component" at the bottom adds one. */
export function CategorySection({ familyId }: { familyId: string }) {
  const [categories, setCategories] = useState<db.Category[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [subtype, setSubtype] = useState('');
  const [actuation, setActuation] = useState('');
  const [portCount, setPortCount] = useState('2');
  const [error, setError] = useState<string | null>(null);
  /** The component whose edit view is open, if any. */
  const [editing, setEditing] = useState<db.Category | null>(null);

  const armComponent = useSketchStore((s) => s.armComponent);

  const refresh = async () => setCategories(await db.listCategories(familyId));

  useEffect(() => {
    void refresh().catch((e: unknown) => setError(describeError(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId]);

  // Anything that changes the library — the edit view saving, File ▸ Import, a reset —
  // re-reads the list.
  useEffect(
    () => db.onLibraryChange(() => void refresh().catch((e: unknown) => setError(describeError(e)))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [familyId],
  );

  const addCategory = async () => {
    if (!name.trim()) return;
    setError(null);
    try {
      const created = await db.upsertCategory({
        familyId,
        name: name.trim(),
        subtype: subtype.trim() || null,
        actuation: actuation.trim() || null,
        portCount: Math.max(1, parseInt(portCount, 10) || 2),
      });
      setName('');
      setSubtype('');
      setActuation('');
      setPortCount('2');
      setAdding(false);
      // A new component has only the generic placeholder symbol, so go straight to drawing it.
      setEditing(created);
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <div className="library-section">
      <ul className="library-list">
        {categories.map((c) => (
          <li key={c.id}>
            <div className="library-list-row">
              <button className="library-list-name" onClick={() => armComponent(c.id)} title="Place this component on the canvas">
                {c.name}
              </button>
              <button className="library-icon-button" onClick={() => setEditing(c)} title={`Edit ${c.name} — drawing, name, connection ports`} aria-label={`Edit ${c.name}`}>
                {PENCIL}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {categories.length === 0 && <p className="library-muted">No components in this family yet.</p>}

      {adding ? (
        <div className="library-add-row library-add-row--wrap">
          <input autoFocus placeholder="Name (e.g. Solenoid 2-Way Valve)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addCategory()} />
          <input placeholder="Subtype (e.g. 2-way)" value={subtype} onChange={(e) => setSubtype(e.target.value)} />
          <input placeholder="Actuation (optional)" value={actuation} onChange={(e) => setActuation(e.target.value)} />
          <input
            type="number"
            min="1"
            placeholder="Ports"
            value={portCount}
            onChange={(e) => setPortCount(e.target.value)}
            className="library-port-count-input"
            title="How many connection points the starting symbol has — you can change them when you draw it"
          />
          <button className="library-primary" onClick={() => void addCategory()}>
            Add
          </button>
          <button onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <button className="library-new" onClick={() => setAdding(true)}>
          + New component
        </button>
      )}
      {error && <p className="field-error">{error}</p>}
      {editing && (
        <SymbolEditor
          category={editing}
          onClose={() => setEditing(null)}
          // The library-change subscription above re-reads the list; this only matters for
          // the old callback contract.
          onSaved={() => {}}
        />
      )}
    </div>
  );
}
