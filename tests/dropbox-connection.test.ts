import { afterEach, expect, it, vi } from 'vitest';
import { DropboxAuth, DROPBOX_ACCOUNT_KEY, DROPBOX_PENDING_KEY, DROPBOX_TOKEN_KEY } from '../src/sync/dropbox-auth';
import { authenticateDropbox, connectDropboxWorkspace } from '../src/sync/dropbox-connection';
import { DROPBOX_LOCAL_KEY, localDropboxKey } from '../src/sync/dropbox-key';
import { dropboxCredentials } from '../src/sync/dropbox';
import { driveKey, newSyncKey } from '../src/sync/drive-key';
import { SyncClient, type Preview } from '../src/sync/client';
import { extensionSyncStore as store } from '../src/sync/store';
import { defaults } from '../src/models/state';
import { payload } from '../src/sync/payload';
import { exportWorkspace } from '../src/models/workspace';
import { dropboxHarness } from './dropbox-harness';

afterEach(() => vi.unstubAllGlobals());
function profile() {
  const data: Record<string, unknown> = { explorerState: defaults() };
  const storage = {
    get: vi.fn(async () => structuredClone(data)),
    set: vi.fn(async (values: object) => { Object.assign(data, structuredClone(values)); }),
    remove: vi.fn(async (keys: string | string[]) => { for (const k of typeof keys === 'string' ? [keys] : keys) delete data[k]; }),
  };
  vi.stubGlobal('browser', undefined);
  const api = { storage: { local: storage } };
  vi.stubGlobal('chrome', api);
  return { data, storage, api };
}
async function connected() {
  const p = profile(), h = dropboxHarness(), provider = h.provider(), key = newSyncKey();
  const client = new SyncClient(provider, store);
  await client.connectProvider(await dropboxCredentials(key), null);
  return { ...p, h, provider, key, client };
}
it('successful connection retains a separate device-local key', async () => {
  const f = await connected();
  expect(await localDropboxKey()).toBe(f.key);
  expect(f.data[DROPBOX_LOCAL_KEY]).toBe(f.key);
});
it('existing connection migration preserves the key before Disconnect deletes its baseline', async () => {
  const f = await connected(); delete f.data[DROPBOX_LOCAL_KEY];
  const state = structuredClone(f.data.explorerState), remote = structuredClone(f.h.content());
  await f.client.disconnect();
  expect(f.data.explorerSync).toBeUndefined(); expect(await localDropboxKey()).toBe(f.key);
  expect(f.h.auth.disconnect).toHaveBeenCalledOnce();
  expect(f.data.explorerState).toEqual(state); expect(f.h.content()).toEqual(remote);
});
it('Disconnect and same-account reconnect reuses the key and connects without key entry or upload', async () => {
  const f = await connected(); await f.client.disconnect(); f.h.calls.length = 0;
  expect(await connectDropboxWorkspace(f.h.provider(), store)).toEqual({ kind: 'done' });
  expect(driveKey((await store.read()).sync!)).toBe(f.key);
  expect(f.h.calls.filter(c => c.url.endsWith('/upload'))).toHaveLength(0);
  expect(f.h.calls.filter(c => c.url.endsWith('/download'))).toHaveLength(1);
});
it('fresh profile with an encrypted remote requires a key, with no writes', async () => {
  const f = await connected(); profile(); f.h.calls.length = 0;
  expect(await connectDropboxWorkspace(f.h.provider(), store)).toEqual({ kind: 'key-required', mismatch: false });
  expect((await store.read()).sync).toBeNull();
  expect(f.h.calls.some(c => c.url.endsWith('/upload'))).toBe(false);
});
it('wrong retained key cannot overwrite a different account or replace the saved key', async () => {
  const f = await connected(), remote = structuredClone(f.h.content()); profile();
  const wrong = newSyncKey(); await chrome.storage.local.set({ [DROPBOX_LOCAL_KEY]: wrong }); f.h.calls.length = 0;
  expect(await connectDropboxWorkspace(f.h.provider(), store)).toEqual({ kind: 'key-required', mismatch: true });
  expect(await localDropboxKey()).toBe(wrong); expect(f.h.content()).toEqual(remote);
  expect((await store.read()).sync).toBeNull(); expect(f.h.calls.some(c => c.url.endsWith('/upload'))).toBe(false);
});
it('valid user-supplied key replaces the retained key only after preview confirmation', async () => {
  const f = await connected();
  await store.transaction(async () => ({ state: { ...defaults(), folders: [{ id: 'local', parentId: null, name: 'Local', createdAt: 1 }] }, sync: null }));
  const wrong = newSyncKey(); await chrome.storage.local.set({ [DROPBOX_LOCAL_KEY]: wrong });
  const result = await connectDropboxWorkspace(f.h.provider(), store, f.key) as Preview;
  expect(result.kind).toBe('conflict'); expect(await localDropboxKey()).toBe(wrong);
  await new SyncClient(f.h.provider(), store).resolve(result, 'remote');
  expect(await localDropboxKey()).toBe(f.key);
});
it('invalid supplied key leaves both the remote and saved key unchanged', async () => {
  const f = await connected(); await f.client.disconnect(); const remote = structuredClone(f.h.content());
  await expect(connectDropboxWorkspace(f.h.provider(), store, 'invalid')).rejects.toThrow('Invalid Sync Key');
  expect(await localDropboxKey()).toBe(f.key); expect(f.h.content()).toEqual(remote);
});
it('initial remote creation still works and retains its generated key', async () => {
  profile(); const h = dropboxHarness();
  expect(await connectDropboxWorkspace(h.provider(), store)).toEqual({ kind: 'done' });
  expect(await localDropboxKey()).toBe(driveKey((await store.read()).sync!));
});
it('device-local key and account ID are excluded from payload and workspace exports', async () => {
  const f = await connected(); await chrome.storage.local.set({ [DROPBOX_ACCOUNT_KEY]: 'dbid:local-identity' });
  const state = (await store.read()).state;
  const json = JSON.stringify([payload(state), exportWorkspace(state)]);
  for (const value of [f.key, 'dbid:local-identity', DROPBOX_LOCAL_KEY, DROPBOX_TOKEN_KEY]) expect(json).not.toContain(value);
});

// Exercise account replacement against the real local store, before any file request.
function oauth(accountId?: string) {
  const api = chrome as unknown as { identity: object };
  api.identity = {
    getRedirectURL: () => 'https://test.chromiumapp.org/dropbox',
    launchWebAuthFlow: vi.fn(async ({ url }: { url: string }) => {
      const u = new URL(url); return `${u.searchParams.get('redirect_uri')}?code=code&state=${u.searchParams.get('state')}`;
    }),
  };
  const fetcher = vi.fn(async () => Response.json({ access_token: 'new-access', refresh_token: 'new-refresh',
    expires_in: 14400, token_type: 'bearer', scope: 'files.metadata.read files.content.read files.content.write', account_id: accountId }));
  return new DropboxAuth('public-app-key', fetcher);
}
it('normal same-account reconnect retains the baseline and does not force a new login', async () => {
  const f = await connected(); f.data[DROPBOX_ACCOUNT_KEY] = 'dbid:same'; const before = structuredClone(f.data.explorerSync);
  await authenticateDropbox(oauth('dbid:same'), store);
  expect(f.data.explorerSync).toEqual(before); expect(await localDropboxKey()).toBe(f.key);
});
it('changed account clears remote baselines before replacing tokens, retaining the key', async () => {
  const f = await connected(); f.data[DROPBOX_ACCOUNT_KEY] = 'dbid:old'; delete f.data[DROPBOX_LOCAL_KEY];
  f.storage.set.mockImplementation(async values => {
    if (DROPBOX_TOKEN_KEY in values) expect(f.data.explorerSync).toBeUndefined();
    Object.assign(f.data, structuredClone(values));
  });
  await authenticateDropbox(oauth('dbid:new'), store);
  expect(f.data.explorerSync).toBeUndefined(); expect(await localDropboxKey()).toBe(f.key);
  expect(f.data[DROPBOX_ACCOUNT_KEY]).toBe('dbid:new');
});
it('explicit Change account resets the baseline even if the user signs into the same account', async () => {
  const f = await connected(); f.data[DROPBOX_ACCOUNT_KEY] = 'dbid:same';
  await authenticateDropbox(oauth('dbid:same'), store, true);
  expect(f.data.explorerSync).toBeUndefined(); expect(await localDropboxKey()).toBe(f.key);
});
it('unknown legacy account is revalidated without reusing the old revision', async () => {
  const f = await connected(); await authenticateDropbox(oauth(), store);
  expect(f.data.explorerSync).toBeUndefined(); expect(await localDropboxKey()).toBe(f.key);
});
it('Disconnect removes real OAuth credentials and leaves local account hint/key for reconnect', async () => {
  const f = await connected(); f.data[DROPBOX_ACCOUNT_KEY] = 'dbid:same';
  const auth = oauth('dbid:same'); await auth.connect();
  const client = new SyncClient({ ...f.provider, origin: f.provider.origin, create: f.provider.create.bind(f.provider),
    get: f.provider.get.bind(f.provider), put: f.provider.put.bind(f.provider), disconnect: () => auth.disconnect() }, store);
  await client.disconnect();
  expect(f.data[DROPBOX_TOKEN_KEY]).toBeUndefined(); expect(f.data.explorerSync).toBeUndefined();
  expect(f.data[DROPBOX_ACCOUNT_KEY]).toBe('dbid:same'); expect(await localDropboxKey()).toBe(f.key);
});
it('switching to a different encrypted account never writes with the old account baseline/key', async () => {
  const remoteAccount = await connected(), remote = structuredClone(remoteAccount.h.content());
  const localAccount = await connected(); localAccount.data[DROPBOX_ACCOUNT_KEY] = 'dbid:old';
  await authenticateDropbox(oauth('dbid:other'), store, true);
  remoteAccount.h.calls.length = 0;
  expect(await connectDropboxWorkspace(remoteAccount.h.provider(), store)).toEqual({ kind: 'key-required', mismatch: true });
  expect(localAccount.data.explorerSync).toBeUndefined(); expect(await localDropboxKey()).toBe(localAccount.key);
  expect(remoteAccount.h.content()).toEqual(remote);
  expect(remoteAccount.h.calls.some(c => c.url.endsWith('/upload'))).toBe(false);
});
it('cancelling account change keeps the original tokens, key, baseline and workspace', async () => {
  const f = await connected(), auth = oauth('dbid:other');
  f.data[DROPBOX_ACCOUNT_KEY] = 'dbid:old'; f.data[DROPBOX_TOKEN_KEY] = { accessToken: 'original' };
  const before = structuredClone(f.data);
  vi.mocked(chrome.identity.launchWebAuthFlow).mockRejectedValueOnce(Error('cancelled'));
  await expect(authenticateDropbox(auth, store, true)).rejects.toThrow('cancelled');
  expect(f.data).toEqual(before);
});
it('both devices can disconnect then reconnect with their saved key without either re-entering it', async () => {
  const a = await connected(), b = profile();
  expect(await connectDropboxWorkspace(a.h.provider(), store, a.key)).toEqual({ kind: 'done' });
  await new SyncClient(a.h.provider(), store).disconnect();
  vi.stubGlobal('chrome', a.api);
  await a.client.disconnect();
  expect(a.data[DROPBOX_LOCAL_KEY]).toBe(a.key); expect(b.data[DROPBOX_LOCAL_KEY]).toBe(a.key);
  a.h.calls.length = 0;
  for (const api of [a.api, b.api]) {
    vi.stubGlobal('chrome', api);
    expect((await store.read()).sync).toBeNull();
    expect(await connectDropboxWorkspace(a.h.provider(), store)).toEqual({ kind: 'done' });
    expect(driveKey((await store.read()).sync!)).toBe(a.key);
  }
  expect(a.h.calls.some(call => call.url.endsWith('/upload'))).toBe(false);
});
it('a malformed remote baseline does not hide a valid key in the legacy Dropbox connection', async () => {
  const f = await connected(); delete f.data[DROPBOX_LOCAL_KEY];
  (f.data.explorerSync as { lastSyncedRemoteVersion?: string }).lastSyncedRemoteVersion = undefined;
  await expect(store.read()).rejects.toThrow('credentials');
  expect(await localDropboxKey()).toBe(f.key);
  expect(f.data[DROPBOX_LOCAL_KEY]).toBeUndefined(); // Reading is not key replacement.
});
it('invalid-connection Disconnect preserves the remaining key before deleting its legacy record', async () => {
  const f = await connected(); delete f.data[DROPBOX_LOCAL_KEY];
  (f.data.explorerSync as { lastSyncedAt: unknown }).lastSyncedAt = null;
  const state = structuredClone(f.data.explorerState), remote = structuredClone(f.h.content());
  await store.transaction(async () => ({ sync: null }));
  expect(f.data.explorerSync).toBeUndefined(); expect(f.data[DROPBOX_LOCAL_KEY]).toBe(f.key);
  expect(f.data.explorerState).toEqual(state); expect(f.h.content()).toEqual(remote);
  f.h.calls.length = 0;
  expect(await connectDropboxWorkspace(f.h.provider(), store)).toEqual({ kind: 'done' });
  expect(f.h.calls.some(call => call.url.endsWith('/upload'))).toBe(false);
});
it('failed key preservation cannot delete the sole legacy key record', async () => {
  const f = await connected(); delete f.data[DROPBOX_LOCAL_KEY];
  (f.data.explorerSync as { lastSyncedAt: unknown }).lastSyncedAt = null;
  const before = structuredClone(f.data.explorerSync);
  f.storage.set.mockRejectedValueOnce(Error('storage unavailable'));
  await expect(store.transaction(async () => ({ sync: null }))).rejects.toThrow('storage unavailable');
  expect(f.data.explorerSync).toEqual(before); expect(await localDropboxKey()).toBe(f.key);
});
it('an interrupted-connection draft can be shown and reused even without a confirmed connection', async () => {
  const f = await connected(); delete f.data[DROPBOX_LOCAL_KEY]; delete f.data.explorerSync;
  f.data[DROPBOX_PENDING_KEY] = f.key;
  expect(await localDropboxKey()).toBe(f.key);
  expect(await connectDropboxWorkspace(f.h.provider(), store)).toEqual({ kind: 'done' });
  expect(f.data[DROPBOX_LOCAL_KEY]).toBe(f.key);
});
it('key recovery ignores unrelated provider records and malformed keys without generating replacements', async () => {
  const f = profile(), key = newSyncKey();
  f.data[DROPBOX_LOCAL_KEY] = 'invalid'; f.data[DROPBOX_PENDING_KEY] = 'invalid';
  f.data.explorerSync = { provider: 'google-drive', encryptionKey: (await dropboxCredentials(key)).encryptionKey };
  f.storage.set.mockClear(); expect(await localDropboxKey()).toBeNull(); expect(f.storage.set).not.toHaveBeenCalled();
  f.data.explorerSync = { provider: 'dropbox', encryptionKey: 'invalid' };
  expect(await localDropboxKey()).toBeNull(); expect(f.storage.set).not.toHaveBeenCalled();
});
it('a corrupt pending draft does not prevent existing-remote onboarding or cause remote writes', async () => {
  const f = await connected(); delete f.data[DROPBOX_LOCAL_KEY]; delete f.data.explorerSync;
  f.data[DROPBOX_PENDING_KEY] = 'invalid'; const remote = structuredClone(f.h.content()); f.h.calls.length = 0;
  expect(await connectDropboxWorkspace(f.h.provider(), store)).toEqual({ kind: 'key-required', mismatch: false });
  expect(f.h.content()).toEqual(remote); expect(f.h.calls.some(call => call.url.endsWith('/upload'))).toBe(false);
});
