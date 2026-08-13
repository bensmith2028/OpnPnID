import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSketchStore } from '../canvas/store/useSketchStore';
import { guardUnsaved, performGuardedAction } from './unsavedGuard';

// The real modules reach for native dialogs and the Tauri shell, neither of which exists
// here — and what's under test is only which of them gets called, and when.
const newProject = vi.fn();
const openProject = vi.fn(async () => {});
const quitApp = vi.fn();
vi.mock('../io/projectIO', () => ({
  newProject: () => newProject(),
  openProject: () => openProject(),
}));
vi.mock('../platform/appClose', () => ({ quitApp: () => quitApp() }));

beforeEach(() => {
  vi.clearAllMocks();
  useSketchStore.getState().newProject();
  useSketchStore.getState().setPendingGuardedAction(null);
});

/** Marks the document dirty the way an edit would, without needing real geometry. */
function makeDirty() {
  useSketchStore.getState().bumpVersion();
  expect(useSketchStore.getState().dirty).toBe(true);
}

describe('guarding the actions that discard the drawing', () => {
  it('runs straight through when there is nothing unsaved to lose', async () => {
    await guardUnsaved('new');
    expect(newProject).toHaveBeenCalledOnce();
    expect(useSketchStore.getState().pendingGuardedAction).toBeNull(); // never prompted
  });

  it.each(['quit', 'new', 'open'] as const)('holds %s back for the prompt when the drawing is dirty', async (action) => {
    makeDirty();
    await guardUnsaved(action);

    expect(useSketchStore.getState().pendingGuardedAction).toBe(action);
    // Nothing has happened yet — the whole point is that the drawing survives until the
    // prompt is answered.
    expect(newProject).not.toHaveBeenCalled();
    expect(openProject).not.toHaveBeenCalled();
    expect(quitApp).not.toHaveBeenCalled();
    expect(useSketchStore.getState().dirty).toBe(true);
  });

  it('carries out the held-back action once the prompt is answered, and takes the prompt down', async () => {
    makeDirty();
    await guardUnsaved('open');
    await performGuardedAction('open');

    expect(openProject).toHaveBeenCalledOnce();
    expect(useSketchStore.getState().pendingGuardedAction).toBeNull();
  });

  // The dialog is what puts itself back up on a rejection (it's the only thing on screen
  // that can show the message) — this just pins down that the failure reaches it at all
  // rather than being swallowed here.
  it('propagates a failure in the action itself to its caller', async () => {
    openProject.mockRejectedValueOnce(new Error('not an OpnPnID project'));
    makeDirty();
    await guardUnsaved('open');

    await expect(performGuardedAction('open')).rejects.toThrow('not an OpnPnID project');
  });
});
