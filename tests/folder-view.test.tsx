import { renameItem } from '../src/models/explorer';
import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ItemDetails } from '../src/components/ItemDetails';
import { defaults, addConversation, moveItem, deleteFolder } from '../src/models/state';
import type { Item } from '../src/models/types';
import { exportWorkspace, parseWorkspace, applyWorkspace } from '../src/models/workspace';

function mixed() {
  const s = defaults();
  s.folders = [
    { id: 'parent', name: 'Parent', parentId: null, createdAt: 1 },
    { id: 'child', name: 'Child', parentId: 'parent', pinned: true, color: '#123456', createdAt: 1 },
    { id: 'grandchild', name: 'Grandchild', parentId: 'child', createdAt: 1 },
    { id: 'destination', name: 'Destination', parentId: null, createdAt: 1 },
  ];
  let next = addConversation(s, 'Direct', 'https://chatgpt.com/c/direct', 'parent').state;
  next = addConversation(next, 'Nested', 'https://chatgpt.com/c/nested', 'child').state;
  next.conversations[0].favorite = true;
  return next;
}
const selected: Item[] = [{ kind: 'folder', id: 'child' }, { kind: 'conversation', id: 'direct' }];

it('folder row names use colored icons without a duplicate chat color dot', () => {
  const html = renderToStaticMarkup(<ItemDetails folder={mixed().folders[1]} />);
  expect(html).toContain('tabler-icon-folder-filled');
  expect(html).toContain('fill="#123456"');
  expect(html).toContain('Child');
  expect(html).toContain('<span role="cell" class="color-cell"></span>');
  expect(html).not.toContain('color-dot-button');
});
it('mixed bulk move preserves folder metadata, nested contents and chat favorite', () => {
  const s = mixed();
  const moved = selected.reduce((next, item) => moveItem(next, item, 'destination'), s);
  expect(moved.folders[1]).toMatchObject({ parentId: 'destination', pinned: true, color: '#123456' });
  expect(moved.folders[2].parentId).toBe('child');
  expect(moved.conversations[0]).toMatchObject({ folderId: 'destination', favorite: true });
  expect(moved.conversations[1].folderId).toBe('child');
  expect(() => selected.reduce((next, item) => moveItem(next, item, 'grandchild'), s)).toThrow();
  expect(s.folders[1].parentId).toBe('parent');
  expect(s.conversations[0].folderId).toBe('parent');
});
it('mixed remove keeps existing nonrecursive folder removal semantics', () => {
  const s = mixed();
  const next = selected.reduce((state, item) => item.kind === 'folder'
    ? deleteFolder(state, item.id)
    : { ...state, conversations: state.conversations.filter(c => c.id !== item.id) }, s);
  expect(next.folders.some(f => f.id === 'child')).toBe(false);
  expect(next.folders.find(f => f.id === 'grandchild')?.parentId).toBe('parent');
  expect(next.conversations).toHaveLength(1);
  expect(next.conversations[0]).toMatchObject({ id: 'nested', folderId: null });
  expect(s.conversations).toHaveLength(2);
});

it('shared folder rename changes only name and survives Workspace import/export', () => {
  const s = mixed(), next = renameItem(s, { kind: 'folder', id: 'child' }, '  Renamed folder  ');
  expect(next.folders[1]).toEqual({ ...s.folders[1], name: 'Renamed folder' });
  expect(next.folders[2]).toEqual(s.folders[2]);
  expect(next.conversations).toEqual(s.conversations);
  expect(s.folders[1].name).toBe('Child');
  const restored = applyWorkspace(defaults(), parseWorkspace(JSON.parse(JSON.stringify(exportWorkspace(next)))));
  expect(restored.folders.find(f => f.id === 'child')).toMatchObject({ name: 'Renamed folder', parentId: 'parent', color: '#123456', pinned: true });
  expect(restored.folders.find(f => f.id === 'grandchild')?.parentId).toBe('child');
});
it('folder names use the same blank rejection and length normalization as main rename', () => {
  const s = mixed(), item: Item = { kind: 'folder', id: 'child' };
  expect(renameItem(s, item, '   ')).toBe(s);
  expect(renameItem(s, item, 'x'.repeat(301)).folders[1].name).toHaveLength(300);
});
