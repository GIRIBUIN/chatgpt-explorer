import {
  IconHome, IconStar, IconInbox, IconFolder, IconFolderPlus,
  IconMessagePlus, IconDownload, IconUpload, IconSearch, IconSettings,
  IconDots, IconSortAscending, IconSortDescending, IconArrowLeft,
  IconArrowRight, IconArrowUp, IconArrowDown, IconChevronRight,
  IconChevronDown, IconRefresh, IconKey, IconLock, IconAlertTriangle,
  IconAlertCircle, IconInfoCircle, IconFileImport, IconFileExport,
  IconX, IconLink, IconUnlink, IconCopy, IconCommand, IconPin,
} from '@tabler/icons-react';

// One semantic mapping keeps repeated actions consistent across the Explorer.
const icons = {
  home: IconHome, favorite: IconStar, inbox: IconInbox, folder: IconFolder,
  newFolder: IconFolderPlus, currentChat: IconMessagePlus, download: IconDownload,
  upload: IconUpload, search: IconSearch, settings: IconSettings, more: IconDots,
  sortAscending: IconSortAscending, sortDescending: IconSortDescending,
  back: IconArrowLeft, forward: IconArrowRight, up: IconArrowUp, down: IconArrowDown,
  chevronRight: IconChevronRight, chevronDown: IconChevronDown, sync: IconRefresh,
  key: IconKey, lock: IconLock, warning: IconAlertTriangle, error: IconAlertCircle,
  info: IconInfoCircle, import: IconFileImport, export: IconFileExport,
  close: IconX, connect: IconLink, disconnect: IconUnlink, copy: IconCopy,
  commands: IconCommand, pin: IconPin,
};

/** Decorative: the surrounding text or button aria-label supplies the name. */
export function UiIcon({ name, size = 16 }: { name: keyof typeof icons; size?: 16 | 18 }) {
  const Icon = icons[name];
  return <Icon className="ui-icon" size={size} stroke={1.75} color="currentColor"
    aria-hidden="true" focusable="false" />;
}
