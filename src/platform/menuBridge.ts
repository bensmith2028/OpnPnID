/**
 * Frontend half of the native Edit-menu bridge (see src-tauri/src/lib.rs's macOS-only
 * `.setup()` block). On macOS, a `keydown` for Cmd+C/V/X/Z/A never reaches the webview at
 * all unless *some* native window menu exists — and once a menu item claims one of those
 * accelerators, AppKit consumes the keystroke before it would ever become a `keydown`
 * here, so a JS keydown handler can no longer see it either way. Rust re-emits each click
 * as an `app-menu` event instead; this module is the one place the frontend listens for
 * that and decides what a given action actually means for whatever's currently focused.
 *
 * Windows/Linux never get a menu (see lib.rs), so `onNativeMenuAction` is a no-op there —
 * those platforms keep using the plain `keydown`-based handling already in SketchCanvas.tsx
 * and SymbolEditor.tsx.
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isTauriRuntime } from './runtime';

export type MenuAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll';

/** Subscribes to native Edit-menu clicks. Safe to call unconditionally (no-ops outside a
 * Tauri runtime, e.g. plain `npm run dev` in a browser) and returns a synchronous cleanup
 * function suitable for direct use as a `useEffect` return value. */
export function onNativeMenuAction(handler: (action: MenuAction) => void): () => void {
  if (!isTauriRuntime()) return () => {};
  let unlisten: UnlistenFn | undefined;
  let cancelled = false;
  listen<MenuAction>('app-menu', (event) => handler(event.payload)).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/** True when focus is on a real text-editing control. The native Edit-menu items route
 * here for standard editing behavior instead of the canvas/symbol-editor's own clipboard
 * and undo stacks — otherwise Cmd+C while renaming a tag would try to copy schematic
 * components instead of the text being typed. */
export function isTextEditableFocus(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

/** Best-effort standard editing behavior for the currently-focused text field, used when a
 * native Edit-menu click lands there. `execCommand` is deprecated but still the only way to
 * trigger the browser's built-in editing commands programmatically; `paste` in particular
 * may silently no-op if the webview withholds clipboard-read access, in which case a
 * right-click -> Paste still works as a fallback. */
export function applyTextFieldMenuAction(action: MenuAction): void {
  document.execCommand(action);
}
