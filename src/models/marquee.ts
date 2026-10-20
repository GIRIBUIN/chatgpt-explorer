export type Point = { x: number; y: number };
export type Rectangle = Point & { width: number; height: number };
export type Selection = { ids: string[]; anchor: string | null };
export const MARQUEE_THRESHOLD = 4;
export const pastThreshold = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) >= MARQUEE_THRESHOLD;
export const contentPoint = (client: Point, origin: Point, scroll: Point, zoom: number): Point => ({
  x: (client.x - origin.x) / zoom + scroll.x, y: (client.y - origin.y) / zoom + scroll.y,
});
export const selectionRectangle = (a: Point, b: Point): Rectangle => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y),
});
export const overlaps = (a: Rectangle, b: Rectangle) => a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0 &&
  a.x < b.x + b.width && a.x + a.width > b.x &&
  a.y < b.y + b.height && a.y + a.height > b.y;
export function marqueeSelection(base: Selection, hits: string[], additive: boolean): Selection {
  const ids = [...new Set(additive ? [...base.ids, ...hits] : hits)];
  return { ids, anchor: additive && base.anchor && ids.includes(base.anchor) ? base.anchor : ids[0] ?? null };
}
