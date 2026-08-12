import { useEffect, useState } from 'react';
import { useSketchStore } from '../canvas/store/useSketchStore';
import * as db from './db';
import { describeError } from './errors';
import { RealPartSection } from './RealPartForm';

/** Category list + add form for one family. Each category is the fine-grained,
 * symbol-owning classification ("Automated 2-Way Valve") — expandable to show/manage
 * both its attribute schema (the "make these attributes configurable too" surface) and
 * its real parts (RealPartSection). `editMode` gates the Delete button (see
 * LibraryPanel's Edit toggle) — Place stays always available. */
export function CategorySection({ familyId, editMode }: { familyId: string; editMode: boolean }) {
  const [categories, setCategories] = useState<db.Category[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [subtype, setSubtype] = useState('');
  const [actuation, setActuation] = useState('');
  const [portCount, setPortCount] = useState('2');
  const [error, setError] = useState<string | null>(null);

  const armComponent = useSketchStore((s) => s.armComponent);

  const refresh = async () => setCategories(await db.listCategories(familyId));

  useEffect(() => {
    void refresh().catch((e: unknown) => setError(describeError(e)));
    setExpandedId(null);
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
              <button className="library-list-name" onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}>
                {c.name} <span className="library-muted">({c.portCount} port{c.portCount === 1 ? '' : 's'})</span>
              </button>
              <button onClick={() => armComponent(c.id, null)} title="Place this category's symbol (no specific part assigned)">
                Place
              </button>
              {editMode && <button onClick={() => void removeCategory(c.id, c.name)}>Delete</button>}
            </div>
            {expandedId === c.id && (
              <>
                <AttributeDefinitionsEditor categoryId={c.id} editMode={editMode} />
                <RealPartSection categoryId={c.id} editMode={editMode} onArm={(realPartId) => armComponent(c.id, realPartId)} />
              </>
            )}
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
    </div>
  );
}

function AttributeDefinitionsEditor({ categoryId, editMode }: { categoryId: string; editMode: boolean }) {
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
              {editMode && <button onClick={() => void removeAttr(a.id)}>Remove</button>}
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
