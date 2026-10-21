import { webext } from '../utils/browser';
import { DropboxAuth, DROPBOX_ACCOUNT_KEY, DROPBOX_PENDING_KEY } from './dropbox-auth';
import { DropboxProvider, dropboxCredentials } from './dropbox';
import { localDropboxKey, validatedLocalKey } from './dropbox-key';
import { newSyncKey } from './drive-key';
import { canonical, decrypt, hash, SyncDecryptionError } from './crypto';
import { SyncClient, type Outcome, type SyncStore } from './client';
import { networkLock } from './locks';
import { parsePayload } from './payload';

/** Block background sync while OAuth replaces the token and its account baseline. */
export async function authenticateDropbox(auth: DropboxAuth, store: SyncStore, changeAccount = false) {
  await networkLock(async () => {
    const previous = (await webext().storage.local.get(DROPBOX_ACCOUNT_KEY))[DROPBOX_ACCOUNT_KEY];
    await auth.connect({ changeAccount, beforeSave: async accountId => {
      if (changeAccount || !accountId || accountId !== previous)
        await store.transaction(async () => ({ sync: null }));
    } });
  });
}

export type DropboxConnectionOutcome = Outcome | { kind: 'key-required'; mismatch: boolean };
/** Reuse a local key only after authenticating the actual remote ciphertext. */
export async function connectDropboxWorkspace(provider: DropboxProvider, store: SyncStore, suppliedKey?: string): Promise<DropboxConnectionOutcome> {
  const client = new SyncClient(provider, store), local = await store.read();
  if (local.sync) {
    try { return await client.now(); }
    catch (error) {
      if (!(error instanceof SyncDecryptionError)) throw error;
      // An explicit reconnect after another device reset its key must offer the
      // same existing-workspace onboarding, without discarding the old local key.
      await networkLock(() => store.transaction(async now => {
        if (canonical(now.sync) !== canonical(local.sync)) throw Error('Connection changed. Reconnect Dropbox again.');
        return { sync: null };
      }));
      return { kind: 'key-required', mismatch: true };
    }
  }
  const remote = await provider.readRemote();
  const pending = await validatedLocalKey((await webext().storage.local.get(DROPBOX_PENDING_KEY))[DROPBOX_PENDING_KEY]);
  const saved = await localDropboxKey();
  const candidates = suppliedKey !== undefined ? [suppliedKey] : [...new Set([saved, pending])].filter((key): key is string => !!key);
  if (remote) {
    if (!candidates.length) return { kind: 'key-required', mismatch: false };
    let credentials;
    for (const candidate of candidates) {
      const c = await dropboxCredentials(candidate);
      let plain;
      try { plain = await decrypt(c, remote.encryptedBlob); }
      catch { continue; }
      parsePayload(plain); // A decryptable but invalid workspace must not become a valid local key.
      credentials = c; break;
    }
    if (!credentials) return { kind: 'key-required', mismatch: true };
    // Key-aware read preserves the existing validated legacy-path migration.
    const verified = await provider.readRemote(credentials, remote);
    if (!verified) throw Error('Dropbox sync file not found. Connect again.');
    const result = await client.connectProvider(credentials, verified);
    if (!('remote' in result)) return result;
    if (await hash(result.payload) === result.localHash) return client.resolve(result, 'remote');
    return local.state.folders.length || local.state.conversations.length ? { ...result, kind: 'conflict' } : result;
  }
  if (suppliedKey) throw Error('Dropbox sync file not found. Connect again.');
  // A new remote gets a new key; only an interrupted first creation reuses its draft.
  const initial = typeof pending === 'string' ? pending : newSyncKey();
  await webext().storage.local.set({ [DROPBOX_PENDING_KEY]: initial });
  return client.connectProvider(await dropboxCredentials(initial), null);
}
