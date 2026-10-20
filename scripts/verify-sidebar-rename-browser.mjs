// Isolated extension UI with synthetic folders/chats; no account data or tmp files.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
await fs.mkdir('.verification', { recursive: true });
const profile = await fs.mkdtemp(path.join(root, '.verification/sidebar-rename-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}),
  args: [`--disable-extensions-except=${root}/dist/chromium`, `--load-extension=${root}/dist/chromium`],
});
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const page = context.pages()[0], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(worker.url().replace('background.js', 'explorer.html'));
  await page.getByRole('button', { name: 'New Folder', exact: true }).click();
  await page.getByLabel('Display name', { exact: true }).fill('Seed');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.evaluate(async () => {
    const { explorerState: s } = await chrome.storage.local.get('explorerState');
    s.folders = [
      { id: 'parent', name: 'Projects', parentId: null, pinned: true, color: '#123456', createdAt: 1 },
      { id: 'child', name: 'Nested', parentId: 'parent', pinned: true, color: '#3b82f6', createdAt: 1 },
      { id: 'leaf', name: 'Leaf', parentId: 'child', pinned: false, createdAt: 1 },
      { id: 'other', name: 'Other', parentId: null, pinned: false, createdAt: 1 },
    ];
    s.conversations = [{ id: 'chat', title: 'Alias', originalTitle: 'Original', url: 'https://chatgpt.com/c/chat',
      folderId: 'child', color: '#ef4444', favorite: true, projectId: null, projectName: null, createdAt: 1, lastOpenedAt: null }];
    s.settings.lastLocation = 'folder:child'; s.settings.colorFilter = '#ef4444';
    await chrome.storage.local.set({ explorerState: s });
  });
  await page.reload();
  await page.getByRole('heading', { name: 'Nested', exact: true }).waitFor();
  const read = () => page.evaluate(async () => (await chrome.storage.local.get('explorerState')).explorerState);
  const tree = id => page.locator(`[data-sidebar-folder-id="${id}"]`);
  const name = id => tree(id).locator('button.tree-name');
  const input = page.getByRole('textbox', { name: 'Rename', exact: true });
  const start = async id => {
    await name(id).focus(); await page.keyboard.press('F2'); await input.waitFor();
    assert.equal(await page.locator('.inline-rename').count(), 1);
    assert.equal(await tree(id).locator('.inline-rename').count(), 1);
    assert.equal(await tree(id).getAttribute('draggable'), 'false');
    assert.ok(await tree(id).locator('.folder-pin-button').isDisabled());
    assert.equal(await input.evaluate(el => el.closest('button')), null);
    assert.equal(await input.evaluate(el => el.selectionEnd - el.selectionStart), (await input.inputValue()).length);
  };
  const committed = async (id, value) => {
    await input.fill(value); await input.press('Enter'); await input.waitFor({ state: 'hidden' });
    await page.waitForFunction(({ id, value }) => document.querySelector(`[data-sidebar-folder-id="${id}"] button.tree-name`)?.textContent === value, { id, value });
  };
  const original = await read();
  await name('child').click(); await start('child');
  await input.click();
  const pinBounds = await tree('child').locator('.folder-pin-button').boundingBox();
  await page.mouse.click(pinBounds.x + pinBounds.width / 2, pinBounds.y + pinBounds.height / 2);
  assert.equal(await input.count(), 1);
  assert.ok(await input.evaluate(el => el === document.activeElement));
  assert.equal((await read()).folders[1].pinned, true);
  await tree('child').locator('.folder-icon').click();
  assert.equal(await input.count(), 1);
  assert.ok(await input.evaluate(el => el === document.activeElement));
  await page.screenshot({ path: '.verification/sidebar-inline-rename.png' });
  await page.getByRole('heading', { name: 'Nested', exact: true }).waitFor();
  await committed('child', 'Nested updated');
  await page.getByRole('heading', { name: 'Nested updated', exact: true }).waitFor();
  assert.equal(await page.locator('.breadcrumb').getByRole('button', { name: 'Nested updated', exact: true }).count(), 1);
  assert.equal((await read()).settings.lastLocation, 'folder:child');
  await start('parent');
  await page.getByRole('heading', { name: 'Nested updated', exact: true }).waitFor();
  await committed('parent', 'Projects updated');
  assert.equal(await page.locator('.breadcrumb').getByRole('button', { name: 'Projects updated', exact: true }).count(), 1);
  assert.equal((await read()).settings.colorFilter, '#ef4444');
  assert.equal((await read()).settings.lastLocation, 'folder:child');
  const changed = await read();
  assert.deepEqual(changed.folders[0], { ...original.folders[0], name: 'Projects updated' });
  assert.deepEqual(changed.folders[1], { ...original.folders[1], name: 'Nested updated' });
  assert.deepEqual(changed.folders.slice(2), original.folders.slice(2));
  assert.deepEqual(changed.conversations, original.conversations);

  await start('child'); await input.fill('Cancelled'); await input.press('Escape');
  await input.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.matches('[data-sidebar-folder-id="child"] button.tree-name'));
  await page.keyboard.press('F2'); await input.waitFor();
  await input.fill('   '); await input.press('Enter'); await input.waitFor({ state: 'hidden' });
  assert.equal((await read()).folders[1].name, 'Nested updated');
  // Sidebar context-menu Rename stays in place and uses the same inline component.
  await tree('parent').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename F2', exact: true }).click();
  await input.waitFor(); assert.equal(await tree('parent').locator('.inline-rename').count(), 1);
  await input.fill('Context name'); await input.press('Enter'); await input.waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: 'Nested updated', exact: true }).waitFor();

  // Blur saves, while clicking another folder keeps the new navigation/focus.
  await start('child'); await input.fill('Blur child'); await name('other').click();
  await input.waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: 'Other', exact: true }).waitFor();
  assert.equal((await read()).folders[1].name, 'Blur child');
  assert.ok(await name('other').evaluate(el => el === document.activeElement));
  await name('child').click();
  const chat = page.locator('.item-row').filter({ hasText: 'Alias' });
  await chat.click();
  for (const system of ['Home', 'Favorites', 'Inbox']) {
    const control = page.locator('aside').getByRole('button', { name: system === 'Inbox' ? /Inbox/ : system, exact: system !== 'Inbox' });
    await control.focus(); await page.keyboard.press('F2'); assert.equal(await input.count(), 0);
    assert.equal(await page.locator('.item-row.selected').count(), 1);
  }
  await page.locator('.side-heading').evaluate(el => { el.tabIndex = -1; el.focus(); });
  await page.keyboard.press('F2'); assert.equal(await input.count(), 0);
  await page.locator('.side-heading').evaluate(el => el.removeAttribute('tabindex'));
  const search = page.getByRole('searchbox', { name: 'Search', exact: true });
  await search.focus(); await page.keyboard.press('F2'); assert.equal(await input.count(), 0);
  for (const type of ['textarea', 'contenteditable']) {
    await page.evaluate(type => {
      const el = document.createElement(type === 'textarea' ? 'textarea' : 'div');
      el.id = 'editing-context'; if (type === 'contenteditable') el.contentEditable = 'true';
      document.querySelector('.app').append(el); el.focus();
    }, type);
    await page.keyboard.press('F2'); assert.equal(await input.count(), 0);
    await page.locator('#editing-context').evaluate(el => el.remove());
  }
  // Main folder/chat F2 still uses the original shared commit path, with one input.
  await name('parent').click();
  const folder = page.locator('.item-row').filter({ hasText: 'Blur child' });
  await folder.click(); await page.keyboard.press('F2'); await input.waitFor();
  assert.equal(await page.locator('aside .inline-rename').count(), 0);
  assert.equal(await page.locator('.item-row .inline-rename').count(), 1);
  await input.fill('Main child'); await input.press('Enter'); await input.waitFor({ state: 'hidden' });
  await name('child').click(); await chat.click(); await page.keyboard.press('F2');
  await input.fill('Main chat'); await input.press('Enter'); await input.waitFor({ state: 'hidden' });
  await page.reload(); await page.getByRole('heading', { name: 'Main child', exact: true }).waitFor();
  assert.equal(await name('parent').innerText(), 'Context name');
  assert.equal(await name('child').innerText(), 'Main child');
  assert.equal((await read()).folders[1].color, '#3b82f6');
  assert.equal((await read()).folders[1].pinned, true);
  assert.deepEqual(errors, []);
  console.log('PASS synthetic Edge sidebar F2: root/nested/current folder, one focused selected input, Enter/Escape/blank/blur, breadcrumb/title, no navigation/filter reset, pin/drag guards, focus restoration, system/text-input exclusions, shared main rename and persistence.');
} finally { await context.close(); }
