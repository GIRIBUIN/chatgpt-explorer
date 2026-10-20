// Two isolated Chromium extension profiles; real Worker handler + local SQLite,
// routed HTTPS requests (not a Cloudflare deployment and not a ChatGPT account).
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { server } from "../sync-server/tests/harness.ts";
const root = process.cwd(),
  backend = server();
// With SYNC_TEST_ORIGIN, use an actual running Wrangler Worker/D1 instead of routing.
const liveOrigin = process.env.SYNC_TEST_ORIGIN;
import { chromium } from 'playwright';
await fs.mkdir(path.join(root, '.verification'), { recursive: true });
const contexts = [],
  errors = [];
async function persisted(device, revision, folders) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const saved = await device.read();
    if (saved.explorerSync?.lastSyncedRevision === revision && saved.explorerState?.folders.length === folders) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error(`Expected persisted revision ${revision} and ${folders} folders`);
}
async function device() {
  const profile = await fs.mkdtemp(
    path.join(root, ".verification/sync-profile-"),
  );
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
    args: [
      `--disable-extensions-except=${root}/dist/chromium`,
      `--load-extension=${root}/dist/chromium`,
    ],
  });
  contexts.push(context);
  if (!liveOrigin) await context.route("https://sync.example.com/**", async (route) => {
    const req = route.request();
    const response = await backend.fetcher(req.url(), {
      method: req.method(),
      headers: req.headers(),
      body: req.postData() ?? undefined,
    });
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const page = context.pages()[0];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(worker.url().replace("background.js", "explorer.html"));
  const settings = () =>
    page.getByRole("button", { name: "Settings", exact: true }).click();
  const read = () =>
    worker.evaluate(
      async () =>
        await chrome.storage.local.get([
          "explorerState",
          "explorerSync",
          "workspaceBackup",
        ]),
    );
  async function folder(name) {
    await page.getByRole("button", { name: "New Folder", exact: true }).click();
    await page.getByLabel("Display name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  }
  return { page, worker, settings, read, folder };
}
try {
  const a = await device(),
    b = await device();
  await a.folder("A first");
  await a.settings();
  await a.page
    .getByRole("button", { name: "Enable Sync", exact: true })
    .click();
  await a.page.getByText("Connected", { exact: true }).waitFor({timeout:20000}).catch(async error=>{console.error("Enable status:",await a.page.getByRole("status").allTextContents());throw error;});
  assert.equal((await a.read()).explorerSync.lastSyncedRevision, 1);
  assert.equal(
    await a.page.getByLabel("Sync Code", { exact: true }).count(),
    0,
  );
  await a.page
    .getByRole("button", { name: "Show sync code", exact: true })
    .click();
  const code = await a.page
    .getByLabel("Sync Code", { exact: true })
    .inputValue();
  await b.settings();
  await b.page
    .getByRole("button", { name: "Connect Existing", exact: true })
    .click();
  await b.page.getByLabel("Sync Code", { exact: true }).fill(code);
  await b.page
    .getByRole("button", { name: "Connect Existing", exact: true })
    .last()
    .click();
  await b.page
    .getByRole("heading", { name: "Remote sync data found", exact: true })
    .waitFor();
  assert.equal((await b.read()).explorerSync, undefined);
  await b.page.getByRole("button", { name: "Apply", exact: true }).click();
  await b.page.getByText("Connected", { exact: true }).waitFor();
  assert.equal((await b.read()).explorerState.folders[0].name, "A first");
  assert((await b.read()).workspaceBackup);
  await a.page.getByRole("button", { name: "Close", exact: true }).click();
  await a.folder("A second");
  await a.settings();
  await a.page.getByRole("button", { name: "Sync now", exact: true }).click();
  await a.page.getByText("Sync completed.", { exact: true }).waitFor();
  assert.equal((await a.read()).explorerSync.lastSyncedRevision, 2);
  assert.equal((await a.read()).explorerState.folders.length, 2, "A saved two folders before B pull");
  if (liveOrigin) {
    const c = (await a.read()).explorerSync;
    const r = await (await fetch(`${liveOrigin}/v1/sync/${c.syncId}`, { headers: { Authorization: `Bearer ${c.authToken}` } })).json();
    const key = await crypto.subtle.importKey("raw", Buffer.from(c.encryptionKey, "base64url"), "AES-GCM", false, ["decrypt"]);
    const decoded = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(r.encryptedBlob.iv, "base64url"), additionalData: new TextEncoder().encode(`chat-explorer-sync:1:${c.syncId}`) }, key, Buffer.from(r.encryptedBlob.ciphertext, "base64url"))));
    assert.equal(decoded.workspace.folders.length, 2, "Worker persisted both folders");
  }
  await b.page.getByRole("button", { name: "Sync now", exact: true }).click();
  await b.page.getByText("Connected", { exact: true }).waitFor();
  await persisted(b, 2, 2);
  await a.page.getByRole("button", { name: "Close", exact: true }).click();
  await a.folder("A conflict");
  await a.settings();
  await a.page.getByRole("button", { name: "Sync now", exact: true }).click();
  await a.page.getByText("Sync completed.", { exact: true }).waitFor();
  await b.page.getByRole("button", { name: "Close", exact: true }).click();
  await b.folder("B conflict");
  await b.settings();
  await b.page.getByRole("button", { name: "Sync now", exact: true }).click();
  await b.page
    .getByRole("heading", { name: "Sync conflict", exact: true })
    .waitFor();
  await b.page
    .getByRole("button", { name: "Cancel", exact: true })
    .last()
    .click();
  assert(
    (await b.read()).explorerState.folders.some((f) => f.name === "B conflict"),
  );
  await b.page.getByRole("button", { name: "Sync now", exact: true }).click();
  await b.page
    .getByRole("heading", { name: "Sync conflict", exact: true })
    .waitFor();
  await b.page.getByRole("button", { name: "Use remote", exact: true }).click();
  await persisted(b, 3, 3);
  assert(
    !(await b.read()).explorerState.folders.some(
      (f) => f.name === "B conflict",
    ),
  );
  assert(
    (await b.read()).workspaceBackup.state.folders.some(
      (f) => f.name === "B conflict",
    ),
  );
  const before = (await b.read()).explorerState;
  await b.page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await b.page
    .getByRole("button", { name: "Enable Sync", exact: true })
    .waitFor();
  assert.equal((await b.read()).explorerSync, undefined);
  assert.deepEqual((await b.read()).explorerState, before);
  if (!liveOrigin) {
  const row = backend.db.prepare("select * from sync_workspaces").get();
  assert(!JSON.stringify(row).includes("A first"));
  assert(
    !JSON.stringify(row).includes((await a.read()).explorerSync.encryptionKey),
  );
  }
  assert.deepEqual(errors, []);
  console.log(
    `PASS (${liveOrigin ? "live Worker/D1" : "routed Worker/SQLite"}): two isolated Edge devices Enable/Connect preview/Apply, revision 1→2 push/pull, conflict cancel/remote backup, hidden code, Disconnect metadata preserved.`,
  );
} finally {
  for (const c of contexts) await c.close();
  backend.db.close();
}

