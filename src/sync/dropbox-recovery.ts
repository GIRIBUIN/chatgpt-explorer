import { webext } from '../utils/browser';
import { DROPBOX_ACCOUNT_KEY, DROPBOX_PENDING_KEY, DROPBOX_TOKEN_KEY } from './dropbox-auth';
import { DropboxProvider, DROPBOX_PATH, dropboxCredentials } from './dropbox';
import { localDropboxKey } from './dropbox-key';
import { newSyncKey } from './drive-key';
import { decrypt, encrypt, hash } from './crypto';
import { payload, parsePayload } from './payload';
import { networkLock } from './locks';
import type { SyncStore } from './client';
import type { Remote } from './types';

export type DropboxResetPreview = { localHash: string; sessionHash: string; remote: Remote };
const stale = () => Error('Sync reset is stale. Review the reset again. No new reset was applied.');
async function sessionHash() {
  const data = await webext().storage.local.get([DROPBOX_ACCOUNT_KEY, DROPBOX_TOKEN_KEY]);
  const token = data[DROPBOX_TOKEN_KEY] as { refreshToken?: string; clientId?: string } | undefined;
  // Identify the OAuth session without putting a token in the preview or errors.
  return hash({ account: data[DROPBOX_ACCOUNT_KEY] ?? null, client: token?.clientId ?? null, session: token?.refreshToken ?? null });
}
function requireLocalWorkspace(local: Awaited<ReturnType<SyncStore['read']>>) {
  if (local.sync) throw Error('Disconnect before resetting sync.');
  if (!local.state.folders.length && !local.state.conversations.length)
    throw Error('This device has no folders or chats. Restore a local workspace before resetting sync.');
}
/** Read-only preparation. Cancelling this preview changes neither keys nor files. */
export function prepareDropboxReset(provider: DropboxProvider, store: SyncStore): Promise<DropboxResetPreview> {
  return networkLock(async () => {
    const local = await store.read(); requireLocalWorkspace(local);
    const before = await sessionHash(), remote = await provider.readRemote();
    if (!remote) throw Error('No existing Dropbox workspace to reset. Connect Dropbox again.');
    const saved = await localDropboxKey();
    if (saved) {
      let plain;
      try { plain = await decrypt(await dropboxCredentials(saved), remote.encryptedBlob); }
      catch { /* A missing or incompatible key is the only reason to offer recovery. */ }
      if (plain !== undefined) {
        parsePayload(plain);
        throw Error('A working Sync Key is available. Connect the existing workspace instead.');
      }
    }
    // Recovery cannot atomically compare both the legacy root and a new canonical file.
    // Keep the validated legacy migration path intact instead of weakening it.
    if (JSON.parse(remote.remoteVersion ?? 'null')?.[2] !== DROPBOX_PATH.toLowerCase())
      throw Error('Recover the Sync Key and migrate the old root sync file before resetting sync.');
    if (before !== await sessionHash()) throw stale();
    return { localHash: await hash(payload(local.state)), sessionHash: before, remote };
  });
}
/** Deliberate replacement, never called by startup/idle/close/manual ordinary sync. */
export function resetDropboxWorkspace(provider: DropboxProvider, store: SyncStore, preview: DropboxResetPreview, confirmed: boolean) {
  if (confirmed !== true) return Promise.reject(Error('Confirm replacement of the encrypted Dropbox workspace first.'));
  return networkLock(async () => {
    const local = await store.read(); requireLocalWorkspace(local);
    const currentPayload = payload(local.state);
    if (await hash(currentPayload) !== preview.localHash) throw stale();
    const checkLocal = async () => {
      const current = await store.read(); requireLocalWorkspace(current);
      if (await hash(payload(current.state)) !== preview.localHash || await sessionHash() !== preview.sessionHash) throw stale();
    };
    await checkLocal();
    const remote = await provider.readRemote();
    if (!remote || remote.remoteVersion !== preview.remote.remoteVersion || remote.revision !== preview.remote.revision) throw stale();
    await checkLocal();
    // Existing backup mechanism, completed before any remote write. Keeping the
    // state unchanged also uses the store's full stale-local-state write guard.
    await store.transaction(async now => {
      requireLocalWorkspace(now);
      if (await hash(payload(now.state)) !== preview.localHash) throw stale();
      return { backup: true, state: now.state };
    });
    const key = newSyncKey(), credentials = await dropboxCredentials(key), blob = await encrypt(credentials, currentPayload);
    await checkLocal();
    // Keep a recovery draft if Dropbox accepts the write but its response is lost.
    // The previously confirmed local key is replaced only after success.
    await webext().storage.local.set({ [DROPBOX_PENDING_KEY]: key });
    const saved = await provider.resetRemote(remote, blob);
    await store.transaction(async now => {
      if (now.sync || await sessionHash() !== preview.sessionHash) throw stale();
      return { sync: { ...credentials, lastSyncedRevision: saved.revision, lastSyncedRemoteVersion: saved.remoteVersion,
        lastSyncedPayloadHash: preview.localHash, lastSyncedAt: Date.now() } };
    });
    await webext().storage.local.remove(DROPBOX_PENDING_KEY);
    // Edits made while the upload was in flight remain local and dirty against
    // the snapshot hash, rather than being overwritten by the recovery snapshot.
    return { kind: 'done' } as const;
  });
}
