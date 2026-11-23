/** A tiny "tell the user what just happened" channel: anything can `notify(...)`, and the
 * <Toaster /> in App shows it for a few seconds. Used for results that have no natural place
 * on screen — an import finishing, a file failing to open. */
export interface Notice {
  id: number;
  message: string;
  kind: 'info' | 'error';
}

let nextId = 1;
const listeners = new Set<(notice: Notice) => void>();

export function notify(message: string, kind: Notice['kind'] = 'info'): void {
  const notice = { id: nextId++, message, kind };
  for (const listener of listeners) listener(notice);
}

export function subscribeNotices(listener: (notice: Notice) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
