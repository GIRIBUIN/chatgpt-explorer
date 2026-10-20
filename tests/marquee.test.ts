import { it, expect } from 'vitest';
import { contentPoint, selectionRectangle, overlaps, marqueeSelection, pastThreshold } from '../src/models/marquee';

it('normalizes selection rectangles in every drag direction', () => {
  expect(selectionRectangle({ x: 30, y: 60 }, { x: 10, y: 20 })).toEqual({ x: 10, y: 20, width: 20, height: 40 });
  expect(selectionRectangle({ x: 10, y: 20 }, { x: 30, y: 60 })).toEqual({ x: 10, y: 20, width: 20, height: 40 });
});
it.each([[3, false], [4, true], [5, true]])('distinguishes a %ipx drag from a click', (distance, expected) => {
  expect(pastThreshold({ x: 10, y: 10 }, { x: 10 + Number(distance), y: 10 })).toBe(expected);
});
it('requires actual rectangle overlap rather than edge contact or a zero-area line', () => {
  const row = { x: 10, y: 20, width: 80, height: 30 };
  expect(overlaps(row, { x: 89, y: 49, width: 10, height: 10 })).toBe(true);
  expect(overlaps(row, { x: 90, y: 20, width: 10, height: 10 })).toBe(false);
  expect(overlaps(row, { x: 15, y: 25, width: 0, height: 10 })).toBe(false);
});
it('plain marquee replaces selection and establishes a visible-row anchor', () => {
  expect(marqueeSelection({ ids: ['a', 'b'], anchor: 'a' }, ['folder:c', 'conversation:d'], false))
    .toEqual({ ids: ['folder:c', 'conversation:d'], anchor: 'folder:c' });
  expect(marqueeSelection({ ids: ['a'], anchor: 'a' }, [], false)).toEqual({ ids: [], anchor: null });
});
it('Ctrl/Cmd marquee is additive without toggling or duplicates', () => {
  const base = { ids: ['a', 'b'], anchor: 'b' };
  expect(marqueeSelection(base, ['b', 'c', 'd'], true)).toEqual({ ids: ['a', 'b', 'c', 'd'], anchor: 'b' });
  expect(marqueeSelection(base, [], true)).toEqual(base);
  expect(base).toEqual({ ids: ['a', 'b'], anchor: 'b' });
});
it.each([0.8, 1, 1.4])('content coordinates account for scrolling at scale %s', zoom => {
  const client = { x: 100 + 60 * zoom, y: 80 + 120 * zoom };
  const p = contentPoint(client, { x: 100, y: 80 }, { x: 10, y: 200 }, zoom);
  expect(p.x).toBeCloseTo(70); expect(p.y).toBeCloseTo(320);
});
