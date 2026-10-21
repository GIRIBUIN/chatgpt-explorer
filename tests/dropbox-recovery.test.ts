import { afterEach, expect, it, vi } from 'vitest';
import { defaults } from '../src/models/state';
import { exportWorkspace } from '../src/models/workspace';
import { defaultTheme, parseTheme } from '../src/models/theme';
import { DropboxProvider, dropboxCredentials } from '../src/sync/dropbox';
import { DROPBOX_ACCOUNT_KEY, DROPBOX_PENDING_KEY, DROPBOX_TOKEN_KEY } from '../src/sync/dropbox-auth';
import { DROPBOX_LOCAL_KEY, localDropboxKey } from '../src/sync/dropbox-key';
import { connectDropboxWorkspace } from '../src/sync/dropbox-connection';
import { prepareDropboxReset, resetDropboxWorkspace } from '../src/sync/dropbox-recovery';
import { decrypt, encrypt, hash } from '../src/sync/crypto';
import { newSyncKey } from '../src/sync/drive-key';
import { payload } from '../src/sync/payload';
import { extensionSyncStore as store } from '../src/sync/store';
import { SyncClient } from '../src/sync/client';
import { dropboxHarness } from './dropbox-harness';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function profile() {
  const state = { ...defaults(), folders: [{ id: 'local', name: 'Local workspace', parentId: null, createdAt: 1 }] };
  const data: Record<string, unknown> = { explorerState: state };
  const set = vi.fn(async (values: object) => { Object.assign(data, structuredClone(values)); });
  vi.stubGlobal('browser', undefined);
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async () => structuredClone(data)), set,
    remove: vi.fn(async (keys: string | string[]) => { for (const key of typeof keys === 'string' ? [keys] : keys) delete data[key]; }),
  } } });
  return { data, set, state };
}
async function lostKey() {
  const f = profile(), h = dropboxHarness(), key = newSyncKey(), provider = h.provider();
  await new SyncClient(provider, store).connectProvider(await dropboxCredentials(key), null);
  await store.transaction(async () => ({ sync: null }));
  delete f.data[DROPBOX_LOCAL_KEY]; delete f.data[DROPBOX_PENDING_KEY];
  h.calls.length = 0;
  return { ...f, h, key, provider };
}
const uploads = (h: ReturnType<typeof dropboxHarness>) => h.calls.filter(c => c.url.endsWith('/upload'));
it('fresh existing workspace discovery does not generate or persist a candidate key', async () => {
  const f = await lostKey(), before = structuredClone(f.h.content());
  expect(await connectDropboxWorkspace(f.provider, store)).toEqual({ kind: 'key-required', mismatch: false });
  expect(f.data[DROPBOX_LOCAL_KEY]).toBeUndefined(); expect(f.data[DROPBOX_PENDING_KEY]).toBeUndefined();
  expect(uploads(f.h)).toHaveLength(0); expect(f.h.content()).toEqual(before);
});
it('a new empty remote gets a fresh key rather than reusing another workspace key', async () => {
  const f = profile(), h = dropboxHarness(), old = newSyncKey(); f.data[DROPBOX_LOCAL_KEY] = old;
  await connectDropboxWorkspace(h.provider(), store);
  expect(await localDropboxKey()).not.toBe(old);
  expect(await decrypt((await store.read()).sync!, (await h.provider().get((await store.read()).sync!)).encryptedBlob)).toEqual(payload(f.state));
});
it('reset preparation and cancellation make no key/remote/backup mutations', async () => {
  const f = await lostKey(), before = structuredClone(f.h.content()); f.set.mockClear();
  await prepareDropboxReset(f.provider, store);
  expect(f.set).not.toHaveBeenCalled(); expect(uploads(f.h)).toHaveLength(0);
  expect(f.h.content()).toEqual(before); expect(f.data[DROPBOX_PENDING_KEY]).toBeUndefined();
});
it('reset requires explicit confirmation before any backup, key generation or write', async () => {
  const f = await lostKey(), preview = await prepareDropboxReset(f.provider, store); f.set.mockClear();
  await expect(resetDropboxWorkspace(f.provider, store, preview, false)).rejects.toThrow('Confirm replacement');
  expect(f.set).not.toHaveBeenCalled(); expect(uploads(f.h)).toHaveLength(0);
});
it('confirmed reset backs up first, conditionally replaces the remote and retains the new key', async () => {
  const f = await lostKey(), preview = await prepareDropboxReset(f.provider, store);
  const provider = new DropboxProvider(f.h.auth, async (url, init) => {
    if (String(url).endsWith('/upload')) expect(f.data.workspaceBackup).toMatchObject({ state: f.state });
    return f.h.fetcher(url, init);
  });
  expect(await resetDropboxWorkspace(provider, store, preview, true)).toEqual({ kind: 'done' });
  const sync = (await store.read()).sync!, key = await localDropboxKey();
  expect(key).toBeTruthy(); expect(key).not.toBe(f.key); expect(f.data[DROPBOX_PENDING_KEY]).toBeUndefined();
  const remote = await f.provider.get(sync);
  expect(remote.revision).toBe(preview.remote.revision + 1);
  expect(await decrypt(sync, remote.encryptedBlob)).toEqual(payload(f.state));
  await expect(decrypt(await dropboxCredentials(f.key), remote.encryptedBlob)).rejects.toThrow('decrypt');
  const args = JSON.parse(new Headers(uploads(f.h)[0].init.headers).get('Dropbox-API-Arg')!);
  expect(args.mode).toEqual({ '.tag': 'update', update: JSON.parse(preview.remote.remoteVersion!)[1] });
  expect(args.strict_conflict).toBe(true); expect(args.autorename).toBe(false);
  expect(sync.lastSyncedPayloadHash).toBe(await hash(payload(f.state)));
});
it('empty/default local workspace cannot replace an encrypted remote', async () => {
  const f = await lostKey(); f.data.explorerState = defaults();
  await expect(prepareDropboxReset(f.provider, store)).rejects.toThrow('no folders or chats');
  expect(uploads(f.h)).toHaveLength(0); expect(f.data[DROPBOX_PENDING_KEY]).toBeUndefined();
});
it('working saved key prevents lost-key reset instead of replacing a recoverable workspace', async () => {
  const f = await lostKey(); f.data[DROPBOX_LOCAL_KEY] = f.key;
  await expect(prepareDropboxReset(f.provider, store)).rejects.toThrow('working Sync Key');
  expect(uploads(f.h)).toHaveLength(0);
});
it('local edit after reset preview rejects without changing keys or remote', async () => {
  const f = await lostKey(), preview = await prepareDropboxReset(f.provider, store);
  f.data.explorerState = { ...f.state, folders: [{ ...f.state.folders[0], name: 'Changed' }] };
  await expect(resetDropboxWorkspace(f.provider, store, preview, true)).rejects.toThrow('stale');
  expect(uploads(f.h)).toHaveLength(0); expect(f.data[DROPBOX_LOCAL_KEY]).toBeUndefined();
});
it('remote edit after reset preview rejects without an upload', async () => {
  const f = await lostKey(), preview = await prepareDropboxReset(f.provider, store); f.h.corrupt(f.h.content());
  await expect(resetDropboxWorkspace(f.provider, store, preview, true)).rejects.toThrow('stale');
  expect(uploads(f.h)).toHaveLength(0);
});
it.each(['account', 'session'])('%s change after reset preview cannot write to another Dropbox session', async mode => {
  const f = await lostKey(), preview = await prepareDropboxReset(f.provider, store);
  if (mode === 'account') f.data[DROPBOX_ACCOUNT_KEY] = 'dbid:other';
  else f.data[DROPBOX_TOKEN_KEY] = { clientId: 'public-app', refreshToken: 'different-session' };
  await expect(resetDropboxWorkspace(f.provider, store, preview, true)).rejects.toThrow('stale');
  expect(uploads(f.h)).toHaveLength(0);
});
it('backup failure prevents remote replacement and key generation', async () => {
  const f = await lostKey(), preview = await prepareDropboxReset(f.provider, store);
  f.set.mockImplementation(async values => { if ('workspaceBackup' in values) throw Error('Backup unavailable'); Object.assign(f.data, values); });
  await expect(resetDropboxWorkspace(f.provider, store, preview, true)).rejects.toThrow('Backup unavailable');
  expect(uploads(f.h)).toHaveLength(0); expect(f.data[DROPBOX_PENDING_KEY]).toBeUndefined();
});
it('racing Dropbox revision rejects the conditional write without replacing the retained key', async () => {
  const f = await lostKey(), wrong = newSyncKey(); f.data[DROPBOX_LOCAL_KEY] = wrong;
  const preview = await prepareDropboxReset(f.provider, store), before = structuredClone(f.h.content()); f.h.fail('stale');
  await expect(resetDropboxWorkspace(f.provider, store, preview, true)).rejects.toMatchObject({ status: 409 });
  expect(f.h.content()).toEqual(before); expect(await localDropboxKey()).toBe(wrong);
  expect((await store.read()).sync).toBeNull(); expect(f.data.workspaceBackup).toBeTruthy();
});
it('accepted upload with a lost response retains a draft that reconnect can validate', async () => {
  const f = await lostKey(), old = newSyncKey(); f.data[DROPBOX_LOCAL_KEY] = old;
  const preview = await prepareDropboxReset(f.provider, store);
  const lossy = new DropboxProvider(f.h.auth, async (url, init) => {
    const response = await f.h.fetcher(url, init);
    if (String(url).endsWith('/upload')) throw Error('network');
    return response;
  });
  await expect(resetDropboxWorkspace(lossy, store, preview, true)).rejects.toThrow('temporarily unavailable');
  expect(await localDropboxKey()).toBe(old); const pending = f.data[DROPBOX_PENDING_KEY]; expect(pending).toBeTruthy();
  expect(await connectDropboxWorkspace(f.provider, store)).toEqual({ kind: 'done' });
  expect(await localDropboxKey()).toBe(pending);
});
it('edits during the upload survive locally and remain dirty against the reset snapshot', async () => {
  const f = await lostKey(), preview = await prepareDropboxReset(f.provider, store);
  const racing = new DropboxProvider(f.h.auth, async (url, init) => {
    if (String(url).endsWith('/upload')) f.data.explorerState = { ...f.state, folders: [{ ...f.state.folders[0], name: 'Latest edit' }] };
    return f.h.fetcher(url, init);
  });
  await resetDropboxWorkspace(racing, store, preview, true);
  const local = await store.read(); expect(local.state.folders[0].name).toBe('Latest edit');
  expect(await hash(payload(local.state))).not.toBe(local.sync!.lastSyncedPayloadHash);
  expect(f.data.workspaceBackup).toMatchObject({ state: f.state });
});
it('reset does not bypass legacy-root migration safety', async () => {
  const f = await lostKey(); f.h.seedLegacy(f.h.content()); f.h.removeCanonical();
  await expect(prepareDropboxReset(f.provider, store)).rejects.toThrow('migrate the old root');
  expect(uploads(f.h)).toHaveLength(0);
});
it('decryptable but malformed data never validates a supplied key or replaces the saved key', async () => {
  const f = await lostKey(), wrong = newSyncKey(); f.data[DROPBOX_LOCAL_KEY] = wrong;
  const blob = await encrypt(await dropboxCredentials(f.key), { invalid: 'workspace' });
  f.h.corrupt({ formatVersion: 1, revision: 1, updatedAt: 1, iv: blob.iv, ciphertext: blob.ciphertext });
  await expect(connectDropboxWorkspace(f.provider, store, f.key)).rejects.toThrow();
  expect(await localDropboxKey()).toBe(wrong); expect(uploads(f.h)).toHaveLength(0);
});
it('recovery exports and errors/logs exclude actual keys and OAuth tokens', async () => {
  const f = await lostKey(); f.data[DROPBOX_LOCAL_KEY] = newSyncKey();
  const log = vi.spyOn(console, 'log'), error = vi.spyOn(console, 'error');
  const preview = await prepareDropboxReset(f.provider, store);
  await resetDropboxWorkspace(f.provider, store, preview, true);
  const key = await localDropboxKey(), local = await store.read();
  const json = JSON.stringify([exportWorkspace(local.state), parseTheme(defaultTheme), payload(local.state), f.h.content()]);
  for (const secret of [key!, f.key, 'refreshToken', 'encryptionKey', 'access-token']) expect(json).not.toContain(secret);
  expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
});
it('an old connected device can explicitly reconnect and enter the replacement key after a reset', async () => {
  const f = await lostKey();
  await connectDropboxWorkspace(f.provider, store, f.key);
  const before = structuredClone(f.data.explorerState), nextKey = newSyncKey();
  const nextBlob = await encrypt(await dropboxCredentials(nextKey), payload(f.state));
  f.h.corrupt({ formatVersion: 1, revision: 2, updatedAt: 2, iv: nextBlob.iv, ciphertext: nextBlob.ciphertext });
  f.h.calls.length = 0;
  expect(await connectDropboxWorkspace(f.provider, store)).toEqual({ kind: 'key-required', mismatch: true });
  expect(f.data.explorerSync).toBeUndefined(); expect(await localDropboxKey()).toBe(f.key);
  expect(f.data.explorerState).toEqual(before); expect(uploads(f.h)).toHaveLength(0);
  expect(await connectDropboxWorkspace(f.provider, store, nextKey)).toEqual({ kind: 'done' });
  expect(await localDropboxKey()).toBe(nextKey);
});
it('local edit during reset remote validation is rejected before backup or upload', async () => {
  const f = await lostKey(), preview = await prepareDropboxReset(f.provider, store);
  const racing = new DropboxProvider(f.h.auth, async (url, init) => {
    const result = await f.h.fetcher(url, init);
    if (String(url).endsWith('/download')) f.data.explorerState = { ...f.state, folders: [{ ...f.state.folders[0], name: 'Unreviewed edit' }] };
    return result;
  });
  await expect(resetDropboxWorkspace(racing, store, preview, true)).rejects.toThrow('stale');
  expect(uploads(f.h)).toHaveLength(0); expect(f.data.workspaceBackup).toBeUndefined();
  expect(f.data[DROPBOX_PENDING_KEY]).toBeUndefined();
});
