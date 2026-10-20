import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Folder } from '../src/models/types';
import { folderPinned, sortFolders } from '../src/models/folders';
import { defaults, normalizeState, addConversation } from '../src/models/state';
import { migrateFolderPins } from '../src/models/migration';
import { exportWorkspace, parseWorkspace, applyWorkspace, workspaceDiff } from '../src/models/workspace';
import { payload, applyPayload, syncDiff } from '../src/sync/payload';
import { FolderPinButton } from '../src/components/FolderPinButton';
import { FavoriteButton } from '../src/components/FavoriteButton';

const folder = (name: string, pinned = false, parentId: string | null = null): Folder =>
  ({ id: name, name, parentId, pinned, createdAt: 1 });
const compare = (a: Folder, b: Folder) => a.name.localeCompare(b.name);
const names = (items: Folder[]) => items.map(f => f.name);

it('root pins precede only their unpinned siblings', () => {
  expect(names(sortFolders([folder('A'), folder('C', true), folder('B')], compare))).toEqual(['C', 'A', 'B']);
});
it('nested pins stay in their parent and preserve parent slots in a mixed search', () => {
  const result = sortFolders([folder('A', false, 'parent'), folder('B'), folder('C', true, 'parent')], compare);
  expect(names(result)).toEqual(['C', 'B', 'A']);
  expect(result.map(f => f.parentId)).toEqual(['parent', null, 'parent']);
});
it('multiple pins and unpinned groups retain the existing name order', () => {
  const folders = [folder('D', true), folder('B'), folder('A', true), folder('C')];
  expect(names(sortFolders(folders, compare))).toEqual(['A', 'D', 'B', 'C']);
  expect(names(sortFolders(folders, (a, b) => compare(b, a)))).toEqual(['D', 'A', 'C', 'B']);
});
it('unpin restores normal ordering without moving a folder to another parent', () => {
  const folders = [folder('A', false, 'p'), folder('Z', true, 'p')];
  expect(names(sortFolders(folders, compare))).toEqual(['Z', 'A']);
  folders[1].pinned = false;
  expect(names(sortFolders(folders, compare))).toEqual(['A', 'Z']);
  expect(folders.every(f => f.parentId === 'p')).toBe(true);
});
it('legacy folder favorites migrate safely and explicit unpin takes precedence', () => {
  const raw = { ...defaults(), folders: [{ ...folder('A'), pinned: undefined, favorite: true },
    { ...folder('B'), favorite: true }] };
  const migrated = migrateFolderPins(raw);
  const state = normalizeState(migrated);
  expect(state.folders.map(f => f.pinned)).toEqual([true, false]);
  expect(state.folders.every(f => !('favorite' in f))).toBe(true);
  expect(migrateFolderPins(migrated)).toBe(migrated);
  expect(raw.folders[0].favorite).toBe(true);
  expect(folderPinned({ favorite: false })).toBe(false);
});
it('Workspace export/import and semantic sync preserve pins and custom colors', () => {
  const s = defaults(); s.folders = [{ ...folder('A', true), color: '#123456' }];
  const workspace = parseWorkspace(JSON.parse(JSON.stringify(exportWorkspace(s))));
  expect(workspace.folders[0]).toMatchObject({ pinned: true, color: '#123456' });
  expect(workspace.folders[0]).not.toHaveProperty('favorite');
  expect(applyWorkspace(defaults(), workspace).folders[0].pinned).toBe(true);
  expect(applyPayload(defaults(), payload(s)).folders[0].pinned).toBe(true);
  const unpinned = { ...s, folders: [folder('A')] };
  expect(workspaceDiff(s, exportWorkspace(unpinned)).foldersChanged).toBe(1);
  expect(syncDiff(s, payload(unpinned)).foldersChanged).toBe(1);
});
it('legacy Workspace favorites become pins without changing chat favorites', () => {
  const s = addConversation(defaults(), 'Chat', 'https://chatgpt.com/c/chat', null).state;
  s.conversations[0].favorite = true;
  const raw = { ...exportWorkspace(s), folders: [{ id: 'A', name: 'A', parentId: null, favorite: true }] };
  const workspace = parseWorkspace(raw);
  expect(workspace.folders[0]).toEqual({ id: 'A', name: 'A', parentId: null, pinned: true });
  expect(applyWorkspace(defaults(), workspace).conversations[0].favorite).toBe(true);
  expect(() => parseWorkspace({ ...raw, folders: [{ ...raw.folders[0], pinned: 'true' }] })).toThrow();
});
it('folder pin controls use neutral filled/outline icons with accessible pressed state', () => {
  const filled = renderToStaticMarkup(<FolderPinButton pinned name="Folder" onToggle={() => {}} />);
  expect(filled).toContain('tabler-icon-pin-filled');
  expect(filled).toContain('is-pinned');
  expect(filled).toContain('aria-label="Unpin folder: Folder"');
  expect(filled).toContain('aria-pressed="true"');
  expect(filled).toContain('fill="currentColor"');
  expect(filled).not.toMatch(/star|favorite/);
  const outline = renderToStaticMarkup(<FolderPinButton pinned={false} name="Folder" onToggle={() => {}} />);
  expect(outline).toContain('aria-label="Pin folder: Folder"');
  expect(outline).toContain('aria-pressed="false"');
  expect(outline).not.toContain('pin-filled');
  expect(renderToStaticMarkup(<FavoriteButton favorite name="Chat" onToggle={() => {}} />)).toContain('tabler-icon-star-filled');
});
