import { useEffect, useState } from 'react';
import * as db from './db';
import { describeError } from './errors';

/** Normalizes what was typed into a tag-letter field down to what the column stores: a
 * single uppercase character, or null for "no default letter" (families like Instrument,
 * where the letter varies by category). Shared by the Add Family form and the inline
 * per-row box so both coerce identically. */
export function normalizeTagLetter(raw: string): string | null {
  return raw.trim().toUpperCase().slice(0, 1) || null;
}

/** Family list + add form — a loose grouping (Valve, Pump, Instrument, ...) used only
 * for browsing and the ISA-lite tag-letter default. Families own no symbol/attribute
 * logic of their own; that all lives on the categories inside them (see CategoryForm).
 * `editMode` gates the Delete button and the inline edit boxes (see LibraryPanel's Edit
 * toggle). */
export function FamilyManager({ families, onChange, editMode }: { families: db.Family[]; onChange: () => void; editMode: boolean }) {
  const [newName, setNewName] = useState('');
  const [newLetter, setNewLetter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const addFamily = async () => {
    if (!newName.trim()) return;
    setError(null);
    try {
      await db.upsertFamily({ name: newName.trim(), tagLetter: normalizeTagLetter(newLetter), sortOrder: families.length });
      setNewName('');
      setNewLetter('');
      onChange();
    } catch (e) {
      setError(describeError(e));
    }
  };

  /** Applies one edited field to an existing family. Spreading the row keeps the fields
   * the edit didn't touch (the other of name/tagLetter, plus sortOrder) intact — upsert
   * rewrites the whole record, so anything left off would be nulled out. */
  const updateFamily = async (family: db.Family, changes: Partial<db.Family>) => {
    setError(null);
    try {
      await db.upsertFamily({ ...family, ...changes });
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
              {/* Browsing shows the family as plain text; in edit mode both of its fields
                  become text boxes so they can be corrected in place — otherwise fixing a
                  typo means deleting the family, which cascades away every category and
                  real part inside it. Unlike a category row there's no expand toggle to
                  displace: a family row has nothing to expand, so its name was never a
                  button and no chevron is needed. */}
              {editMode ? (
                <>
                  <FamilyNameInput family={f} onRename={(name) => void updateFamily(f, { name })} />
                  <FamilyTagLetterInput family={f} onRetag={(tagLetter) => void updateFamily(f, { tagLetter })} />
                </>
              ) : (
                <span className="library-list-name">
                  {f.name} {f.tagLetter ? <span className="library-muted">({f.tagLetter})</span> : null}
                </span>
              )}
              {editMode && (
                <button
                  className="library-icon-button library-icon-button--danger"
                  onClick={() => void removeFamily(f.id, f.name)}
                  title="Delete family — deletes the family and everything in it"
                >
                  🗑
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
          onChange={(e) => setNewLetter(normalizeTagLetter(e.target.value) ?? '')}
          className="library-tag-letter-input"
          title="ISA-lite auto-tag first letter, e.g. V for Valve. Optional — leave blank for families like Instrument where it varies by category."
        />
        <button onClick={() => void addFamily()}>Add Family</button>
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

/** Inline rename box for one family row (edit mode only). Its own component so each row
 * owns its draft text, committing on blur/Enter and reverting on Escape — the same
 * commit idiom as CategoryNameInput. */
function FamilyNameInput({ family, onRename }: { family: db.Family; onRename: (name: string) => void }) {
  const [text, setText] = useState(family.name);

  // Re-sync when the list reloads (a rename elsewhere, or a folder sync) so the box
  // never sits on a stale draft.
  useEffect(() => setText(family.name), [family.name]);

  const commit = () => {
    const next = text.trim();
    // A blank name would leave the family unlabelled, so treat it as a cancel rather
    // than an error worth interrupting the user for.
    if (!next || next === family.name) setText(family.name);
    else onRename(next);
  };

  return (
    <input
      className="library-list-name library-list-name--input"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') {
          setText(family.name);
          e.currentTarget.blur();
        }
      }}
      title="Rename this family — Enter to save, Escape to cancel"
    />
  );
}

/** Inline tag-letter box for one family row (edit mode only) — same commit idiom as
 * FamilyNameInput, and the same normalizeTagLetter coercion as the Add Family form.
 * Blank is a real value here (null: no default letter, because it varies by category),
 * so unlike the name there's nothing to revert an empty commit to. */
function FamilyTagLetterInput({ family, onRetag }: { family: db.Family; onRetag: (tagLetter: string | null) => void }) {
  const [text, setText] = useState(family.tagLetter ?? '');

  useEffect(() => setText(family.tagLetter ?? ''), [family.tagLetter]);

  const commit = () => {
    const next = normalizeTagLetter(text);
    // Skip unchanged text so merely tabbing through the field doesn't rewrite the row.
    if (next !== family.tagLetter) onRetag(next);
  };

  return (
    <input
      className="library-list-name library-list-name--input library-tag-letter-input"
      value={text}
      onChange={(e) => setText(normalizeTagLetter(e.target.value) ?? '')}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') {
          setText(family.tagLetter ?? '');
          e.currentTarget.blur();
        }
      }}
      title="ISA-lite auto-tag first letter, e.g. V for Valve. Blank for families like Instrument where it varies by category — Enter to save, Escape to cancel."
    />
  );
}
