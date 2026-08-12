import { useState } from 'react';
import * as db from './db';
import { describeError } from './errors';

/** Family list + add form — a loose grouping (Valve, Pump, Instrument, ...) used only
 * for browsing and the ISA-lite tag-letter default. Families own no symbol/attribute
 * logic of their own; that all lives on the categories inside them (see CategoryForm).
 * `editMode` gates the Delete button (see LibraryPanel's Edit toggle). */
export function FamilyManager({ families, onChange, editMode }: { families: db.Family[]; onChange: () => void; editMode: boolean }) {
  const [newName, setNewName] = useState('');
  const [newLetter, setNewLetter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const addFamily = async () => {
    if (!newName.trim()) return;
    setError(null);
    try {
      await db.upsertFamily({ name: newName.trim(), tagLetter: newLetter.trim() || null, sortOrder: families.length });
      setNewName('');
      setNewLetter('');
      onChange();
    } catch (e) {
      setError(describeError(e));
    }
  };

  const removeFamily = async (id: string, name: string) => {
    // Deleting a family cascades to its categories, and from there to their attribute
    // definitions and real parts — the most destructive single action in the library,
    // so it gets a confirmation even though the Delete button itself is already
    // edit-mode-gated.
    if (!window.confirm(`Delete "${name}" and everything in it (categories, attributes, real parts)? This can't be undone.`)) return;
    setError(null);
    try {
      await db.deleteFamily(id);
      onChange();
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <div className="library-section">
      <ul className="library-list">
        {families.map((f) => (
          <li key={f.id}>
            <div className="library-list-row">
              <span className="library-list-name">
                {f.name} {f.tagLetter ? <span className="library-muted">({f.tagLetter})</span> : null}
              </span>
              {editMode && (
                <button onClick={() => void removeFamily(f.id, f.name)} title="Deletes the family and everything in it">
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="library-add-row">
        <input placeholder="Family name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <input
          placeholder="Tag letter"
          value={newLetter}
          onChange={(e) => setNewLetter(e.target.value.toUpperCase().slice(0, 1))}
          className="library-tag-letter-input"
          title="ISA-lite auto-tag first letter, e.g. V for Valve. Optional — leave blank for families like Instrument where it varies by category."
        />
        <button onClick={() => void addFamily()}>Add Family</button>
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
