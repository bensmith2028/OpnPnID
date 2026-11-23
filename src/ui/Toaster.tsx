import { useEffect, useState } from 'react';
import { type Notice, subscribeNotices } from './notice';

const SHOW_MS = 6000;

/** Shows messages sent through `notify`, stacked at the bottom-right, each dismissing itself
 * after a few seconds (or on click). */
export function Toaster() {
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(
    () =>
      subscribeNotices((notice) => {
        setNotices((prev) => [...prev, notice]);
        window.setTimeout(() => setNotices((prev) => prev.filter((n) => n.id !== notice.id)), SHOW_MS);
      }),
    [],
  );

  if (notices.length === 0) return null;
  return (
    <div className="toaster" role="status" aria-live="polite">
      {notices.map((n) => (
        <div key={n.id} className={`toast toast--${n.kind}`} onClick={() => setNotices((prev) => prev.filter((x) => x.id !== n.id))}>
          {n.message}
        </div>
      ))}
    </div>
  );
}
