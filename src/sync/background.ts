import { AutoSync, AUTO_KEY, AUTO_ALARM, type AutoState } from './auto';
import { webext } from '../utils/browser';
import { extensionSyncStore } from './store';
import { SyncClient } from './client';
import { providerFor } from './providers';
import { SYNC_KEY } from './types';
import { discoverExplorerWindow } from './window';

export function installAutoSync() {
  const api = webext();
  if (!api.alarms) return; // Older hosts retain manual sync.
  const auto = new AutoSync({
    local: extensionSyncStore.read,
    read: async () => (await api.storage.local.get(AUTO_KEY))[AUTO_KEY] as AutoState | undefined,
    write: async state => { await api.storage.local.set({ [AUTO_KEY]: state }); },
    now: Date.now,
    schedule: async when => {
      if (when === null) await api.alarms.clear(AUTO_ALARM);
      else await api.alarms.create(AUTO_ALARM, { when: Math.max(Date.now() + 1000, when) });
    },
    sync: async onlyIfDirty => {
      if (!navigator.locks) throw Error('Automatic sync unavailable.');
      const local = await extensionSyncStore.read();
      if (!local.sync) throw Error('Not connected.');
      const client = new SyncClient(providerFor(local.sync), extensionSyncStore);
      // Automatic attempts must never open a consent prompt without a user gesture.
      const manifest = api.runtime.getManifest() as unknown as { browser_specific_settings?: { gecko?: unknown } };
      if (manifest.browser_specific_settings?.gecko) {
        const permissions = await api.permissions.getAll() as unknown as { data_collection?: string[] };
        if (!['websiteContent', 'authenticationInfo'].every(p => permissions.data_collection?.includes(p)))
          throw Error('Sync permission required.');
      }
      return client.now(onlyIfDirty);
    },
    result: async outcome => {
      await api.runtime.sendMessage({ type: 'auto-sync-result', outcome }).catch(() => {});
    },
  });
  const safe = (task: Promise<unknown>) => { void task.catch(() => {}); };
  api.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === AUTO_ALARM) safe(auto.alarm());
  });
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[SYNC_KEY]) safe(auto.manualSuccess());
    else if (changes.explorerState) safe(auto.changed());
  });
  api.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== api.runtime.id || sender.url !== api.runtime.getURL('explorer.html')) return false;
    if (message?.type === 'auto-sync-startup') safe(discoverExplorerWindow());
    const task = message?.type === 'auto-sync-startup' ? auto.startup()
      : message?.type === 'auto-sync-enabled' && typeof message.enabled === 'boolean' ? auto.setEnabled(message.enabled)
      : null;
    if (!task) return false;
    void task.then(() => reply({ ok: true }), () => reply({ ok: false }));
    return true;
  });
  // Recovery only restores one-shot scheduling; it never performs a startup GET itself.
  safe(auto.recover());
  api.runtime.onStartup.addListener(() => safe(auto.recover()));
  return auto;
}
