import type { Location } from "../models/types";
export type History = { entries: Location[]; index: number };
export function navigate(h: History, to: Location): History {
  return h.entries[h.index] === to
    ? h
    : { entries: [...h.entries.slice(0, h.index + 1), to], index: h.index + 1 };
}
export function travel(h: History, delta: number): History {
  return {
    ...h,
    index: Math.max(0, Math.min(h.entries.length - 1, h.index + delta)),
  };
}
