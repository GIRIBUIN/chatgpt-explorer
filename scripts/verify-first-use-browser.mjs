// Isolated, synthetic extension checks. No account, private API, or live ChatGPT DOM.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
await fs.mkdir('.verification', { recursive: true });
const profile = await fs.mkdtemp(path.join(root, '.verification/first-use-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  args: [`--disable-extensions-except=${root}/dist/chromium`, `--load-extension=${root}/dist/chromium`],
});
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const pending = context.waitForEvent('page');
  await worker.evaluate(() => chrome.windows.create({ type: 'popup', url: chrome.runtime.getURL('explorer.html'), width: 1000, height: 750 }));
  const page = await pending, errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let html = '<!doctype html><title>ChatGPT</title><main>Loading</main>';
  await context.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: html }));
  const onboarding = page.getByRole('region', { name: 'No conversations yet', exact: true });
  const dialog = page.getByRole('dialog');
  const toolbar = page.locator('.commandbar');
  const read = () => worker.evaluate(async () => (await chrome.storage.local.get('explorerState')).explorerState);
  const chats = () => worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://chatgpt.com/*' })).filter(t => t.url?.startsWith('https://chatgpt.com/')));
  const start = () => toolbar.getByRole('button', { name: 'Import Chats', exact: true }).click();
  const cancel = async () => { await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); };
  const ready = '<!doctype html><title>Current chat - ChatGPT</title><nav data-app-action-sidebar-scroll style="height:160px;overflow:auto"><a data-interactive-row-link="true" href="/c/ready">Ready chat</a></nav><main>Chat</main>';

  // First-use Import goes through the real session and recovery path.
  await onboarding.waitFor();
  await page.screenshot({ path: '.verification/first-use-onboarding.png' });
  assert.equal(await onboarding.getByRole('button').count(), 2);
  await onboarding.getByRole('button', { name: 'Import Chats', exact: true }).click();
  await dialog.getByText(/ChatGPT is not open/).waitFor();
  assert.equal((await chats()).length, 0);
  const openedChat = context.waitForEvent('page');
  await dialog.getByRole('button', { name: 'Open ChatGPT', exact: true }).click();
  const chat = await openedChat;
  await chat.waitForURL('https://chatgpt.com/');
  assert.equal((await chats()).length, 1);
  await chat.waitForLoadState();
  assert.equal(await page.getByRole('status').count(), 0, 'Open must not auto-import');
  await dialog.getByRole('button', { name: 'Open ChatGPT', exact: true }).click();
  assert.equal((await chats()).length, 1, 'Open reuses the existing normal tab');
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await dialog.getByText(/sign in if needed/).waitFor();
  assert(!(await dialog.innerText()).includes('signed out'));
  await cancel();

  // A known sidebar that is not usable gets a readiness message, without guessing auth.
  html = '<!doctype html><title>ChatGPT</title><nav hidden data-app-action-sidebar-scroll></nav>';
  await chat.reload();
  await start();
  await dialog.getByText(/conversation list is not ready/).waitFor();
  html = ready;
  await chat.goto('https://chatgpt.com/c/ready');
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Imported 1 chats.' }).waitFor({ timeout: 20000 });
  await onboarding.waitFor({ state: 'hidden' });
  assert.equal((await read()).conversations.length, 1);
  assert.equal((await chats()).length, 1);

  // Reset only this synthetic workspace, then exercise the other onboarding action.
  const reset = async () => {
    await worker.evaluate(async () => {
      const { explorerState: s } = await chrome.storage.local.get('explorerState');
      s.folders = []; s.conversations = []; s.settings.lastLocation = 'home'; s.settings.collapsed = [];
      await chrome.storage.local.set({ explorerState: s });
    });
    await page.reload();
    await onboarding.waitFor();
  };
  await reset();
  await onboarding.getByRole('button', { name: 'Add Current Chat', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Conversation added.' }).waitFor();
  await onboarding.waitFor({ state: 'hidden' });
  assert.equal((await read()).conversations[0].id, 'ready');

  // Partial scan retains successes, counts existing chats, and offers a safe retry.
  html = ready.replace('</nav>', '<a data-interactive-row-link="true" href="/c/partial">Partial chat</a><div style="height:900px"></div></nav><script>const nav=document.querySelector("nav");nav.addEventListener("scroll",()=>{if(nav.scrollTop>0)nav.remove();});</script>');
  await chat.goto('https://chatgpt.com/c/partial');
  await start();
  await dialog.getByText(/Imported 1 chats\. Skipped 1 existing chats\./).waitFor({ timeout: 20000 });
  await page.screenshot({ path: '.verification/first-use-recovery.png' });
  assert((await dialog.innerText()).includes('Source pages not fully read: 1'));
  assert(!(await dialog.innerText()).includes('selector'));
  assert.equal((await read()).conversations.length, 2);
  await cancel();

  // New Folder regressions use the actual toolbar/editor, persisted state and both panes.
  await reset();
  async function create(name, parentId) {
    const before = (await read())?.folders ?? [];
    await toolbar.getByRole('button', { name: 'New Folder', exact: true }).click();
    await dialog.getByLabel('Display name', { exact: true }).fill(name);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const state = await read();
    const folder = state.folders.find(f => f.name === name);
    assert.equal(folder.parentId, parentId);
    assert.deepEqual(state.folders.filter(f => f.id !== folder.id), before, 'Existing folder metadata is preserved');
    await page.locator(`[data-sidebar-folder-id="${folder.id}"]`).waitFor();
    const row = page.locator('.item-row').filter({ hasText: name });
    await row.waitFor();
    assert.equal(await row.getAttribute('aria-selected'), 'true');
    return folder;
  }
  const rootFolder = await create('Development', null);
  await onboarding.waitFor({ state: 'hidden' });
  await page.locator('.item-row').filter({ hasText: 'Development' }).dblclick();
  const child = await create('AI', rootFolder.id);
  await page.locator('.item-row').filter({ hasText: /^AI/ }).dblclick();
  await create('Models', child.id);
  await page.locator('aside').getByRole('button', { name: 'Favorites', exact: true }).click();
  await create('From Favorites', null);
  await page.locator('aside').getByRole('button', { name: /Inbox/ }).click();
  await create('From Inbox', null);
  await page.locator(`[data-sidebar-folder-id="${child.id}"] button.tree-name`).click();
  await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('no matching folder');
  await create('From Search', null);
  assert.equal(await page.getByRole('searchbox', { name: 'Search', exact: true }).inputValue(), '');
  // Whitespace is not a search view; nested creation still applies.
  await page.locator(`[data-sidebar-folder-id="${child.id}"] button.tree-name`).click();
  await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('   ');
  await create('Whitespace child', child.id);
  await page.locator(`[data-sidebar-folder-id="${rootFolder.id}"] .chevron`).click();
  await create('Collapsed ancestor child', child.id);
  // Sidebar context menu remains relative to its clicked folder, even from Favorites.
  await page.locator('aside').getByRole('button', { name: 'Favorites', exact: true }).click();
  await page.locator(`[data-sidebar-folder-id="${child.id}"]`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New Folder', exact: true }).click();
  await dialog.getByLabel('Display name', { exact: true }).fill('Context child');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await read()).folders.find(f => f.name === 'Context child').parentId, child.id);
  await page.locator('.item-row').filter({ hasText: 'Context child' }).waitFor();
  assert.equal(await onboarding.count(), 0, 'Meaningful folders must not be hidden');
  await page.screenshot({ path: '.verification/first-use-folders.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: onboarding actions/removal; missing/unready/unavailable ChatGPT, Open/reuse/no automatic import, retry/success, partial counts/retention; Home/nested/Favorites/Inbox/search/whitespace/context-menu folder creation and immediate visibility/selection.');
} finally {
  await context.close();
}
