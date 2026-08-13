import { useEffect, useState } from 'react';
import { useSketchStore } from '../canvas/store/useSketchStore';
import * as db from './db';
import { describeError } from './errors';
import { SymbolEditor } from './SymbolEditor';

/** Category list + add form for one family. Each category is the fine-grained,
 * symbol-owning classification ("Automated 2-Way Valve"), with its attribute schema (the
 * "make these attributes configurable too" surface) hanging off the row. Real hardware
 * (real parts) is no longer managed here — it lives in the RealHardwareModal opened from
 * a placed component on the canvas. `editMode` (see LibraryPanel's Edit toggle) splits
 * the row cleanly in two: browsing is purely for placing — clicking the name arms the
 * component — while edit mode swaps in the library-authoring actions (rename, attribute
 * schema, Edit Drawing, Delete). */
export function CategorySection({ familyId, editMode }: { familyId: string; editMode: boolean }) {
  const [categories, setCategories] = useState<db.Category[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
    setExpandedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId]);

  // The attribute schema is an edit-mode-only surface, but `expandedId` is component
  // state that the Edit toggle doesn't unmount — so a row expanded while editing would
  // come back expanded the next time Edit is switched on, which isn't what "open the
  // schema for this row" meant several toggles ago. Collapsing on every transition keeps
  // entering edit mode a clean slate. (The row's render also gates on `editMode`; that's
  // what stops the panel showing in browsing mode for the frame before this effect runs.)
  useEffect(() => setExpandedId(null), [editMode]);

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

  const removeCategory = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}" and all its real parts? This can't be undone.`)) return;
    setError(null);
    try {
      await db.deleteCategory(id);
      if (expandedId === id) setExpandedId(null);
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
                  onClick={() => armComponent(c.id, null)}
                  title="Place this category's symbol on the canvas (no specific part assigned)"
                >
                  {c.name}
                </button>
              )}
              {/* Everything else on the row is edit-mode-only (Attributes, Edit Drawing,
                  Delete). Keeping the two sets mutually exclusive is what the Edit toggle
                  is for: browsing stays a one-click place-this list, and the schema editor
                  can't be opened — or accidentally added to — mid-placement. */}
              {editMode && (
                <>
                  <button
                    className="library-icon-button"
                    onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                    title="Show/hide this category's configurable attributes"
                  >
                    {expandedId === c.id ? '▾' : '▸'}
                  </button>
                  <button
                    className="library-icon-button"
                    onClick={() => setSymbolEditorFor(c)}
                    title="Edit Drawing — draw or upload this category's symbol and mark its connection ports"
                  >
                    ✎
                  </button>
                  <button className="library-icon-button library-icon-button--danger" onClick={() => void removeCategory(c.id, c.name)} title="Delete category">
                    🗑
                  </button>
                </>
              )}
            </div>
            {editMode && expandedId === c.id && <AttributeDefinitionsEditor categoryId={c.id} />}
          </li>
        ))}
      </ul>
      <div className="library-add-row library-add-row--wrap">
        <input placeholder="Name (e.g. Automated 2-Way Valve)" value={name} onChange={(e) => setName(e.target.value)} />
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
        <button onClick={() => void addCategory()}>Add Category</button>
      </div>
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

/** One category's attribute schema — the definitions every real part in it fills in.
 * Rendered only from an expanded row in edit mode, so unlike the other library sections
 * it takes no `editMode` prop: reaching it at all already means editing, and gating the
 * per-attribute Delete on a flag that can only be true here would just be noise. */
function AttributeDefinitionsEditor({ categoryId }: { categoryId: string }) {
  const [attrs, setAttrs] = useState<db.AttributeDefinition[]>([]);
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [type, setType] = useState<db.AttributeType>('text');
  const [unit, setUnit] = useState('');
  const [options, setOptions] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => setAttrs(await db.listAttributeDefinitions(categoryId));

  useEffect(() => {
    void refresh().catch((e: unknown) => setError(describeError(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  const addAttr = async () => {
    if (!key.trim() || !label.trim()) return;
    setError(null);
    try {
      await db.upsertAttributeDefinition({
        categoryId,
        key: key.trim(),
        label: label.trim(),
        type,
        unit: unit.trim() || null,
        options: type === 'select' ? options.split(',').map((s) => s.trim()).filter(Boolean) : null,
        sortOrder: attrs.length,
      });
      setKey('');
      setLabel('');
      setUnit('');
      setOptions('');
      await refresh();
    } catch (e) {
      setError(describeError(e));
    }
  };

  const removeAttr = async (id: string) => {
    setError(null);
    try {
      await db.deleteAttributeDefinition(id);
      await refresh();
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <div className="library-attributes">
      {attrs.length > 0 && (
        <ul className="library-list library-list--compact">
          {attrs.map((a) => (
            <li key={a.id}>
              <span>
                {a.label} <span className="library-muted">({a.key}, {a.type}{a.unit ? `, ${a.unit}` : ''})</span>
              </span>
              <button className="library-icon-button library-icon-button--danger" onClick={() => void removeAttr(a.id)} title="Remove attribute">
                🗑
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="library-add-row library-add-row--wrap">
        <input placeholder="key (e.g. cv)" value={key} onChange={(e) => setKey(e.target.value)} />
        <input placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value as db.AttributeType)}>
          <option value="text">Text</option>
          <option value="number">Number</option>
          <option value="select">Select</option>
          <option value="boolean">Boolean</option>
          <option value="url">URL</option>
        </select>
        <input placeholder="Unit (optional)" value={unit} onChange={(e) => setUnit(e.target.value)} />
        {type === 'select' && <input placeholder="Options, comma-separated" value={options} onChange={(e) => setOptions(e.target.value)} />}
        <button onClick={() => void addAttr()}>Add Attribute</button>
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
