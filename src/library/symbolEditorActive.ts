/**
 * Tracks whether the SymbolEditor modal is currently mounted, so the main canvas's native
 * Edit-menu bridge (see src/platform/menuBridge.ts) knows to defer to the symbol editor's
 * own handling while it's open on top, instead of both acting on the same menu click.
 *
 * The two already get this mutual exclusion for free on plain `keydown` (SymbolEditor's
 * listener runs in the capture phase and calls `stopPropagation`), but a native menu event
 * is a separate pub/sub channel, not a DOM event, so it doesn't come with that for free —
 * hence this tiny explicit flag.
 */
let openCount = 0;

export function markSymbolEditorOpen(): void {
  openCount += 1;
}

export function markSymbolEditorClosed(): void {
  openCount = Math.max(0, openCount - 1);
}

export function isSymbolEditorOpen(): boolean {
  return openCount > 0;
}
