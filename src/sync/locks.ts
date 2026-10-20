// Shared by extension pages and the background worker (same extension origin).
export class SyncBusyError extends Error {
  constructor() { super('Sync is already running.'); }
}
export async function stateLock<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks)
    return await navigator.locks.request('explorer-state-write', work);
  return work(); // Unit-test hosts; automatic sync requires Web Locks at runtime.
}
export async function networkLock<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks)
    return await navigator.locks.request('explorer-sync-network', { ifAvailable: true }, lock => {
      if (!lock) throw new SyncBusyError();
      return work();
    });
  return work();
}
