import { useEffect, useMemo, useState } from 'react';
import * as db from '../library/db';
import { describeError } from '../library/errors';
import { HardwareRow } from '../library/HardwareDialog';
import { ConfirmDialog } from './ConfirmDialog';

/** The whole hardware catalog in one place: every entry for every component, grouped by
 * component, each editable in place (saved as you leave a field) and deletable. Opened from
 * "Catalog" in the top bar. Entries are also reachable per component from its edit window. */
export function CatalogDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<db.HardwareItem[]>([]);
  const [categories, setCategories] = useState<db.Category[]>([]);
  const [families, setFamilies] = useState<db.Family[]>([]);
  const [query, setQuery] = useState('');
  const [addTo, setAddTo] = useState('');
  const [deleting, setDeleting] = useState<db.HardwareItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () =>
    Promise.all([db.listAllHardware(), db.listCategories(), db.listFamilies()])
      .then(([h, c, f]) => {
        setItems(h);
        setCategories(c);
        setFamilies(f);
      })
      .catch((e: unknown) => setError(describeError(e)));

  useEffect(() => {
    void reload();
    return db.onLibraryChange(() => void reload());
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !deleting) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose, deleting]);

  const familyName = (id: string) => families.find((f) => f.id === id)?.name ?? '';
  const q = query.trim().toLowerCase();

  /** Entries grouped under "Family — Component", in family then component order, filtered by the
   * search (name or notes). */
  const groups = useMemo(() => {
    const out: { category: db.Category; items: db.HardwareItem[] }[] = [];
    for (const category of categories) {
      const mine = items.filter((h) => h.categoryId === category.id && (!q || h.name.toLowerCase().includes(q) || h.notes.toLowerCase().includes(q)));
      if (mine.length > 0) out.push({ category, items: mine.sort((a, b) => a.name.localeCompare(b.name)) });
    }
    const order = (c: db.Category) => families.findIndex((f) => f.id === c.familyId);
    return out.sort((a, b) => order(a.category) - order(b.category) || a.category.name.localeCompare(b.category.name));
  }, [categories, families, items, q]);

  const save = async (item: db.HardwareItem, changes: Partial<db.HardwareItem>) => {
    const next = { ...item, ...changes };
    if (next.name === item.name && next.notes === item.notes) return;
    setError(null);
    try {
      await db.upsertHardware(next);
    } catch (e) {
      setError(describeError(e));
    }
  };

  const add = async () => {
    if (!addTo) return;
    setError(null);
    try {
      await db.upsertHardware({ categoryId: addTo, name: 'New hardware', notes: '' });
      setQuery('');
    } catch (e) {
      setError(describeError(e));
    }
  };

  const remove = async (item: db.HardwareItem) => {
    setDeleting(null);
    setError(null);
    try {
      await db.deleteHardware(item.id);
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel hardware-dialog catalog-dialog" role="dialog" aria-label="Hardware catalog" onClick={(e) => e.stopPropagation()}>
        <h3>Hardware catalog</h3>
        <input
          className="catalog-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search names and notes"
          aria-label="Search the hardware catalog"
          autoFocus
        />
        <div className="hardware-list">
          {groups.length === 0 && <p className="library-muted">{q ? 'Nothing matches.' : 'The catalog is empty. Save hardware from a component\'s Properties, or add some above.'}</p>}
          {groups.map(({ category, items: rows }) => (
            <section key={category.id} className="catalog-group">
              <h4>
                {familyName(category.familyId)} — {category.name}
              </h4>
              {rows.map((item) => (
                <HardwareRow key={item.id} item={item} componentName={category.name} onSave={(c) => void save(item, c)} onDelete={() => setDeleting(item)} />
              ))}
            </section>
          ))}
        </div>
        <div className="catalog-add">
          <span>Add new hardware to</span>
          <select value={addTo} onChange={(e) => setAddTo(e.target.value)} aria-label="Component to add hardware to">
            <option value="">Choose a component…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {familyName(c.familyId)} — {c.name}
              </option>
            ))}
          </select>
          <button onClick={() => void add()} disabled={!addTo}>
            + Add
          </button>
        </div>
        {error && <p className="field-error">{error}</p>}
        <div className="unsaved-actions">
          <div className="toolbar-spacer" />
          <button className="active" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.name}"?`}
          message="It's removed from the hardware catalog. Components already using it keep their own copy of the name and notes."
          confirmLabel="Delete"
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
