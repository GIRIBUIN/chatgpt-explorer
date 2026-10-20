import type { Folder } from './types';

/** Compatibility boundary: an explicit pin always wins over legacy favorite. */
export const folderPinned = (f: { pinned?: unknown; favorite?: unknown }) =>
  typeof f.pinned === 'boolean' ? f.pinned : f.favorite === true;

/** Pin only within sibling groups, retaining the existing order inside each group. */
export function sortFolders(folders: Folder[], compare: (a: Folder, b: Folder) => number) {
  const sorted = [...folders].sort(compare);
  const groups = new Map<string | null, Folder[]>();
  for (const f of sorted) {
    if (!groups.has(f.parentId)) groups.set(f.parentId, []);
    groups.get(f.parentId)!.push(f);
  }
  for (const [parent, siblings] of groups)
    groups.set(parent, [...siblings.filter(f => f.pinned), ...siblings.filter(f => !f.pinned)]);
  const offsets = new Map<string | null, number>();
  return sorted.map(f => {
    const index = offsets.get(f.parentId) ?? 0;
    offsets.set(f.parentId, index + 1);
    return groups.get(f.parentId)![index];
  });
}
