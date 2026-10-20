import type { Credentials, Envelope, Remote, SyncState } from './types';

/** Remote I/O only. Scheduling, encryption, backup and conflicts stay in SyncClient. */
export interface SyncProvider {
  readonly origin: string;
  get(c: Credentials, reuse?: Remote): Promise<Remote>;
  /** Optional metadata-first check: null means the persisted baseline is unchanged. */
  check?(c: SyncState): Promise<Remote | null>;
  /** Reuse checked metadata only within this network operation, never across syncs. */
  operation?<T>(work: () => Promise<T>): Promise<T>;
  create(c: Credentials, blob: Envelope): Promise<Remote>;
  put(c: Credentials, revision: number, blob: Envelope, version?: string): Promise<Remote>;
  disconnect?(): Promise<void>;
}
