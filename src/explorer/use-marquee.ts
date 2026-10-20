import { useEffect, useRef, useState, type Dispatch, type SetStateAction, type PointerEvent } from 'react';
import { contentPoint, marqueeSelection, overlaps, pastThreshold, selectionRectangle,
  type Point, type Rectangle, type Selection } from '../models/marquee';

type Options = { keys: string[]; selection: Selection; select: Dispatch<SetStateAction<Selection>>; scope: string; disabled: boolean };
type Gesture = { id: number; origin: Point; start: Point; client: Point; base: Selection;
  additive: boolean; active: boolean; result: Selection };

export function useMarquee(options: Options) {
  const main = useRef<HTMLElement>(null), latest = useRef(options);
  latest.current = options;
  const gesture = useRef<Gesture | null>(null), suppressClick = useRef(false);
  const [rectangle, setRectangle] = useState<Rectangle | null>(null);
  const zoom = () => Number(getComputedStyle(document.documentElement).zoom) || 1;
  const viewport = (el: HTMLElement, scale: number) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + el.clientLeft * scale, y: r.top + el.clientTop * scale,
      width: el.clientWidth * scale, height: el.clientHeight * scale };
  };
  function finish(restore: boolean) {
    const g = gesture.current;
    gesture.current = null;
    if (g && main.current?.hasPointerCapture(g.id)) main.current.releasePointerCapture(g.id);
    if (g && restore) latest.current.select(g.base);
    // A blur-save may reorder the view before pointerup: the empty press still clears.
    else if (g && !g.active && !g.additive) latest.current.select({ ids: [], anchor: null });
    setRectangle(null);
  }
  function update(client: Point) {
    const el = main.current, g = gesture.current;
    if (!el || !g) return;
    g.client = client;
    if (!g.active && !pastThreshold(g.origin, client)) return;
    g.active = true;
    const scale = zoom(), v = viewport(el, scale);
    const point = contentPoint({ x: Math.max(v.x, Math.min(client.x, v.x + v.width)),
      y: Math.max(v.y, Math.min(client.y, v.y + v.height)) }, v, { x: el.scrollLeft, y: el.scrollTop }, scale);
    const box = selectionRectangle(g.start, point), keys = new Set(latest.current.keys), hits: string[] = [];
    for (const row of el.querySelectorAll<HTMLElement>('.item-row[data-item-key]')) {
      const key = row.dataset.itemKey!;
      if (!keys.has(key) || !row.getClientRects().length) continue;
      const r = row.getBoundingClientRect();
      const p = contentPoint({ x: r.left, y: r.top }, v, { x: el.scrollLeft, y: el.scrollTop }, scale);
      if (overlaps(box, { ...p, width: r.width / scale, height: r.height / scale })) hits.push(key);
    }
    const base = { ...g.base, ids: g.base.ids.filter(id => keys.has(id)) };
    g.result = marqueeSelection(base, hits, g.additive);
    latest.current.select(g.result);
    setRectangle(box);
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!gesture.current) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(true); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') finish(false);
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      const g = gesture.current;
      gesture.current = null;
      if (g && main.current?.hasPointerCapture(g.id)) main.current.releasePointerCapture(g.id);
    };
  }, []);
  useEffect(() => { finish(false); }, [options.scope, options.disabled]);
  return { ref: main, rectangle, handlers: {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (latest.current.disabled || gesture.current || e.button !== 0 || !e.isPrimary || e.altKey || e.shiftKey) return;
      const el = e.currentTarget, target = e.target;
      if (!(target instanceof Element) || (target !== el && !target.matches('.file-list, .empty, .empty-small'))) return;
      const scale = zoom(), v = viewport(el, scale), client = { x: e.clientX, y: e.clientY };
      // Exclude native scrollbars as well as controls/header/row descendants.
      if (client.x < v.x || client.x >= v.x + v.width || client.y < v.y || client.y >= v.y + v.height) return;
      const base = latest.current.selection;
      gesture.current = { id: e.pointerId, origin: client, client, base, result: base,
        start: contentPoint(client, v, { x: el.scrollLeft, y: el.scrollTop }, scale),
        additive: e.ctrlKey || e.metaKey, active: false };
      el.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (gesture.current?.id !== e.pointerId) return;
      update({ x: e.clientX, y: e.clientY });
      if (gesture.current?.active) e.preventDefault();
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const g = gesture.current;
      if (!g || g.id !== e.pointerId) return;
      update({ x: e.clientX, y: e.clientY });
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      finish(false);
      if (g.active && g.result.anchor) {
        const row = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('.item-row[data-item-key]'))
          .find(row => row.dataset.itemKey === g.result.anchor);
        row?.focus({ preventScroll: true });
      }
    },
    onPointerCancel: (e: PointerEvent<HTMLElement>) => { if (gesture.current?.id === e.pointerId) finish(true); },
    onLostPointerCapture: (e: PointerEvent<HTMLElement>) => { if (gesture.current?.id === e.pointerId) finish(true); },
    onScroll: () => { if (gesture.current) update(gesture.current.client); },
    onClickCapture: (e: React.MouseEvent) => {
      if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); suppressClick.current = false; }
    },
    onDragStartCapture: (e: React.DragEvent) => { if (gesture.current) { e.preventDefault(); e.stopPropagation(); } },
  } };
}
