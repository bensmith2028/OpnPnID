import { useEffect, useRef, useState } from 'react';
import { buildCsvTemplate, importCsv, type ImportResult } from './csv';
import * as db from './db';
import { describeError } from './errors';

/** One input per attribute definition, rendered inline in the "Add Real Part" form so a
 * new part's spec values can be filled in at creation time instead of only via CSV
 * import. Keyed by `attr.key`; `select`/`boolean` get dedicated controls, everything
 * else is a plain (possibly `number`-typed) text input. */
function SpecInput({ attr, value, onChange }: { attr: db.AttributeDefinition; value: string | boolean; onChange: (v: string | boolean) => void }) {
  if (attr.type === 'boolean') {
    return (
      <label className="library-spec-checkbox" title={attr.label}>
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        {attr.label}
      </label>
    );
  }
  if (attr.type === 'select') {
    return (
      <select value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} title={attr.label}>
        <option value="">{attr.label}…</option>
        {(attr.options ?? []).map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      type={attr.type === 'number' ? 'number' : 'text'}
      placeholder={attr.unit ? `${attr.label} (${attr.unit})` : attr.label}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Real-parts list + add form (including per-attribute spec-value inputs) + CSV catalog
 * import/template-export for one category — shown inside the RealHardwareModal for a
 * placed component. `editMode` gates the Delete button (see LibraryPanel's Edit toggle).
 * `onSelect` reports "use this part for the instance the modal was opened from" — it does
 * not place anything itself, that's the modal's job. */
export function RealPartSection({
  categoryId,
  editMode,
  onSelect,
}: {
  categoryId: string;
  editMode: boolean;
  onSelect: (realPartId: string) => void;
}) {
  const [parts, setParts] = useState<db.RealPart[]>([]);
  const [attributes, setAttributes] = useState<db.AttributeDefinition[]>([]);
  const [manufacturer, setManufacturer] = useState('');
  const [modelNumber, setModelNumber] = useState('');
  const [datasheetUrl, setDatasheetUrl] = useState('');
  const [specValues, setSpecValues] = useState<Record<string, string | boolean>>({});
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    setParts(await db.listRealParts(categoryId));
    setAttributes(await db.listAttributeDefinitions(categoryId));
  };

  useEffect(() => {
    void refresh().catch((e: unknown) => setError(describeError(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  const setSpecValue = (key: string, value: string | boolean) => setSpecValues((prev) => ({ ...prev, [key]: value }));

  const addPart = async () => {
    if (!manufacturer.trim() || !modelNumber.trim()) return;
    setError(null);
    try {
      const specs: Record<string, string | number | boolean> = {};
      for (const attr of attributes) {
        const raw = specValues[attr.key];
        if (raw === undefined || raw === '') continue;
        if (attr.type === 'number') {
          const n = parseFloat(String(raw));
          if (Number.isFinite(n)) specs[attr.key] = n;
        } else {
          specs[attr.key] = raw;
        }
      }
      await db.upsertRealPart({
        categoryId,
        manufacturer: manufacturer.trim(),
        modelNumber: modelNumber.trim(),
        datasheetUrl: datasheetUrl.trim() || null,
        specs,
      });
      setManufacturer('');
      setModelNumber('');
      setDatasheetUrl('');
      setSpecValues({});
      await refresh();
    } catch (e) {
      setError(describeError(e));
    }
  };

  const removePart = async (id: string) => {
    setError(null);
    try {
      await db.deleteRealPart(id);
      await refresh();
    } catch (e) {
      setError(describeError(e));
    }
  };

  const downloadTemplate = () => {
    const csv = buildCsvTemplate(attributes);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'component-catalog-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      const result = await importCsv(text, categoryId, attributes);
      if (result.skipped.length > 0) console.warn('CSV import skipped rows:', result.skipped);
      setImportResult(result);
      await refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="library-real-parts">
      {parts.length > 0 && (
        <ul className="library-list library-list--compact">
          {parts.map((p) => (
            <li key={p.id}>
              <span>
                {p.manufacturer} {p.modelNumber}
              </span>
              <div>
                <button onClick={() => onSelect(p.id)} title="Use this part">
                  Use
                </button>
                {editMode && (
                  <button className="library-icon-button library-icon-button--danger" onClick={() => void removePart(p.id)} title="Delete real part">
                    🗑
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="library-add-row library-add-row--wrap">
        <input placeholder="Manufacturer" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
        <input placeholder="Model number" value={modelNumber} onChange={(e) => setModelNumber(e.target.value)} />
        <input placeholder="Datasheet URL (optional)" value={datasheetUrl} onChange={(e) => setDatasheetUrl(e.target.value)} />
      </div>
      {attributes.length > 0 && (
        <div className="library-add-row library-add-row--wrap">
          {attributes.map((attr) => (
            <SpecInput key={attr.key} attr={attr} value={specValues[attr.key] ?? ''} onChange={(v) => setSpecValue(attr.key, v)} />
          ))}
        </div>
      )}
      <div className="library-add-row">
        <button onClick={() => void addPart()}>Add Real Part</button>
      </div>
      <div className="library-csv-row">
        <button onClick={downloadTemplate}>Export CSV Template</button>
        <button onClick={() => fileInputRef.current?.click()}>Import CSV</button>
        <input ref={fileInputRef} type="file" accept=".csv" onChange={(e) => void onFileSelected(e)} style={{ display: 'none' }} />
      </div>
      {importResult && (
        <p className="library-import-result">
          Imported {importResult.imported} part{importResult.imported === 1 ? '' : 's'}.
          {importResult.skipped.length > 0 ? ` Skipped ${importResult.skipped.length} row(s) — see console.` : ''}
        </p>
      )}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
