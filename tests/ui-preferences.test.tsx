import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FolderIcon } from '../src/components/FolderIcon';
import { InterfaceScale } from '../src/components/InterfaceScale';
import { ItemDetails } from '../src/components/ItemDetails';
import { DataDialog } from '../src/components/DataDialog';
import { defaults, normalizeState, assignColor, addConversation, renameColor } from '../src/models/state';
import { exportWorkspace, parseWorkspace, applyWorkspace } from '../src/models/workspace';
import { payload, applyPayload, syncDiff } from '../src/sync/payload';
import { hash } from '../src/sync/crypto';
import { uiScale, scaleStep, scaleShortcut, menuPosition } from '../src/models/ui-scale';
const folder = (id: string, parentId: string | null = null) => ({ id, name: id, parentId, pinned: false, createdAt: 1 });
function state(): ReturnType<typeof defaults> { return { ...defaults(), folders: [folder('parent'), folder('child', 'parent')] }; }

it('default folders use the yellow filled icon', () => {
  const html = renderToStaticMarkup(<FolderIcon />);
  expect(html).toContain('tabler-icon-folder-filled');
  expect(html).toContain('fill="var(--folder-default-color)"');
});
it('colored folders use the common filled icon without coloring names or rows', () => {
  const html = renderToStaticMarkup(<ItemDetails folder={{ ...folder('Study'), color: '#3b82f6' }} />);
  expect(html).toContain('tabler-icon-folder-filled'); expect(html).toContain('fill="#3b82f6"');
  expect(html).toContain('aria-hidden="true"'); expect(html).not.toContain('style="color:');
});
it('nested colored folders preserve hierarchy and custom colors through normalization', () => {
  const s = assignColor(state(), [{ kind: 'folder', id: 'child' }], '#3B82F6');
  expect(normalizeState(s).folders[1]).toMatchObject({ parentId: 'parent', color: '#3b82f6' });
  expect(s.folders[0].color).toBeUndefined();
});
it('selected rows retain the folder icon color independently of selection styling', () => {
  const html = renderToStaticMarkup(<div className="tree-row active"><FolderIcon color="#ef4444" /></div>);
  expect(html).toContain('fill="#ef4444"'); expect(html).toContain('tree-row active');
});
it('folder colors persist in workspace export/import and sync without a new palette', () => {
  const s = assignColor(state(), [{ kind: 'folder', id: 'parent' }], '#123456');
  const w = parseWorkspace(JSON.parse(JSON.stringify(exportWorkspace(s))));
  expect(applyWorkspace(defaults(), w).folders[0].color).toBe('#123456');
  expect(applyPayload(defaults(), payload(s)).folders.find(f => f.id === 'parent')?.color).toBe('#123456');
  expect(s.colorRules).toEqual(defaults().colorRules);
});
it('default color clears only the folder color and old workspace files preserve it on merge', () => {
  const s = assignColor(state(), [{ kind: 'folder', id: 'parent' }], '#3b82f6');
  expect(assignColor(s, [{ kind: 'folder', id: 'parent' }], null).folders[0].color).toBeUndefined();
  expect(applyWorkspace(s, exportWorkspace(state())).folders[0].color).toBe('#3b82f6');
  expect(syncDiff(s, payload(state())).foldersChanged).toBe(1);
  expect(applyPayload(s, payload(state())).folders[0].color).toBeUndefined();
});
it('invalid folder colors are rejected while independent HEX values are accepted', () => {
  const w = exportWorkspace(state()); w.folders[0].color = 'red';
  expect(() => parseWorkspace(w)).toThrow(); w.folders[0].color = '#123456';
  expect(parseWorkspace(w).folders[0].color).toBe('#123456');
});
it.each([['+', 1], ['=', 1], ['-', -1], ['0', 0]] as const)('Ctrl %s selects the app scale action', (key, result) => {
  expect(scaleShortcut({ key, ctrlKey: true, metaKey: false, altKey: false })).toBe(result);
});
it('Cmd and numpad scale shortcuts work without capturing ordinary text/edit shortcuts', () => {
  expect(scaleShortcut({ key: '+', ctrlKey: false, metaKey: true, altKey: false })).toBe(1);
  expect(scaleShortcut({ key: 'Add', code: 'NumpadAdd', ctrlKey: true, metaKey: false, altKey: false })).toBe(1);
  expect(scaleShortcut({ key: 'Insert', code: 'Numpad0', ctrlKey: true, metaKey: false, altKey: false })).toBeNull();
  for (const key of ['a', 'Enter', 'Delete', 'F2', '+'])
    expect(scaleShortcut({ key, ctrlKey: key !== '+', metaKey: false, altKey: false })).toBeNull();
});
it('scale steps clamp at both ends and reset to 100%', () => {
  expect(scaleStep(80, -1)).toBe(80); expect(scaleStep(140, 1)).toBe(140);
  expect(scaleStep(80, 1)).toBe(90); expect(scaleStep(140, -1)).toBe(130);
  expect(scaleStep(140, 0)).toBe(100); expect(uiScale(NaN)).toBe(100);
});
it('scale persists locally but neither changes semantic sync hash nor appears in exports', async () => {
  const s = state(), scaled = { ...s, settings: { ...s.settings, uiScale: 140 } };
  expect(normalizeState(JSON.parse(JSON.stringify(scaled))).settings.uiScale).toBe(140);
  expect(await hash(payload(s))).toBe(await hash(payload(scaled)));
  expect(JSON.stringify(exportWorkspace(scaled))).not.toContain('uiScale');
  expect(JSON.stringify(payload(scaled))).not.toContain('uiScale');
  expect(applyPayload(scaled, payload(s)).settings.uiScale).toBe(140);
});
it('scale controls have accessible names and endpoint disabled states', () => {
  const html = renderToStaticMarkup(<InterfaceScale value={80} change={() => {}} />);
  expect(html).toContain('aria-label="Zoom out" disabled=""');
  expect(html).toContain('aria-label="Zoom in"'); expect(html).toContain('80%');
  expect(renderToStaticMarkup(<InterfaceScale value={140} change={() => {}} />)).toContain('aria-label="Zoom in" disabled=""');
});
it('ordinary Appearance/Data buttons remain text-only while scale controls are present', () => {
  const html = renderToStaticMarkup(<DataDialog state={state()} commit={async () => true} />);
  expect(html).toContain('Interface scale');
  for (const button of html.match(/<button[\s\S]*?<\/button>/g) ?? []) expect(button).not.toContain('<svg');
});
it('scaled fixed menus stay within the document coordinate space', () => {
  expect(menuPosition(280, 140, 900, 650, 140)).toEqual({ x: 200, y: 100 });
});

it('folder assignment and normalization never add chat color rules', () => {
  const s = defaults(); s.folders = [folder('f')];
  const colored = normalizeState(assignColor(s, [{ kind: 'folder', id: 'f' }], '#123456'));
  expect(colored.colorRules).toEqual(s.colorRules);
  expect(colored.folders[0].color).toBe('#123456');
});
it('old color rules are retained and chat color changes leave folder decoration alone', () => {
  const s = state(); s.folders[0] = { ...s.folders[0], color: '#123456' };
  s.colorRules.push({ color: '#123456', name: 'Existing label', order: 99 });
  const withChat = addConversation(s, 'Chat', 'https://chatgpt.com/c/test-chat', null).state;
  const next = normalizeState(renameColor(assignColor(withChat, [{ kind: 'conversation', id: 'test-chat' }], '#123456'), '#123456', 'Career'));
  expect(next.folders[0].color).toBe('#123456');
  expect(next.colorRules.find(r => r.color === '#123456')?.name).toBe('Career');
  expect(normalizeState(s).colorRules.find(r => r.color === '#123456')?.name).toBe('Existing label');
});
