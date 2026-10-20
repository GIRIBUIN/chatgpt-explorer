import type { AppState, Item } from './types';
import { itemKey } from './explorer';
import { ancestors, canMoveFolder, moveItem } from './state';

function parent(s: AppState, item: Item) {
  return item.kind === 'folder'
    ? s.folders.find(f => f.id === item.id)?.parentId
    : s.conversations.find(c => c.id === item.id)?.folderId;
}

export function dragPayload(s: AppState, grabbed: Item, selected: Item[]): Item[] {
  const candidates = selected.some(i => itemKey(i) === itemKey(grabbed)) ? selected : [grabbed];
  const items = [...new Map(candidates.filter(i => parent(s, i) !== undefined).map(i => [itemKey(i), i])).values()];
  const folders = new Set(items.filter(i => i.kind === 'folder').map(i => i.id));
  // A selected ancestor already carries its contents; never flatten that subtree.
  return items.filter(i => !ancestors(s.folders, parent(s, i) ?? null).some(f => folders.has(f.id)));
}

export function canDropItems(s: AppState, items: Item[], target: string | null): boolean {
  if (!target || !s.folders.some(f => f.id === target) || !items.length) return false;
  if (items.some(i => parent(s, i) === undefined ||
    (i.kind === 'folder' && !canMoveFolder(s.folders, i.id, target)))) return false;
  return items.some(i => parent(s, i) !== target);
}

/** Validate the entire batch against the latest saved state before changing anything. */
export function moveDraggedItems(s: AppState, items: Item[], target: string | null): AppState {
  if (!canDropItems(s, items, target)) throw Error('Invalid move destination.');
  return items.reduce((next, item) => parent(next, item) === target ? next : moveItem(next, item, target), s);
}
