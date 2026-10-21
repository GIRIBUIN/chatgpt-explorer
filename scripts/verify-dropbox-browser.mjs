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
  const requests = []; let challenge = null, accountId = 'dbid:synthetic-main', nextAccountId = null;
  const authModes = [];
  await context.route('https://api.dropboxapi.com/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith('/oauth2/token')) {
      const p = new URLSearchParams(request.postData()); assert.ok(!p.has('client_secret'));
      if (p.get('grant_type') === 'authorization_code') {
        assert.equal(createHash('sha256').update(p.get('code_verifier')).digest('base64url'), challenge);
        return route.fulfill({ json: { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh',
          expires_in: 14400, token_type: 'bearer', scope: scopes.join(' '), account_id: accountId } });
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
  await page.exposeFunction('recordChallenge', (value, forced) => {
    challenge = value; authModes.push(forced);
    if (forced && nextAccountId) { accountId = nextAccountId; nextAccountId = null; }
  });
  await page.evaluate(() => {
    chrome.identity.getAuthToken = () => { throw Error('Dropbox must not use native Google tokens'); };
    chrome.identity.launchWebAuthFlow = async ({ url, interactive }) => {
      if (!interactive) throw Error('Unexpected background OAuth prompt');
      const u = new URL(url);
      if (u.origin !== 'https://www.dropbox.com' || u.searchParams.get('token_access_type') !== 'offline' ||
          u.searchParams.get('code_challenge_method') !== 'S256' || u.searchParams.get('response_type') !== 'code' ||
          u.searchParams.get('scope') !== 'files.metadata.read files.content.read files.content.write') throw Error('Invalid OAuth');
      await window.recordChallenge(u.searchParams.get('code_challenge'), u.searchParams.get('force_reauthentication') === 'true');
      return `${u.searchParams.get('redirect_uri')}?code=synthetic-code&state=${u.searchParams.get('state')}`;
    };
  });
  const read = () => worker.evaluate(() => chrome.storage.local.get(['explorerState', 'explorerSync', 'explorerDropboxToken', 'workspaceBackup', 'explorerAutoSync', 'explorerDropboxSyncKey', 'explorerDropboxAccount']));
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
  return { page, worker, read, settings, sync, edit, requests, redirect, authModes, chooseAccount: id => { nextAccountId = id; } };
}
// Actual rendered Settings assertions for independent OAuth/workspace states.
async function providerUi(d, state, recoveryAvailable = false) {
  const button = name => d.page.getByRole('button', { name, exact: true });
  if (state === 'unauthorized') {
    await button('Connect Dropbox').waitFor();
    await button('Connect another account').waitFor();
    assert.equal(await button('Disconnect Dropbox').count(), 0);
    assert.equal(await button('Change account').count(), 0);
    assert.equal(await button('Sync now').count(), 0);
    return;
  }
  await waitFor(() => button('Disconnect Dropbox').isEnabled());
  assert.equal(await button('Connect Dropbox').count(), 0);
  assert.equal(await button('Connect another account').count(), 0);
  await button('Change account').waitFor();
  if (state === 'connected') {
    await d.page.getByText('Connected', { exact: true }).waitFor();
    await button('Sync now').waitFor();
    await button('Copy Sync Key').waitFor();
    assert.equal(await d.page.getByRole('heading', { name: 'Existing synced workspace found', exact: true }).count(), 0);
    return;
  }
  await d.page.getByText('Authorized · Workspace not connected.', { exact: true }).waitFor();
  assert.equal(await button('Sync now').count(), 0);
  assert.equal(await d.page.getByRole('heading', { name: 'Existing synced workspace found', exact: true }).count(), 1);
  assert.ok(!(await d.page.locator('dialog').innerText()).includes('Remote data found.'));
  await d.page.getByPlaceholder('Paste Sync Key', { exact: true }).waitFor();
  assert.ok((await button('Connect existing workspace').getAttribute('class')).includes('primary'));
  assert.equal(await button('Reset sync using this device…').isEnabled(), recoveryAvailable);
  if (state === 'wrong-key')
    await d.page.getByText('This Sync Key cannot decrypt the Dropbox workspace.', { exact: false }).waitFor();
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
  await providerUi(a, 'unauthorized');
  await a.page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  await a.page.getByText('Connected', { exact: true }).waitFor();
  await providerUi(a, 'connected');
  assert.equal((await a.read()).explorerSync.provider, 'dropbox'); assert.equal(generation, 1);
  assert.equal((await a.read()).explorerDropboxToken.refreshToken, 'synthetic-refresh');
  assert.ok(!JSON.stringify(document).includes('Synthetic private folder'));
  await a.page.setViewportSize({ width: 500, height: 850 });
  await a.page.screenshot({ path: '.verification/settings-sync-500.png' });
  await a.page.setViewportSize({ width: 900, height: 850 });
  assert.equal(await a.page.getByLabel('Sync Key', { exact: true }).getAttribute('type'), 'password');
  assert.ok(!(await a.page.locator('dialog').innerText()).includes('dbid:'));
  await a.page.evaluate(() => { navigator.clipboard.writeText = async value => { window.copiedSyncKey = value; }; });
  await a.page.getByRole('button', { name: 'Copy Sync Key', exact: true }).click();
  assert.equal(await a.page.evaluate(() => window.copiedSyncKey), (await a.read()).explorerDropboxSyncKey);
  assert.equal(await a.page.getByLabel('Sync Key', { exact: true }).getAttribute('type'), 'password');
  await a.page.getByRole('button', { name: 'Show Sync Key', exact: true }).click();
  const key = await a.page.getByLabel('Sync Key', { exact: true }).inputValue();
  assert.ok(!JSON.stringify(document).includes(key));
  await b.settings(); await b.page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  await b.page.getByRole('heading', { name: 'Existing synced workspace found', exact: true }).waitFor();
  await providerUi(b, 'key-required', false);
  const initialAuthCount = b.authModes.length;
  await b.page.locator('.data-settings').getByRole('button', { name: 'Cancel', exact: true }).click();
  await b.page.getByRole('button', { name: 'Continue workspace connection', exact: true }).waitFor();
  assert.equal(await b.page.getByRole('button', { name: 'Connect Dropbox', exact: true }).count(), 0);
  await b.page.getByRole('button', { name: 'Continue workspace connection', exact: true }).click();
  await providerUi(b, 'key-required', false);
  assert.equal(b.authModes.length, initialAuthCount);
  assert.ok(!(await b.read()).explorerDropboxSyncKey);
  await b.page.getByText('No saved Sync Key was found in this browser profile.', { exact: false }).waitFor();
  assert.equal(await b.page.getByLabel('Sync Key', { exact: true }).inputValue(), '');
  assert.ok(!(await b.page.locator('dialog').innerText()).includes('dbid:'));
  assert.equal(await b.page.getByRole('button', { name: 'Reset sync using this device…', exact: true }).isDisabled(), true);
  await b.page.getByLabel('Sync Key', { exact: true }).fill(key);
  await b.page.getByRole('button', { name: 'Connect existing workspace', exact: true }).click();
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
  await equal.page.getByRole('button', { name: 'Connect existing workspace', exact: true }).click();
  await waitFor(async () => !!(await equal.read()).explorerSync);
  assert.equal(await equal.page.getByRole('heading', { name: 'Sync conflict', exact: true }).count(), 0);
  // A legacy key survives invalid-baseline cleanup instead of disappearing with it.
  const legacyKeyDevice = await device(), legacyData = await a.read();
  await legacyKeyDevice.page.evaluate(async data => {
    const broken = { ...data.explorerSync, lastSyncedAt: null };
    await chrome.storage.local.set({ explorerState: data.explorerState, explorerSync: broken });
    await chrome.storage.local.remove('explorerDropboxSyncKey');
  }, legacyData);
  await legacyKeyDevice.settings();
  await legacyKeyDevice.page.getByRole('button', { name: 'Show saved Sync Key', exact: true }).click();
  assert.equal(await legacyKeyDevice.page.getByLabel('Saved Sync Key on this device', { exact: true }).inputValue(), key);
  await legacyKeyDevice.page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await providerUi(legacyKeyDevice, 'unauthorized');
  assert.equal((await legacyKeyDevice.read()).explorerDropboxSyncKey, key);
  await legacyKeyDevice.page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  await providerUi(legacyKeyDevice, 'connected');
  assert.equal((await legacyKeyDevice.read()).explorerSync.encryptionKey, legacyData.explorerSync.encryptionKey);
  // Nonempty divergent first-connect uses the existing explicit conflict choices.
  const different = await device();
  await different.page.getByRole('button', { name: 'New Folder', exact: true }).click();
  await different.page.getByLabel('Display name', { exact: true }).fill('Different local');
  await different.page.getByRole('button', { name: 'Save', exact: true }).click(); await different.settings();
  await different.page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  await different.page.getByLabel('Sync Key', { exact: true }).fill(key);
  await different.page.getByRole('button', { name: 'Connect existing workspace', exact: true }).click();
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
  // Both devices disconnect: the key remains available locally without OAuth.
  await a.page.getByRole('button', { name: 'Disconnect Dropbox', exact: true }).click();
  await waitFor(async () => !(await a.read()).explorerSync && !(await a.read()).explorerDropboxToken);
  await a.page.getByRole('button', { name: 'Show saved Sync Key', exact: true }).waitFor();
  assert.equal(await a.page.getByLabel('Saved Sync Key on this device', { exact: true }).getAttribute('type'), 'password');
  await a.page.getByRole('button', { name: 'Copy saved Sync Key', exact: true }).click();
  assert.equal(await a.page.evaluate(() => window.copiedSyncKey), key);
  await b.page.getByRole('button', { name: 'Disconnect Dropbox', exact: true }).click();
  await waitFor(async () => !(await b.read()).explorerSync && !(await b.read()).explorerDropboxToken);
  assert.equal((await b.read()).explorerState.folders[0].name, 'Conflict A'); assert.ok(document);
  assert.equal((await b.read()).explorerDropboxSyncKey, key);
  assert.ok(!(await a.read()).explorerSync);
  await b.page.getByRole('button', { name: 'Show saved Sync Key', exact: true }).click();
  assert.equal(await b.page.getByLabel('Saved Sync Key on this device', { exact: true }).inputValue(), key);
  await a.page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  await providerUi(a, 'connected');
  assert.equal(await a.page.getByPlaceholder('Paste Sync Key', { exact: true }).count(), 0);
  await b.page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  await b.page.getByText('Connected', { exact: true }).waitFor();
  assert.equal(await b.page.getByLabel('Sync Key', { exact: true }).getAttribute('type'), 'password');
  await b.page.getByRole('button', { name: 'Show Sync Key', exact: true }).click();
  assert.equal(await b.page.getByLabel('Sync Key', { exact: true }).inputValue(), key);
  assert.equal(b.authModes.at(-1), false);
  await b.page.getByRole('button', { name: 'Hide Sync Key', exact: true }).click();
  // Another encrypted account must not inherit the old remote baseline or be overwritten.
  const mainDocument = structuredClone(document), mainGeneration = generation;
  document = null; generation = 0;
  const otherAccount = await device(); await otherAccount.settings();
  await otherAccount.page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  await otherAccount.page.getByText('Connected', { exact: true }).waitFor();
  await otherAccount.page.getByRole('button', { name: 'Show Sync Key', exact: true }).click();
  const otherKey = await otherAccount.page.getByLabel('Sync Key', { exact: true }).inputValue();
  assert.notEqual(otherKey, key);
  const otherDocument = structuredClone(document);
  b.chooseAccount('dbid:synthetic-other'); b.requests.length = 0;
  await b.page.getByRole('button', { name: 'Change account', exact: true }).click();
  await b.page.getByText('This Sync Key cannot decrypt the Dropbox workspace.', { exact: false }).waitFor();
  await providerUi(b, 'wrong-key', true);
  await b.page.getByRole('button', { name: 'Show saved Sync Key', exact: true }).click();
  assert.equal(await b.page.getByLabel('Saved Sync Key on this device', { exact: true }).inputValue(), key);
  await b.page.getByText('This saved key did not decrypt the current Dropbox workspace.', { exact: false }).waitFor();
  await b.page.getByRole('button', { name: 'Hide saved Sync Key', exact: true }).click();
  assert.equal(b.authModes.at(-1), true);
  assert.equal((await b.read()).explorerDropboxAccount, 'dbid:synthetic-other');
  assert.ok(!(await b.read()).explorerSync);
  assert.equal((await b.read()).explorerDropboxSyncKey, key);
  assert.equal(b.requests.includes('upload'), false); assert.deepEqual(document, otherDocument);
  await b.page.getByLabel('Sync Key', { exact: true }).fill(otherKey);
  await b.page.getByRole('button', { name: 'Connect existing workspace', exact: true }).click();
  await b.page.getByRole('heading', { name: 'Sync conflict', exact: true }).waitFor();
  assert.equal((await b.read()).explorerDropboxSyncKey, key);
  await b.page.getByRole('button', { name: 'Use remote', exact: true }).click();
  await waitFor(async () => (await b.read()).explorerDropboxSyncKey === otherKey);
  await b.page.getByRole('button', { name: 'Show Sync Key', exact: true }).waitFor();
  document = mainDocument; generation = mainGeneration;
  // A fresh installation discovers the old root, validates its key, and copies
  // only encrypted bytes into the dedicated path without deleting the root.
  legacyDocument = structuredClone(document); legacyGeneration = 7; document = null;
  const migrated = await device(); await migrated.settings();
  await migrated.page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  assert.equal(document, null);
  await migrated.page.getByLabel('Sync Key', { exact: true }).fill(key);
  await migrated.page.getByRole('button', { name: 'Connect existing workspace', exact: true }).click();
  await migrated.page.getByRole('button', { name: 'Apply', exact: true }).click();
  await waitFor(async () => !!(await migrated.read()).explorerSync);
  assert.equal(document.iv, legacyDocument.iv); assert.equal(document.ciphertext, legacyDocument.ciphertext);
  assert.ok((await migrated.read()).workspaceBackup);
  assert.ok((await migrated.read()).explorerSync.lastSyncedRemoteVersion.includes(remotePath.toLowerCase()));
  migrated.requests.length = 0; await migrated.sync(); assert.deepEqual(migrated.requests, ['metadata']);
  // A lost key can only reset from a nonempty local workspace after explicit review.
  const recovery = await device();
  await recovery.page.getByRole('button', { name: 'New Folder', exact: true }).click();
  await recovery.page.getByLabel('Display name', { exact: true }).fill('Recovered local workspace');
  await recovery.page.getByRole('button', { name: 'Save', exact: true }).click(); await recovery.settings();
  await recovery.page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  await recovery.page.getByRole('heading', { name: 'Existing synced workspace found', exact: true }).waitFor();
  await providerUi(recovery, 'key-required', true);
  assert.ok(!(await recovery.read()).explorerDropboxSyncKey);
  const beforeReset = structuredClone(document), beforeGeneration = generation;
  await recovery.page.getByRole('button', { name: 'Reset sync using this device…', exact: true }).click();
  const resetSection = recovery.page.getByRole('region', { name: 'Confirm sync reset', exact: true });
  assert.equal(await resetSection.getByRole('button', { name: 'Replace encrypted sync data', exact: true }).isDisabled(), true);
  await resetSection.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(document, beforeReset); assert.equal(generation, beforeGeneration);
  assert.ok(!(await recovery.read()).explorerDropboxSyncKey);
  await recovery.page.getByRole('button', { name: 'Reset sync using this device…', exact: true }).click();
  await resetSection.getByRole('checkbox').check();
  await resetSection.getByRole('button', { name: 'Replace encrypted sync data', exact: true }).click();
  await recovery.page.getByText('Connected', { exact: true }).waitFor();
  const recovered = await recovery.read();
  assert.ok(recovered.workspaceBackup);
  assert.equal(recovered.workspaceBackup.state.folders[0].name, 'Recovered local workspace');
  assert.ok(recovered.explorerDropboxSyncKey); assert.notEqual(recovered.explorerDropboxSyncKey, key);
  assert.equal(generation, beforeGeneration + 1);
  assert.equal(await recovery.page.getByLabel('Sync Key', { exact: true }).getAttribute('type'), 'password');
  await recovery.page.getByRole('button', { name: 'Copy Sync Key', exact: true }).waitFor();
  assert.ok(!(await recovery.page.locator('dialog').innerText()).includes('dbid:'));
  // Previously connected devices must be able to enter the replacement key on Reconnect.
  const resetDocument = structuredClone(document); a.requests.length = 0;
  await a.page.getByRole('button', { name: 'Reconnect Dropbox', exact: true }).click();
  await a.page.getByRole('heading', { name: 'Existing synced workspace found', exact: true }).waitFor();
  assert.equal(a.requests.includes('upload'), false);
  assert.equal((await a.read()).explorerDropboxSyncKey, key);
  await a.page.getByLabel('Sync Key', { exact: true }).fill(recovered.explorerDropboxSyncKey);
  await a.page.getByRole('button', { name: 'Connect existing workspace', exact: true }).click();
  await a.page.getByRole('heading', { name: 'Sync conflict', exact: true }).waitFor();
  await a.page.getByRole('button', { name: 'Use remote', exact: true }).click();
  await waitFor(async () => (await a.read()).explorerDropboxSyncKey === recovered.explorerDropboxSyncKey);
  assert.deepEqual(document, resetDocument);
  // A partial connection can disconnect without applying a workspace or losing a key.
  const pending = await device(); await pending.settings();
  await pending.page.getByRole('button', { name: 'Connect Dropbox', exact: true }).click();
  await providerUi(pending, 'key-required', false);
  await pending.page.getByRole('button', { name: 'Disconnect Dropbox', exact: true }).click();
  await providerUi(pending, 'unauthorized');
  assert.ok(!(await pending.read()).explorerDropboxToken);
  assert.equal(await pending.page.getByPlaceholder('Paste Sync Key', { exact: true }).count(), 0);
  assert.deepEqual(document, resetDocument);
  assert.deepEqual(errors, []);
  console.log('PASS synthetic Dropbox: Full access disclosure, dedicated path, validated legacy migration, code+PKCE/offline, encrypted create, key/preview/backup, two-profile push/pull, silent refresh, conflict, Disconnect/revoke + retained key/reconnect, forced account change + mismatch no-write/confirmed key replacement, provider UI states unauthorized/connected/key-required/wrong-key/recovery available+unavailable, masked Show/Copy + saved key access even after both devices disconnect or during mismatch + hidden account IDs, lost-key reset confirmation/cancellation/backup; HTTP budgets 1/2/3. No live Dropbox account used.');
  console.log('Measured Chromium-engine redirect:', a.redirect);
} finally { for (const c of contexts.reverse()) await c.close(); }
