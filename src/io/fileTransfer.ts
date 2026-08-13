/**
 * The browser half of file import/export — the two things a plain browser tab has in place
 * of the native save/open dialogs. Shared by projectIO (whole drawings) and symbolIO
 * (single part drawings) so both kinds of file move the same way; the Tauri paths stay in
 * those modules, since only they know their own dialog filters and default names.
 */

/** Hand text to the download manager (the same Blob + anchor idiom the library's CSV
 * template export uses). */
export function downloadText(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
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
