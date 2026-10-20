import { webext } from "../utils/browser";
import { isBounds } from "../utils/bounds";

// Firefox has no windows.onBoundsChanged. Poll only while Explorer is open,
// writing changed normal bounds; maximized/minimized geometry is not persisted.
export function watchWindowBounds() {
  if (webext().windows.onBoundsChanged) return () => {};
  let previous = "",
    busy = false,
    disposed = false;
  const capture = async () => {
    if (busy || disposed) return;
    busy = true;
    try {
      const win = await webext().windows.getCurrent();
      if (
        disposed ||
        win.type !== "popup" ||
        win.state !== "normal" ||
        !isBounds(win)
      )
        return;
      const bounds = {
        left: win.left,
        top: win.top,
        width: win.width,
        height: win.height,
      };
      const key = JSON.stringify(bounds);
      if (key !== previous) {
        await webext().storage.local.set({ windowBounds: bounds });
        previous = key;
      }
    } catch {
      /* Retry on next poll without interrupting the Explorer. */
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void capture(), 1000);
  void capture();
  return () => {
    disposed = true;
    clearInterval(timer);
  };
}
