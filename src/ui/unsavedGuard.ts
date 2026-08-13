/**
 * The one place that decides whether an action which discards the current drawing gets to
 * happen immediately or has to ask first (see UnsavedChangesDialog for the asking).
 *
 * Closing/quitting, New, and Open all destroy unsaved work in exactly the same way, so
 * they go through the same gate rather than each growing its own confirmation. Quitting is
 * the odd one only in where it starts: the shell holds the close back and tells the
 * frontend (see platform/appClose.ts), because by the time JS hears about a close it can
 * no longer be stopped — New and Open are ordinary button clicks and simply call in here.
 */
import { type GuardedAction, useSketchStore } from '../canvas/store/useSketchStore';
import { newProject, openProject } from '../io/projectIO';
import { quitApp } from '../platform/appClose';

/** Carries out an action whose consequences for unsaved work have already been settled —
 * either because there was nothing to lose, or because the prompt was answered. */
export async function performGuardedAction(action: GuardedAction): Promise<void> {
  useSketchStore.getState().setPendingGuardedAction(null);
  switch (action) {
    case 'quit':
      quitApp();
      return;
    case 'new':
      newProject();
      return;
    case 'open':
      await openProject();
      return;
  }
}

/** Runs `action` straight away when the drawing has nothing unsaved in it, and otherwise
 * raises the prompt and returns — the action then happens (or doesn't) once it's answered.
 * Rejects only for a failure in the action itself, e.g. an unreadable project file. */
export async function guardUnsaved(action: GuardedAction): Promise<void> {
  if (!useSketchStore.getState().dirty) return performGuardedAction(action);
  useSketchStore.getState().setPendingGuardedAction(action);
}
