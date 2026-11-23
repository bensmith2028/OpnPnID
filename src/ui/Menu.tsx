import { type ReactNode, useEffect, useRef, useState } from 'react';

/** A button that opens a small dropdown. Closes on outside click, Escape, or when an item is
 * chosen. `children` is a render function so items can close the menu themselves. */
export function Menu({
  label,
  title,
  align = 'left',
  keepOpen = false,
  children,
}: {
  label: ReactNode;
  title?: string;
  align?: 'left' | 'right';
  /** For panels with inputs in them (the View menu): choosing/typing shouldn't close it. */
  keepOpen?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  return (
    <div className="menu" ref={rootRef}>
      <button className={open ? 'active' : ''} onClick={() => setOpen((o) => !o)} title={title} aria-haspopup="menu" aria-expanded={open}>
        {label} <span className="menu-caret">▾</span>
      </button>
      {open && (
        <div className={`menu-popup menu-popup--${align}`} role="menu" onClick={keepOpen ? undefined : close}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  onClick,
  children,
  hint,
  disabled,
}: {
  onClick: () => void;
  children: ReactNode;
  /** Right-aligned shortcut reminder. */
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button className="menu-item" role="menuitem" onClick={onClick} disabled={disabled}>
      <span>{children}</span>
      {hint && <span className="menu-hint">{hint}</span>}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="menu-separator" role="separator" />;
}
