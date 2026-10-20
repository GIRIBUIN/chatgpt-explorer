import { expect, it, vi } from "vitest";
import { loadState } from "../src/storage";
import { defaults } from "../src/models/state";
it("does not report corruption when Chrome changes object key order", async () => {
  const state = defaults();
  const raw = JSON.parse(
    JSON.stringify(state, (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value,
    ),
  );
  const set = vi.fn();
  vi.stubGlobal("chrome", {
    storage: {
      local: { get: vi.fn().mockResolvedValue({ explorerState: raw }), set },
    },
  });
  expect((await loadState()).warning).toBe("");
  expect(set).not.toHaveBeenCalled();
});
it("backs up corrupt raw data before repair and refuses to overwrite future versions", async () => {
  const raw = { version: 1, folders: "broken" };
  const set = vi.fn().mockResolvedValue(undefined);
  const get = vi.fn().mockResolvedValue({ explorerState: raw });
  vi.stubGlobal("chrome", { storage: { local: { get, set } } });
  const result = await loadState();
  expect(result.state).toEqual(defaults());
  expect(set).toHaveBeenCalledWith({
    recoveryBackup: { savedAt: expect.any(Number), raw },
  });
  set.mockClear();
  get.mockResolvedValue({ explorerState: { ...defaults(), version: 99 } });
  expect((await loadState()).readOnly).toBe(true);
  expect(set).not.toHaveBeenCalled();
});
