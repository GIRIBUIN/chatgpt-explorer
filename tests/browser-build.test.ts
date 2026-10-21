import { expect, it, vi } from "vitest";
import { manifestFor } from "../scripts/manifest";
import { webext } from "../src/utils/browser";
import { watchWindowBounds } from "../src/explorer/window-bounds";
import { readFileSync } from "node:fs";

it.each(["chromium", "firefox"] as const)("uses supplied PNG icons in the %s manifest", (target) => {
  const manifest = manifestFor(target);
  for (const [size, path] of Object.entries(manifest.icons)) {
    const png = readFileSync(new URL(`../assets/${path}`, import.meta.url));
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const header = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(header.getUint32(16)).toBe(Number(size));
    expect(header.getUint32(20)).toBe(Number(size));
  }
  for (const [size, path] of Object.entries(manifest.action.default_icon)) {
    expect(manifest.icons[size as keyof typeof manifest.icons]).toBe(path);
  }
});

it("generates a Chromium MV3 service worker manifest", () => {
  const m = manifestFor("chromium");
  expect(m.manifest_version).toBe(3);
  expect(m.background).toEqual({
    service_worker: "background.js",
    type: "module",
  });
  expect(m.permissions).toContain("system.display");
});
it("generates a Firefox MV3 event page manifest without Chromium-only permission", () => {
  const m = manifestFor("firefox");
  expect(m.manifest_version).toBe(3);
  expect(m.background).toEqual({ scripts: ["background.js"], type: "module" });
  expect(m.permissions).not.toContain("system.display");
  expect(m).not.toHaveProperty("minimum_chrome_version");
  expect(m).toHaveProperty("browser_specific_settings.gecko.id");
});
it("shares UI, permissions and commands without mutating the source manifest", () => {
  const a = manifestFor("chromium"),
    b = manifestFor("firefox");
  expect(a.action).toEqual(b.action);
  expect(a.commands).toEqual(b.commands);
  expect(a.host_permissions).toEqual(b.host_permissions);
  expect(manifestFor("chromium").permissions).toContain("system.display");
});
it("uses the Firefox promise namespace when available", () => {
  const fake = { runtime: {} };
  vi.stubGlobal("browser", fake);
  expect(webext()).toBe(fake);
  vi.unstubAllGlobals();
});
it("persists changed Firefox popup bounds without a bounds event and stops polling on cleanup", async () => {
  vi.useFakeTimers();
  const win = {
    type: "popup",
    state: "normal",
    left: 20,
    top: 30,
    width: 900,
    height: 650,
  };
  const getCurrent = vi.fn().mockResolvedValue(win),
    set = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("browser", {
    windows: { getCurrent },
    storage: { local: { set } },
  });
  const stop = watchWindowBounds();
  try {
    await vi.advanceTimersByTimeAsync(1000);
    expect(set).toHaveBeenCalledTimes(1);
    win.left = 80;
    await vi.advanceTimersByTimeAsync(1000);
    expect(set).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenLastCalledWith({
      windowBounds: { left: 80, top: 30, width: 900, height: 650 },
    });
    win.state = "maximized";
    win.width = 1800;
    await vi.advanceTimersByTimeAsync(1000);
    expect(set).toHaveBeenCalledTimes(2);
    stop();
    const calls = getCurrent.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(getCurrent).toHaveBeenCalledTimes(calls);
  } finally {
    stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
