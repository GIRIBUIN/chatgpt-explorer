import type { Bounds } from "../models/types";
export function clampBounds(bounds: Bounds, area: Bounds): Bounds {
  const width = Math.min(area.width, Math.max(480, bounds.width)),
    height = Math.min(area.height, Math.max(360, bounds.height));
  return {
    width,
    height,
    left: Math.round(
      Math.max(
        area.left,
        Math.min(bounds.left, area.left + area.width - width),
      ),
    ),
    top: Math.round(
      Math.max(area.top, Math.min(bounds.top, area.top + area.height - height)),
    ),
  };
}
export function isBounds(x: unknown): x is Bounds {
  return (
    !!x &&
    typeof x === "object" &&
    ["left", "top", "width", "height"].every(
      (k) =>
        typeof (x as Record<string, unknown>)[k] === "number" &&
        Number.isFinite((x as Record<string, unknown>)[k]),
    ) &&
    (x as Bounds).width > 0 &&
    (x as Bounds).height > 0
  );
}
