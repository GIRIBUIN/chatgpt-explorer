import { t } from '../i18n';
import { scaleStep, uiScale } from '../models/ui-scale';

export function InterfaceScale({ value, change }: { value?: number; change: (value: number) => void }) {
  const scale = uiScale(value);
  return <div className="settings-row" role="group" aria-label={t('interfaceScale')}>
    <span>{t('interfaceScale')}</span>
    <div className="dialog-actions settings-actions scale-actions">
      <button type="button" aria-label={t('zoomOut')} disabled={scale === 80} onClick={() => change(scaleStep(scale, -1))}>−</button>
      <output aria-live="polite" aria-label={t('interfaceScale')}>{scale}%</output>
      <button type="button" aria-label={t('zoomIn')} disabled={scale === 140} onClick={() => change(scaleStep(scale, 1))}>+</button>
    </div>
  </div>;
}
