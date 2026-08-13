import { useEffect, useState } from 'react';
import { type GuardedAction, useSketchStore } from '../canvas/store/useSketchStore';
import { saveProject } from '../io/projectIO';
import { describeError } from '../library/errors';
import { performGuardedAction } from './unsavedGuard';

/** What each action is about to do to the drawing, in the second person — the prompt has
 * to name it, or "your changes will be lost" gives the user no way to tell a misclicked
 * New from the close they meant. */
const PROMPTS: Record<GuardedAction, { question: string; consequence: string }> = {
  quit: { question: 'Save changes before closing?', consequence: 'If you close now, those changes are lost.' },
  new: { question: 'Save changes before starting a new drawing?', consequence: 'A new drawing replaces this one, and those changes are lost.' },
  open: { question: 'Save changes before opening another project?', consequence: 'Opening a project replaces this one, and those changes are lost.' },
};

/** The prompt shown when closing/quitting, New, or Open would throw away unsaved edits —
 * see unsavedGuard.ts for what raises it and what each answer then does.
 *
 * Hand-built rather than a native dialog because the answer has three branches (save,
 * discard, stay), and the native dialog plugin only offers two buttons. Same reason it
 * isn't a `window.confirm`, which additionally blocks the whole webview thread. */
export function UnsavedChangesDialog({ action }: { action: GuardedAction }) {
  const filePath = useSketchStore((s) => s.filePath);
  const dismiss = () => useSketchStore.getState().setPendingGuardedAction(null);
  // Which answer is in flight, if any — both take a round trip through a native dialog, so
  // the buttons lock until one settles, and only the Save button reports itself as working.
  const [busy, setBusy] = useState<'saving' | 'proceeding' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Scoped Escape handling, like RealHardwareModal's: Escape means "stay where I am", and
  // must not also reach SketchCanvas's global handler and start changing tools underneath.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        dismiss();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  /** Shared tail of both "go ahead" answers: the action can fail on its own terms (an
   * unreadable file on Open), and this dialog is the only thing on screen that can say so. */
  const proceed = async () => {
    setError(null);
    setBusy('proceeding');
    try {
      await performGuardedAction(action);
    } catch (e) {
      setError(describeError(e));
      setBusy(null);
      // Put the prompt back up rather than leaving the failure invisible behind a closed
      // dialog — performGuardedAction clears the pending action before it runs.
      useSketchStore.getState().setPendingGuardedAction(action);
    }
  };

  const handleSave = async () => {
    setError(null);
    setBusy('saving');
    try {
      await saveProject();
    } catch (e) {
      setBusy(null);
      setError(describeError(e));
      return;
    }
    // A project that's never been saved goes through a native Save dialog, which the user
    // can back out of — that leaves the document still dirty, and going ahead anyway would
    // throw away exactly the work they just asked to keep. Backing out of the save is
    // treated as backing out of the whole thing.
    if (useSketchStore.getState().dirty) {
      setBusy(null);
      dismiss();
      return;
    }
    await proceed();
  };

  const fileName = filePath ? filePath.split(/[\\/]/).pop() : null;
  const { question, consequence } = PROMPTS[action];

  return (
    <div className="modal-backdrop unsaved-backdrop" onClick={dismiss}>
      <div className="modal-panel unsaved-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{question}</h3>
        <p>{fileName ? `“${fileName}” has changes that haven't been saved.` : 'This drawing has never been saved.'}</p>
        <p className="unsaved-warning">{consequence}</p>
        {error && <p className="unsaved-error">{error}</p>}
        <div className="unsaved-actions">
          <button onClick={dismiss} disabled={busy !== null}>
            Cancel
          </button>
          <div className="toolbar-spacer" />
          <button onClick={() => void proceed()} disabled={busy !== null}>
            Don't Save
          </button>
          <button className="active" onClick={() => void handleSave()} disabled={busy !== null} autoFocus>
            {busy === 'saving' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
