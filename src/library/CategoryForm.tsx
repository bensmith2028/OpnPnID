import { useEffect, useState } from 'react';
import { useSketchStore } from '../canvas/store/useSketchStore';
import * as db from './db';
import { exportLibrary } from '../io/libraryIO';
import { describeError } from './errors';
import { SymbolEditor } from './SymbolEditor';

/** Component list + add form for one family. Each row is a general component ("Solenoid
 * 2-Way Valve") that owns a drawing and its connection ports. `editMode` (see LibraryPanel's
 * Edit toggle) splits the row cleanly in two: browsing is purely for placing — clicking the
 * name arms the component — while edit mode swaps in the library-authoring actions (rename,
 * Edit Drawing, Export, Delete). */
export function CategorySection({ familyId, editMode }: { familyId: string; editMode: boolean }) {
  const [categories, setCategories] = useState<db.Category[]>([]);
  const [name, setName] = useState('');
  const [subtype, setSubtype] = useState('');
  const [actuation, setActuation] = useState('');
  const [portCount, setPortCount] = useState('2');
  const [error, setError] = useState<string | null>(null);
  /** The category whose symbol is open in the drawing editor, if any. */
  const [symbolEditorFor, setSymbolEditorFor] = useState<db.Category | null>(null);

  const armComponent = useSketchStore((s) => s.armComponent);

  const refresh = async () => setCategories(await db.listCategories(familyId));

  useEffect(() => {
    void refresh().catch((e: unknown) => setError(describeError(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId]);

  const addCategory = async () => {
    if (!name.trim()) return;
    setError(null);
    try {
      await db.upsertCategory({
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
      await refresh();
    } catch (e) {
      setError(describeError(e));
    }
  };

  const renameCategory = async (category: db.Category, name: string) => {
    setError(null);
    try {
      // Spreading the row keeps subtype/actuation/portCount/symbolId intact — upsert
      // rewrites the whole record, so anything left off would be nulled out.
      await db.upsertCategory({ ...category, name });
      await refresh();
    } catch (e) {
      setError(describeError(e));
    }
  };

  const exportOne = async (category: db.Category) => {
    setError(null);
    try {
      await exportLibrary([category.id]);
    } catch (e) {
      setError(describeError(e));
    }
  };

  const removeCategory = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}" and its drawing? This can't be undone.`)) return;
    setError(null);
    try {
      await db.deleteCategory(id);
      await refresh();
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
              {/* Browsing mode: the name *is* the Place action, so the whole (already
                  full-width) label is the click target instead of a separate button
                  crowding a narrow panel. The `title` carries what the button used to
                  spell out, since the row no longer names the action itself. In edit mode
                  the name becomes a text box so the category can be renamed in place. */}
              {editMode ? (
                <CategoryNameInput category={c} onRename={(name) => void renameCategory(c, name)} />
              ) : (
                <button
                  className="library-list-name"
                  onClick={() => armComponent(c.id)}
                  title="Place this component on the canvas"
                >
                  {c.name}
                </button>
              )}
              {/* Everything else on the row is edit-mode-only. Keeping the two sets mutually
                  exclusive is what the Edit toggle is for: browsing stays a one-click
                  place-this list. */}
              {editMode && (
                <>
                  <button className="library-icon-button" onClick={() => setSymbolEditorFor(c)} title="Edit Drawing — draw or upload this component's symbol and mark its connection ports">
                    ✎
                  </button>
                  <button className="library-icon-button" onClick={() => void exportOne(c)} title="Export this component as a file you can share">
                    ⤓
                  </button>
                  <button className="library-icon-button library-icon-button--danger" onClick={() => void removeCategory(c.id, c.name)} title="Delete component">
                    🗑
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {editMode && (
        <div className="library-add-row library-add-row--wrap">
          <input placeholder="Name (e.g. Solenoid 2-Way Valve)" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Subtype (e.g. 2-way)" value={subtype} onChange={(e) => setSubtype(e.target.value)} />
          <input placeholder="Actuation (optional)" value={actuation} onChange={(e) => setActuation(e.target.value)} />
          <input
            type="number"
            min="1"
            placeholder="Ports"
            value={portCount}
            onChange={(e) => setPortCount(e.target.value)}
            className="library-port-count-input"
            title="Only used for the fallback placeholder symbol — hand-built symbols declare their own port count"
          />
          <button onClick={() => void addCategory()}>Add Component</button>
        </div>
      )}
      {error && <p className="field-error">{error}</p>}
      {symbolEditorFor && (
        <SymbolEditor
          category={symbolEditorFor}
          onClose={() => setSymbolEditorFor(null)}
          // Re-reads the list so the row reflects the category's new symbol_id (and any
          // later re-open of the editor loads the saved symbol rather than the fallback).
          onSaved={() => void refresh().catch((e: unknown) => setError(describeError(e)))}
        />
      )}
    </div>
  );
}

/** Inline rename box for one category row (edit mode only). Its own component so each
 * row owns its draft text, committing on blur/Enter and reverting on Escape — the same
 * commit idiom as the Properties Panel's fields. */
function CategoryNameInput({ category, onRename }: { category: db.Category; onRename: (name: string) => void }) {
  const [text, setText] = useState(category.name);

  // Re-sync when the list reloads (a rename elsewhere, or a folder sync) so the box
  // never sits on a stale draft.
  useEffect(() => setText(category.name), [category.name]);

  const commit = () => {
    const next = text.trim();
    // A blank name would leave the row unlabelled and unplaceable, so treat it as a
    // cancel rather than an error worth interrupting the user for.
    if (!next || next === category.name) setText(category.name);
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
          setText(category.name);
          e.currentTarget.blur();
        }
      }}
      title="Rename this category — Enter to save, Escape to cancel"
    />
  );
}
