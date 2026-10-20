// Native mouse/HTML drag in an isolated extension profile; synthetic metadata only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const root = process.cwd();
await fs.mkdir('.verification', { recursive: true });
const profile = await fs.mkdtemp(path.join(root, '.verification/drag-'));
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
  const seed = await page.evaluate(async () => {
    const { explorerState: s } = await chrome.storage.local.get('explorerState');
    s.folders = [
      ['src', 'Source', null], ['target', 'Main target', 'src'],
      ['a', 'Folder A', 'src'], ['b', 'Folder B', 'src'], ['leaf', 'Leaf', 'a'],
      ['outer', 'Outer', null], ['nested', 'Nested destination', 'outer'],
    ].map(([id, name, parentId]) => ({ id, name, parentId, createdAt: 1,
      pinned: id === 'a', ...(id === 'a' ? { color: '#123456' } : {}) }));
    s.conversations = ['A', 'B', 'C', 'D'].map(letter => ({
      id: `chat-${letter}`, title: `Chat ${letter}`, originalTitle: `Original ${letter}`,
      url: `https://chatgpt.com/c/chat-${letter}`, folderId: 'src',
      projectId: null, projectName: null, favorite: letter === 'A',
      color: '#ef4444', createdAt: 1, lastOpenedAt: null,
    }));
    s.settings.lastLocation = 'folder:src'; s.settings.collapsed = ['outer'];
    return s;
  });
  const read = () => page.evaluate(async () => (await chrome.storage.local.get('explorerState')).explorerState);
  const row = name => page.locator('.item-row').filter({ has: page.getByText(name, { exact: true }) });
  const tree = name => page.locator('.tree-name').filter({ hasText: new RegExp(`^${name}$`) }).locator('..');
  const reset = async () => {
    await page.evaluate(s => chrome.storage.local.set({ explorerState: s }), seed);
    await page.reload();
    await page.getByRole('heading', { name: 'Source', exact: true }).waitFor();
    await row('Chat A').waitFor();
    await page.evaluate(() => {
      window.dragTrace = null;
      document.addEventListener('drop', e => {
        const text = e.dataTransfer.getData('application/x-chat-explorer');
        window.dragTrace = { payload: text ? JSON.parse(text) : null,
          selected: document.querySelectorAll('.item-row.selected').length };
      }, true);
    });
  };
  const select = async names => {
    for (let i = 0; i < names.length; i++) await row(names[i]).click({ modifiers: i ? ['Control'] : [] });
    assert.equal(await page.locator('.item-row.selected').count(), names.length);
  };
  const nativeDrag = async (source, target, count, valid = true) => {
    await source.scrollIntoViewIfNeeded();
    const a = await source.boundingBox();
    await page.mouse.move(a.x + 45, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 65, a.y + a.height / 2 + 4, { steps: 5 });
    await page.locator('.drag-count').waitFor();
    assert.equal(await page.locator('.drag-count').innerText(), `Moving ${count} item${count === 1 ? '' : 's'}`);
    assert.equal(await page.locator('.item-row.selected').count(), count);
    const b = await target.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
    await page.mouse.move(b.x + b.width / 2 + 1, b.y + b.height / 2, { steps: 2 });
    await page.waitForFunction(({ valid }) => !!document.querySelector(`[data-drop="${valid ? 'valid' : 'invalid'}"]`), { valid });
    assert.equal(await target.getAttribute('data-drop'), valid ? 'valid' : 'invalid');
    await page.mouse.up();
    await page.locator('.drag-count').waitFor({ state: 'hidden' });
  };
  const placed = async (ids, target, kind = 'conversation') => {
    await page.waitForFunction(async ({ ids, target, kind }) => {
      const { explorerState: s } = await chrome.storage.local.get('explorerState');
      return ids.every(id => kind === 'folder' ? s.folders.find(f => f.id === id)?.parentId === target
        : s.conversations.find(c => c.id === id)?.folderId === target);
    }, { ids, target, kind });
  };

  await reset(); await select(['Chat A', 'Chat B', 'Chat C']);
  await nativeDrag(row('Chat B'), row('Main target'), 3);
  await placed(['chat-A', 'chat-B', 'chat-C'], 'target');
  assert.equal((await read()).conversations[3].folderId, 'src');
  assert.equal((await page.evaluate(() => window.dragTrace)).payload.length, 3);
  assert.equal(await page.locator('.item-row.selected').count(), 0);

  await reset(); await select(['Chat A', 'Chat B']);
  await nativeDrag(row('Chat D'), tree('Outer'), 1);
  await placed(['chat-D'], 'outer');
  assert.deepEqual((await read()).conversations.slice(0, 2).map(c => c.folderId), ['src', 'src']);
  assert.deepEqual((await page.evaluate(() => window.dragTrace)).payload, [{ kind: 'conversation', id: 'chat-D' }]);

  await reset();
  await page.getByRole('button', { name: 'Outer Expand', exact: true }).click();
  await select(['Folder A', 'Folder B']);
  await nativeDrag(row('Folder B'), tree('Nested destination'), 2);
  await placed(['a', 'b'], 'nested', 'folder');
  assert.equal((await read()).folders.find(f => f.id === 'leaf').parentId, 'a');

  await reset(); await select(['Folder A', 'Chat A', 'Chat B']);
  await nativeDrag(row('Chat A'), row('Main target'), 3);
  await placed(['a'], 'target', 'folder'); await placed(['chat-A', 'chat-B'], 'target');
  const moved = await read();
  assert.deepEqual(moved.folders.find(f => f.id === 'a'), { ...seed.folders.find(f => f.id === 'a'), parentId: 'target' });
  assert.deepEqual(moved.conversations[0], { ...seed.conversations[0], folderId: 'target' });

  await reset();
  await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('Control+a');
  await nativeDrag(row('Chat B'), tree('Outer'), 7);
  await placed(['a', 'b', 'target'], 'outer', 'folder');
  await placed(['chat-A', 'chat-B', 'chat-C', 'chat-D'], 'outer');
  assert.equal(await page.locator('.item-row').count(), 0);

  await reset(); await select(['Folder A', 'Chat A']);
  await nativeDrag(row('Folder A'), tree('Leaf'), 2, false);
  assert.deepEqual(await read(), seed);
  await reset(); await select(['Folder A']);
  await nativeDrag(row('Folder A'), row('Folder A'), 1, false);
  assert.deepEqual(await read(), seed);
  await reset(); await select(['Chat A']);
  await nativeDrag(row('Chat A'), tree('Source'), 1, false);
  assert.deepEqual(await read(), seed);
  await reset(); await select(['Chat A']);
  await nativeDrag(row('Chat A'), page.getByRole('button', { name: 'Home', exact: true }).last(), 1, false);
  assert.deepEqual(await read(), seed);
  await reset(); await select(['Chat A', 'Chat B']);
  const cancelled = await row('Chat A').boundingBox();
  await page.mouse.move(cancelled.x + 45, cancelled.y + cancelled.height / 2);
  await page.mouse.down();
  await page.mouse.move(cancelled.x + 70, cancelled.y + cancelled.height / 2 + 4, { steps: 5 });
  await page.locator('.drag-count').waitFor();
  await page.keyboard.press('Escape'); await page.mouse.up();
  await page.locator('.drag-count').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.item-row.selected').count(), 2);
  assert.deepEqual(await read(), seed);
  await row('Chat C').click();
  assert.equal(await page.locator('.item-row.selected').count(), 1);

  assert.deepEqual(errors, []);
  console.log('PASS native synthetic Edge drag: multi-chat/main target, unselected-only/collapsed sidebar target, multi-folder/nested destination, mixed batch, Ctrl+A, count badge/selection, invalid self/descendant/same-parent/system targets, preserved metadata, no navigation or page errors.');
} finally { await context.close(); }
