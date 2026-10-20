import { afterEach, expect, it, vi } from "vitest";
import {
  ensureImportContent,
  installImportHealth,
} from "../src/background/import-health";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, "__chatExplorerHealth");
});
const root = "https://chatgpt.com/";
it("treats the explicit closed shell state as closed during a layout transition", () => {
  const { api } = setup();
  vi.stubGlobal("document", {
    querySelector: () => ({
      getClientRects: () => [1],
      querySelectorAll: () => [],
    }),
    querySelectorAll: () => [
      {
        getClientRects: () => [1],
        disabled: false,
        getAttribute: (key: string) =>
          key === "aria-expanded" ? "false" : null,
      },
    ],
  });
  vi.stubGlobal("location", { origin: "https://chatgpt.com", href: root });
  installImportHealth();
  const reply = vi.fn();
  api.runtime.onMessage.addListener.mock.calls[0][0](
    { type: "IMPORT_CONTENT_PING" },
    { id: "test" },
    reply,
  );
  expect(reply).toHaveBeenCalledWith(
    expect.objectContaining({ ok: false, reason: "sidebar-closed" }),
  );
});
function setup(url = root, namespace = "chrome") {
  const health = {
    ok: true,
    hasSidebar: true,
    url,
    visibleConversationCount: 24,
  };
  const api = {
    tabs: { sendMessage: vi.fn().mockResolvedValue(health) },
    scripting: { executeScript: vi.fn().mockResolvedValue([]) },
    runtime: {
      id: "test",
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };
  vi.stubGlobal(namespace, api);
  return { api, health };
}
it.each([root, `${root}c/general`, `${root}g/g-p-${"a".repeat(32)}/c/project`])(
  "pings supported page %s",
  async (url) => {
    const { api, health } = setup(url);
    expect(await ensureImportContent(7, url)).toEqual(health);
    expect(api.scripting.executeScript).not.toHaveBeenCalled();
  },
);
it.each(["chrome", "browser"])(
  "%s injects and retries a missing receiver",
  async (namespace) => {
    const { api, health } = setup(root, namespace);
    api.tabs.sendMessage.mockRejectedValueOnce(Error("No receiver"));
    expect(await ensureImportContent(7, root)).toEqual(health);
    expect(api.tabs.sendMessage).toHaveBeenCalledTimes(2);
    expect(api.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7, frameIds: [0] },
      world: "ISOLATED",
      func: installImportHealth,
    });
  },
);
it("distinguishes rejected injection", async () => {
  const { api } = setup();
  api.tabs.sendMessage.mockRejectedValue(Error("No receiver"));
  api.scripting.executeScript.mockRejectedValue(Error("Cannot access tab"));
  expect((await ensureImportContent(7, root)).reason).toBe("injection-failed");
});
it("distinguishes missing sidebar from unavailable reader", async () => {
  const { api } = setup();
  api.tabs.sendMessage.mockResolvedValue({
    ok: false,
    hasSidebar: false,
    url: root,
    visibleConversationCount: 0,
    reason: "sidebar-not-found",
  });
  expect((await ensureImportContent(7, root)).reason).toBe("sidebar-not-found");
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
});
it("distinguishes message failure after injection", async () => {
  const { api } = setup();
  api.tabs.sendMessage.mockRejectedValue(Error("Message transport failure"));
  expect((await ensureImportContent(7, root)).reason).toBe("message-failed");
});
it("does not inject unsupported pages", async () => {
  const { api } = setup();
  expect((await ensureImportContent(7, "https://example.com/")).reason).toBe(
    "unsupported-page",
  );
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
});
it("replaces its listener on duplicate injection and answers ping", () => {
  const { api } = setup();
  vi.stubGlobal("document", {
    querySelectorAll: () => [],
    querySelector: () => ({
      querySelectorAll: () => [],
      getClientRects: () => [1],
    }),
  });
  vi.stubGlobal("location", { origin: "https://chatgpt.com", href: root });
  installImportHealth();
  const previous = api.runtime.onMessage.addListener.mock.calls[0][0];
  installImportHealth();
  expect(api.runtime.onMessage.removeListener).toHaveBeenCalledWith(previous);
  const reply = vi.fn();
  api.runtime.onMessage.addListener.mock.calls[1][0](
    { type: "IMPORT_CONTENT_PING" },
    { id: "test" },
    reply,
  );
  expect(reply).toHaveBeenCalledWith(
    expect.objectContaining({
      ok: true,
      hasSidebar: true,
      url: root,
      visibleConversationCount: 0,
    }),
  );
});

it("preserves a ping timeout and retry stage", async () => {
  vi.useFakeTimers();
  const { api } = setup();
  api.tabs.sendMessage.mockImplementation(() => new Promise(() => {}));
  const task = ensureImportContent(7, root);
  await vi.advanceTimersByTimeAsync(4001);
  expect(await task).toMatchObject({
    reason: "ping-timeout",
    diagnostic: { stage: "ping-retry", detail: "ping-timeout" },
  });
});
it("reports a navigated tab without starting traversal", async () => {
  setup(root + "c/new");
  expect((await ensureImportContent(7, root)).reason).toBe("tab-navigated");
});
it("does not retry ping until injection registration has completed", async () => {
  const { api } = setup();
  api.tabs.sendMessage.mockRejectedValueOnce(Error("No receiver"));
  let ready!: () => void;
  api.scripting.executeScript.mockImplementation(
    () =>
      new Promise((resolve) => {
        ready = () => resolve([]);
      }),
  );
  const pending = ensureImportContent(7, root);
  await vi.waitFor(() =>
    expect(api.scripting.executeScript).toHaveBeenCalled(),
  );
  expect(api.tabs.sendMessage).toHaveBeenCalledTimes(1);
  ready();
  expect((await pending).ok).toBe(true);
});
