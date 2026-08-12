/** Extracts a displayable message from whatever the SQL plugin/JS runtime throws (often
 * a plain string from the Tauri IPC bridge, not always an Error instance). Library UI
 * actions should always surface failures through this rather than letting a rejected
 * promise fail silently — that's exactly how the "can't add a category" bug hid: a
 * permission error was thrown and nothing displayed it. */
export function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return 'Unknown error';
  }
}
