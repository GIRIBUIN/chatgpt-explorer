// Two isolated Edge profiles + synthetic Dropbox endpoints. NOT live Dropbox OAuth.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = process.cwd();
import { chromium } from 'playwright';
await fs.mkdir(path.join(root, '.verification'), { recursive: true });
const contexts = [], errors = [], scopes = ['files.metadata.read', 'files.content.read', 'files.content.write'];
let document = null, generation = 0, legacyDocument = null, legacyGeneration = 0;
const remotePath = '/ChatGPT Chat Explorer/chat-explorer-sync.json';
const legacyPath = '/chat-explorer-sync.json';
const meta = (legacy = false) => ({ id: legacy ? 'id:legacy' : 'id:synthetic', rev: (legacy ? legacyGeneration : generation).toString(16).padStart(12, '0'),
  path_lower: legacy ? legacyPath : remotePath.toLowerCase(), size: Buffer.byteLength(JSON.stringify(legacy ? legacyDocument : document)) });
async function device() {
  const profile = await fs.mkdtemp(path.join(root, '.verification/dropbox-profile-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
    args: [`--disable-extensions-except=${root}/dist/chromium`, `--load-extension=${root}/dist/chromium`] });
  contexts.push(context);
  const requests = []; let challenge = null;
  await context.route('https://api.dropboxapi.com/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith('/oauth2/token')) {
      const p = new URLSearchParams(request.postData()); assert.ok(!p.has('client_secret'));
      if (p.get('grant_type') === 'authorization_code') {
        assert.equal(createHash('sha256').update(p.get('code_verifier')).digest('base64url'), challenge);
        return route.fulfill({ json: { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh',
          expires_in: 14400, token_type: 'bearer', scope: scopes.join(' ') } });
      }
      assert.equal(p.get('grant_type'), 'refresh_token'); assert.equal(p.get('refresh_token'), 'synthetic-refresh');
      requests.push('refresh'); return route.fulfill({ json: { access_token: 'synthetic-refreshed', expires_in: 14400, token_type: 'bearer' } });
    }
    if (url.pathname.endsWith('/revoke')) { requests.push('revoke'); return route.fulfill({ body: '' }); }
    assert.ok(url.pathname.endsWith('/get_metadata')); assert.ok([remotePath, legacyPath].includes(request.postDataJSON().path));
    requests.push('metadata');
    if (request.postDataJSON().path === legacyPath) return legacyDocument
      ? route.fulfill({ json: { '.tag': 'file', ...meta(true) } })
      : route.fulfill({ status: 409, json: { error: { '.tag': 'path', path: { '.tag': 'not_found' } } } });
    if (!document) return route.fulfill({ status: 409, json: { error: { '.tag': 'path', path: { '.tag': 'not_found' } } } });
    return route.fulfill({ json: { '.tag': 'file', ...meta() } });
  });
  await context.route('https://content.dropboxapi.com/**', async route => {
    const request = route.request(), args = JSON.parse(request.headers()['dropbox-api-arg']);
    if (request.url().endsWith('/download')) {
      assert.ok([remotePath.toLowerCase(), legacyPath].includes(args.path.toLowerCase()));
      const legacy = args.path === legacyPath;
      requests.push('download'); return route.fulfill({ json: legacy ? legacyDocument : document, headers: { 'Dropbox-API-Result': JSON.stringify(meta(legacy)) } });
    }
    assert.equal(args.path, remotePath);
    requests.push('upload'); assert.equal(args.autorename, false); assert.equal(args.strict_conflict, true);
    if (args.mode === 'add' ? !!document : !document || args.mode.update !== meta().rev)
      return route.fulfill({ status: 409, json: { error: { '.tag': 'path', path: { '.tag': 'conflict' } } } });
    document = request.postDataJSON(); generation++; return route.fulfill({ json: meta() });
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const page = context.pages()[0]; page.on('pageerror', e => errors.push(e.message));
  await page.goto(worker.url().replace('background.js', 'explorer.html'));
  const redirect = await page.evaluate(() => chrome.identity.getRedirectURL('dropbox'));
  await page.exposeFunction('recordChallenge', value => { challenge = value; });
  await page.evaluate(() => {
    chrome.identity.getAuthToken = () => { throw Error('Dropbox must not use native Google tokens'); };
    chrome.identity.launchWebAuthFlow = async ({ url, interactive }) => {
      if (!interactive) throw Error('Unexpected background OAuth prompt');
      const u = new URL(url);
      if (u.origin !== 'https://www.dropbox.com' || u.searchParams.get('token_access_type') !== 'offline' ||
          u.searchParams.get('code_challenge_method') !== 'S256' || u.searchParams.get('response_type') !== 'code' ||
          u.searchParams.get('scope') !== 'files.metadata.read files.content.read files.content.write') throw Error('Invalid OAuth');
      await window.recordChallenge(u.searchParams.get('code_challenge'));
      return `${u.searchParams.get('redirect_uri')}?code=synthetic-code&state=${u.searchParams.get('state')}`;
    };
  });
  const read = () => worker.evaluate(() => chrome.storage.local.get(['explorerState', 'explorerSync', 'explorerDropboxToken', 'workspaceBackup', 'explorerAutoSync']));
  const settings = () => page.getByRole('button', { name: 'Settings', exact: true }).click();
  const sync = async () => {
    const at = (await read()).explorerSync.lastSyncedAt;
    await page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await waitFor(async () => (await read()).explorerSync?.lastSyncedAt > at);
    await waitFor(() => page.getByRole('button', { name: 'Sync now', exact: true }).isEnabled());
  };
  const edit = async name => page.evaluate(async name => {
    const { explorerState } = await chrome.storage.local.get('explorerState');
    explorerState.folders[0].name = name; await chrome.storage.local.set({ explorerState });
  }, name);
  return { page, worker, read, settings, sync, edit, requests, redirect };
}
async function waitFor(test) {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await test()) return; await new Promise(r => setTimeout(r, 40)); }
  throw Error('Synthetic Dropbox state did not settle');
}
try {
  const a = await device(), b = await device();
  await a.page.getByRole('button', { name: 'New Folder', exact: true }).click();
  await a.page.getByLabel('Display name', { exact: true }).fill('Synthetic private folder');
  await a.page.getByRole('button', { name: 'Save', exact: true }).click(); await a.settings();
  assert.equal(await a.page.getByText('Reconnect Dropbox to continue syncing.', { exact: true }).count(), 0);
  assert.ok((await a.page.locator('dialog').innerText()).includes('Full Dropbox permission'));
  assert.ok(!(await a.page.locator('dialog').innerText()).includes('App Folder'));
  await a.page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  await a.page.getByText('Connected', { exact: true }).waitFor();
  assert.equal((await a.read()).explorerSync.provider, 'dropbox'); assert.equal(generation, 1);
  assert.equal((await a.read()).explorerDropboxToken.refreshToken, 'synthetic-refresh');
  assert.ok(!JSON.stringify(document).includes('Synthetic private folder'));
  await a.page.setViewportSize({ width: 500, height: 850 });
  await a.page.screenshot({ path: '.verification/settings-sync-500.png' });
  await a.page.setViewportSize({ width: 900, height: 850 });
  await a.page.getByRole('button', { name: 'Show Sync Key', exact: true }).click();
  const key = await a.page.getByLabel('Sync Key', { exact: true }).inputValue();
  assert.ok(!JSON.stringify(document).includes(key));
  await b.settings(); await b.page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  await b.page.getByLabel('Sync Key', { exact: true }).fill(key);
  await b.page.getByRole('button', { name: 'Connect Existing', exact: true }).click();
  await b.page.getByRole('button', { name: 'Apply', exact: true }).click();
  await waitFor(async () => !!(await b.read()).explorerSync);
  assert.ok((await b.read()).workspaceBackup);
  a.requests.length = 0; await a.sync(); assert.deepEqual(a.requests, ['metadata']);
  await a.page.getByRole('button', { name: 'Show Sync Key', exact: true }).click();
  const count = a.requests.length; await a.page.waitForTimeout(100); assert.equal(a.requests.length, count);
  await a.edit('Updated A'); a.requests.length = 0; await a.sync(); assert.deepEqual(a.requests, ['metadata', 'upload']);
  b.requests.length = 0; await b.sync(); assert.deepEqual(b.requests, ['metadata', 'download', 'metadata']);
  assert.equal((await b.read()).explorerState.folders[0].name, 'Updated A');
  await b.edit('Updated B'); await b.sync(); await a.sync();
  assert.equal((await a.read()).explorerState.folders[0].name, 'Updated B');
  // Pair another profile with identical data: equality must connect without conflict.
  const equal = await device();
  const identicalState = (await a.read()).explorerState;
  await equal.page.evaluate(state => chrome.storage.local.set({ explorerState: state }), identicalState);
  await equal.settings(); await equal.page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  await equal.page.getByLabel('Sync Key', { exact: true }).fill(key);
  await equal.page.getByRole('button', { name: 'Connect Existing', exact: true }).click();
  await waitFor(async () => !!(await equal.read()).explorerSync);
  assert.equal(await equal.page.getByRole('heading', { name: 'Sync conflict', exact: true }).count(), 0);
  // Nonempty divergent first-connect uses the existing explicit conflict choices.
  const different = await device();
  await different.page.getByRole('button', { name: 'New Folder', exact: true }).click();
  await different.page.getByLabel('Display name', { exact: true }).fill('Different local');
  await different.page.getByRole('button', { name: 'Save', exact: true }).click(); await different.settings();
  await different.page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  await different.page.getByLabel('Sync Key', { exact: true }).fill(key);
  await different.page.getByRole('button', { name: 'Connect Existing', exact: true }).click();
  await different.page.getByRole('heading', { name: 'Sync conflict', exact: true }).waitFor();
  assert.ok(!(await different.read()).explorerSync);
  const cancel = different.page.getByRole('region', { name: 'Sync preview', exact: true }).getByRole('button', { name: 'Cancel', exact: true });
  await cancel.click(); assert.equal((await different.read()).explorerState.folders[0].name, 'Different local');
  await a.page.evaluate(async () => {
    const data = await chrome.storage.local.get('explorerDropboxToken');
    await chrome.storage.local.set({ explorerDropboxToken: { ...data.explorerDropboxToken, expiresAt: 0 } });
  });
  a.requests.length = 0; await a.sync(); assert.deepEqual(a.requests, ['refresh', 'metadata']);
  await a.edit('Conflict A'); await b.edit('Conflict B'); await a.sync();
  await b.page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await b.page.getByRole('heading', { name: 'Sync conflict', exact: true }).waitFor();
  assert.equal((await b.read()).explorerState.folders[0].name, 'Conflict B');
  await b.page.getByRole('button', { name: 'Use remote', exact: true }).click();
  await waitFor(async () => (await b.read()).explorerState.folders[0].name === 'Conflict A');
  await b.page.getByRole('button', { name: 'Disconnect Dropbox', exact: true }).click();
  await waitFor(async () => !(await b.read()).explorerSync && !(await b.read()).explorerDropboxToken);
  assert.equal((await b.read()).explorerState.folders[0].name, 'Conflict A'); assert.ok(document);
  // A fresh installation discovers the old root, validates its key, and copies
  // only encrypted bytes into the dedicated path without deleting the root.
  legacyDocument = structuredClone(document); legacyGeneration = 7; document = null;
  const migrated = await device(); await migrated.settings();
  await migrated.page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  assert.equal(document, null);
  await migrated.page.getByLabel('Sync Key', { exact: true }).fill(key);
  await migrated.page.getByRole('button', { name: 'Connect Existing', exact: true }).click();
  await migrated.page.getByRole('button', { name: 'Apply', exact: true }).click();
  await waitFor(async () => !!(await migrated.read()).explorerSync);
  assert.equal(document.iv, legacyDocument.iv); assert.equal(document.ciphertext, legacyDocument.ciphertext);
  assert.ok((await migrated.read()).workspaceBackup);
  assert.ok((await migrated.read()).explorerSync.lastSyncedRemoteVersion.includes(remotePath.toLowerCase()));
  migrated.requests.length = 0; await migrated.sync(); assert.deepEqual(migrated.requests, ['metadata']);
  assert.deepEqual(errors, []);
  console.log('PASS synthetic Dropbox: Full access disclosure, dedicated path, validated legacy migration, code+PKCE/offline, encrypted create, key/preview/backup, two-profile push/pull, silent refresh, conflict, Disconnect/revoke; HTTP budgets 1/2/3. No live Dropbox account used.');
  console.log('Measured Chromium-engine redirect:', a.redirect);
} finally { for (const c of contexts.reverse()) await c.close(); }
