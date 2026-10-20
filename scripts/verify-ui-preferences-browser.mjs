// Synthetic extension UI only. No ChatGPT/Dropbox account or personal workspace.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
await fs.mkdir('.verification', { recursive: true });
const profile = await fs.mkdtemp(path.join(root, '.verification/ui-preferences-'));
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
  await page.getByRole('heading', { name: 'Home', exact: true }).waitFor();
  await page.getByRole('button', { name: 'New Folder', exact: true }).click();
  await page.getByLabel('Display name', { exact: true }).fill('Seed');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.evaluate(async () => {
    const { explorerState: s } = await chrome.storage.local.get('explorerState');
    s.folders = [{ id: 'parent', name: 'Parent', parentId: null, pinned: false, createdAt: 1 },
      { id: 'child', name: 'Nested color', parentId: 'parent', color: '#3b82f6', pinned: false, createdAt: 1 },
      { id: 'long', name: 'Long folder name '.repeat(12), parentId: null, pinned: false, createdAt: 1 },
      { id: 'z-root', name: 'Z root pin', parentId: null, pinned: true, createdAt: 1 },
      { id: 'earlier', name: 'Earlier child', parentId: 'parent', pinned: false, createdAt: 1 },
      { id: 'grandchild', name: 'Grandchild', parentId: 'child', pinned: false, createdAt: 1 },
      { id: 'mixed', name: 'Mixed demo', parentId: null, pinned: false, createdAt: 1 },
      { id: 'mixed-a', name: 'A unpinned', parentId: 'mixed', pinned: false, createdAt: 1 },
      { id: 'mixed-z', name: 'Z pinned', parentId: 'mixed', pinned: true, color: '#ef4444', createdAt: 1 },
      { id: 'chats-only', name: 'Chats only', parentId: null, pinned: false, createdAt: 1 }];
    s.conversations = [{ id: 'test-chat', title: 'Test chat', originalTitle: 'Test chat', url: 'https://chatgpt.com/c/test-chat', projectId: null, projectName: null, folderId: null, color: '#ffffff', favorite: false, createdAt: 1, lastOpenedAt: null }];
    for (const [id, title, folderId, color, projectId] of [
      ['mixed-chat-a', 'A chat', 'mixed', '#ef4444', 'g-p-' + 'a'.repeat(32)],
      ['mixed-chat-z', 'Z chat', 'mixed', '#ffffff', null],
      ['only-chat', 'Only chat', 'chats-only', '#ffffff', null],
      ['descendant-chat', 'Descendant chat', 'grandchild', '#ffffff', null],
    ]) s.conversations.push({ id, title, url: `https://chatgpt.com/c/${id}`, folderId, color, projectId,
      projectName: projectId ? 'Demo project' : null, favorite: false, createdAt: 1, lastOpenedAt: null });
    await chrome.storage.local.set({ explorerState: s });
  });
  await page.reload();
  const scale = async n => page.waitForFunction(n => Number(getComputedStyle(document.documentElement).zoom) === n / 100, n);
  const read = () => page.evaluate(async () => (await chrome.storage.local.get('explorerState')).explorerState);
  const expectNames = async expected => {
    await page.waitForFunction(expected => JSON.stringify(Array.from(document.querySelectorAll('.item-row .item-name > .truncate'), el => el.textContent)) === JSON.stringify(expected), expected);
    assert.deepEqual(await page.locator('.item-row .item-name > .truncate').allTextContents(), expected);
  };
  const navigate = name => page.locator('.tree-name').filter({ hasText: name }).click();
  await navigate('Chats only');
  await expectNames(['Only chat']);
  await navigate('Mixed demo');
  await expectNames(['Z pinned', 'A unpinned', 'A chat', 'Z chat']);
  const zFolder = page.locator('.item-row').filter({ hasText: 'Z pinned' });
  assert.equal(await zFolder.locator('.color-cell .dot').count(), 0);
  assert.equal(await zFolder.locator('.color-cell').innerText(), '');
  assert.equal(await zFolder.locator('.date-cell').innerText(), '—');
  assert.equal(await zFolder.locator('.row-actions .folder-pin-button').count(), 1);
  await page.getByRole('button', { name: 'Change sort direction', exact: true }).click();
  await expectNames(['Z pinned', 'A unpinned', 'Z chat', 'A chat']);
  await page.getByRole('button', { name: 'Change sort direction', exact: true }).click();
  // Filters apply only to chats; both direct child folders remain and participate in Select All.
  await page.getByLabel('Project filter', { exact: true }).selectOption('none');
  await page.getByLabel('Color filter', { exact: true }).selectOption('#ef4444');
  await expectNames(['Z pinned', 'A unpinned']);
  assert.equal(await page.locator('.file-list .empty').count(), 0);
  await page.getByLabel('Color filter', { exact: true }).selectOption('all');
  await page.getByLabel('Project filter', { exact: true }).selectOption('all');
  await expectNames(['Z pinned', 'A unpinned', 'A chat', 'Z chat']);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Control+a');
  assert.equal(await page.locator('.item-row.selected').count(), 4);
  await zFolder.click({ button: 'right' });
  assert.ok(await page.getByRole('menuitem', { name: 'Color...', exact: true }).isDisabled());
  await page.keyboard.press('Escape');
  await zFolder.focus();
  await page.keyboard.press('Control+a');
  assert.equal(await page.locator('.item-row.selected').count(), 4);
  await page.keyboard.press('Control+Shift+p');
  const command = page.getByRole('dialog', { name: 'Command Palette', exact: true });
  assert.ok(await command.getByRole('button', { name: 'Color...', exact: true }).isDisabled());
  await page.keyboard.press('Escape');
  await zFolder.click();
  assert.equal(await page.locator('.item-row.selected').count(), 1);
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Z pinned', exact: true }).waitFor();
  await expectNames([]);
  assert.equal(await page.locator('.file-list .empty').innerText(), 'No items');
  // Preserve the existing global search scope, including folder names.
  const query = page.getByRole('searchbox', { name: 'Search', exact: true });
  await query.fill('name:"A unpinned"');
  await expectNames(['A unpinned']);
  await query.fill('');
  await navigate('Parent');
  await expectNames(['Earlier child', 'Nested color']);
  assert.equal(await page.locator('.file-list .empty').count(), 0);
  const nestedRow = page.locator('.item-row').filter({ hasText: 'Nested color' });
  await nestedRow.dblclick();
  await page.getByRole('heading', { name: 'Nested color', exact: true }).waitFor();
  await expectNames(['Grandchild']);
  await page.locator('.item-row').click();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Grandchild', exact: true }).waitFor();
  await expectNames(['Descendant chat']);

  const tree = page.locator('.tree-name').filter({ hasText: 'Parent' });
  await tree.click();
  assert.equal(await page.locator('.tree-name').first().innerText(), 'Z root pin');
  assert.equal(await page.locator('.tree-row .favorite-button').count(), 0);
  const siblingNames = () => page.locator('.tree-name').allTextContents();
  const originalOrder = await siblingNames();
  assert.ok(originalOrder.indexOf('Earlier child') < originalOrder.indexOf('Nested color'));
  const child = page.locator('.tree-name').filter({ hasText: 'Nested color' });
  await child.click();
  assert.equal(await child.locator('svg').getAttribute('fill'), '#3b82f6');
  assert.ok(await child.locator('..').evaluate(el => el.classList.contains('active')));
  // Folder decoration shares HEX swatches but never chat label rules.
  const originalRules = (await read()).colorRules;
  await child.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Color...', exact: true }).click();
  const folderDialog = page.getByRole('dialog', { name: 'Folder color', exact: true });
  assert.ok(!/Color label|Color name|Shared by all chats/.test(await folderDialog.innerText()));
  await folderDialog.getByLabel('HEX', { exact: true }).fill('#123456');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal((await read()).folders.find(f => f.id === 'child').color, '#123456');
  assert.equal(await child.locator('svg').getAttribute('fill'), '#123456');

  assert.deepEqual((await read()).colorRules, originalRules);
  assert.equal(await tree.locator('svg').getAttribute('fill'), 'var(--folder-default-color)');
  // Nested pins share the same trailing edge and remain keyboard reachable.
  const childRow = child.locator('..');
  const star = childRow.getByRole('button', { name: 'Pin folder: Nested color', exact: true });
  await childRow.hover();
  assert.equal(await star.evaluate(el => getComputedStyle(el).opacity), '1');
  await star.click();
  const filled = childRow.getByRole('button', { name: 'Unpin folder: Nested color', exact: true });
  assert.equal(await filled.getAttribute('aria-pressed'), 'true');
  const pinOrder = await siblingNames();
  assert.ok(pinOrder.indexOf('Parent') < pinOrder.indexOf('Nested color'));
  assert.ok(pinOrder.indexOf('Nested color') < pinOrder.indexOf('Earlier child'));
  assert.equal(await filled.evaluate(el => getComputedStyle(el).color), await childRow.evaluate(el => getComputedStyle(el).color));
  assert.equal(await filled.locator('.tabler-icon-pin-filled').count(), 1);
  const a = await filled.boundingBox();
  const b = await tree.locator('..').locator('.folder-pin-button').boundingBox();
  assert.ok(Math.abs(a.x + a.width - b.x - b.width) < 1);
  await tree.click();
  const listRow = page.locator('.item-row').filter({ hasText: 'Nested color' });
  assert.equal(await listRow.locator('.item-name .folder-pin-button').count(), 0);
  assert.equal(await listRow.locator('.row-actions .folder-pin-button.is-pinned').count(), 1);
  await page.mouse.move(0, 0);
  await page.getByRole('heading', { name: 'Parent', exact: true }).click();
  const hidden = tree.locator('..').locator('.folder-pin-button');
  assert.equal(await hidden.evaluate(el => getComputedStyle(el).opacity), '0');
  await hidden.focus();
  assert.equal(await hidden.evaluate(el => getComputedStyle(el).opacity), '1');

  await page.getByRole('button', { name: /Inbox/ }).click();
  const chatRow = page.locator('.item-row').filter({ hasText: 'Test chat' });
  await chatRow.hover();
  await chatRow.getByRole('button', { name: 'Add to Favorites: Test chat', exact: true }).click();
  await chatRow.getByRole('button', { name: 'Remove from Favorites: Test chat', exact: true }).waitFor();
  assert.equal(await chatRow.locator('.row-actions .tabler-icon-star-filled').count(), 1);
  assert.equal(await chatRow.locator('.item-name .tabler-icon-star-filled').count(), 0);
  assert.equal(await chatRow.getAttribute('aria-selected'), 'false');
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  assert.equal(await page.locator('.item-row').count(), 1);
  assert.equal(await page.locator('.item-row .folder-pin-button').count(), 0);
  await page.getByRole('button', { name: /Inbox/ }).click();
  // Row hover remains neutral; selection wins, with stable trailing control slots.
  const appearance = row => row.evaluate(el => ({ background: getComputedStyle(el).backgroundColor,
    color: getComputedStyle(el).color, label: el.querySelector('.truncate').getBoundingClientRect().x,
    star: el.querySelector('.favorite-button, .folder-pin-button').getBoundingClientRect().x }));
  await page.getByRole('heading', { name: 'Inbox', exact: true }).click();
  const normal = await appearance(chatRow);
  await chatRow.hover();
  const hovered = await appearance(chatRow);
  assert.notEqual(hovered.background, normal.background);
  assert.equal(hovered.color, normal.color);
  assert.equal(hovered.label, normal.label); assert.equal(hovered.star, normal.star);
  await chatRow.locator('.truncate').click();
  const selectedHover = await appearance(chatRow);
  await page.getByRole('heading', { name: 'Inbox', exact: true }).hover();
  assert.deepEqual(await appearance(chatRow), selectedHover);
  assert.notEqual(selectedHover.background, hovered.background);
  const parentRow = tree.locator('..');
  const treeNormal = await appearance(parentRow);
  await parentRow.hover();
  const treeHover = await appearance(parentRow);
  assert.notEqual(treeHover.background, treeNormal.background);
  assert.equal(treeHover.color, treeNormal.color);
  assert.equal(treeHover.label, treeNormal.label); assert.equal(treeHover.star, treeNormal.star);
  await tree.click();
  const treeSelectedHover = await appearance(parentRow);
  await page.getByRole('heading', { name: 'Parent', exact: true }).hover();
  assert.deepEqual(await appearance(parentRow), treeSelectedHover);
  assert.notEqual(treeSelectedHover.background, treeHover.background);
  assert.equal(await child.locator('svg').getAttribute('fill'), '#123456');
  await page.getByRole('button', { name: /Inbox/ }).click();
  const longTree = page.locator('.tree-name').filter({ hasText: 'Long folder name' });
  assert.equal(await longTree.getAttribute('title'), null);
  await tree.hover();
  await page.waitForTimeout(700);
  assert.equal(await page.getByRole('tooltip').count(), 0);
  await longTree.locator('.truncate').hover();
  await page.waitForTimeout(200);
  assert.equal(await page.getByRole('tooltip').count(), 0);
  await page.getByRole('tooltip').waitFor();
  assert.equal(await page.getByRole('tooltip').innerText(), 'Long folder name '.repeat(12).trim());
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('tooltip').count(), 0);
  // The same component handles clipped chat names, including keyboard row focus.
  await chatRow.click();
  await page.keyboard.press('F2');
  await page.getByRole('textbox', { name: 'Rename', exact: true }).fill('A long chat title '.repeat(15));
  await page.getByRole('textbox', { name: 'Rename', exact: true }).press('Enter');
  await page.locator('.inline-rename').waitFor({ state: 'hidden' });
  const longChat = page.locator('.item-row').filter({ hasText: 'A long chat title' });
  await longChat.focus();
  await page.getByRole('tooltip').waitFor();
  assert.equal(await longChat.locator('.truncate').getAttribute('title'), null);
  await page.getByRole('heading', { name: 'Inbox', exact: true }).click();
  await page.getByRole('tooltip').waitFor({ state: 'hidden' });

  // Theme tokens retain a visible favorite independently of blue selection.
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    const button = longChat.locator('.favorite-button');
    assert.equal(await button.evaluate(el => getComputedStyle(el).color), scheme === 'light' ? 'rgb(166, 107, 0)' : 'rgb(245, 196, 81)');
    await page.screenshot({ path: `.verification/folder-favorites-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });

  for (const width of [900, 500]) {
    await page.setViewportSize({ width, height: 650 });
    for (const amount of [80, 100, 140]) {
      await page.keyboard.press('Control+0'); await scale(100);
      for (let i = 100; i > amount; i -= 10) await page.keyboard.press('Control+-');
      for (let i = 100; i < amount; i += 10) await page.keyboard.press('Control+=');
      await scale(amount);
      const geometry = await page.evaluate(() => {
        const app = document.querySelector('.app').getBoundingClientRect();
        const aside = document.querySelector('aside').getBoundingClientRect();
        const settings = document.querySelector('.settings-button').getBoundingClientRect();
        return { app: { x: app.x, y: app.y, width: app.width, height: app.height },
          aside: aside.width, right: settings.right, width: innerWidth, height: innerHeight,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      assert.ok(Math.abs(geometry.app.height - geometry.height) < 2, JSON.stringify(geometry));
      assert.ok(geometry.right <= width + 1, JSON.stringify(geometry));
      assert.ok(geometry.overflow <= 1, JSON.stringify(geometry));
      // Narrow/high-scale command bars intentionally retain their existing
      // horizontal scrolling; every control must remain reachable.
      const direction = page.getByRole('button', { name: 'Change sort direction', exact: true });
      await direction.scrollIntoViewIfNeeded();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const dialog = page.getByRole('dialog');
      const bounds = await dialog.boundingBox();
      assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1, JSON.stringify(bounds));
      assert.ok(bounds.y >= -1 && bounds.y + bounds.height <= 651, JSON.stringify(bounds));
      for (const button of await dialog.getByRole('button').all()) {
        const label = await button.innerText();
        if (['Import JSON', 'Export JSON', 'Export backup', 'Reset'].includes(label))
          assert.equal(await button.locator('svg').count(), 0);
      }
      await page.screenshot({ path: `.verification/ui-settings-${width}-${amount}.png` });
      await page.getByRole('group', { name: 'Interface scale', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `.verification/ui-appearance-${width}-${amount}.png` });
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.screenshot({ path: `.verification/ui-explorer-${width}-${amount}.png` });
    }
  }
  // Native zoom remains unchanged; shortcuts also work while editing/searching.
  const search = page.getByRole('searchbox', { name: 'Search', exact: true });
  await search.fill('untouched');
  await page.keyboard.press('Control+-'); await scale(130);
  assert.equal(await search.inputValue(), 'untouched');
  await page.evaluate(() => {
    const field = document.createElement('div'); field.contentEditable = 'true'; field.id = 'editable-probe';
    field.textContent = 'unchanged'; document.body.append(field); field.focus();
  });
  await page.keyboard.press('Control+-'); await scale(120);
  assert.equal(await page.locator('#editable-probe').innerText(), 'unchanged');
  await page.locator('#editable-probe').evaluate(el => el.remove());
  await page.evaluate(() => {
    const field = document.createElement('textarea'); field.id = 'textarea-probe';
    field.value = 'unchanged'; document.body.append(field); field.focus();
  });
  await page.keyboard.press('Control+='); await scale(130);
  assert.equal(await page.locator('#textarea-probe').inputValue(), 'unchanged');
  await page.locator('#textarea-probe').evaluate(el => el.remove());
  await page.keyboard.press('Control+0'); await scale(100);
  await search.fill('');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click(); await scale(110);
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click(); await scale(100);
  // Saving an older Settings form must not undo the immediately applied scale.
  await page.keyboard.press('Control+='); await scale(110);
  await page.getByRole('button', { name: 'Save', exact: true }).click(); await scale(110);
  await page.reload(); await scale(110);
  assert.equal((await read()).folders.find(f => f.id === 'child').color, '#123456');
  assert.equal((await read()).folders.find(f => f.id === 'child').pinned, true);
  const zoom = await page.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: location.href }); return chrome.tabs.getZoom(tab.id);
  });
  assert.equal(zoom, 1);
  assert.deepEqual(errors, []);
  console.log('PASS synthetic UI preferences: neutral hover/selection precedence, delayed clipped-only folder/chat tooltips, direct child folder/chat lists, chat-only filters, mixed selection guards, nested navigation, stable trailing pins/chat favorites, independent folder colors, persistence, text-only Settings actions, 80/100/140% at 500/900px, input/contenteditable shortcuts, scale controls, browser zoom unchanged.');
} finally { await context.close(); }
