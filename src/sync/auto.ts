import type { Local, Outcome } from './client';
import { hash } from './crypto';
import { payload } from './payload';
import { SyncBusyError } from './locks';
export const AUTO_KEY = 'explorerAutoSync';
export const AUTO_ALARM = 'explorer-sync-idle';
export const IDLE_MS = 5 * 60 * 1000;
export type AutoState = {
  enabled: boolean;
  dirty: boolean;
  connectionId: string | null;
  observedHash: string;
  lastChangedAt: number;
  scheduledAt: number | null;
  lastAttemptAt: number | null;
  error: string | null;
  conflict: boolean;
};
export const autoDefaults = (): AutoState => ({ enabled: true, dirty: false, connectionId: null,
  observedHash: '', lastChangedAt: 0, scheduledAt: null, lastAttemptAt: null, error: null, conflict: false });
export type AutoPorts = {
  local: () => Promise<Local>;
  read: () => Promise<AutoState | undefined>;
  write: (state: AutoState) => Promise<void>;
  schedule: (when: number | null) => Promise<void>;
  now: () => number;
  sync: (onlyIfDirty?: boolean) => Promise<Outcome>;
  result: (outcome: Outcome) => Promise<void>;
};
export class AutoSync {
  private queue: Promise<unknown> = Promise.resolve();
  private attemptPending = false;
  constructor(private ports: AutoPorts) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const task = this.queue.then(work);
    this.queue = task.catch(() => {});
    return task;
  }
  private async observe(at: number) {
    const p = this.ports, local = await p.local(), a = { ...autoDefaults(), ...await p.read() };
    if (!local.sync) {
      Object.assign(a, { dirty: false, connectionId: null, observedHash: '', scheduledAt: null, error: null, conflict: false });
    } else {
      const h = await hash(payload(local.state));
      if (h === local.sync.lastSyncedPayloadHash) {
        // A manual success updates the baseline; failures are retained until an explicit attempt.
        if (a.observedHash !== h || a.dirty && !a.error && !a.conflict || a.connectionId !== local.sync.syncId)
          Object.assign(a, { dirty: false, scheduledAt: null, error: null, conflict: false });
      } else if (a.observedHash !== h || a.connectionId !== local.sync.syncId) {
        Object.assign(a, { dirty: true, lastChangedAt: at, scheduledAt: at + IDLE_MS, error: null });
      }
      a.observedHash = h;
      a.connectionId = local.sync.syncId;
    }
    await p.write(a);
    await p.schedule(a.enabled && a.dirty ? a.scheduledAt : null);
    return a;
  }
  changed(at = this.ports.now()) { return this.serial(() => this.observe(at)); }
  recover() { return this.changed(); }
  setEnabled(enabled: boolean) {
    return this.serial(async () => {
      const a = await this.observe(this.ports.now());
      a.enabled = enabled;
      if (enabled && a.dirty) a.scheduledAt = Math.max(this.ports.now(), a.lastChangedAt + IDLE_MS);
      await this.ports.write(a);
      await this.ports.schedule(enabled && a.dirty ? a.scheduledAt : null);
    });
  }
  private requestAttempt(reason: 'startup' | 'alarm' | 'close') {
    if (this.attemptPending) return Promise.resolve();
    this.attemptPending = true;
    return this.serial(() => this.attempt(reason)).finally(() => { this.attemptPending = false; });
  }
  startup() { return this.requestAttempt('startup'); }
  alarm() { return this.requestAttempt('alarm'); }
  close() { return this.requestAttempt('close'); }
  private async attempt(reason: 'startup' | 'alarm' | 'close') {
    const p = this.ports, a = await this.observe(p.now());
    if (!a.enabled || !a.connectionId) return;
    if (reason === 'close' && !a.dirty) return;
    if (reason === 'alarm') {
      if (!a.dirty || a.scheduledAt === null) return;
      if (p.now() < a.lastChangedAt + IDLE_MS) {
        await p.schedule(a.lastChangedAt + IDLE_MS);
        return;
      }
    }
    const previousDeadline = a.scheduledAt;
    // Keep the existing idle safety net durable if close-time execution is interrupted.
    if (reason !== 'close') a.scheduledAt = null;
    a.lastAttemptAt = p.now();
    await p.write(a);
    if (reason !== 'close') await p.schedule(null);
    try {
      const outcome = await p.sync(reason === 'close');
      const local = await p.local(), h = await hash(payload(local.state));
      a.conflict = 'remote' in outcome;
      a.error = null;
      a.dirty = a.conflict || h !== local.sync?.lastSyncedPayloadHash;
      a.scheduledAt = null;
      if (h !== a.observedHash && a.dirty) {
        a.lastChangedAt = p.now();
        a.scheduledAt = a.lastChangedAt + IDLE_MS;
      }
      a.observedHash = h;
      await p.write(a);
      await p.schedule(a.enabled && a.dirty ? a.scheduledAt : null);
      await p.result(outcome);
    } catch (error) {
      a.dirty = true;
      if (!(reason === 'close' && error instanceof SyncBusyError)) {
        // Persist only a safe recovery category, never a provider response/token.
        const recovery = error instanceof Error && 'syncRecovery' in error ? error.syncRecovery : null;
        a.error = recovery === 'reconnect' ? 'reconnect-required' : recovery === 'temporary' ? 'temporarily-unavailable'
          : 'Automatic sync failed. Use Sync now to retry.';
      }
      if (reason === 'close') a.scheduledAt = previousDeadline;
      await p.write(a);
      if (reason === 'close') await p.schedule(previousDeadline);
      // Close preserves only its existing idle safety net, never creates a retry loop.
    }
  }
  manualSuccess() {
    return this.serial(async () => {
      const a = { ...autoDefaults(), ...await this.ports.read() };
      a.error = null;
      a.conflict = false;
      await this.ports.write(a);
      await this.observe(this.ports.now());
    });
  }
}
