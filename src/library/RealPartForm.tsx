import { useEffect, useRef, useState } from 'react';
import { buildCsvTemplate, importCsv, type ImportResult } from './csv';
import * as db from './db';
import { describeError } from './errors';

/** Real-parts list + add form + CSV catalog import/template-export for one category —
 * shown expanded inline under it in the Category list. `editMode` gates the Delete
 * button (see LibraryPanel's Edit toggle). */
export function RealPartSection({
  categoryId,
  editMode,
  onArm,
}: {
  categoryId: string;
  editMode: boolean;
  onArm: (realPartId: string) => void;
}) {
  const [parts, setParts] = useState<db.RealPart[]>([]);
  const [attributes, setAttributes] = useState<db.AttributeDefinition[]>([]);
  const [manufacturer, setManufacturer] = useState('');
  const [modelNumber, setModelNumber] = useState('');
  const [datasheetUrl, setDatasheetUrl] = useState('');
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

  const addPart = async () => {
    if (!manufacturer.trim() || !modelNumber.trim()) return;
    setError(null);
    try {
      await db.upsertRealPart({
        categoryId,
        manufacturer: manufacturer.trim(),
        modelNumber: modelNumber.trim(),
        datasheetUrl: datasheetUrl.trim() || null,
      });
      setManufacturer('');
      setModelNumber('');
      setDatasheetUrl('');
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
                <button onClick={() => onArm(p.id)}>Place</button>
                {editMode && <button onClick={() => void removePart(p.id)}>Delete</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="library-add-row library-add-row--wrap">
        <input placeholder="Manufacturer" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
        <input placeholder="Model number" value={modelNumber} onChange={(e) => setModelNumber(e.target.value)} />
        <input placeholder="Datasheet URL (optional)" value={datasheetUrl} onChange={(e) => setDatasheetUrl(e.target.value)} />
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
