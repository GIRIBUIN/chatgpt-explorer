import { IconFolderFilled } from '@tabler/icons-react';
import { validColor } from '../models/state';

/** Only this decorative icon receives the user's color; names/selection keep theme colors. */
export function FolderIcon({ color }: { color?: string }) {
  const colored = validColor(color);
  return <IconFolderFilled size={16} stroke={1.75} className="ui-icon colored-folder-icon"
    color={colored ? color : 'var(--folder-default-color)'} aria-hidden="true" focusable="false" />;
}
