import { IconPin, IconPinFilled } from '@tabler/icons-react';
import { t } from '../i18n';

export function FolderPinButton({ pinned, name, onToggle, disabled = false }: {
  pinned: boolean; name: string; onToggle: () => void; disabled?: boolean;
}) {
  const Icon = pinned ? IconPinFilled : IconPin;
  return <button type="button" className={`folder-pin-button${pinned ? ' is-pinned' : ''}`}
    disabled={disabled}
    aria-label={`${t(pinned ? 'unpinFolder' : 'pinFolder')}: ${name}`} aria-pressed={pinned}
    onDoubleClick={e => e.stopPropagation()}
    onClick={e => { e.stopPropagation(); onToggle(); }}>
    <Icon size={16} stroke={1.75} color="currentColor" aria-hidden="true" focusable="false" />
  </button>;
}
