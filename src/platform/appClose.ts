/**
 * Frontend half of the "don't lose unsaved work on the way out" guard (see the
 * UnsavedChanges state in src-tauri/src/lib.rs).
 *
 * The decision to hold the app open has to be made in the shell, not here: by the time a
 * close or quit would reach JS it can no longer be stopped. So the frontend's job is only
 * to (a) keep the shell told whether the drawing is dirty, and (b) answer the prompt the
 * shell asks for when someone tries to leave with edits outstanding.
 *
 * In a plain browser tab — where none of that exists — the same intent is served by the
 * standard `beforeunload` guard, which gets the browser's own generic "leave site?" dialog
 * rather than the app's three-way prompt. That's the most a page is allowed to do.
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './runtime';

/** Registered only while there are unsaved changes: a `beforeunload` listener that's
 * present at all makes some browsers treat *every* navigation as needing confirmation. */
let browserGuard: ((e: BeforeUnloadEvent) => void) | null = null;

/** Tells the shell whether the drawing has edits that aren't on disk. Call on every change
 * to the store's `dirty` flag — the shell reads this, and nothing else, when deciding
 * whether a close/quit should be held for the prompt. */
export function reportUnsavedChanges(hasUnsaved: boolean): void {
  if (isTauriRuntime()) {
    // Fire-and-forget: a failure here can only mean the shell is already going away.
    void invoke('set_unsaved_changes', { hasUnsaved }).catch(() => {});
    return;
  }
  if (hasUnsaved && !browserGuard) {
    // `preventDefault` is the modern spelling; `returnValue` is what older engines
    // actually check. Neither lets the page choose the wording of the dialog.
    browserGuard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', browserGuard);
  } else if (!hasUnsaved && browserGuard) {
    window.removeEventListener('beforeunload', browserGuard);
    browserGuard = null;
  }
}

/** Subscribes to "someone tried to close/quit with unsaved changes". Safe to call
 * unconditionally (no-ops in a browser tab, which gets the native dialog instead) and
 * returns a synchronous cleanup function suitable for a `useEffect` return value. */
export function onAppCloseRequested(handler: () => void): () => void {
  if (!isTauriRuntime()) return () => {};
  let unlisten: UnlistenFn | undefined;
  let cancelled = false;
  listen('app-close-requested', () => handler()).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/** Goes through with the close/quit that was held back. No-op in a browser tab: a page
 * can't close a tab it didn't open, and there the guard is the browser's own dialog
 * anyway — this is only ever reached from the desktop prompt. */
export function quitApp(): void {
  if (!isTauriRuntime()) return;
  void invoke('quit_app').catch(() => {});
}
