/** Which shell the frontend is running inside. The app is normally the Tauri desktop
 * build, but the same bundle also runs in a plain browser tab (`npm run dev`), where none
 * of the native plugins — menus, dialogs, filesystem — exist. Anything that would call one
 * has to check first and fall back to a web equivalent. */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
