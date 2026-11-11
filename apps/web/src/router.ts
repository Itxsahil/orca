import { useSyncExternalStore } from 'react';

/* A tiny client-side router: enough for a handful of pages, no dependency. */

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
window.addEventListener('popstate', notify);

export function navigate(path: string, { replace = false } = {}) {
  if (path === window.location.pathname) return;
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  notify();
}

export function usePathname(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => window.location.pathname,
  );
}
