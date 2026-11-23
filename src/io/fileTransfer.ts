/**
 * How files get in and out of the app: a download to save, a file picker to open. Shared by
 * every kind of file (drawings, symbols, libraries, PDF, CSV) so they all move the same way.
 */

/** Hand a blob to the download manager. */
export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadText(fileName: string, text: string, mimeType = 'application/json'): void {
  downloadBlob(fileName, new Blob([text], { type: mimeType }));
}

/** Choose a file to read — a transient file input, since there's no native dialog to ask.
 * Resolves null on dismissal, though not every engine fires `cancel`, so a dismissed picker
 * may simply never resolve; nothing is waiting on it either way. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

/** Shape of the (Chromium-only) File System Access save picker — typed here because the
 * DOM lib doesn't ship it everywhere. */
interface SaveFilePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{ name: string; createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>;
}

/** Save As: lets the user choose where the file goes and what it's called.
 *
 * Where the browser offers a save picker (Chrome, Edge) that's a real "choose a folder and a
 * name" dialog. Elsewhere (Firefox, Safari) there is no way for a page to ask for a location,
 * so it asks for a file name and downloads it — the browser then saves to its downloads
 * folder, or asks where if it's set to.
 *
 * Resolves to the name the file was saved under, or null if the user backed out (so callers
 * leave their "unsaved" state alone). Throws only for a real failure to write. */
export async function saveTextAs(suggestedName: string, text: string, mimeType = 'application/json'): Promise<string | null> {
  const picker = (window as unknown as SaveFilePickerWindow).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker.call(window, {
        suggestedName,
        // Browsers only accept simple extensions here, so ".pnid.json" is offered as ".json";
        // the suggested name still carries the full one.
        types: [{ description: 'OpnPnID file', accept: { [mimeType]: ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([text], { type: mimeType }));
      await writable.close();
      return handle.name;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null; // closed the dialog
      throw e;
    }
  }

  const typed = window.prompt('Save as (file name):', suggestedName);
  if (typed === null) return null;
  const name = typed.trim() || suggestedName;
  // Keep the double extension the app looks for, if the user dropped it.
  const suffix = suggestedName.slice(suggestedName.indexOf('.'));
  const finalName = name.toLowerCase().endsWith(suffix.toLowerCase()) ? name : `${name.replace(/\.json$/i, '')}${suffix}`;
  downloadText(finalName, text, mimeType);
  return finalName;
}
