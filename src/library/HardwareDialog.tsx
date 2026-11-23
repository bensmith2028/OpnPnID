import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import * as db from './db';
import { describeError } from './errors';

/** The hardware catalog entries for one component type — specific parts ("Burkert 2076") with free-text
 * notes for requirements and attributes. Each edit saves as you leave the field; placed
 * components pick from this list in their Properties. Opened from the component's edit window. */
export function HardwareDialog({ category, onClose }: { category: db.Category; onClose: () => void }) {
  const [items, setItems] = useState<db.HardwareItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<db.HardwareItem | null>(null);

  const reload = () => db.listHardware(category.id).then(setItems).catch((e: unknown) => setError(describeError(e)));
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category.id]);

  // Escape closes this dialog (not the edit window behind it).
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

  const save = async (item: db.HardwareItem, changes: Partial<db.HardwareItem>) => {
    const next = { ...item, ...changes };
    if (next.name === item.name && next.notes === item.notes) return;
    setError(null);
    try {
      await db.upsertHardware(next);
      await reload();
    } catch (e) {
      setError(describeError(e));
    }
  };

  const add = async () => {
    setError(null);
    try {
      await db.upsertHardware({ categoryId: category.id, name: 'New hardware', notes: '' });
      await reload();
    } catch (e) {
      setError(describeError(e));
    }
  };

  const remove = async (item: db.HardwareItem) => {
    setDeleting(null);
    setError(null);
    try {
      await db.deleteHardware(item.id);
      await reload();
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    // stopPropagation: this sits inside the edit window, whose backdrop closes it on click.
    <div
      className="modal-backdrop unsaved-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="modal-panel hardware-dialog" role="dialog" aria-label="Hardware" onClick={(e) => e.stopPropagation()}>
        <h3>Hardware catalog — {category.name}</h3>
        <p className="library-muted">Specific parts you use for this component. Placed components pick from here; notes are free text. (Everything is also under Catalog in the top bar.)</p>
        <div className="hardware-list">
          {items.length === 0 && <p className="library-muted">No hardware yet.</p>}
          {items.map((item) => (
            <HardwareRow key={item.id} item={item} componentName={category.name} onSave={(c) => void save(item, c)} onDelete={() => setDeleting(item)} />
          ))}
        </div>
        {error && <p className="field-error">{error}</p>}
        <div className="unsaved-actions">
          <button onClick={() => void add()}>+ Add hardware</button>
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

/** One hardware entry, with its own draft text so typing isn't fought by the reload after a save. */
export function HardwareRow({
  item,
  componentName,
  onSave,
  onDelete,
}: {
  item: db.HardwareItem;
  componentName: string;
  onSave: (changes: Partial<db.HardwareItem>) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [notes, setNotes] = useState(item.notes);
  // Each field follows only its own saved value, so saving the name can't wipe notes being typed.
  useEffect(() => setName(item.name), [item.name]);
  useEffect(() => setNotes(item.notes), [item.notes]);

  const commit = () => onSave({ name: name.trim() || item.name, notes });

  return (
    <div className="hardware-row">
      <div className="hardware-row-head">
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={commit} placeholder={componentName} aria-label="Hardware name" />
        <button className="hardware-row-delete" onClick={onDelete} title="Delete this hardware" aria-label={`Delete ${item.name}`}>
          🗑
        </button>
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={commit}
        rows={3}
        placeholder="Notes — requirements, attributes"
        aria-label="Hardware notes"
      />
    </div>
  );
}
