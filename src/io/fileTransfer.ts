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
