import { it, expect } from 'vitest';
import type { Item } from '../src/models/types';
import { defaults, addConversation } from '../src/models/state';
import { dragPayload, canDropItems, moveDraggedItems } from '../src/models/drag';
import { sortFolders } from '../src/models/folders';
import { exportWorkspace, parseWorkspace, applyWorkspace } from '../src/models/workspace';

const chat = (id: string): Item => ({ kind: 'conversation', id });
const folder = (id: string): Item => ({ kind: 'folder', id });
function fixture() {
  const s = defaults();
  s.folders = [
    { id: 'src', name: 'Source', parentId: null, createdAt: 1 },
    { id: 'dst', name: 'Destination', parentId: null, createdAt: 1 },
    { id: 'a', name: 'Z pinned', parentId: 'src', pinned: true, color: '#123456', createdAt: 1 },
    { id: 'b', name: 'A plain', parentId: 'src', createdAt: 1 },
    { id: 'leaf', name: 'Leaf', parentId: 'a', createdAt: 1 },
    { id: 'nested', name: 'Nested destination', parentId: 'dst', createdAt: 1 },
  ];
  let next = s;
  for (const id of ['one', 'two', 'three', 'four']) next = addConversation(next, id, `https://chatgpt.com/c/${id}`, 'src').state;
  next.conversations[0] = { ...next.conversations[0], title: 'Alias', originalTitle: 'Original', favorite: true,
    color: '#ef4444', projectId: 'g-p-' + 'a'.repeat(32), projectName: 'Project', lastOpenedAt: 42 };
  return next;
}

it('single chat drag uses just the grabbed item', () => {
  expect(dragPayload(fixture(), chat('one'), [])).toEqual([chat('one')]);
});
it('dragging any selected chat preserves the full multi-selection payload', () => {
  const items = [chat('one'), chat('two'), chat('three')];
  expect(dragPayload(fixture(), chat('two'), items)).toEqual(items);
});
it('an unselected item drags alone, independently of the prior selection', () => {
  expect(dragPayload(fixture(), chat('four'), [chat('one'), folder('a')])).toEqual([chat('four')]);
});
it('selected folders and mixed selections share the same batch payload', () => {
  const s = fixture();
  expect(dragPayload(s, folder('b'), [folder('a'), folder('b')])).toEqual([folder('a'), folder('b')]);
  expect(dragPayload(s, chat('one'), [folder('a'), chat('one'), chat('two')])).toEqual([folder('a'), chat('one'), chat('two')]);
});
it('deduplicates items and excludes missing/nonmovable sources', () => {
  expect(dragPayload(fixture(), chat('one'), [chat('one'), chat('one'), folder('missing')])).toEqual([chat('one')]);
  expect(dragPayload(fixture(), folder('home'), [])).toEqual([]);
});
it('selected ancestors carry selected contents without flattening the subtree', () => {
  const s = fixture(); s.conversations[0].folderId = 'leaf';
  const items = dragPayload(s, chat('one'), [folder('a'), folder('leaf'), chat('one')]);
  expect(items).toEqual([folder('a')]);
  const next = moveDraggedItems(s, items, 'dst');
  expect(next.folders.find(f => f.id === 'leaf')?.parentId).toBe('a');
  expect(next.conversations[0].folderId).toBe('leaf');
});
it.each(['dst', 'nested'])('moves multiple chats to folder %s', target => {
  const s = fixture(), items = [chat('one'), chat('two'), chat('three')];
  expect(canDropItems(s, items, target)).toBe(true);
  const next = moveDraggedItems(s, items, target);
  expect(next.conversations.slice(0, 3).map(c => c.folderId)).toEqual([target, target, target]);
  expect(next.conversations[3].folderId).toBe('src');
});
it('moves folders and a mixed chat while preserving every other metadata field', () => {
  const s = fixture(), next = moveDraggedItems(s, [folder('a'), folder('b'), chat('one')], 'nested');
  expect(next.folders[2]).toEqual({ ...s.folders[2], parentId: 'nested' });
  expect(next.folders[3]).toEqual({ ...s.folders[3], parentId: 'nested' });
  expect(next.folders[4]).toEqual(s.folders[4]);
  expect(next.conversations[0]).toEqual({ ...s.conversations[0], folderId: 'nested' });
  expect(s.folders[2].parentId).toBe('src');
});
it.each(['a', 'leaf', 'missing', null])('rejects self/descendant/missing/system destination %s atomically', target => {
  const s = fixture(), before = structuredClone(s), items = [folder('a'), chat('one')];
  expect(canDropItems(s, items, target)).toBe(false);
  expect(() => moveDraggedItems(s, items, target)).toThrow();
  expect(s).toEqual(before);
});
it('rejects empty batches and entirely same-parent no-op drops', () => {
  const s = fixture();
  expect(canDropItems(s, [], 'dst')).toBe(false);
  expect(canDropItems(s, [folder('a'), chat('one')], 'src')).toBe(false);
});
it('skips already-placed members when other members have a meaningful move', () => {
  const s = fixture(); s.conversations[0].folderId = 'dst';
  expect(moveDraggedItems(s, [chat('one'), chat('two')], 'dst').conversations.slice(0, 2).map(c => c.folderId)).toEqual(['dst', 'dst']);
});
it('rechecks removed targets/sources and new descendant relationships before saving', () => {
  const s = fixture(), items = [folder('a'), chat('one')];
  expect(canDropItems(s, items, 'dst')).toBe(true);
  const removed = { ...s, folders: s.folders.filter(f => f.id !== 'dst') };
  expect(() => moveDraggedItems(removed, items, 'dst')).toThrow();
  const nested = { ...s, folders: s.folders.map(f => f.id === 'dst' ? { ...f, parentId: 'a' } : f) };
  expect(() => moveDraggedItems(nested, items, 'dst')).toThrow();
  expect(() => moveDraggedItems(s, [...items, chat('deleted')], 'dst')).toThrow();
});
it('moved pin groups retain existing name sorting and survive Workspace round trips', () => {
  const moved = moveDraggedItems(fixture(), [folder('a'), folder('b'), chat('one')], 'nested');
  const restored = applyWorkspace(defaults(), parseWorkspace(JSON.parse(JSON.stringify(exportWorkspace(moved)))));
  const folders = sortFolders(restored.folders.filter(f => f.parentId === 'nested'), (a, b) => a.name.localeCompare(b.name));
  expect(folders.map(f => f.id)).toEqual(['a', 'b']);
  expect(folders[0]).toMatchObject({ pinned: true, color: '#123456' });
  expect(restored.conversations[0]).toMatchObject({ folderId: 'nested', favorite: true, title: 'Alias', originalTitle: 'Original', projectName: 'Project' });
});
