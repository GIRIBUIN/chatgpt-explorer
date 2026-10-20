import { loadState } from '../storage';
import { webext } from '../utils/browser';
import { storedSync } from './storage';
import { SYNC_KEY } from './types';
import { canonical } from './crypto';
import { stateLock } from './locks';
import type { SyncStore } from './client';

async function readLocal(tolerateInvalidCredentials = false) {
    const loaded = await loadState();
    if (loaded.readOnly) throw Error('Workspace is read-only.');
    const sync = await storedSync().catch(error => {
      if (tolerateInvalidCredentials) return null;
      throw error;
    });
    return { state: loaded.state, sync };
}
export const extensionSyncStore: SyncStore = {
  read: readLocal,
  async transaction(fn) {
    const before = await readLocal(true);
    // Network/schema work happens outside the write lock: local edits remain immediate.
    const change = await fn(before);
    await stateLock(async () => {
      const current = await readLocal(true);
      if (canonical(current.sync) !== canonical(before.sync) ||
          (change.state && canonical(current.state) !== canonical(before.state)))
        throw Error('Preview is stale. Run Sync now again.');
      if (change.backup)
        await webext().storage.local.set({ workspaceBackup: { savedAt: Date.now(), state: current.state } });
      const writes: Record<string, unknown> = {};
      if (change.state) writes.explorerState = change.state;
      if (change.sync) writes[SYNC_KEY] = change.sync;
      if (Object.keys(writes).length) await webext().storage.local.set(writes);
      if (change.sync === null) await webext().storage.local.remove(SYNC_KEY);
    });
  },
};
