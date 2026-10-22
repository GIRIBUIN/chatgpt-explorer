import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { defaults } from "../src/models/state";
import { importChats } from "../src/models/import";

const snapshot = (id = "found") => ({
  url: "https://chatgpt.com/c/user",
  mainHeading: null,
  links: [
    {
      href: `https://chatgpt.com/c/${id}`,
      title: id,
      projectHeaders: [],
      inProjectMain: false,
    },
  ],
});
function setup(namespace = "chrome") {
  const user = {
    id: 7,
    windowId: 1,
    active: true,
    url: "https://chatgpt.com/c/user",
    title: "User",
  };
  const api = {
    windows: {
      getAll: vi
        .fn()
        .mockResolvedValue([{ id: 1, type: "normal", tabs: [user] }]),
      update: vi.fn(),
    },
    tabs: {
      sendMessage: vi.fn().mockResolvedValue({
        ok: true,
        hasSidebar: true,
        url: "https://chatgpt.com/c/user",
        visibleConversationCount: 3,
      }),
      create: vi.fn().mockResolvedValue({ id: 99, status: "complete" }),
      remove: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue({ id: 99, status: "complete" }),
      update: vi.fn(),
    },
    runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) },
    scripting: {
      executeScript: vi.fn<
        (request: {
          func: { name: string };
          args?: string[];
          target?: { tabId: number };
        }) => Promise<{ result: unknown }[]>
      >(async ({ func }) => [
        { result: func.name === "readRenderedPage" ? snapshot() : null },
      ]),
    },
  };
  vi.stubGlobal(namespace, api);
  return { api, user };
}
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each(["chrome", "browser"])(
  "%s traverses the current real tab and restores without creating or closing tabs",
  async (namespace) => {
    const { api, user } = setup(namespace);
    const before = { ...user };
    const { scanChats } = await import("../src/background/import");
    const result = await scanChats("session-a");
    expect(api.tabs.create).not.toHaveBeenCalled();
    for (const [request] of api.scripting.executeScript.mock.calls)
      expect(request).toMatchObject({
        target: { tabId: 7 },
        world: "ISOLATED",
      });
    expect(api.tabs.remove).not.toHaveBeenCalled();
    expect(api.tabs.update).not.toHaveBeenCalled();
    expect(api.windows.update).not.toHaveBeenCalled();
    expect(user).toEqual(before);

    expect(result.stopped).toBe(false);
    expect(result.failedPages).toBe(0);
    expect(api.runtime.sendMessage).toHaveBeenCalledWith({
      type: "import-progress",
      sessionId: "session-a",
      count: 1,
      projects: 0,
    });
  },
);
it("returns a missing-tab state without injection or opening tabs", async () => {
  const { api } = setup();
  api.windows.getAll.mockResolvedValue([]);
  const { scanChats } = await import("../src/background/import");
  const result = await scanChats("missing");
  expect(result).toMatchObject({ pageCount: 0, failureReason: "no-chatgpt-tab", candidates: [] });
  expect(api.tabs.create).not.toHaveBeenCalled();
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
});
it("allows a fresh retry after an unready sidebar without losing a missing-sidebar reason", async () => {
  const { api } = setup();
  api.tabs.sendMessage.mockResolvedValueOnce({
    ok: false, hasSidebar: false, url: "https://chatgpt.com/c/user", visibleConversationCount: 0, reason: "sidebar-not-found",
  });
  const original = api.scripting.executeScript.getMockImplementation()!;
  api.scripting.executeScript.mockImplementation(request => request.func.name === "sidebarPage"
    ? Promise.resolve([{ result: { ok: false, reason: "sidebar-closed" } }])
    : original(request));
  const { scanChats } = await import("../src/background/import");
  const failed = await scanChats("unready");
  expect(failed).toMatchObject({ pageCount: 1, failureReason: "sidebar-not-found", failedPages: 1, candidates: [] });
  const retry = await scanChats("retry");
  expect(retry.candidates.length).toBeGreaterThan(0);
  expect(retry.sessionId).toBe("retry");
  expect(retry.failedPages).toBe(0);
  expect(api.tabs.create).not.toHaveBeenCalled();
});
it("attempts restore after content failure without open-tab fallback", async () => {
  const { api } = setup();
  api.scripting.executeScript.mockRejectedValue(Error("script failed"));
  const { scanChats } = await import("../src/background/import");
  const result = await scanChats("error");
  expect(api.tabs.remove).not.toHaveBeenCalled();
  expect(result.failedPages).toBeGreaterThan(0);
  expect(result.candidates).toEqual([]);
});
it("Stop retains partial results, blocks reentry, ignores stale Stop and allows another import", async () => {
  const { api } = setup();
  const { scanChats, stopImport } = await import("../src/background/import");
  let reached!: () => void;
  const waiting = new Promise<void>((resolve) => {
    reached = resolve;
  });
  api.scripting.executeScript.mockImplementation(
    async ({ func, args }: { func: { name: string }; args?: string[] }) => {
      if (func.name === "readRenderedPage") return [{ result: snapshot() }];
      if (args?.[0] === "start") {
        reached();
        return new Promise(() => {});
      }
      return [{ result: null }];
    },
  );
  const task = scanChats("current");
  await waiting;
  expect(scanChats("other")).toBe(task);
  expect(stopImport("stale")).toBe(false);
  expect(stopImport("current")).toBe(true);
  expect(stopImport("current")).toBe(true);
  const result = await task;
  expect(result.stopped).toBe(true);
  expect(result.progress).toEqual({ count: 1, projects: 0 });
  expect(api.runtime.sendMessage).toHaveBeenNthCalledWith(1, {
    type: "import-progress",
    sessionId: "current",
    count: 0,
    projects: 0,
  });
  expect(result.failedPages).toBe(0);
  expect(result.candidates.some((c) => c.title === "found")).toBe(true);
  const merged = importChats(defaults(), result.candidates);
  expect(merged.state.conversations.every((c) => c.folderId === null)).toBe(
    true,
  );
  expect(importChats(merged.state, result.candidates).added).toBe(0);
  expect(api.tabs.remove).not.toHaveBeenCalled();
  api.scripting.executeScript.mockImplementation(async ({ func }) => [
    { result: func.name === "readRenderedPage" ? snapshot() : null },
  ]);
  const next = scanChats("next");
  expect(stopImport("current")).toBe(false);
  expect((await next).stopped).toBe(false);
});
it("Stop before target discovery finishes does not mutate any tab", async () => {
  const { api } = setup();
  api.windows.getAll.mockImplementation(() => new Promise(() => {}));
  const { scanChats, stopImport } = await import("../src/background/import");
  const task = scanChats("load");
  stopImport("load");
  expect((await task).stopped).toBe(true);
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
  expect(api.tabs.create).not.toHaveBeenCalled();
});
it("selects the most recently used normal ChatGPT page, excluding popups", async () => {
  const { api } = setup();
  api.windows.getAll.mockResolvedValue([
    {
      id: 1,
      type: "normal",
      tabs: [
        {
          id: 7,
          windowId: 1,
          active: false,
          url: "https://chatgpt.com/c/user",
          title: "Recent",
          lastAccessed: 200,
        },
        {
          id: 8,
          windowId: 1,
          active: true,
          url: "https://chatgpt.com/",
          title: "Old",
          lastAccessed: 10,
        },
      ],
    },
    {
      id: 2,
      type: "popup",
      tabs: [
        {
          id: 9,
          windowId: 2,
          active: true,
          url: "https://chatgpt.com/c/user",
          title: "Popup",
          lastAccessed: 999,
        },
      ],
    },
  ]);
  const { scanChats } = await import("../src/background/import");
  expect((await scanChats()).targetTabId).toBe(7);
  expect(api.tabs.create).not.toHaveBeenCalled();
});
it("returns collected results if the user closes the target tab", async () => {
  const { api } = setup();
  api.scripting.executeScript.mockImplementation(async ({ func, args }) => {
    if (func.name === "readRenderedPage") return [{ result: snapshot() }];
    if (args?.[0] === "capture" || args?.[0] === "begin")
      return [{ result: null }];
    throw Error("No tab with id 7");
  });
  api.tabs.remove.mockRejectedValue(Error("Already closed"));
  const { scanChats } = await import("../src/background/import");
  const result = await scanChats("closed");
  expect(result.candidates.some((c) => c.title === "found")).toBe(true);
  expect(result.failedPages).toBe(1);
  expect(api.tabs.remove).not.toHaveBeenCalled();
});
it("bounds an unresponsive content script and cleans up", async () => {
  vi.useFakeTimers();
  const { api } = setup();
  api.scripting.executeScript.mockImplementation(() => new Promise(() => {}));
  const { scanChats } = await import("../src/background/import");
  const task = scanChats("timeout");
  await vi.advanceTimersByTimeAsync(21000);
  const result = await task;
  expect(result.failedPages).toBe(1);
  expect(api.tabs.remove).not.toHaveBeenCalled();
});
it("resolves earlier conversations from later project links after virtualization removes them", async () => {
  const { api } = setup();
  const projectId = "g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  let reads = 0;
  api.scripting.executeScript.mockImplementation(async ({ func }) => {
    if (func.name === "readRenderedPage") {
      reads++;
      const page = snapshot();
      page.links[0].href = `https://chatgpt.com/g/${projectId}/c/found`;
      return [
        {
          result:
            reads === 1
              ? page
              : {
                  ...page,
                  links: [],
                  projectLinks: [
                    {
                      href: `https://chatgpt.com/g/${projectId}/project`,
                      title: "LLM",
                    },
                  ],
                },
        },
      ];
    }
    return [{ result: { top: 0, height: 100, viewport: 100 } }];
  });
  const { scanChats } = await import("../src/background/import");
  const result = await scanChats("names");
  expect(result.projectNames[projectId]).toBe("LLM");
  const merged = importChats(
    defaults(),
    result.candidates,
    result.projectNames,
  );
  expect(
    merged.state.conversations.find((c) => c.id === "found")?.projectName,
  ).toBe("LLM");
  expect(api.tabs.remove).not.toHaveBeenCalled();
});
it("Stop while collecting expanded Projects retains General and Project results and restores", async () => {
  const { api } = setup();
  const id = "g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const { scanChats, stopImport } = await import("../src/background/import");
  let expanded = false;
  api.scripting.executeScript.mockImplementation(async ({ func, args }) => {
    if (func.name === "projectPage") {
      if (args?.[0] === "expand") expanded = true;
      if (args?.[0] === "close" || args?.[0] === "restore") expanded = false;
      return [{ result: { ok: true } }];
    }
    if (func.name === "readRenderedPage")
      return [
        {
          result: {
            ...snapshot(),
            projects: [{ id, name: "Local ai", collapsed: !expanded }],
            links: [
              ...snapshot().links,
              ...(expanded
                ? [
                    {
                      href: `https://chatgpt.com/g/${id}/c/child`,
                      title: "Child",
                      projectHeaders: [],
                      inProjectMain: false,
                      containerProjectId: id,
                      semantic: true,
                    },
                  ]
                : []),
            ],
          },
        },
      ];
    return [{ result: null }];
  });
  api.runtime.sendMessage.mockImplementation(
    async (message: { count: number }) => {
      if (message.count === 2) stopImport("project-stop");
    },
  );
  const result = await scanChats("project-stop");
  expect(result.stopped).toBe(true);
  expect(expanded).toBe(false);
  const merged = importChats(
    defaults(),
    result.candidates,
    result.projectNames,
  );
  expect(
    merged.state.conversations.find((c) => c.id === "child"),
  ).toMatchObject({ projectName: "Local ai", folderId: null });
  expect(merged.state.conversations.some((c) => c.id === "found")).toBe(true);
  expect(api.tabs.create).not.toHaveBeenCalled();
  expect(api.tabs.remove).not.toHaveBeenCalled();
});

it("uses only JSON-serializable arguments for Chromium script injection", async () => {
  const { api } = setup();
  const original = api.scripting.executeScript.getMockImplementation()!;
  api.scripting.executeScript.mockImplementation(async (request) => {
    if (request.args?.some((value) => value === undefined))
      throw Error("Value is unserializable");
    return original(request);
  });
  const { scanChats } = await import("../src/background/import");
  const result = await scanChats("chrome-json");
  expect(result.failedPages).toBe(0);
  expect(result.candidates.length).toBeGreaterThan(0);
  for (const [request] of api.scripting.executeScript.mock.calls)
    expect(request.args ?? []).not.toContain(undefined);
});
