export const uiScales = [80, 90, 100, 110, 120, 130, 140] as const;
export function uiScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 100;
  return Math.max(80, Math.min(140, Math.round(value / 10) * 10));
}
export function scaleStep(value: unknown, direction: -1 | 0 | 1): number {
  return direction === 0 ? 100 : uiScale(uiScale(value) + direction * 10);
}
export function scaleShortcut(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; key: string; code?: string; isComposing?: boolean }): -1 | 0 | 1 | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.isComposing) return null;
  if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') return 1;
  if (e.key === '-' || e.code === 'NumpadSubtract') return -1;
  // With NumLock off Numpad0 is Insert; Ctrl+Insert must remain Copy.
  if (e.key === '0') return 0;
  return null;
}
// Pointer coordinates are physical CSS viewport coordinates; zoomed fixed menus
// use the document's unscaled coordinates instead.
export function menuPosition(x: number, y: number, width: number, height: number, scale: unknown) {
  const factor = uiScale(scale) / 100;
  return { x: Math.max(8, Math.min(x / factor, width / factor - 240)),
    y: Math.max(8, Math.min(y / factor, height / factor - 330)) };
}
