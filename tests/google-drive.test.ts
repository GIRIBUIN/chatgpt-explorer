import { it, expect, vi, afterEach } from 'vitest';
import { driveHarness } from './drive-harness';
import { driveCredentials, driveKey, newSyncKey } from '../src/sync/drive-key';
import { encrypt, decrypt, hash } from '../src/sync/crypto';
import { GoogleDriveProvider, driveSyncMessage } from '../src/sync/google-drive';
import { SyncError } from '../src/sync/api';
import { connectGoogle, pkce, authCode, googleToken } from '../src/sync/google-auth-firefox';
import { DRIVE_SCOPE, GOOGLE_TOKEN_KEY } from '../src/sync/google-auth-common';
import { SyncClient, type Local, type Preview, type SyncStore } from '../src/sync/client';
import { defaults, addConversation } from '../src/models/state';
import { AutoSync, IDLE_MS, type AutoState } from '../src/sync/auto';
import { payload, parsePayload, syncDiff } from '../src/sync/payload';
import { manifestFor } from '../scripts/manifest';

afterEach(() => vi.unstubAllGlobals());
it.each(['etag', 'updatedAt', 'reencryption'])('identical plaintext with changed %s acknowledges baseline without conflict', async variant => {
  const { a, h, c } = await pair();
  // Simulate a stale local baseline, as well as a changed remote envelope.
  a.local.sync!.lastSyncedPayloadHash = 'old-baseline';
  const before = structuredClone(a.local.state);
  const content = structuredClone(h.content()) as { updatedAt: number; iv: string; ciphertext: string };
  if (variant === 'updatedAt') content.updatedAt++;
  if (variant === 'reencryption') Object.assign(content, (({ iv, ciphertext }) => ({ iv, ciphertext }))(await encrypt(c, payload(before))));
  h.corrupt(content);
  const writes = h.calls.filter(x => x.init.method === 'PUT').length;
  expect(await a.client.now()).toEqual({ kind: 'none' });
  await a.auto.manualSuccess();
  expect(a.state().dirty).toBe(false); expect(a.state().conflict).toBe(false);
  expect(a.local.state).toEqual(before); expect(a.backups).toHaveLength(0);
  expect(a.local.sync!.lastSyncedRemoteVersion).toBe((await h.provider().get(c)).remoteVersion);
  expect(a.local.sync!.lastSyncedPayloadHash).toBe(await hash(payload(before)));
  expect(h.calls.filter(x => x.init.method === 'PUT')).toHaveLength(writes);
});
it('same independent semantic edits never surface a zero-diff conflict', async () => {
  const { a, b } = await pair(); a.edit('same'); b.edit('same');
  await a.client.now();
  expect(await b.client.now()).toEqual({ kind: 'none' });
  await b.auto.manualSuccess(); expect(b.state().dirty).toBe(false);
});
it('409 race with the same winning plaintext acknowledges instead of showing conflict', async () => {
  const { a, h } = await pair(); a.edit('same-winner');
  const provider = h.provider(), put = provider.put.bind(provider);
  provider.put = async (...args) => { await put(...args); throw new SyncError(409); };
  const client = new SyncClient(provider, { read: a.ports.local, transaction: async fn => {
    const change = await fn(structuredClone(a.local)); if (change.sync) a.local.sync = change.sync;
  } });
  expect(await client.now()).toEqual({ kind: 'none' });
  expect(a.local.sync!.lastSyncedPayloadHash).toBe(await hash(payload(a.local.state)));
});
it('device runtime and sync envelope fields are absent from semantic payload', async () => {
  const { a } = await pair(); const before = await hash(payload(a.local.state));
  a.local.sync!.lastSyncedAt++; a.local.sync!.lastSyncedRevision++;
  a.local.sync!.lastSyncedRemoteVersion = 'different-etag';
  a.local.state.conversations[0].lastOpenedAt = Date.now();
  a.local.state.conversations[0].createdAt = Date.now();
  a.local.state.settings.lastLocation = 'inbox';
  expect(await hash(payload(a.local.state))).toBe(before);
  const serialized = JSON.stringify(payload(a.local.state));
  for (const field of ['updatedAt', 'revision', 'etag', 'provider', 'lastSyncedAt', 'dirty', 'lastOpenedAt'])
    expect(serialized).not.toContain(`"${field}"`);
});
it('true divergent edits still surface a nonzero semantic conflict', async () => {
  const { a, b } = await pair(); a.edit('remote'); b.edit('local'); await a.client.now();
  const result = await b.client.now() as Preview;
  expect(result.kind).toBe('conflict');
  expect(Object.values(syncDiff(b.local.state, result.payload)).some(Boolean)).toBe(true);
});
it('remote entity array order does not create a semantic conflict', async () => {
  const { a, c, h } = await pair(); a.edit('second'); await a.client.now();
  const p = payload(a.local.state); p.workspace.chats.reverse(); p.workspace.colorRules.reverse();
  const r = await h.provider().get(c); await h.provider().put(c, r.revision, await encrypt(c, p), r.remoteVersion);
  a.local.sync!.lastSyncedPayloadHash = 'old';
  expect(await a.client.now()).toEqual({ kind: 'none' });
  expect(await hash(parsePayload(p))).toBe(await hash(payload(a.local.state)));
});
it('concurrent local edit during equal-remote reconciliation cannot be marked synced', async () => {
  const { a, c, h } = await pair(); h.corrupt(h.content());
  const baseline = structuredClone(a.local.sync);
  const provider = h.provider(), check = provider.check.bind(provider);
  provider.check = async credentials => { const r = await check(credentials); a.edit('during-network'); return r; };
  const client = new SyncClient(provider, { read: a.ports.local, transaction: async fn => {
    const change = await fn(structuredClone(a.local)); if (change.sync) a.local.sync = change.sync;
  } });
  await expect(client.now()).rejects.toThrow('Local data changed');
  expect(a.local.sync).toEqual(baseline); expect(a.local.state.conversations.some(x => x.id === 'during-network')).toBe(true);
  expect(c.provider).toBe('google-drive');
});
it('sync diff reports original-title clearing and removed color rules', async () => {
  const { a } = await pair(); a.local.state.conversations[0].originalTitle = 'Original';
  const p = payload(a.local.state); p.workspace.chats[0].originalTitle = null;
  const unused = p.workspace.colorRules.findIndex(r => !p.workspace.chats.some(c => c.color === r.color));
  p.workspace.colorRules.splice(unused, 1);
  const diff = syncDiff(a.local.state, p);
  expect(diff.chatsChanged).toBe(1); expect(diff.colorRulesChanged).toBe(1);
});
async function seeded() {
  const h = driveHarness(), c = await driveCredentials(newSyncKey()), blob = await encrypt(c, { secret: 'private title' });
  const p = h.provider(), remote = await p.create(c, blob);
  return { h, c, blob, p, remote };
}
it('Drive no remote file returns null', async () => expect(await driveHarness().provider().readRemote()).toBeNull());
it('first creation accepts upload representation ETag and saves latest metadata baseline', async () => {
  const h = driveHarness(); h.fail('upload-etag'); const a = device(h), c = await driveCredentials(newSyncKey());
  expect(await a.client.connectProvider(c, null)).toEqual({ kind: 'done' });
  const remote = await h.provider().get(c);
  expect(a.local.sync?.provider).toBe('google-drive');
  expect(a.local.sync?.lastSyncedRemoteVersion).toBe(remote.remoteVersion);
  expect(a.local.sync?.lastSyncedRemoteVersion).not.toContain('upload-representation');
  expect(a.local.sync?.lastSyncedPayloadHash).toBe(await hash(payload(a.local.state)));
  await a.auto.manualSuccess(); expect(a.state().dirty).toBe(false); expect(a.state().conflict).toBe(false);
  expect(await a.client.now()).toEqual({ kind: 'none' });
});
it('media download never applies metadata ETag but detects a concurrent write', async () => {
  const { h, p } = await seeded();
  expect(h.calls.filter(x => x.url.searchParams.get('alt') === 'media').every(x => !new Headers(x.init.headers).has('If-Match'))).toBe(true);
  h.fail('during-read'); await expect(p.readRemote()).rejects.toMatchObject({ status: 409 });
});
it('update accepts different upload ETag without losing stale write protection', async () => {
  const { h, p, c, blob, remote } = await seeded(); h.fail('upload-etag');
  const next = await p.put(c, 1, blob, remote.remoteVersion); expect(next.remoteVersion).toBe((await p.get(c)).remoteVersion);
  await expect(p.put(c, 1, blob, remote.remoteVersion)).rejects.toMatchObject({ status: 409 });
});
it('reconnecting existing created remote previews without creating another file', async () => {
  const h = driveHarness(), a = device(h), c = await driveCredentials(newSyncKey());
  await a.client.connectProvider(c, null); const b = device(h);
  const preview = await b.client.connectProvider(c, await h.provider().get(c)) as Preview;
  expect(b.local.sync).toBeNull(); expect(preview.kind).toBe('connect');
  await b.client.resolve(preview, 'remote'); expect(b.local.sync?.lastSyncedRemoteVersion).toBe(a.local.sync?.lastSyncedRemoteVersion);
  expect(h.calls.filter(x => x.init.method === 'POST')).toHaveLength(1);
});
it('disconnected Drive error never directs users to unavailable Sync now', () => {
  expect(driveSyncMessage(new SyncError(409), false)).not.toMatch(/sync now/i);
  expect(driveSyncMessage(Error('Preview is stale. Run Sync now again.'), false)).toContain('Connect Google Drive again');
  expect(driveSyncMessage(new SyncError(409), true)).toContain('Sync now');
});
it('creates one marked appDataFolder file containing ciphertext only', async () => {
  const { h, c, p } = await seeded();
  expect(await decrypt(c, (await p.get(c)).encryptedBlob)).toEqual({ secret: 'private title' });
  const upload = h.calls.find(x => x.init.method === 'POST')!;
  expect(upload.init.body).toContain('appDataFolder');
  for (const secret of ['private title', c.encryptionKey, c.syncId, 'test-access-token']) expect(upload.init.body).not.toContain(secret);
  expect(h.calls.filter(x => x.url.searchParams.has('spaces')).every(x => x.url.searchParams.get('spaces') === 'appDataFolder')).toBe(true);
});
it('existing remote prevents duplicate create', async () => { const { p, c, blob } = await seeded(); await expect(p.create(c, blob)).rejects.toMatchObject({ status: 409 }); });
it('conditional update changes remote version and uses If-Match', async () => {
  const { h, p, c, remote } = await seeded();
  const next = await p.put(c, 1, await encrypt(c, {}), remote.remoteVersion);
  expect(next.revision).toBe(2); expect(next.remoteVersion).not.toBe(remote.remoteVersion);
  expect(new Headers(h.calls.find(x => x.init.method === 'PUT')!.init.headers).get('If-Match')).toBe('"e1"');
});
it('race at upload precondition becomes conflict', async () => { const { h, p, c, blob, remote } = await seeded(); h.fail('stale'); await expect(p.put(c, 1, blob, remote.remoteVersion)).rejects.toMatchObject({ status: 409 }); });
it('post-write version change is not acknowledged as synced', async () => { const { h, p, c, blob, remote } = await seeded(); h.fail('after-write'); await expect(p.put(c, 1, blob, remote.remoteVersion)).rejects.toMatchObject({ status: 409 }); });
it('stale read version cannot write', async () => { const { p, c, blob, remote } = await seeded(); await p.put(c, 1, blob, remote.remoteVersion); await expect(p.put(c, 1, blob, remote.remoteVersion)).rejects.toMatchObject({ status: 409 }); });
it('missing write precondition fails closed', async () => { const { p, c, blob } = await seeded(); await expect(p.put(c, 1, blob)).rejects.toThrow('precondition'); });
it('missing ETag fails closed', async () => { const { h, p, c } = await seeded(); h.noEtag(); await expect(p.get(c)).rejects.toThrow('precondition'); });
it('multiple candidates are never arbitrarily selected during discovery', async () => { const { h } = await seeded(); h.duplicates(); await expect(h.provider().readRemote()).rejects.toThrow('Multiple'); });
it('malformed remote is rejected', async () => { const { h, p } = await seeded(); h.corrupt({ title: 'not ciphertext' }); await expect(p.readRemote()).rejects.toThrow('Invalid'); });
it('missing token does not call network or interactive auth', async () => { const fetcher = vi.fn(); const p = new GoogleDriveProvider(async () => { throw Error('Reconnect'); }, fetcher); await expect(p.readRemote()).rejects.toThrow('Reconnect'); expect(fetcher).not.toHaveBeenCalled(); });
it('401 requires explicit reconnect', async () => { const { h, p } = await seeded(); h.fail('auth'); await expect(p.readRemote()).rejects.toThrow('Reconnect'); });
it('network failure does not leak raw error', async () => { const { h, p } = await seeded(); h.fail('network'); await expect(p.readRemote()).rejects.toThrow('Could not access Google Drive'); });
it('Sync Key contains key and format only; no Cloudflare auth credential', async () => { const key = newSyncKey(), c = await driveCredentials(key); expect(driveKey(c)).toBe(key); expect(c.authToken).toBe(''); expect((await driveCredentials(key)).syncId).toBe(c.syncId); });
it('invalid Sync Key rejected', async () => { await expect(driveCredentials('bad')).rejects.toThrow('Invalid Sync Key'); });
it('PKCE verifier and challenge use random S256', async () => { const a = await pkce(), b = await pkce(); expect(a.verifier).not.toBe(b.verifier); expect(a.verifier).toMatch(/^[\w-]{43}$/); const expected = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(a.verifier))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); expect(a.challenge).toBe(expected); });
it('redirect code requires exact URI and state', () => { expect(authCode('https://id.chromiumapp.org/google?state=s&code=c', 'https://id.chromiumapp.org/google', 's')).toBe('c'); for (const url of ['https://evil.test/google?state=s&code=c', 'https://id.chromiumapp.org/google?state=wrong&code=c', 'https://id.chromiumapp.org/google?state=s&code=c&code=d']) expect(() => authCode(url, 'https://id.chromiumapp.org/google', 's')).toThrow(); });
it('auth cancellation rejected', () => expect(() => authCode('https://id.chromiumapp.org/google?state=s&error=access_denied', 'https://id.chromiumapp.org/google', 's')).toThrow('cancelled'));
it.each(['chromium', 'firefox'])('%s PKCE uses identity redirect, appdata scope and no secret', async target => {
  const saved: Record<string, unknown> = {}, redirect = target === 'chromium' ? 'https://id.chromiumapp.org/google' : 'https://id.extensions.allizom.org/google';
  const api = { identity: { getRedirectURL: () => redirect, launchWebAuthFlow: async ({ url, interactive }: { url: string; interactive: boolean }) => {
    const u = new URL(url); expect(interactive).toBe(true); expect(u.searchParams.get('response_type')).toBe('code'); expect(u.searchParams.get('scope')).toBe(DRIVE_SCOPE); expect(u.searchParams.get('code_challenge_method')).toBe('S256'); return `${redirect}?code=code&state=${u.searchParams.get('state')}`;
  } }, storage: { local: { set: async (v: object) => Object.assign(saved, v), get: async () => saved } } };
  vi.stubGlobal(target === 'firefox' ? 'browser' : 'chrome', api);
  if (target === 'chromium') vi.stubGlobal('browser', undefined);
  const fetcher = vi.fn(async (_i, options) => { const params = new URLSearchParams(String(options?.body)); expect(params.has('client_secret')).toBe(false); expect(params.get('redirect_uri')).toBe(redirect); expect(params.get('code_verifier')).toHaveLength(43); return Response.json({ access_token: 'access', token_type: 'Bearer', expires_in: 3600, scope: DRIVE_SCOPE }); }) as typeof fetch;
  await connectGoogle('client', fetcher); expect(await googleToken('client')).toBe('access'); expect(saved[GOOGLE_TOKEN_KEY]).toBeDefined();
});
it('expired token requires reconnect without launchWebAuthFlow', async () => { const launch = vi.fn(); vi.stubGlobal('browser', { identity: { launchWebAuthFlow: launch }, storage: { local: { get: async () => ({ [GOOGLE_TOKEN_KEY]: { clientId: 'c', accessToken: 'expired', expiresAt: 0 } }) } } }); await expect(googleToken('c')).rejects.toThrow('Reconnect'); expect(launch).not.toHaveBeenCalled(); });
it('invalid token endpoint body is never exposed or saved', async () => {
  const set = vi.fn();
  vi.stubGlobal('browser', { identity: { getRedirectURL: () => 'https://id.chromiumapp.org/google', launchWebAuthFlow: async ({ url }: { url: string }) => `https://id.chromiumapp.org/google?code=x&state=${new URL(url).searchParams.get('state')}` }, storage: { local: { set } } });
  const error = await connectGoogle('client', async () => new Response('secret-token-not-json')).catch(e => e as Error);
  expect(error).toBeInstanceOf(Error); expect((error as Error).message).not.toContain('secret-token'); expect(set).not.toHaveBeenCalled();
});
it.each(['chromium', 'firefox'] as const)('%s Drive manifest uses identity and narrow hosts', target => { const m = manifestFor(target, '', true); expect(m.permissions).toContain('identity'); expect(m.host_permissions).toContain('https://www.googleapis.com/drive/v2/*'); expect(m.host_permissions).not.toContain('https://*/*'); });

function device(h: ReturnType<typeof driveHarness>) {
  const local: Local = { state: defaults(), sync: null }, backups: Local['state'][] = [];
  const store: SyncStore = { read: async () => structuredClone(local), transaction: async fn => { const change = await fn(structuredClone(local)); if (change.backup) backups.push(structuredClone(local.state)); if (change.state) local.state = change.state; if (change.sync !== undefined) local.sync = change.sync; } };
  const client = new SyncClient(h.provider(), store);
  let saved: AutoState | undefined, alarm: number | null = null, time = 1000;
  const ports = { local: store.read, read: async () => saved, write: async (s: AutoState) => { saved = s; }, schedule: async (t: number | null) => { alarm = t; }, now: () => time, sync: (dirty?: boolean) => client.now(dirty), result: async () => {} };
  const auto = new AutoSync(ports);
  return { local, backups, client, auto, ports, state: () => saved!, alarm: () => alarm, time: (t: number) => { time = t; }, edit: (name: string) => { local.state = addConversation(local.state, name, `https://chatgpt.com/c/${name}`, null).state; } };
}
async function pair() { const h = driveHarness(), a = device(h), b = device(h), c = await driveCredentials(newSyncKey()); a.edit('first'); await a.client.connectProvider(c, null); const preview = await b.client.connectProvider(c, await h.provider().get(c)) as Preview; expect(b.local.sync).toBeNull(); await b.client.resolve(preview, 'remote'); await a.auto.recover(); await b.auto.recover(); return { h, a, b, c }; }
it('Drive Connect previews then applies with backup; startup pulls after idle push', async () => { const { a, b } = await pair(); expect(b.backups).toHaveLength(1); a.edit('second'); await a.auto.changed(); expect(a.state().dirty).toBe(true); a.time(1000 + IDLE_MS); await a.auto.alarm(); expect(a.local.sync?.lastSyncedRevision).toBe(2); await b.auto.startup(); expect(b.local.state.conversations).toHaveLength(2); expect(b.backups).toHaveLength(2); });
it('Drive close pushes; clean close and later alarm send no request', async () => { const { a, b, h } = await pair(); a.edit('close'); await a.auto.changed(); await a.auto.close(); const count = h.calls.length; await a.auto.close(); a.time(1000 + IDLE_MS); await a.auto.alarm(); expect(h.calls).toHaveLength(count); await b.auto.startup(); expect(b.local.state.conversations).toHaveLength(2); });
it('Drive idle/close race remains single flight', async () => { const { a } = await pair(); a.edit('race'); await a.auto.changed(); a.time(1000 + IDLE_MS); await Promise.all([a.auto.alarm(), a.auto.close()]); expect(a.local.sync?.lastSyncedRevision).toBe(2); });
it('Drive OFF suppresses automatic requests but manual now works', async () => { const { a, h } = await pair(); await a.auto.setEnabled(false); a.edit('off'); await a.auto.changed(); const count = h.calls.length; await a.auto.startup(); await a.auto.close(); a.time(1000 + IDLE_MS); await a.auto.alarm(); expect(h.calls).toHaveLength(count); await a.client.now(); expect(a.local.sync?.lastSyncedRevision).toBe(2); });
it('Drive failure keeps dirty and baseline; restart recovers alarm', async () => { const { a, h } = await pair(); a.edit('offline'); await a.auto.changed(); const baseline = structuredClone(a.local.sync); h.fail('network'); await a.auto.close(); expect(a.state().dirty).toBe(true); expect(a.local.sync).toEqual(baseline); const restarted = new AutoSync(a.ports); await restarted.recover(); expect(a.alarm()).toBe(1000 + IDLE_MS); h.fail(''); await restarted.startup(); expect(a.state().dirty).toBe(false); });
it('Drive automatic conflict remains pending without overwrite', async () => { const { a, b } = await pair(); a.edit('a'); b.edit('b'); await a.auto.changed(); await b.auto.changed(); await a.auto.close(); const before = structuredClone(b.local); await b.auto.close(); expect(b.state().conflict).toBe(true); expect(b.local).toEqual(before); });
it('Drive preview rejects local and remote stale state', async () => { const { a, b } = await pair(); a.edit('remote'); await a.client.now(); b.edit('local'); const p = await b.client.now() as Preview; b.edit('later'); await expect(b.client.resolve(p, 'remote')).rejects.toThrow('stale'); const q = await b.client.now() as Preview; a.edit('newremote'); await a.client.now(); await expect(b.client.resolve(q, 'remote')).rejects.toThrow('stale'); });
it('wrong Drive key never applies local state', async () => { const { h, c } = await pair(); const b = device(h); await expect(b.client.connectProvider(await driveCredentials(newSyncKey()), await h.provider().get(c))).rejects.toThrow('decrypt'); expect(b.local.state).toEqual(defaults()); expect(b.backups).toHaveLength(0); });
it('Drive baseline hashes only sync payload, not token state', async () => { const { a } = await pair(); expect(a.local.sync?.lastSyncedPayloadHash).toBe(await hash(payload(a.local.state))); expect(JSON.stringify(payload(a.local.state))).not.toContain('encryptionKey'); });
it('Drive disconnect removes token and credentials only', async () => { vi.stubGlobal('__BROWSER_TARGET__', 'firefox'); const { a, h } = await pair(); const before = structuredClone(a.local.state), remote = h.content(); const remove = vi.fn(async () => {}); vi.stubGlobal('browser', { storage: { local: { remove } } }); await a.client.disconnect(); expect(a.local.sync).toBeNull(); expect(a.local.state).toEqual(before); expect(h.content()).toEqual(remote); expect(remove).toHaveBeenCalledWith([GOOGLE_TOKEN_KEY, 'explorerDrivePendingKey']); });
it('Drive invalid decrypted schema cannot overwrite workspace', async () => { const { a, b, c, h } = await pair(); const r = await h.provider().get(c); await h.provider().put(c, r.revision, await encrypt(c, { version: 999 }), r.remoteVersion); const before = structuredClone(b.local); await expect(b.client.now()).rejects.toThrow(); expect(b.local).toEqual(before); expect(a.local.sync?.lastSyncedRevision).toBe(1); });
