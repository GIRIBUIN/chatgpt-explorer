import { expect, it, afterEach, vi } from "vitest";
import { server } from "../sync-server/tests/harness";
import {
  SyncClient,
  type SyncStore,
  type Local,
  type Preview,
} from "../src/sync/client";
import { SyncApi } from "../src/sync/api";
import { syncCode, encrypt, credentials } from "../src/sync/crypto";
import { defaults, addConversation } from "../src/models/state";
const servers: ReturnType<typeof server>[] = [];
afterEach(() => {
  servers.splice(0).forEach((s) => s.db.close());
});
function setup() {
  const s = server();
  servers.push(s);
  const api = new SyncApi("https://sync.example.com", s.fetcher);
  function device() {
    const local: Local = { state: defaults(), sync: null };
    const backups: Local["state"][] = [];
    let failBackup = false;
    const store: SyncStore = {
      read: async () => structuredClone(local),
      transaction: async (fn) => {
        const change = await fn(structuredClone(local));
        if (change.backup) {
          if (failBackup) throw Error("Backup failed");
          backups.push(structuredClone(local.state));
        }
        if (change.state) local.state = change.state;
        if (change.sync !== undefined) local.sync = change.sync;
      },
    };
    const client = new SyncClient(api, store);
    return {
      client,
      get: () => local,
      edit: (title: string) => {
        local.state = addConversation(
          local.state,
          title,
          `https://chatgpt.com/c/${title}`,
          null,
        ).state;
      },
      backups,
      fail: () => {
        failBackup = true;
      },
    };
  }
  return { a: device(), b: device(), api, ...s };
}
async function pair() {
  const all = setup();
  all.a.edit("first");
  await all.a.client.enable();
  const p = await all.b.client.connect(syncCode(all.a.get().sync!));
  expect(all.b.get().state.conversations).toHaveLength(0);
  await all.b.client.resolve(p, "remote");
  return all;
}
it("Enable and Connect Existing preview/apply create revision 1 on two devices", async () => {
  const { a, b } = await pair();
  expect(a.get().sync?.lastSyncedRevision).toBe(1);
  expect(b.get().state.conversations[0].title).toBe("first");
  expect(b.backups).toHaveLength(1);
});
it("local-only pushes revision 2; unchanged peer pulls; neither changed no-op", async () => {
  const { a, b } = await pair();
  a.edit("second");
  expect((await a.client.now()).kind).toBe("done");
  expect(a.get().sync?.lastSyncedRevision).toBe(2);
  await b.client.now();
  expect(b.get().state.conversations).toHaveLength(2);
  expect((await b.client.now()).kind).toBe("none");
  expect(b.get().sync?.lastSyncedRevision).toBe(2);
});
it('legacy Cloudflare HTTP request budgets remain unchanged', async () => {
  const { a, b, fetcher } = await pair();
  const spy = vi.fn(fetcher), api = new SyncApi('https://sync.example.com', spy);
  const local = b.get();
  const client = new SyncClient(api, { read: async () => structuredClone(local), transaction: async fn => {
    const change = await fn(structuredClone(local));
    if (change.sync) local.sync = change.sync;
    if (change.state) local.state = change.state;
  } });
  await client.now(); expect(spy.mock.calls.map(c => c[1]?.method)).toEqual(['GET']);
  spy.mockClear(); b.edit('local-only'); await client.now();
  expect(spy.mock.calls.map(c => c[1]?.method)).toEqual(['GET', 'PUT']);
  await a.client.now(); a.edit('remote-only'); await a.client.now(); spy.mockClear();
  await client.now(); expect(spy.mock.calls.map(c => c[1]?.method)).toEqual(['GET', 'GET']);
});
it("both changed produce conflict; Use remote backs up local edits", async () => {
  const { a, b } = await pair();
  a.edit("remote");
  await a.client.now();
  b.edit("local");
  const conflict = (await b.client.now()) as Preview;
  expect(conflict.kind).toBe("conflict");
  expect(b.get().state.conversations.some((c) => c.id === "local")).toBe(true);
  await b.client.resolve(conflict, "remote");
  expect(b.backups.at(-1)?.conversations.some((c) => c.id === "local")).toBe(
    true,
  );
  expect(b.get().state.conversations.some((c) => c.id === "local")).toBe(false);
});
it("explicit Use this device overwrites with latest checked revision", async () => {
  const { a, b, api } = await pair();
  a.edit("remote");
  await a.client.now();
  b.edit("local");
  const p = (await b.client.now()) as Preview;
  await b.client.resolve(p, "local");
  expect((await api.get(b.get().sync!)).revision).toBe(3);
  await a.client.now();
  expect(a.get().state.conversations.some((c) => c.id === "local")).toBe(true);
});
it("local change makes preview stale", async () => {
  const { a, b } = setup();
  await a.client.enable();
  const p = await b.client.connect(syncCode(a.get().sync!));
  b.edit("new");
  await expect(b.client.resolve(p, "remote")).rejects.toThrow("stale");
  expect(b.backups).toHaveLength(0);
  expect(b.get().sync).toBeNull();
});
it("remote change makes preview stale", async () => {
  const { a, b } = setup();
  await a.client.enable();
  const p = await b.client.connect(syncCode(a.get().sync!));
  a.edit("new");
  await a.client.now();
  await expect(b.client.resolve(p, "remote")).rejects.toThrow("stale");
  expect(b.backups).toHaveLength(0);
});
it("failed decrypt and failed schema validation never modify local workspace", async () => {
  const { a, b, api } = await pair();
  const original = structuredClone(b.get());
  await api.put(
    a.get().sync!,
    1,
    await encrypt(
      {
        ...a.get().sync!,
        encryptionKey: credentials("https://sync.example.com").encryptionKey,
      },
      {},
    ),
  );
  await expect(b.client.now()).rejects.toThrow();
  expect(b.get()).toEqual(original);
  await api.put(
    a.get().sync!,
    2,
    await encrypt(a.get().sync!, { version: 999 }),
  );
  await expect(b.client.now()).rejects.toThrow();
  expect(b.get()).toEqual(original);
});
it("backup failure prevents remote apply and baseline update", async () => {
  const { a, b } = await pair();
  a.edit("remote");
  await a.client.now();
  b.fail();
  const before = structuredClone(b.get());
  await expect(b.client.now()).rejects.toThrow("Backup");
  expect(b.get()).toEqual(before);
});
it("Disconnect removes credentials only", async () => {
  const { a } = await pair(),
    state = structuredClone(a.get().state);
  await a.client.disconnect();
  expect(a.get().sync).toBeNull();
  expect(a.get().state).toEqual(state);
});
it("Export both returns plaintext payloads without credentials and does not apply", async () => {
  const { a, b } = await pair();
  a.edit("remote");
  await a.client.now();
  b.edit("local");
  const p = (await b.client.now()) as Preview,
    before = structuredClone(b.get());
  const both = await b.client.exportBoth(p);
  expect(both.local.workspace.chats.some((c) => c.id === "local")).toBe(true);
  expect(both.remote.workspace.chats.some((c) => c.id === "remote")).toBe(true);
  expect(JSON.stringify(both)).not.toContain(a.get().sync!.encryptionKey);
  expect(b.get()).toEqual(before);
});
