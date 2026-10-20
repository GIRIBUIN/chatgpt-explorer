import { it, expect, vi, afterEach } from 'vitest';
import { dropboxHarness } from './dropbox-harness';
import { dropboxCredentials, DROPBOX_PATH, DROPBOX_LEGACY_PATH } from '../src/sync/dropbox';
import { newSyncKey, driveKey, driveCredentials } from '../src/sync/drive-key';
import { encrypt, decrypt, hash } from '../src/sync/crypto';
import { payload } from '../src/sync/payload';
import { defaults, addConversation } from '../src/models/state';
import { SyncClient, type SyncStore, type Local, type Preview } from '../src/sync/client';
import { AutoSync, type AutoState, IDLE_MS } from '../src/sync/auto';
import { storedSync } from '../src/sync/storage';
import { providerFor, dropboxDefault } from '../src/sync/providers';
import { DropboxProvider } from '../src/sync/dropbox';
import { DropboxReconnectError, DropboxUnavailableError } from '../src/sync/dropbox-auth';
import { GoogleDriveProvider } from '../src/sync/google-drive';
import { CloudflareProvider } from '../src/sync/api';
afterEach(() => vi.unstubAllGlobals());
function device(h: ReturnType<typeof dropboxHarness>) {
  const local: Local = { state: defaults(), sync: null }, backups: Local['state'][] = [];
  const store: SyncStore = { read: async () => structuredClone(local), transaction: async fn => {
    const change = await fn(structuredClone(local));
    if (change.backup) backups.push(structuredClone(local.state));
    if (change.state) local.state = change.state;
    if (change.sync !== undefined) local.sync = change.sync;
  } };
  const provider = h.provider(), client = new SyncClient(provider, store);
  let saved: AutoState | undefined, time = 1000, alarm: number | null = null;
  const ports = { local: store.read, read: async () => saved, write: async (a: AutoState) => { saved = a; },
    schedule: async (t: number | null) => { alarm = t; }, now: () => time, sync: (dirty?: boolean) => client.now(dirty), result: async () => {} };
  const auto = new AutoSync(ports);
  return { local, store, provider, client, backups, auto, ports, status: () => saved!, alarm: () => alarm,
    time: (t: number) => { time = t; }, edit: (s: string) => { local.state = addConversation(local.state, s, `https://chatgpt.com/c/${s}`, null).state; } };
}
async function pair() {
  const h = dropboxHarness(), a = device(h), b = device(h), key = newSyncKey(), c = await dropboxCredentials(key);
  a.edit('private-first'); await a.client.connectProvider(c, null);
  const preview = await b.client.connectProvider(c, await b.provider.get(c)) as Preview;
  await b.client.resolve(preview, 'remote'); await a.auto.recover(); await b.auto.recover(); h.calls.length = 0;
  return { h, a, b, c, key };
}
const budget = (h: ReturnType<typeof dropboxHarness>) => ({
  metadata: h.calls.filter(c => c.url.endsWith('/get_metadata')).length,
  download: h.calls.filter(c => c.url.endsWith('/download')).length,
  upload: h.calls.filter(c => c.url.endsWith('/upload')).length,
});
it('dedicated-path lookup checks the legacy root only when canonical remote is missing', async () => {
  const h = dropboxHarness(); expect(await h.provider().readRemote()).toBeNull(); expect(h.calls).toHaveLength(2);
  expect(JSON.parse(h.calls[0].init.body as string)).toEqual({ path: DROPBOX_PATH });
});
it('first create acknowledges authoritative upload revision without self-conflict', async () => {
  const h = dropboxHarness(), a = device(h), c = await dropboxCredentials(newSyncKey()); a.edit('private-title');
  expect(await a.client.connectProvider(c, null)).toEqual({ kind: 'done' });
  expect(a.local.sync).toMatchObject({ provider: 'dropbox', lastSyncedRevision: 1, lastSyncedPayloadHash: await hash(payload(a.local.state)) });
  expect(a.local.sync!.lastSyncedRemoteVersion).toContain(h.meta().rev);
  expect(budget(h)).toEqual({ metadata: 2, download: 0, upload: 1 });
  await a.auto.manualSuccess(); expect(a.status().dirty).toBe(false);
});
it('initial upload cannot overwrite an existing remote or create a conflicted copy', async () => {
  const { h, c } = await pair(); const before = structuredClone(h.content());
  await expect(h.provider().create(c, await encrypt(c, {}))).rejects.toMatchObject({ status: 409 });
  expect(h.content()).toEqual(before);
});
it('download validates the exact header revision and encrypted envelope', async () => {
  const { h, c, a } = await pair(); const r = await h.provider().get(c);
  expect(await decrypt(c, r.encryptedBlob)).toEqual(payload(a.local.state));
  expect(budget(h)).toEqual({ metadata: 1, download: 1, upload: 0 });
});
it('download raced by another revision fails safely', async () => {
  const { h, c } = await pair(); h.fail('read-race'); await expect(h.provider().get(c)).rejects.toMatchObject({ status: 409 });
});
it.each([
  ['unchanged', { metadata: 1, download: 0, upload: 0 }],
  ['local', { metadata: 1, download: 0, upload: 1 }],
  ['remote', { metadata: 2, download: 1, upload: 0 }],
] as const)('%s request budget preserves metadata-first dedup', async (mode, expected) => {
  const { h, a, b } = await pair();
  if (mode === 'local') b.edit('local');
  if (mode === 'remote') { a.edit('remote'); await a.client.now(); h.calls.length = 0; }
  await b.client.now(); expect(budget(h)).toEqual(expected);
});
it('conditional upload sends current rev, strict_conflict and never overwrite/autorename', async () => {
  const { h, b } = await pair(); const rev = h.meta().rev; b.edit('local'); await b.client.now();
  const call = h.calls.find(c => c.url.endsWith('/upload'))!;
  expect(JSON.parse(new Headers(call.init.headers).get('Dropbox-API-Arg')!)).toMatchObject({
    path: DROPBOX_PATH, mode: { '.tag': 'update', update: rev }, strict_conflict: true, autorename: false });
});
it('stale revision never overwrites remote and produces an existing conflict preview', async () => {
  const { h, b } = await pair(); const before = structuredClone(h.content()), baseline = structuredClone(b.local.sync);
  b.edit('local'); h.fail('stale'); const outcome = await b.client.now();
  expect(outcome.kind).toBe('conflict'); expect(h.content()).toEqual(before); expect(b.local.sync).toEqual(baseline);
});
it('equal independent edits acknowledge semantic equality without conflict', async () => {
  const { a, b } = await pair(); a.edit('same'); b.edit('same'); await a.client.now();
  expect(await b.client.now()).toEqual({ kind: 'none' }); await b.auto.manualSuccess(); expect(b.status().dirty).toBe(false);
});
it('true divergence uses conflict UI and explicit remote choice backs up first', async () => {
  const { a, b } = await pair(); a.edit('remote'); b.edit('local'); await a.client.now();
  const before = structuredClone(b.local.state), p = await b.client.now() as Preview; expect(p.kind).toBe('conflict');
  expect(b.local.state).toEqual(before); await b.client.resolve(p, 'remote');
  expect(b.backups.at(-1)).toEqual(before); expect(b.local.state.conversations.some(c => c.id === 'remote')).toBe(true);
});
it('local stale preview cannot apply and does not discard the new edit', async () => {
  const { a, b } = await pair(); a.edit('remote'); b.edit('local'); await a.client.now();
  const p = await b.client.now() as Preview; b.edit('new-local'); const before = structuredClone(b.local);
  await expect(b.client.resolve(p, 'remote')).rejects.toThrow('stale'); expect(b.local).toEqual(before);
});
it('remote stale preview cannot apply', async () => {
  const { a, b } = await pair(); a.edit('remote'); b.edit('local'); await a.client.now();
  const p = await b.client.now() as Preview; a.edit('new-remote'); await a.client.now();
  await expect(b.client.resolve(p, 'remote')).rejects.toThrow('stale');
});
it('wrong Sync Key never applies local data', async () => {
  const { h, c } = await pair(), d = device(h), before = structuredClone(d.local);
  await expect(d.client.connectProvider(await dropboxCredentials(newSyncKey()), await h.provider().get(c))).rejects.toThrow('decrypt');
  expect(d.local).toEqual(before);
});
it('single-flight simultaneous requests share metadata and upload', async () => {
  const { h, b } = await pair(); b.edit('local'); const other = new SyncClient(h.provider(), b.store);
  await Promise.all([b.client.now(), b.client.now(), other.now()]);
  expect(budget(h)).toEqual({ metadata: 1, download: 0, upload: 1 });
});
it('edits during active sync produce at most one follow-up and preserve later dirty edits', async () => {
  const { h, b } = await pair(); b.edit('local'); const put = b.provider.put.bind(b.provider); let n = 0;
  vi.spyOn(b.provider, 'put').mockImplementation(async (...args) => { b.edit(`during-${++n}`); return put(...args); });
  await b.client.now(); expect(n).toBe(2); expect(budget(h).upload).toBe(2);
  await b.auto.manualSuccess(); expect(b.status().dirty).toBe(true);
});
it('startup/idle/close policies and clean-close zero request remain', async () => {
  const { h, a, b } = await pair(); a.edit('idle'); await a.auto.changed(); a.time(1000 + IDLE_MS);
  await a.auto.alarm(); expect(budget(h).upload).toBe(1); await b.auto.startup();
  expect(b.local.state.conversations.some(c => c.id === 'idle')).toBe(true);
  h.calls.length = 0; await a.auto.close(); expect(h.calls).toHaveLength(0);
  b.edit('close'); await b.auto.changed(); await b.auto.close(); expect(budget(h).upload).toBe(1);
});
it('OFF disables automatic work while manual sync still succeeds', async () => {
  const { h, b } = await pair(); await b.auto.setEnabled(false); b.edit('off'); await b.auto.changed();
  b.time(IDLE_MS * 2); await b.auto.startup(); await b.auto.alarm(); await b.auto.close(); expect(h.calls).toHaveLength(0);
  await b.client.now(); expect(budget(h).upload).toBe(1);
});
it('network/refresh failure preserves dirty and baseline; restart recovers deadline', async () => {
  const { h, b } = await pair(); b.edit('offline'); await b.auto.changed(); const before = structuredClone(b.local.sync); h.fail('network');
  await b.auto.close(); expect(b.status().dirty).toBe(true); expect(b.local.sync).toEqual(before);
  h.fail(''); await new AutoSync(b.ports).recover(); expect(b.alarm()).toBe(1000 + IDLE_MS);
  await b.auto.startup(); expect(b.status().dirty).toBe(false);
});
it('401 invalidates and retries the API once with silently refreshed credentials', async () => {
  const { h, b } = await pair(); h.fail('401-once'); await b.client.now();
  expect(h.auth.invalidate).toHaveBeenCalledTimes(1); expect(budget(h).metadata).toBe(2);
});
it('second 401 requires reconnect without infinite API retries or baseline change', async () => {
  const { h, b } = await pair(); h.fail('401'); const before = structuredClone(b.local);
  await expect(b.client.now()).rejects.toThrow('Reconnect Dropbox'); expect(budget(h).metadata).toBe(2); expect(b.local).toEqual(before);
});
it('remote file contains encrypted envelope only, without Sync Key or OAuth credentials', async () => {
  const { h, c, key } = await pair(); const body = JSON.stringify(h.content());
  expect(Object.keys(h.content() as object).sort()).toEqual(['ciphertext', 'formatVersion', 'iv', 'revision', 'updatedAt']);
  for (const text of ['private-first', key, c.encryptionKey, 'access-token', 'refreshToken', 'folders', 'theme']) expect(body).not.toContain(text);
});
it('Sync Key format/AAD remain compatible but remote provider metadata is separate', async () => {
  const key = newSyncKey(), drive = await driveCredentials(key), dropbox = await dropboxCredentials(key);
  expect(driveKey(dropbox)).toBe(key); expect(dropbox.syncId).toBe(drive.syncId);
  expect(await decrypt(dropbox, await encrypt(drive, { version: 1 }))).toEqual({ version: 1 });
  expect(dropbox.origin).not.toBe(drive.origin); expect(dropbox.provider).toBe('dropbox');
});
it('Disconnect preserves local workspace and remote snapshot', async () => {
  const { h, b } = await pair(); const state = structuredClone(b.local.state), remote = structuredClone(h.content());
  await b.client.disconnect(); expect(b.local.sync).toBeNull(); expect(b.local.state).toEqual(state); expect(h.content()).toEqual(remote);
  expect(h.auth.disconnect).toHaveBeenCalledTimes(1);
});
it('Dropbox credentials validate from local storage but never enter canonical payload', async () => {
  const { b } = await pair(); vi.stubGlobal('browser', undefined); vi.stubGlobal('chrome', { storage: { local: { get: async () => ({ explorerSync: b.local.sync }) } } });
  expect(await storedSync()).toEqual(b.local.sync);
  expect(JSON.stringify(payload(b.local.state))).not.toContain(b.local.sync!.encryptionKey);
});
it('default provider switches to Dropbox while persisted Google/Cloudflare connections retain routing', async () => {
  vi.stubGlobal('__SYNC_PROVIDER__', 'dropbox'); vi.stubGlobal('__SYNC_ORIGIN__', 'https://sync.example.com');
  const { c, key } = await pair(); expect(dropboxDefault()).toBe(true); expect(providerFor()).toBeInstanceOf(DropboxProvider);
  expect(providerFor(c)).toBeInstanceOf(DropboxProvider); expect(providerFor(await driveCredentials(key))).toBeInstanceOf(GoogleDriveProvider);
  expect(providerFor({ ...c, provider: undefined, origin: 'https://sync.example.com' })).toBeInstanceOf(CloudflareProvider);
});
it('explicit Google-to-Dropbox switch uploads local metadata with a fresh provider baseline', async () => {
  const h = dropboxHarness(), a = device(h), key = newSyncKey(); a.edit('retained-local-alias');
  a.local.sync = { ...await driveCredentials(key), lastSyncedRevision: 27, lastSyncedRemoteVersion: 'old-drive-token',
    lastSyncedPayloadHash: await hash(payload(a.local.state)), lastSyncedAt: 1 };
  const before = structuredClone(a.local.state);
  // Switching requires explicit local disconnect; it does not pull/delete Drive data.
  await a.store.transaction(async () => ({ sync: null }));
  await a.client.connectProvider(await dropboxCredentials(key), null);
  expect(a.local.state).toEqual(before); expect(a.local.sync!.lastSyncedRevision).toBe(1);
  expect(a.local.sync!.lastSyncedRemoteVersion).not.toContain('drive');
  expect(await decrypt(a.local.sync!, (await h.provider().get(a.local.sync!)).encryptedBlob)).toEqual(payload(before));
});
it('refresh failure in background preserves local metadata and dirty revision/hash', async () => {
  const { h, b } = await pair(); b.edit('pending'); await b.auto.changed(); const before = structuredClone(b.local);
  h.auth.token.mockRejectedValueOnce(Error('Reconnect Dropbox'));
  await b.auto.close(); expect(b.local).toEqual(before); expect(b.status().dirty).toBe(true); expect(b.status().error).toBeTruthy();
});
it('background conflict stays pending without automatic overwrite', async () => {
  const { a, b } = await pair(); a.edit('a'); b.edit('b'); await a.auto.changed(); await b.auto.changed();
  await a.auto.close(); const before = structuredClone(b.local); await b.auto.close();
  expect(b.status().conflict).toBe(true); expect(b.local).toEqual(before);
});
async function legacy() {
  const h = dropboxHarness(), a = device(h), c = await dropboxCredentials(newSyncKey());
  a.edit('legacy-private');
  const encrypted = await encrypt(c, payload(a.local.state));
  const document = { formatVersion: 1, revision: 7, updatedAt: 1000, iv: encrypted.iv, ciphertext: encrypted.ciphertext };
  h.seedLegacy(document);
  return { h, a, c, document };
}
it('legacy root migrates only after decryption/schema validation and preserves original bytes', async () => {
  const { h, c, document } = await legacy();
  const r = await h.provider().readRemote(c);
  expect(r?.revision).toBe(7); expect(h.legacy()).toEqual(document);
  expect(h.content()).toMatchObject({ revision: 7, iv: document.iv, ciphertext: document.ciphertext });
  expect(r!.remoteVersion).toContain(DROPBOX_PATH.toLowerCase());
  expect(h.calls.filter(c => c.url.endsWith('/upload'))).toHaveLength(1);
});
it('legacy discovery without a Sync Key reads but never migrates or overwrites', async () => {
  const { h } = await legacy(); expect(await h.provider().readRemote()).not.toBeNull();
  expect(h.content()).toBeNull(); expect(budget(h).upload).toBe(0);
});
it('wrong legacy key cannot create the dedicated file or alter local metadata', async () => {
  const { h, a } = await legacy(); const before = structuredClone(a.local);
  await expect(h.provider().readRemote(await dropboxCredentials(newSyncKey()))).rejects.toThrow('decrypt');
  expect(h.content()).toBeNull(); expect(a.local).toEqual(before);
});
it('invalid decrypted legacy schema cannot migrate', async () => {
  const { h, c, document } = await legacy(); const encrypted = await encrypt(c, { invalid: true });
  h.seedLegacy({ ...document, iv: encrypted.iv, ciphertext: encrypted.ciphertext });
  await expect(h.provider().readRemote(c)).rejects.toThrow(); expect(h.content()).toBeNull();
});
it('existing canonical file wins without reading, merging, or deleting a legacy root', async () => {
  const { h, c, a } = await pair(); const canonical = structuredClone(h.content());
  h.seedLegacy({ ...canonical as object, revision: 999 }); h.calls.length = 0;
  const r = await h.provider().readRemote(c);
  expect(await decrypt(c, r!.encryptedBlob)).toEqual(payload(a.local.state)); expect(h.content()).toEqual(canonical);
  expect(h.calls.some(c => c.url.endsWith('/get_metadata') && JSON.parse(String(c.init.body)).path === DROPBOX_LEGACY_PATH)).toBe(false);
  expect(budget(h).upload).toBe(0);
});
it('completed migration stores canonical baseline and never resurrects a stale legacy file', async () => {
  const { h, c, a } = await legacy(); const provider = h.provider(), r = await provider.readRemote(c);
  const p = await a.client.connectProvider(c, r) as Preview; await a.client.resolve(p, 'remote');
  h.removeCanonical(); h.calls.length = 0;
  await expect(h.provider().check(a.local.sync!)).rejects.toThrow('not found');
  expect(h.calls).toHaveLength(1); expect(h.legacy()).not.toBeNull();
});
it('legacy-aware initial create refuses to replace an existing encrypted workspace', async () => {
  const { h, c, document } = await legacy();
  await expect(h.provider().create(c, await encrypt(c, payload(defaults())))).rejects.toMatchObject({ status: 409 });
  expect(h.content()).toBeNull(); expect(h.legacy()).toEqual(document);
});
it('dedicated sync performs no listing, delete, or access to unrelated Dropbox paths', async () => {
  const { h, b } = await pair(); b.edit('local'); await b.client.now();
  for (const { url, init } of h.calls) {
    expect(url).toMatch(/\/(get_metadata|download|upload)$/);
    const args = JSON.parse(url.endsWith('/get_metadata') ? String(init.body) : new Headers(init.headers).get('Dropbox-API-Arg')!);
    expect(args.path.toLowerCase()).toBe(DROPBOX_PATH.toLowerCase());
  }
});
it('provider-local path marker is excluded from workspace/theme sync payload', async () => {
  const { b } = await pair(); const p = JSON.stringify(payload(b.local.state));
  expect(b.local.sync!.lastSyncedRemoteVersion).toContain(DROPBOX_PATH.toLowerCase());
  expect(p).not.toContain(DROPBOX_PATH.toLowerCase()); expect(p).not.toContain('explorerDropboxToken');
});
it.each([
  [new DropboxReconnectError(), 'reconnect-required'],
  [new DropboxUnavailableError(), 'temporarily-unavailable'],
] as const)('automatic sync stores a safe recovery category, preserving dirty and baseline: %s', async (failure, category) => {
  const { h, b } = await pair(); b.edit('pending'); await b.auto.changed(); const before = structuredClone(b.local);
  h.auth.token.mockRejectedValueOnce(failure); await b.auto.close();
  expect(b.status().error).toBe(category); expect(b.status().dirty).toBe(true); expect(b.local).toEqual(before);
});
