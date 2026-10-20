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
it('persists folder favorite migration once after preserving the original backup', async () => {
  const raw = { ...defaults(), folders: [{ id: 'f', name: 'Folder', parentId: null, favorite: true, createdAt: 1 }] };
  const data: Record<string, unknown> = { explorerState: raw };
  const set = vi.fn(async (change: Record<string, unknown>) => { Object.assign(data, change); });
  vi.stubGlobal('chrome', { storage: { local: { get: async () => data, set } } });
  try {
    const result = await loadState();
    expect(result.warning).toBe('');
    expect(result.state.folders[0]).toMatchObject({ pinned: true, createdAt: 1 });
    expect(result.state.folders[0]).not.toHaveProperty('favorite');
    expect(set.mock.calls[0][0]).toMatchObject({ migrationBackupFolderPins: raw });
    expect(data.explorerState).toEqual(result.state);
    set.mockClear();
    await loadState();
    expect(set).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});
