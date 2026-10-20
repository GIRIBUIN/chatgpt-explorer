import { IconStar, IconStarFilled } from '@tabler/icons-react';
import { t } from '../i18n';

export function FavoriteButton({ favorite, name, onToggle }: {
  favorite: boolean; name: string; onToggle: () => void;
}) {
  const Icon = favorite ? IconStarFilled : IconStar;
  return <button type="button" className={`favorite-button${favorite ? ' is-favorite' : ''}`}
    aria-label={`${t(favorite ? 'removeFromFavorites' : 'addToFavorites')}: ${name}`}
    aria-pressed={favorite}
    onDoubleClick={e => e.stopPropagation()}
    onClick={e => { e.stopPropagation(); onToggle(); }}>
    <Icon size={16} stroke={1.75} color="currentColor" aria-hidden="true" focusable="false" />
  </button>;
}
