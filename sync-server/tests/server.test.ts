import { expect, it, afterEach } from "vitest";
import { server } from "./harness";
import { credentials, encrypt } from "../../src/sync/crypto";
import { SyncApi } from "../../src/sync/api";
const opened: ReturnType<typeof server>[] = [];
function setup() {
  const s = server();
  opened.push(s);
  const c = credentials("https://sync.example.com");
  return { ...s, c, api: new SyncApi(c.origin, s.fetcher) };
}
afterEach(() => {
  for (const s of opened) s.db.close();
  opened.length = 0;
});
it("creates and authenticates GET; database contains only ciphertext and token hash", async () => {
  const { api, c, db } = setup();
  const blob = await encrypt(c, { title: "private-title" });
  expect((await api.create(c, blob)).revision).toBe(1);
  expect((await api.get(c)).encryptedBlob).toEqual(blob);
  const row = db.prepare("select * from sync_workspaces").get();
  expect(JSON.stringify(row)).not.toContain("private-title");
  expect(JSON.stringify(row)).not.toContain(c.authToken);
  expect(JSON.stringify(row)).not.toContain(c.encryptionKey);
  expect(row?.auth_hash).toMatch(/^[a-f0-9]{64}$/);
});
it("invalid auth and unknown ID give the same response", async () => {
  const { api, c } = setup();
  await api.create(c, await encrypt(c, {}));
  await expect(
    api.get({ ...c, authToken: "x".repeat(43) }),
  ).rejects.toMatchObject({ status: 401 });
  await expect(api.get({ ...c, syncId: "x".repeat(43) })).rejects.toMatchObject(
    { status: 401 },
  );
});
it("PUT increments revision and rejects stale optimistic write", async () => {
  const { api, c } = setup();
  const blob = await encrypt(c, {});
  await api.create(c, blob);
  expect((await api.put(c, 1, blob)).revision).toBe(2);
  await expect(api.put(c, 1, blob)).rejects.toMatchObject({ status: 409 });
  expect((await api.get(c)).revision).toBe(2);
});
it("concurrent writes with the same revision have only one winner", async () => {
  const { api, c } = setup(),
    blob = await encrypt(c, {});
  await api.create(c, blob);
  const results = await Promise.allSettled([
    api.put(c, 1, blob),
    api.put(c, 1, blob),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await api.get(c)).revision).toBe(2);
});
it("rejects malformed JSON and invalid revision", async () => {
  const { api, c, fetcher } = setup();
  await api.create(c, await encrypt(c, {}));
  const res = await fetcher(c.origin + "/v1/sync", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.authToken}`,
      "Content-Type": "application/json",
    },
    body: "{",
  });
  expect(res.status).toBe(400);
  await expect(api.put(c, -1, await encrypt(c, {}))).rejects.toMatchObject({
    status: 400,
  });
});
it("rejects oversized blob and limits streamed request body", async () => {
  const { c, fetcher } = setup();
  const request = (ciphertext: string) =>
    fetcher(c.origin + "/v1/sync", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        syncId: c.syncId,
        encryptedBlob: { version: 1, iv: "a".repeat(16), ciphertext },
      }),
    });
  expect((await request("x".repeat(1000001))).status).toBe(400);
  expect((await request("x".repeat(1010001))).status).toBe(413);
});
it("rejects arbitrary web origins and allows extension preflight without credentials", async () => {
  const { fetcher, c } = setup();
  expect(
    (
      await fetcher(c.origin + "/v1/sync", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" },
      })
    ).status,
  ).toBe(403);
  const r = await fetcher(c.origin + "/v1/sync", {
    method: "OPTIONS",
    headers: { Origin: "moz-extension://abc-123" },
  });
  expect(r.status).toBe(204);
  expect(r.headers.get("Access-Control-Allow-Origin")).toBe(
    "moz-extension://abc-123",
  );
});
it("rate limiter rejects abuse", async () => {
  const { c, fetcher, env } = setup();
  env.RATE_LIMITER.limit = async () => ({ success: false });
  expect((await fetcher(c.origin + "/v1/sync")).status).toBe(429);
});
