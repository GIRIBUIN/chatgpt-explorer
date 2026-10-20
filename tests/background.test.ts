import { beforeEach, describe, expect, it, vi } from "vitest";
const event = () => ({ addListener: vi.fn() });
function mockChrome() {
  const chrome = {
    runtime: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      id: "test",
      getURL: (path: string) => `chrome-extension://test/${path}`,
      onMessage: event(),
    },
    action: { onClicked: event() },
    commands: { onCommand: event() },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
      session: {
        get: vi.fn().mockResolvedValue({ sourceWindowId: 1 }),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
    windows: {
      getAll: vi.fn().mockResolvedValue([]),
      getLastFocused: vi.fn().mockResolvedValue({
        id: 1,
        type: "normal",
        left: 100,
        top: 100,
        width: 1200,
        height: 800,
      }),
      create: vi.fn().mockResolvedValue({ id: 2 }),
      update: vi.fn().mockResolvedValue({}),
      get: vi
        .fn()
        .mockResolvedValue({ id: 1, type: "normal", state: "normal" }),
      onRemoved: event(),
      onFocusChanged: event(),
      onBoundsChanged: event(),
    },
    system: {
      display: {
        getInfo: vi.fn().mockResolvedValue([
          {
            isPrimary: true,
            workArea: { left: 0, top: 0, width: 1920, height: 1080 },
          },
        ]),
      },
    },
    tabs: {
      sendMessage: vi.fn().mockResolvedValue({
        ok: true,
        hasSidebar: true,
        url: "https://chatgpt.com/",
        visibleConversationCount: 3,
      }),
      query: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 50, status: "complete" }),
      get: vi.fn().mockResolvedValue({ id: 50, status: "complete" }),
      remove: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue({}),
    },
    scripting: {
      executeScript: vi.fn().mockResolvedValue([
        {
          result: {
            url: "https://chatgpt.com/",
            mainHeading: null,
            links: [],
          },
        },
      ]),
    },
  };
  vi.stubGlobal("chrome", chrome);
  return chrome;
}
beforeEach(() => vi.resetModules());
describe("MV3 lifecycle", () => {
  it("keeps real ChatGPT tabs available for Current Chat and tab reuse", async () => {
    const c = mockChrome();
    const owned = {
      id: 99,
      windowId: 1,
      url: "https://chatgpt.com/c/temporary",
      lastAccessed: 500,
    };
    const user = {
      id: 5,
      windowId: 1,
      url: "https://chatgpt.com/c/user",
      lastAccessed: 10,
    };
    c.windows.getAll.mockResolvedValue([
      { id: 1, type: "normal", tabs: [owned, user] },
    ]);
    c.tabs.query.mockResolvedValue([owned, user]);
    const { openChat } = await import("../src/background");

    const handler = c.runtime.onMessage.addListener.mock.calls[0][0];
    const response = await new Promise<{ value: { id: string }[] }>((resolve) =>
      handler(
        { type: "current-chat" },
        { id: "test", url: "chrome-extension://test/explorer.html" },
        resolve,
      ),
    );
    expect(response.value.map((item) => item.id)).toEqual([
      "temporary",
      "user",
    ]);
    await openChat("https://chatgpt.com/c/another");
    expect(c.tabs.update).toHaveBeenCalledWith(99, expect.anything());
  });
  it("selects a normal window when Firefox last-focused is the Explorer popup", async () => {
    const c = mockChrome();
    c.windows.getLastFocused.mockResolvedValue({
      id: 9,
      type: "popup",
      left: 0,
      top: 0,
      width: 900,
      height: 650,
    });
    c.windows.getAll.mockResolvedValue([
      { id: 3, type: "normal", tabs: [{ lastAccessed: 200 }] },
    ]);
    const { openChat } = await import("../src/background");
    await openChat("https://chatgpt.com/c/a", "new-tab");
    expect(c.windows.getLastFocused).toHaveBeenCalledWith();
    expect(c.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ windowId: 3 }),
    );
  });
  it("coalesces repeated import requests until scanning finishes", async () => {
    const c = mockChrome();
    const { scanChats } = await import("../src/background");
    const first = scanChats();
    expect(scanChats()).toBe(first);
    await first;
    expect(c.windows.getAll).toHaveBeenCalledTimes(1);
    await scanChats();
    expect(c.windows.getAll).toHaveBeenCalledTimes(2);
  });
  it("opens without the Chromium display API", async () => {
    const c = mockChrome();
    Reflect.deleteProperty(c, "system");
    const { openExplorer } = await import("../src/background");
    await openExplorer();
    expect(c.windows.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: "popup", width: 900, height: 650 }),
    );
  });
  it.each(["new-tab", "new-window"] as const)(
    "Open follows the configured %s default",
    async (mode) => {
      const c = mockChrome();
      c.storage.local.get.mockResolvedValue({
        explorerState: { settings: { defaultOpenBehavior: mode } },
      });
      const { openChat } = await import("../src/background");
      await openChat("https://chatgpt.com/c/a");
      if (mode === "new-tab")
        expect(c.tabs.create).toHaveBeenCalledWith(
          expect.objectContaining({
            url: "https://chatgpt.com/c/a",
            windowId: 1,
          }),
        );
      else
        expect(c.windows.create).toHaveBeenCalledWith({
          url: "https://chatgpt.com/c/a",
          type: "normal",
          focused: true,
        });
      expect(c.tabs.update).not.toHaveBeenCalled();
    },
  );
  it.each(["new-tab", "new-window"] as const)(
    "explicit %s overrides the default",
    async (mode) => {
      const c = mockChrome();
      c.storage.local.get.mockResolvedValue({
        explorerState: { settings: { defaultOpenBehavior: "reuse" } },
      });
      const { openChat } = await import("../src/background");
      await openChat("https://chatgpt.com/c/a", mode);
      expect(c.tabs.query).not.toHaveBeenCalled();
      if (mode === "new-tab") expect(c.tabs.create).toHaveBeenCalledTimes(1);
      else
        expect(c.windows.create).toHaveBeenCalledWith(
          expect.objectContaining({ type: "normal" }),
        );
    },
  );
  it("reports injection failure without importing open tabs", async () => {
    const c = mockChrome();
    c.windows.getAll.mockResolvedValue([
      {
        id: 1,
        type: "normal",
        tabs: [
          {
            id: 5,
            windowId: 1,
            url: "https://chatgpt.com/c/open",
            title: "Open",
          },
        ],
      },
    ]);
    c.tabs.sendMessage.mockRejectedValue(Error("No receiver"));
    c.scripting.executeScript.mockRejectedValue(Error("unavailable"));
    const { scanChats } = await import("../src/background");
    const result = await scanChats();
    expect(result.failedPages).toBe(1);
    expect(result.candidates).toEqual([]);
    expect(c.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 5, frameIds: [0] },
        world: "ISOLATED",
      }),
    );
  });
  it("includes general rendered sidebar conversations from the existing real tab", async () => {
    const c = mockChrome();
    c.windows.getAll.mockResolvedValue([
      {
        id: 1,
        type: "normal",
        tabs: [{ id: 5, windowId: 1, url: "https://chatgpt.com/" }],
      },
    ]);
    c.scripting.executeScript.mockResolvedValue([
      {
        result: {
          url: "https://chatgpt.com/",
          mainHeading: null,
          links: [
            {
              href: "https://chatgpt.com/c/from-sidebar",
              title: "Sidebar title",
              projectHeaders: [],
              inProjectMain: false,
            },
          ],
        },
      },
    ]);
    const { scanChats } = await import("../src/background");
    expect((await scanChats()).candidates[0].title).toBe("Sidebar title");
    expect(c.tabs.create).not.toHaveBeenCalled();
    expect(c.tabs.remove).not.toHaveBeenCalled();
    expect(c.tabs.update).not.toHaveBeenCalled();
  });
  it("serializes concurrent launches and centers the popup", async () => {
    const c = mockChrome();
    const { openExplorer } = await import("../src/background");
    await Promise.all([openExplorer(), openExplorer()]);
    expect(c.windows.create).toHaveBeenCalledTimes(1);
    expect(c.windows.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "popup",
        width: 900,
        height: 650,
        left: 250,
        top: 175,
      }),
    );
  });
  it("finds an existing minimized Explorer after worker restart", async () => {
    const c = mockChrome();
    c.windows.getAll.mockResolvedValue([
      {
        id: 7,
        state: "minimized",
        tabs: [{ url: "chrome-extension://test/explorer.html" }],
      },
    ]);
    const { openExplorer } = await import("../src/background");
    await openExplorer();
    expect(c.windows.create).not.toHaveBeenCalled();
    expect(c.windows.update).toHaveBeenCalledWith(7, {
      focused: true,
      state: "normal",
    });
  });
  it("clamps stored bounds from a removed monitor", async () => {
    const c = mockChrome();
    c.storage.local.get.mockResolvedValue({
      windowBounds: { left: 9000, top: 9000, width: 900, height: 650 },
    });
    const { openExplorer } = await import("../src/background");
    await openExplorer();
    expect(c.windows.create).toHaveBeenCalledWith(
      expect.objectContaining({ left: 1020, top: 430 }),
    );
  });
  it("Current Chat searches all normal windows, never the Explorer popup", async () => {
    const c = mockChrome();
    c.windows.getAll.mockResolvedValue([
      {
        id: 1,
        type: "normal",
        tabs: [
          {
            id: 5,
            url: "https://chatgpt.com/c/abc",
            title: "Example - ChatGPT",
          },
        ],
      },
      {
        id: 2,
        type: "popup",
        tabs: [{ id: 6, url: "https://chatgpt.com/c/popup" }],
      },
    ]);
    await import("../src/background");
    const handler = c.runtime.onMessage.addListener.mock.calls[0][0];
    const result = await new Promise((resolve) =>
      handler(
        { type: "current-chat" },
        { id: "test", url: "chrome-extension://test/explorer.html" },
        resolve,
      ),
    );
    expect(c.windows.getAll).toHaveBeenCalledWith({
      populate: true,
      windowTypes: ["normal"],
    });
    expect(c.tabs.query).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      value: [
        {
          id: "abc",
          projectId: null,
          tabId: 5,
          windowId: 1,
          lastAccessed: 0,
          active: false,
          url: "https://chatgpt.com/c/abc",
          title: "Example",
        },
      ],
    });
  });
  it("reuses the most recently accessed ChatGPT tab and does not close Explorer", async () => {
    const c = mockChrome();
    c.tabs.query.mockResolvedValue([
      { id: 3, windowId: 1, lastAccessed: 5, url: "https://chatgpt.com/" },
      { id: 4, windowId: 2, lastAccessed: 10, url: "https://chatgpt.com/" },
    ]);
    await import("../src/background");
    const handler = c.runtime.onMessage.addListener.mock.calls[0][0];
    await new Promise((resolve) =>
      handler(
        { type: "open-chat", url: "https://chatgpt.com/c/new" },
        { id: "test", url: "chrome-extension://test/explorer.html" },
        resolve,
      ),
    );
    expect(c.tabs.update).toHaveBeenCalledWith(4, {
      url: "https://chatgpt.com/c/new",
      active: true,
    });
    expect(c.tabs.create).not.toHaveBeenCalled();
  });
});

it("activates a reused tab without URL update when the SPA click succeeds", async () => {
  const c = mockChrome();
  c.tabs.query.mockResolvedValue([
    { id: 4, windowId: 1, url: "https://chatgpt.com/" },
  ]);
  c.scripting.executeScript.mockResolvedValue([{ result: true }] as never);
  const { openChat } = await import("../src/background");
  await openChat("https://chatgpt.com/c/a", "reuse");
  expect(c.tabs.update).toHaveBeenCalledWith(4, { active: true });
  expect(c.tabs.create).not.toHaveBeenCalled();
});
it("retains full-navigation fallback when SPA injection fails", async () => {
  const c = mockChrome();
  c.tabs.query.mockResolvedValue([
    { id: 4, windowId: 1, url: "https://chatgpt.com/" },
  ]);
  c.scripting.executeScript.mockRejectedValue(Error("unavailable"));
  const { openChat } = await import("../src/background");
  await openChat("https://chatgpt.com/c/a", "reuse");
  expect(c.tabs.update).toHaveBeenCalledWith(4, {
    active: true,
    url: "https://chatgpt.com/c/a",
  });
});
