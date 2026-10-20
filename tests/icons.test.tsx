import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { UiIcon } from '../src/components/UiIcon';
import { ItemDetails } from '../src/components/ItemDetails';
import { TruncatedName } from '../src/components/TruncatedName';
import { FavoriteButton } from '../src/components/FavoriteButton';
import { FolderColorFields } from '../src/components/FolderColorFields';
import { Dialog } from '../src/components/Dialog';

it('internal icons inherit theme color and remain decorative without changing control names', () => {
  const icon = renderToStaticMarkup(<UiIcon name="folder" />);
  expect(icon).toContain('width="16"');
  expect(icon).toContain('height="16"');
  expect(icon).toContain('stroke="currentColor"');
  expect(icon).toContain('stroke-width="1.75"');
  expect(icon).toContain('aria-hidden="true"');
  expect(icon).toContain('focusable="false"');
  expect(renderToStaticMarkup(<UiIcon name="settings" size={18} />)).toContain('width="18"');
});

it('item names have filled folders and no inline favorite control', () => {
  const html = renderToStaticMarkup(<ItemDetails folder={{ id: 'f', name: 'Study', parentId: null, pinned: true, createdAt: 1 }} />);
  expect(html).toContain('tabler-icon-folder');
  expect(html).toContain('tabler-icon-folder-filled');
  expect(html).not.toContain('tabler-icon-star');
  expect(html).not.toMatch(/[▰★☆]/);
});

it('icon-only dialog close keeps its accessible button label', () => {
  const html = renderToStaticMarkup(<Dialog title="Settings" onClose={() => {}}>Content</Dialog>);
  expect(html).toContain('aria-label="Close"');
  expect(html).toContain('tabler-icon-x');
  expect(html).not.toContain('×');
});

it('favorite controls expose filled status and accessible toggle names', () => {
  const html = renderToStaticMarkup(<FavoriteButton favorite name="Study" onToggle={() => {}} />);
  expect(html).toContain('tabler-icon-star-filled');
  expect(html).toContain('is-favorite');
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain('Remove from Favorites: Study');
  const off = renderToStaticMarkup(<FavoriteButton favorite={false} name="Study" onToggle={() => {}} />);
  expect(off).toContain('aria-pressed="false"');
  expect(off).not.toContain('star-filled');
  expect(off).toContain('Add to Favorites: Study');
});
it('folder fields contain decoration controls without chat naming semantics', () => {
  const html = renderToStaticMarkup(<FolderColorFields color="#123456" change={() => {}} />);
  expect(html).toContain('Custom color');
  expect(html).toContain('type="color"');
  expect(html).not.toMatch(/Color label|Color name|Shared by all chats|Color 1/);
});

it('names render without native tooltip or an eager custom tooltip', () => {
  const html = renderToStaticMarkup(<TruncatedName>Full name</TruncatedName>);
  expect(html).toContain('class="truncate"');
  expect(html).toContain('Full name');
  expect(html).not.toContain('title=');
  expect(html).not.toContain('role="tooltip"');
});
