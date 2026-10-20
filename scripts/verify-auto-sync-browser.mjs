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
  throw Error(`Expected persisted revision ${revision} and ${folders} folders; UI: ${(await device.page.getByRole('status').allTextContents()).join(' / ')}`);
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

async function waitUntil(test) {
  const deadline=Date.now()+20000;
  while(Date.now()<deadline){if(await test())return;await new Promise(r=>setTimeout(r,50));}
  throw Error('Automatic sync state timeout');
}
async function autoState(d){return d.worker.evaluate(async()=> (await chrome.storage.local.get('explorerAutoSync')).explorerAutoSync);}
async function idle(d){
  await waitUntil(async()=> (await autoState(d))?.dirty);
  await d.worker.evaluate(async()=>{
    const {explorerAutoSync:a}=await chrome.storage.local.get('explorerAutoSync');
    a.lastChangedAt=Date.now()-300001;a.scheduledAt=Date.now();
    await chrome.storage.local.set({explorerAutoSync:a});
    await chrome.alarms.create('explorer-sync-idle',{when:Date.now()+100});
  });
}
try {
 const a=await device(), b=await device();
 await a.folder('Initial');await a.settings();await a.page.getByRole('button',{name:'Enable Sync',exact:true}).click();
 await a.page.getByText('Connected',{exact:true}).waitFor();
 await a.page.getByRole('button',{name:'Show sync code',exact:true}).click();
 const code=await a.page.getByLabel('Sync Code',{exact:true}).inputValue();
 await b.settings();await b.page.getByRole('button',{name:'Connect Existing',exact:true}).click();await b.page.getByLabel('Sync Code',{exact:true}).fill(code);
 await b.page.getByRole('button',{name:'Connect Existing',exact:true}).last().click();await b.page.getByRole('button',{name:'Apply',exact:true}).click();await persisted(b,1,1);
 await a.page.getByRole('button',{name:'Close',exact:true}).click();await a.folder('Automatic A');
 assert.equal((await a.read()).explorerState.folders.length,2);
 await waitUntil(async()=> (await autoState(a))?.dirty);
 const alarm=await a.worker.evaluate(()=>chrome.alarms.get('explorer-sync-idle'));
 assert(alarm.scheduledTime>Date.now()+290000);
 await idle(a);await persisted(a,2,2);await waitUntil(async()=> !(await autoState(a)).dirty);
 // A real new Explorer document triggers startup pull, not focus.
 await b.page.reload();await persisted(b,2,2);assert.equal((await b.read()).workspaceBackup.state.folders.length,1);
 await b.folder('Automatic B');await idle(b);await persisted(b,3,3);
 await a.page.reload();await persisted(a,3,3);
 await a.folder('Local A conflict');await b.folder('Local B conflict');await idle(a);await persisted(a,4,4);await idle(b);
 await waitUntil(async()=> (await autoState(b))?.conflict);
 assert((await b.read()).explorerState.folders.some(f=>f.name==='Local B conflict'));
 await b.settings();await b.page.getByRole('heading',{name:'Sync conflict',exact:true}).waitFor();
 await b.page.getByRole('button',{name:'Use remote',exact:true}).click();await persisted(b,4,4);
 assert((await b.read()).workspaceBackup.state.folders.some(f=>f.name==='Local B conflict'));
 await b.page.getByLabel('Automatic sync',{exact:true}).selectOption('off');
 await waitUntil(async()=> !(await autoState(b)).enabled);
 await b.page.getByRole('button',{name:'Close',exact:true}).click();await b.folder('Manual with auto off');
 await waitUntil(async()=> (await autoState(b)).dirty);
 assert.equal(await b.worker.evaluate(()=>chrome.alarms.get('explorer-sync-idle')),undefined);
 await b.page.reload();await b.settings();assert.equal((await b.read()).explorerSync.lastSyncedRevision,4);
 await b.page.getByRole('button',{name:'Sync now',exact:true}).click();await persisted(b,5,5);
 await waitUntil(async()=> !(await autoState(b)).dirty);
 assert.deepEqual(errors,[]);
 console.log('PASS: Edge two devices, real alarms with simulated five-minute deadline; A/B auto push and startup pull, backup, conflict UI/no overwrite, OFF cancels alarm/startup and manual Sync Now still works.');
}finally{for(const c of contexts)await c.close();backend.db.close();}
