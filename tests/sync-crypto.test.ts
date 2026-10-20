import { expect, it, vi } from "vitest";
import {
  credentials,
  encrypt,
  decrypt,
  syncCode,
  parseCode,
  hash,
} from "../src/sync/crypto";
import { payload, parsePayload, applyPayload } from "../src/sync/payload";
import { defaults, addConversation } from "../src/models/state";
import { direction } from "../src/sync/conflict";
import { manifestFor } from "../scripts/manifest";
import { originUrl } from "../src/sync/types";
const origin = "https://sync.example.com";
it("AES-GCM roundtrip and different random IV for every snapshot", async () => {
  const c = credentials(origin),
    p = { title: "Alias" },
    a = await encrypt(c, p),
    b = await encrypt(c, p);
  expect(await decrypt(c, a)).toEqual(p);
  expect(a.iv).not.toBe(b.iv);
  expect(a.ciphertext).not.toBe(b.ciphertext);
});
it("wrong key and modified ciphertext fail authentication", async () => {
  const c = credentials(origin),
    e = await encrypt(c, {});
  await expect(
    decrypt({ ...c, encryptionKey: credentials(origin).encryptionKey }, e),
  ).rejects.toThrow("decrypt");
  await expect(
    decrypt(c, {
      ...e,
      ciphertext: (e.ciphertext[0] === "a" ? "b" : "a") + e.ciphertext.slice(1),
    }),
  ).rejects.toThrow("decrypt");
});
it("AAD binds workspace identity", async () => {
  const c = credentials(origin);
  await expect(
    decrypt({ ...c, syncId: credentials(origin).syncId }, await encrypt(c, {})),
  ).rejects.toThrow();
});
it("Sync Code roundtrip; invalid format and different server rejected", () => {
  const c = credentials(origin);
  expect(parseCode(syncCode(c), origin)).toEqual(c);
  expect(() => parseCode("bad", origin)).toThrow();
  expect(() => parseCode(syncCode(c), "https://other.example")).toThrow();
});
it("canonical hash ignores object key ordering", async () =>
  expect(await hash({ b: 2, a: { d: 4, c: 3 } })).toBe(
    await hash({ a: { c: 3, d: 4 }, b: 2 }),
  ));
it("no crypto secret logging", async () => {
  const log = vi.spyOn(console, "log"),
    warn = vi.spyOn(console, "warn"),
    error = vi.spyOn(console, "error");
  const c = credentials(origin);
  await decrypt(c, await encrypt(c, { private: "metadata" }));
  expect(log).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
it("payload excludes device state, runtime, credentials and conversation content", () => {
  const s = addConversation(
    defaults(),
    "Alias",
    "https://chatgpt.com/c/one",
    null,
  ).state;
  Object.assign(s.conversations[0], { content: "secret-body" });
  Object.assign(s, { credentials: "secret-key", windowBounds: { left: 999 } });
  s.settings.lastLocation = "inbox";
  s.settings.rememberBounds = false;
  const p = payload(s);
  expect(JSON.stringify(p)).not.toMatch(
    /secret|lastLocation|rememberBounds|windowBounds|lastOpenedAt/,
  );
  expect(parsePayload(p)).toEqual(p);
});
it("payload hashing ignores list insertion order", async () => {
  const s = addConversation(
    addConversation(defaults(), "B", "https://chatgpt.com/c/b", null).state,
    "A",
    "https://chatgpt.com/c/a",
    null,
  ).state;
  const a = payload(s);
  s.conversations.reverse();
  expect(await hash(payload(s))).toBe(await hash(a));
});
it("remote snapshot replaces metadata but preserves local window settings", () => {
  const s = addConversation(
    defaults(),
    "Local",
    "https://chatgpt.com/c/local",
    null,
  ).state;
  s.settings.alwaysCentered = true;
  const result = applyPayload(s, payload(defaults()));
  expect(result.conversations).toHaveLength(0);
  expect(result.settings.alwaysCentered).toBe(true);
});
it("payload rejects extra fields and invalid schema", () => {
  expect(() =>
    parsePayload({ ...payload(defaults()), credentials: {} }),
  ).toThrow();
  expect(() =>
    parsePayload({ ...payload(defaults()), preferences: {} }),
  ).toThrow();
});
it.each([
  ["a", "a", 1, 1, "none"],
  ["b", "a", 1, 1, "push"],
  ["a", "a", 2, 1, "pull"],
  ["b", "a", 2, 1, "conflict"],
] as const)("change classification %s %s %i %i", (a, b, c, d, result) =>
  expect(direction(a, b, c, d)).toBe(result),
);
it.each(["chromium", "firefox"] as const)(
  "%s grants only configured server origin",
  (target) => {
    const m = manifestFor(target, origin);
    expect(m.host_permissions).toContain(origin + "/*");
    expect(m.host_permissions).not.toContain("https://*/*");
    expect(manifestFor(target).host_permissions).not.toContain(origin + "/*");
  },
);

it("deleted startup folder is normalized without changing local device settings", () => {
  const s = defaults();
  s.settings.startup = "folder";
  s.settings.startupFolderId = "deleted";
  expect(payload(s).preferences.startup).toBe("home");
  expect(payload(s).preferences.startupFolderId).toBeNull();
  expect(s.settings.startupFolderId).toBe("deleted");
});
it("invalid local workspace is rejected before it can be uploaded", () => {
  const s = defaults();
  s.folders.push({ id: "broken", name: "Broken", parentId: "missing", pinned: false, createdAt: 1 });
  expect(() => payload(s)).toThrow();
});

it.each([
  "https://example.com",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
  "http://[::1]:8787",
])("sync origin permits HTTPS or exact loopback: %s", (value) => {
  expect(originUrl(value, true)).toBe(value);
  for (const target of ["chromium", "firefox"] as const)
    expect(manifestFor(target, originUrl(value, true)).host_permissions).toContain(`${value}/*`);
});
it.each([
  "http://example.com", "http://localhost.example.com:8787",
  "http://192.168.0.1:8787", "https://example.com/path",
  "https://user:pass@example.com", "https://example.com?key=secret",
])("sync origin rejects unsafe or non-origin input: %s", (value) => {
  expect(() => originUrl(value, true)).toThrow();
});
