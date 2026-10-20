import { expect, it, vi } from 'vitest';
import { driveHarness } from './drive-harness';
import { SyncClient, type Local, type SyncStore, type Preview } from '../src/sync/client';
import { defaults, addConversation } from '../src/models/state';
import { driveCredentials, newSyncKey } from '../src/sync/drive-key';
import { AutoSync, IDLE_MS, type AutoState } from '../src/sync/auto';
import { payload } from '../src/sync/payload';
import { encrypt, hash } from '../src/sync/crypto';

function device(h: ReturnType<typeof driveHarness>) {
  const local: Local = { state: defaults(), sync: null }, backups: Local['state'][] = [];
  const store: SyncStore = {
    read: async () => structuredClone(local),
    transaction: async fn => {
      const change = await fn(structuredClone(local));
      if (change.backup) backups.push(structuredClone(local.state));
      if (change.state) local.state = change.state;
      if (change.sync !== undefined) local.sync = change.sync;
    },
  };
  const provider = h.provider(), client = new SyncClient(provider, store);
  return { local, store, provider, client, backups,
    edit(name: string) { local.state = addConversation(local.state, name, `https://chatgpt.com/c/${name}`, null).state; } };
}
function counts(h: ReturnType<typeof driveHarness>) {
  return {
    list: h.calls.filter(c => c.url.searchParams.has('spaces')).length,
    metadata: h.calls.filter(c => !c.url.pathname.includes('/upload/') && c.url.searchParams.has('fields') && !c.url.searchParams.has('spaces')).length,
    media: h.calls.filter(c => c.url.searchParams.get('alt') === 'media').length,
    write: h.calls.filter(c => c.init.method === 'PUT' || c.init.method === 'POST').length,
  };
}
async function fixture() {
  const h = driveHarness(), a = device(h), c = await driveCredentials(newSyncKey());
  a.edit('first'); await a.client.connectProvider(c, null);
  const b = device(h);
  await b.client.resolve(await b.client.connectProvider(c, await b.provider.get(c)) as Preview, 'remote');
  h.calls.length = 0;
  return { h, a, b, c };
}
it.each([
  ['unchanged', { list: 0, metadata: 1, media: 0, write: 0 }],
  ['local', { list: 0, metadata: 2, media: 0, write: 1 }],
  ['remote', { list: 0, metadata: 3, media: 1, write: 0 }],
] as const)('steady-state request budget: %s', async (mode, expected) => {
  const { h, a, b } = await fixture();
  if (mode === 'local') b.edit('local');
  if (mode === 'remote') { a.edit('remote'); await a.client.now(); h.calls.length = 0; }
  await b.client.now();
  expect(counts(h)).toEqual(expected);
});
it('a new provider/worker uses the persisted file ID without rediscovery', async () => {
  const { h, b } = await fixture();
  await new SyncClient(h.provider(), b.store).now();
  expect(counts(h)).toEqual({ list: 0, metadata: 1, media: 0, write: 0 });
  expect(JSON.stringify(payload(b.local.state))).not.toContain('file-a');
});
it('cached file 404 rediscovers exactly once and persists the replacement ID', async () => {
  const { h, b } = await fixture(); h.replaceFile();
  await new SyncClient(h.provider(), b.store).now();
  expect(counts(h)).toEqual({ list: 1, metadata: 3, media: 1, write: 0 });
  expect(b.local.sync!.lastSyncedRemoteVersion).toContain('file-replacement');
  h.calls.length = 0; await new SyncClient(h.provider(), b.store).now();
  expect(counts(h)).toEqual({ list: 0, metadata: 1, media: 0, write: 0 });
});
it('one unchanged sync never downloads/decrypts an envelope or writes', async () => {
  const { h, b } = await fixture(); const download = vi.spyOn(b.provider, 'get');
  await b.client.now(); expect(download).not.toHaveBeenCalled();
  expect(counts(h).media).toBe(0); expect(counts(h).write).toBe(0);
});
it('local change checks once then conditionally writes once and verifies once', async () => {
  const { h, b } = await fixture(); b.edit('local'); await b.client.now();
  expect(h.calls.map(c => c.url.pathname.includes('/upload/') ? 'PUT' : 'metadata')).toEqual(['metadata', 'PUT', 'metadata']);
  expect(new Headers(h.calls[1].init.headers).get('If-Match')).toBeTruthy();
});
it('remote pull downloads once, revalidates with metadata and backs up before apply', async () => {
  const { h, a, b } = await fixture(); a.edit('remote'); await a.client.now(); h.calls.length = 0;
  const before = structuredClone(b.local.state); await b.client.now();
  expect(counts(h).list).toBe(0); expect(counts(h).media).toBe(1);
  expect(b.backups.at(-1)).toEqual(before); expect(b.local.state.conversations).toHaveLength(2);
});
it('new syncs always fetch fresh metadata rather than hiding subsequent remote changes', async () => {
  const { h, a, b } = await fixture(); await b.client.now(); a.edit('remote'); await a.client.now(); h.calls.length = 0;
  await b.client.now(); expect(counts(h).media).toBe(1); expect(b.local.state.conversations).toHaveLength(2);
});
it('simultaneous Sync Now calls and separate clients join a single flight', async () => {
  const { h, b } = await fixture(); const second = new SyncClient(h.provider(), b.store);
  const outcomes = await Promise.all([b.client.now(), b.client.now(), second.now()]);
  expect(outcomes).toEqual([{ kind: 'none' }, { kind: 'none' }, { kind: 'none' }]);
  expect(counts(h)).toEqual({ list: 0, metadata: 1, media: 0, write: 0 });
});
it('manual Sync Now joining a clean close still performs one remote check', async () => {
  const { h, b } = await fixture();
  await Promise.all([b.client.now(true), b.client.now()]);
  expect(counts(h)).toEqual({ list: 0, metadata: 1, media: 0, write: 0 });
});
function automatic(d: ReturnType<typeof device>) {
  let state: AutoState | undefined;
  const auto = new AutoSync({ local: d.store.read, read: async () => state, write: async s => { state = s; },
    schedule: async () => {}, now: () => IDLE_MS * 2, sync: dirty => d.client.now(dirty), result: async () => {} });
  return { auto, state: () => state };
}
it('manual plus idle alarm race issues one write, not two independent syncs', async () => {
  const { h, b } = await fixture(); const { auto } = automatic(b); b.edit('local'); await auto.changed(0);
  await Promise.all([auto.alarm(), b.client.now()]);
  expect(counts(h)).toEqual({ list: 0, metadata: 2, media: 0, write: 1 });
});
it('close plus idle alarm race issues one active sync', async () => {
  const { h, b } = await fixture(); const { auto } = automatic(b); b.edit('local'); await auto.changed(0);
  await Promise.all([auto.close(), auto.alarm(), b.client.now(true)]);
  expect(counts(h)).toEqual({ list: 0, metadata: 2, media: 0, write: 1 });
});
it('local edits during an active sync coalesce into at most one follow-up', async () => {
  const { h, b } = await fixture(); b.edit('initial');
  const put = b.provider.put.bind(b.provider); let writes = 0;
  vi.spyOn(b.provider, 'put').mockImplementation(async (...args) => {
    writes++; b.edit(`during-${writes}`); b.edit(`also-${writes}`); return put(...args);
  });
  await Promise.all([b.client.now(), b.client.now()]);
  expect(writes).toBe(2); expect(counts(h)).toEqual({ list: 0, metadata: 4, media: 0, write: 2 });
  // Edits made during the follow-up are still durable and dirty for the idle alarm.
  expect(await hash(payload(b.local.state))).not.toBe(b.local.sync!.lastSyncedPayloadHash);
});
it('transaction metadata reuse expires before a later standalone write', async () => {
  const { h, b, c } = await fixture(); await b.client.now(); const before = counts(h).metadata;
  const baseline = b.local.sync!;
  await b.provider.put(c, baseline.lastSyncedRevision, await encrypt(c, payload(b.local.state)), baseline.lastSyncedRemoteVersion);
  expect(counts(h).metadata).toBeGreaterThan(before);
});
it('metadata fast path still rejects stale If-Match without changing the baseline', async () => {
  const { h, b } = await fixture(); b.edit('local'); const before = structuredClone(b.local.sync); h.fail('stale');
  const outcome = await b.client.now();
  expect('remote' in outcome).toBe(true); expect(b.local.sync).toEqual(before);
  expect(counts(h).write).toBe(1);
});
it('post-write version race is not acknowledged as successful', async () => {
  const { h, b } = await fixture(); b.edit('local'); h.fail('after-write'); const before = structuredClone(b.local.sync);
  // The recovery read may acknowledge identical winning plaintext, but cannot save
  // an obsolete write-response version as the new baseline.
  await b.client.now(); expect(b.local.sync!.lastSyncedRemoteVersion).not.toBe(before!.lastSyncedRemoteVersion);
  expect(b.local.sync!.lastSyncedRemoteVersion).toBe((await h.provider().get(b.local.sync!)).remoteVersion);
});
it('failed single flight is cleared so a later explicit retry can succeed', async () => {
  const { h, b } = await fixture(); h.fail('network'); await expect(b.client.now()).rejects.toThrow();
  h.fail(''); h.calls.length = 0; await b.client.now();
  expect(counts(h)).toEqual({ list: 0, metadata: 1, media: 0, write: 0 });
});
