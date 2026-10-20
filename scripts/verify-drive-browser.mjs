// Synthetic Google endpoints and identity callback; NOT a real Google account test.
// Build with VITE_GOOGLE_CLIENT_ID_CHROMIUM configured first. Identity is mocked.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
import { chromium } from 'playwright';
await fs.mkdir(path.join(root, '.verification'), { recursive: true });
const contexts = [], errors = [];
let document = null, generation = 0;
const metadata = () => ({ id: 'synthetic-file', title: 'chat-explorer-sync-v1.json', appDataContents: true,
  etag: `"${generation}"`, version: String(generation), properties: [{ key: 'application', value: 'chat-explorer-sync-v1', visibility: 'PRIVATE' }] });
async function device() {
  const requests = [];
  const profile = await fs.mkdtemp(path.join(root, '.verification/drive-profile-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    args: [`--disable-extensions-except=${root}/dist/chromium`, `--load-extension=${root}/dist/chromium`] });
  contexts.push(context);
  await context.route('https://oauth2.googleapis.com/token', route => {
    errors.push('Unexpected Chromium direct token exchange'); return route.abort();
  });
  await context.route('https://www.googleapis.com/**', async route => {
    const request = route.request(), url = new URL(request.url());
    requests.push({ method: request.method(), list: url.searchParams.has('spaces'), media: url.searchParams.get('alt') === 'media' });
    if (url.pathname.includes('/upload/')) {
      if (request.method() === 'POST') {
        const boundary = request.headers()['content-type'].split('boundary=')[1];
        document = JSON.parse(request.postData().split(`--${boundary}`)[2].split('\r\n\r\n')[1].trim()); generation = 1;
      } else {
        if (request.headers()['if-match'] !== metadata().etag) return route.fulfill({ status: 412, body: '' });
        document = JSON.parse(request.postData()); generation++;
      }
      return route.fulfill({ json: { ...metadata(), etag: '"upload-response-etag"' } });
    }
    if (url.searchParams.has('spaces')) return route.fulfill({ json: { items: document ? [{ id: 'synthetic-file' }] : [] } });
    if (url.searchParams.get('alt') === 'media' && request.headers()['if-match'])
      return route.fulfill({ status: 412, body: '' });
    return route.fulfill({ json: url.searchParams.get('alt') === 'media' ? document : metadata() });
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const page = context.pages()[0]; page.on('pageerror', e => errors.push(e.message));
  await page.goto(worker.url().replace('background.js', 'explorer.html'));
  await page.evaluate(() => {
    chrome.identity.getAuthToken = async ({ scopes }) => {
      if (scopes.join(',') !== 'https://www.googleapis.com/auth/drive.appdata') throw Error('Unexpected scope');
      return { token: 'synthetic-access', grantedScopes: scopes };
    };
    chrome.identity.clearAllCachedAuthTokens = async () => {};
    chrome.identity.launchWebAuthFlow = async () => { throw Error('Chromium must not use web auth flow'); };
  });
  const read = () => worker.evaluate(() => chrome.storage.local.get(['explorerState', 'explorerSync', 'workspaceBackup', 'explorerGoogleToken']));
  const settings = () => page.getByRole('button', { name: 'Settings', exact: true }).click();
  async function folder(name) {
    await page.getByRole('button', { name: 'New Folder', exact: true }).click();
    await page.getByLabel('Display name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  async function sync() {
    const before = (await read()).explorerSync.lastSyncedAt;
    await page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await waitFor(async () => (await read()).explorerSync?.lastSyncedAt > before);
    await waitFor(() => page.getByRole('button', { name: 'Sync now', exact: true }).isEnabled());
  }
  return { page, read, settings, folder, requests, sync };
}
async function waitFor(test) {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await test()) return; await new Promise(r => setTimeout(r, 50)); }
  throw Error('Synthetic Drive state did not settle');
}
try {
  const a = await device(), b = await device();
  await a.folder('Synthetic private folder'); await a.settings();
  await a.page.getByRole('button', { name: 'Connect Google Drive', exact: true }).click();
  await a.page.getByText('Connected', { exact: true }).waitFor();
  await a.page.getByRole('button', { name: 'Sync now', exact: true }).waitFor();
  assert.ok(!(await a.page.getByRole('status').allTextContents()).some(x => x.includes('Run Sync now again')));
  assert.equal(generation, 1); assert.ok(!JSON.stringify(document).includes('Synthetic private folder'));
  assert.equal(await a.page.getByLabel('Sync Key', { exact: true }).count(), 0);
  await a.page.getByRole('button', { name: 'Show Sync Key', exact: true }).click();
  const key = await a.page.getByLabel('Sync Key', { exact: true }).inputValue();
  await b.settings(); await b.page.getByRole('button', { name: 'Connect Google Drive', exact: true }).click();
  await b.page.getByLabel('Sync Key', { exact: true }).fill(key);
  await b.page.getByRole('button', { name: 'Connect Existing', exact: true }).click();
  await b.page.getByRole('button', { name: 'Apply', exact: true }).waitFor();
  assert.equal((await b.read()).explorerSync, undefined);
  await b.page.getByRole('button', { name: 'Apply', exact: true }).click();
  await waitFor(async () => (await b.read()).explorerSync?.lastSyncedRevision === 1);
  assert.equal((await b.read()).explorerState.folders[0].name, 'Synthetic private folder');
  assert.ok((await b.read()).workspaceBackup);
  const budgets = {};
  a.requests.length = 0; await a.sync();
  assert.equal(a.requests.length, 1); assert.ok(a.requests.every(r => !r.list && !r.media && r.method === 'GET'));
  budgets.unchanged = a.requests.length;
  const settled = a.requests.length;
  // Showing/hiding a key rerenders Settings but must never start another sync.
  await a.page.getByRole('button', { name: 'Show Sync Key', exact: true }).click();
  await a.page.getByRole('button', { name: 'Show Sync Key', exact: true }).click();
  await a.page.waitForTimeout(150); assert.equal(a.requests.length, settled);
  await a.page.evaluate(async () => {
    const { explorerState: state } = await chrome.storage.local.get('explorerState');
    state.folders[0].name = 'Synthetic updated folder';
    await chrome.storage.local.set({ explorerState: state });
  });
  a.requests.length = 0; await a.sync();
  assert.equal(a.requests.length, 3); assert.equal(a.requests.filter(r => r.method === 'PUT').length, 1);
  assert.ok(a.requests.every(r => !r.list && !r.media)); budgets.local = a.requests.length;
  b.requests.length = 0; await b.sync();
  assert.equal(b.requests.length, 4); assert.equal(b.requests.filter(r => r.media).length, 1);
  assert.ok(b.requests.every(r => !r.list && r.method === 'GET')); budgets.remote = b.requests.length;
  assert.equal((await b.read()).explorerState.folders[0].name, 'Synthetic updated folder');
  await b.page.getByRole('button', { name: 'Disconnect Google Drive', exact: true }).click();
  await waitFor(async () => !(await b.read()).explorerSync && !(await b.read()).explorerGoogleToken);
  assert.equal((await b.read()).explorerState.folders.length, 1);
  assert.equal(generation, 2); assert.deepEqual(errors, []);
  console.log('Synthetic browser Drive HTTP counts:', JSON.stringify(budgets));
  console.log('PASS synthetic Drive UI: Chrome identity adapter, no direct token POST, encrypted creation, hidden Sync Key, second-profile preview/backup/Apply, Disconnect preserves metadata/remote. No real Google account used.');
} finally { for (const c of contexts.reverse()) await c.close(); }
