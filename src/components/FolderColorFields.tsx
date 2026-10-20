import { presets, validColor } from '../models/state';
import { t } from '../i18n';

/** Folder decoration shares HEX swatches, never chat label rules or names. */
export function FolderColorFields({ color, change }: { color: string; change: (color: string) => void }) {
  return <>
    <div className="swatches">
      {presets.map(value => <button type="button" key={value}
        aria-label={`${t('folderColor')} ${value}`} aria-pressed={color === value}
        title={value} style={{ background: value }} onClick={() => change(value)} />)}
    </div>
    <label>{t('customColor')}<input type="color" value={validColor(color) ? color : presets[2]}
      onChange={e => change(e.target.value)} /></label>
    <label>{t('hEX')}<input value={color} pattern="#[0-9a-fA-F]{6}"
      onChange={e => change(e.target.value)} /></label>
  </>;
}
