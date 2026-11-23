import { useEffect } from 'react';

/** An "are you sure?" popup for destructive actions. Cancel is the focused default, so a stray
 * Enter backs out rather than deletes; Escape and clicking outside also cancel. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onCancel]);

  return (
    // stopPropagation: this can sit inside another dialog whose backdrop closes it on click.
    <div
      className="modal-backdrop unsaved-backdrop"
      onClick={(e) => {
        e.stopPropagation();
        onCancel();
      }}
    >
      <div className="modal-panel confirm-dialog" role="alertdialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="unsaved-actions">
          <div className="toolbar-spacer" />
          <button onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button className="confirm-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
