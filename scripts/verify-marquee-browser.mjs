// Pointer Events and native HTML drag in an isolated Edge/Chromium extension profile.
// Synthetic metadata only; no ChatGPT/Dropbox account is used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
await fs.mkdir('.verification', { recursive: true });
const profile = await fs.mkdtemp(path.join(root, '.verification/marquee-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true, viewport: { width: 1200, height: 900 },
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
  const seed = await page.evaluate(async () => {
    const { explorerState: s } = await chrome.storage.local.get('explorerState');
    s.folders = [['src', 'Source', null], ['a', 'Folder A', 'src'], ['b', 'Folder B', 'src'],
      ['target', 'Main target', 'src'], ['outer', 'Outer', null], ['leaf', 'Hidden descendant', 'a']]
      .map(([id, name, parentId]) => ({ id, name, parentId, pinned: false, createdAt: 1 }));
    s.conversations = ['A', 'B', 'C', 'D'].map(letter => ({
      id: `chat-${letter}`, title: `Chat ${letter}`, url: `https://chatgpt.com/c/chat-${letter}`,
      folderId: 'src', color: letter < 'C' ? '#ef4444' : '#ffffff', favorite: letter === 'A',
      projectId: null, projectName: null, createdAt: 1, lastOpenedAt: null,
    }));
    s.settings.lastLocation = 'folder:src'; s.settings.uiScale = 100;
    return s;
  });
  const row = name => page.locator('.item-row').filter({ has: page.getByText(name, { exact: true }) });
  const read = () => page.evaluate(async () => (await chrome.storage.local.get('explorerState')).explorerState);
  const reset = async () => {
    await page.evaluate(s => chrome.storage.local.set({ explorerState: s }), seed);
    await page.reload();
    await page.getByRole('heading', { name: 'Source', exact: true }).waitFor();
    await row('Chat A').waitFor();
    await page.evaluate(() => {
      window.nativeDragStarts = 0;
      document.addEventListener('dragstart', () => window.nativeDragStarts++, true);
    });
  };
  const selected = async keys => {
    await page.waitForFunction(keys => JSON.stringify(Array.from(document.querySelectorAll('.item-row.selected'),
      el => el.dataset.itemKey).sort()) === JSON.stringify([...keys].sort()), keys);
  };
  const blank = async () => page.locator('main').evaluate(el => {
    const r = el.getBoundingClientRect(), scale = Number(getComputedStyle(document.documentElement).zoom);
    const rows = el.querySelectorAll('.item-row'), last = rows[rows.length - 1].getBoundingClientRect();
    return { x: r.right - (el.offsetWidth - el.clientWidth + 5) * scale,
      y: Math.min(last.bottom + 20 * scale, r.bottom - 20 * scale) };
  });
  const range = async (first, last, modifier, beforeRelease) => {
    const a = await row(first).boundingBox(), b = await row(last).boundingBox();
    const scale = await page.evaluate(() => Number(getComputedStyle(document.documentElement).zoom));
    const start = { x: b.x + b.width + 6 * scale, y: b.y + b.height - 2 * scale };
    const end = { x: a.x + 8 * scale, y: a.y + 2 * scale };
    if (modifier) await page.keyboard.down(modifier);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await page.locator('.selection-marquee').waitFor();
    assert.equal(await page.locator('.drag-count').count(), 0);
    assert.equal(await page.evaluate(() => window.nativeDragStarts), 0);
    const box = await page.locator('.selection-marquee').boundingBox();
    for (const [actual, expected] of [[box.x, end.x], [box.y, end.y],
      [box.width, start.x - end.x], [box.height, start.y - end.y]])
      assert.ok(Math.abs(actual - expected) < 2, JSON.stringify({ box, start, end }));
    if (beforeRelease) await beforeRelease();
    await page.mouse.up();
    if (modifier) await page.keyboard.up(modifier);
    await page.locator('.selection-marquee').waitFor({ state: 'hidden' });
  };

  await reset(); await row('Chat A').click(); await selected(['conversation:chat-A']);
  await page.keyboard.press('F2');
  const rename = page.getByRole('textbox', { name: 'Rename', exact: true });
  await rename.click(); await selected(['conversation:chat-A']); await rename.press('Escape');
  await row('Chat B').hover();
  await row('Chat B').getByRole('button', { name: 'Add to Favorites: Chat B', exact: true }).click();
  await selected(['conversation:chat-A']);
  await row('Folder A').hover();
  await row('Folder A').getByRole('button', { name: 'Pin folder: Folder A', exact: true }).click();
  await selected(['conversation:chat-A']);

  await page.locator('.table-heading').click(); await selected(['conversation:chat-A']);
  await page.getByRole('button', { name: 'Change sort direction', exact: true }).click();
  await selected(['conversation:chat-A']);
  await page.getByRole('button', { name: 'Change sort direction', exact: true }).click();
  await page.getByRole('button', { name: 'New Folder', exact: true }).click();
  await page.getByLabel('Display name', { exact: true }).fill('Input');
  await selected(['conversation:chat-A']);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  let point = await blank(); await page.mouse.click(point.x, point.y, { button: 'right' });
  await selected(['conversation:chat-A']);
  await page.mouse.click(point.x, point.y); await selected([]);
  await row('Chat A').click();
  point = await blank(); await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x - 2, point.y);
  assert.equal(await page.locator('.selection-marquee').count(), 0);
  await selected(['conversation:chat-A']);
  await page.mouse.up(); await selected([]);

  await range('Chat B', 'Chat B'); await selected(['conversation:chat-B']);
  await row('Chat A').click(); await row('Chat C').click({ modifiers: ['Control'] });
  await range('Chat B', 'Chat D'); await selected(['conversation:chat-B', 'conversation:chat-C', 'conversation:chat-D']);
  for (const modifier of ['Control', 'Meta']) {
    await row('Chat A').click();
    await range('Chat C', 'Chat D', modifier);
    await selected(['conversation:chat-A', 'conversation:chat-C', 'conversation:chat-D']);
    await range('Chat C', 'Chat C', modifier);
    await selected(['conversation:chat-A', 'conversation:chat-C', 'conversation:chat-D']);
  }
  await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('name:"Chat"');
  await page.getByLabel('Color filter', { exact: true }).selectOption('#ffffff');
  await row('Chat A').waitFor({ state: 'hidden' });
  await range('Chat C', 'Chat D'); await selected(['conversation:chat-C', 'conversation:chat-D']);
  assert.equal(await page.locator('aside .item-row.selected').count(), 0);
  await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('');
  await page.getByLabel('Color filter', { exact: true }).selectOption('all');
  await row('Chat A').waitFor();

  for (const amount of [80, 100, 140]) {
    await page.keyboard.press('Control+0');
    for (let i = 100; i > amount; i -= 10) await page.keyboard.press('Control+-');
    for (let i = 100; i < amount; i += 10) await page.keyboard.press('Control+=');
    await page.waitForFunction(amount => Number(getComputedStyle(document.documentElement).zoom) === amount / 100, amount);
    await range('Chat A', 'Chat D', null, async () => {
      await selected(['conversation:chat-A', 'conversation:chat-B', 'conversation:chat-C', 'conversation:chat-D']);
      assert.equal(await page.locator('.selection-marquee').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
      await page.screenshot({ path: `.verification/marquee-${amount}.png` });
    });
    await selected(['conversation:chat-A', 'conversation:chat-B', 'conversation:chat-C', 'conversation:chat-D']);
  }
  await page.keyboard.press('Control+0');
  await page.waitForFunction(() => Number(getComputedStyle(document.documentElement).zoom) === 1);
  await page.emulateMedia({ colorScheme: 'dark' });
  await range('Folder A', 'Chat A', null, () => page.screenshot({ path: '.verification/marquee-dark.png' }));
  await selected(['folder:a', 'folder:b', 'folder:target', 'conversation:chat-A']);
  await page.emulateMedia({ colorScheme: 'light' });
  // Escape cancels a running rectangle and restores the previous selection.
  await row('Chat A').click();
  await range('Chat C', 'Chat D', null, async () => { await page.keyboard.press('Escape'); });
  await selected(['conversation:chat-A']);

  const moveSelection = async (name, count) => {
    const source = await row(name).boundingBox(), target = await row('Main target').boundingBox();
    await page.mouse.move(source.x + 45, source.y + source.height / 2); await page.mouse.down();
    await page.mouse.move(source.x + 70, source.y + source.height / 2 + 4, { steps: 5 });
    await page.locator('.drag-count').waitFor();
    assert.equal(await page.locator('.drag-count').innerText(), `Moving ${count} items`);
    assert.equal(await page.locator('.selection-marquee').count(), 0);
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
    await page.mouse.move(target.x + target.width / 2 + 1, target.y + target.height / 2);
    await page.mouse.up(); await page.locator('.drag-count').waitFor({ state: 'hidden' });
  };
  await range('Chat A', 'Chat D'); await moveSelection('Chat B', 4);
  await page.waitForFunction(async () => (await chrome.storage.local.get('explorerState')).explorerState.conversations.every(c => c.folderId === 'target'));
  await selected([]);
  await reset();
  await range('Folder A', 'Folder A'); await range('Chat A', 'Chat A', 'Control');
  await selected(['folder:a', 'conversation:chat-A']);
  await moveSelection('Folder A', 2);
  await page.waitForFunction(async () => (await chrome.storage.local.get('explorerState')).explorerState.folders.find(f => f.id === 'a').parentId === 'target');
  const moved = await read();
  assert.equal(moved.conversations[0].folderId, 'target');
  assert.equal(moved.conversations[0].favorite, true);
  assert.equal(moved.folders.find(f => f.id === 'leaf').parentId, 'a');
  await selected([]);
  // A long list exercises native scrollbar exclusion and wheel scrolling during capture.
  const longSeed = structuredClone(seed);
  longSeed.conversations.push(...Array.from({ length: 40 }, (_, i) => ({
    ...seed.conversations[0], id: `long-${String(i).padStart(2, '0')}`, title: `Long ${String(i).padStart(2, '0')}`,
    url: `https://chatgpt.com/c/long-${String(i).padStart(2, '0')}`,
  })));
  await page.evaluate(s => chrome.storage.local.set({ explorerState: s }), longSeed);
  await page.reload(); await row('Chat A').waitFor();
  await page.evaluate(() => { window.nativeDragStarts = 0; document.addEventListener('dragstart', () => window.nativeDragStarts++, true); });
  await row('Chat A').click();
  const scrollbar = await page.locator('main').evaluate(el => {
    const r = el.getBoundingClientRect(); return { width: el.offsetWidth - el.clientWidth, x: r.right - 2, y: r.top + r.height / 2 };
  });
  if (scrollbar.width > 0) {
    await page.mouse.click(scrollbar.x, scrollbar.y);
    await selected(['conversation:chat-A']);
    assert.equal(await page.locator('.selection-marquee').count(), 0);
    await page.locator('main').evaluate(el => { el.scrollTop = 0; });
  }
  await range('Chat A', 'Chat D', null, async () => {
    await page.mouse.wheel(0, 180);
    await page.waitForFunction(() => document.querySelector('main').scrollTop > 0);
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.item-row.selected')).some(el => el.dataset.itemKey.startsWith('conversation:long-')));
  });
  await page.locator('.tree-name').filter({ hasText: /^Outer$/ }).click(); await selected([]);
  await reset();
  await row('Chat A').click(); await page.keyboard.press('F2');
  await page.getByRole('textbox', { name: 'Rename', exact: true }).fill('ZZ renamed');
  point = await blank(); await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.getByRole('textbox', { name: 'Rename', exact: true }).waitFor({ state: 'hidden' });
  await page.mouse.up(); await selected([]);
  assert.equal((await read()).conversations[0].title, 'ZZ renamed');
  assert.deepEqual(errors, []);
  console.log('PASS synthetic Edge Pointer Events: blank/header/control/context guards, threshold, single/multiple/mixed marquee, replace/additive Ctrl+Cmd, filtered rows, 80/100/140% geometry, dark/light, Escape/scrollbar/wheel behavior, marquee-to-native multi-drag and mixed drop.');
} finally { await context.close(); }
