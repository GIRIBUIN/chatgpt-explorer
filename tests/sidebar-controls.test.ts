import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sidebarPage } from "../src/content/sidebar-page";
import { loadMorePage } from "../src/content/load-more";
const url = "https://chatgpt.com/c/current";
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("location", { href: url });
  vi.stubGlobal("getComputedStyle", () => ({ visibility: "visible" }));
  vi.stubGlobal(
    "MutationObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  for (const key of [
    "__chatExplorerSidebar",
    "__chatExplorerProjects",
    "__chatExplorerLoadMore",
  ])
    Reflect.deleteProperty(globalThis, key);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function sidebar(open = false, safe = true) {
  let expanded = open;
  const scroller = {
    getClientRects: () => (expanded ? [1] : []),
    closest: () => null,
  };
  const button = {
    isConnected: true,
    disabled: false,
    getClientRects: () => [1],
    closest: () => null,
    getAttribute: (key: string) =>
      key === "aria-controls" ? "controlled-region" : String(expanded),
    click: vi.fn(() => {
      expanded = !expanded;
    }),
  };
  vi.stubGlobal("document", {
    documentElement: {},
    querySelectorAll: (selector: string) =>
      selector.includes("data-app-shell-sidebar-trigger")
        ? []
        : selector.startsWith("button")
          ? [button]
          : [scroller],
    getElementById: () => ({ querySelector: () => (safe ? scroller : null) }),
  });
  return { button, scroller, isOpen: () => expanded };
}
it("leaves an already open sidebar untouched", async () => {
  const d = sidebar(true);
  expect((await sidebarPage("open", "s", url)).ok).toBe(true);
  await sidebarPage("restore", "s", url);
  expect(d.button.click).not.toHaveBeenCalled();
});
it("opens only the semantically controlled sidebar without using locale text", async () => {
  const d = sidebar();
  expect((await sidebarPage("open", "s", url)).ok).toBe(true);
  expect(d.isOpen()).toBe(true);
  await sidebarPage("restore", "s", url);
  expect(d.isOpen()).toBe(false);
});
it("does not guess a toggle when aria-controls has no sidebar evidence", async () => {
  const d = sidebar(false, false);
  expect((await sidebarPage("open", "s", url)).reason).toBe("sidebar-closed");
  expect(d.button.click).not.toHaveBeenCalled();
});
it("bounds the sidebar open wait", async () => {
  const d = sidebar();
  d.scroller.getClientRects = () => [];
  const pending = sidebarPage("open", "s", url);
  await vi.advanceTimersByTimeAsync(5001);
  expect((await pending).reason).toBe("sidebar-open-timeout");
  await sidebarPage("restore", "s", url);
  expect(d.isOpen()).toBe(false);
});
it("Stop restores a sidebar during open wait", async () => {
  const d = sidebar();
  d.scroller.getClientRects = () => [];
  const pending = sidebarPage("open", "s", url);
  await sidebarPage("restore", "s", url);
  await vi.advanceTimersByTimeAsync(100);
  expect((await pending).ok).toBe(false);
  expect(d.isOpen()).toBe(false);
});
it("restores after a sidebar click handler throws", async () => {
  const d = sidebar(),
    click = d.button.click.getMockImplementation()!;
  d.button.click.mockImplementationOnce(() => {
    click();
    throw Error("handler");
  });
  await expect(sidebarPage("open", "s", url)).rejects.toThrow();
  await sidebarPage("restore", "s", url);
  expect(d.isOpen()).toBe(false);
});
function more() {
  const state = { id: "s", closed: false };
  vi.stubGlobal("__chatExplorerProjects", state);
  const ids = ["/c/a"];
  let loading = false;
  const section = { getAttribute: () => "Recents" };
  const scope = {
    querySelector: () => null,
    querySelectorAll: (selector: string) =>
      selector.includes("role=")
        ? loading
          ? [
              {
                textContent: "Loading",
                closest: () => null,
                getClientRects: () => [1],
              },
            ]
          : []
        : ids.map((id) => ({ getAttribute: () => id })),
  };
  const button = {
    innerText: "Show more",
    disabled: false,
    hasAttribute: () => false,
    getAttribute: () => null,
    getClientRects: () => [1],
    getBoundingClientRect: () => ({ top: 170, bottom: 200 }),
    closest: (selector: string) =>
      selector.includes("section-heading")
        ? section
        : selector.includes('role="list')
          ? scope
          : null,
    click: vi.fn(() => {
      loading = true;
      setTimeout(() => {
        ids.push(`/c/${ids.length}`);
        loading = false;
      }, 1000);
    }),
  };
  const scroller = {
    scrollHeight: 500,
    getBoundingClientRect: () => ({ top: 0, bottom: 240 }),
    querySelectorAll: () => [button],
  };
  vi.stubGlobal("document", { querySelector: () => scroller });
  return { button, state, ids, section };
}
it("waits for load-more links and supports repeated batches", async () => {
  const d = more();
  for (let i = 0; i < 3; i++) {
    const pending = loadMorePage("s", url);
    await vi.advanceTimersByTimeAsync(1100);
    expect(await pending).toEqual({ clicked: true, changed: true });
  }
  expect(d.ids.length).toBe(4);
  expect(d.button.click).toHaveBeenCalledTimes(3);
});
it("does not click an unrelated More button outside conversation sections", async () => {
  const d = more();
  d.section.getAttribute = () => "Settings";
  expect((await loadMorePage("s", url)).clicked).toBe(false);
  expect(d.button.click).not.toHaveBeenCalled();
});
it("bounds no-change retries", async () => {
  const d = more();
  d.button.click.mockImplementation(() => {});
  for (let i = 0; i < 2; i++) {
    const pending = loadMorePage("s", url);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await pending).toEqual({ clicked: true, changed: false });
  }
  expect((await loadMorePage("s", url)).clicked).toBe(false);
  expect(d.button.click).toHaveBeenCalledTimes(2);
});
it("Stop ends load-more waiting and prevents another click", async () => {
  const d = more();
  d.button.click.mockImplementation(() => {});
  const pending = loadMorePage("s", url);
  d.state.closed = true;
  await vi.advanceTimersByTimeAsync(100);
  expect((await pending).changed).toBe(false);
  expect((await loadMorePage("s", url)).clicked).toBe(false);
  expect(d.button.click).toHaveBeenCalledTimes(1);
});

it("uses the exact shell trigger even when closed sidebar DOM is absent", async () => {
  const d = sidebar();
  const doc = document as unknown as {
    querySelectorAll: (s: string) => unknown[];
  };
  doc.querySelectorAll = (selector) =>
    selector.includes("data-app-shell-sidebar-trigger")
      ? [d.button]
      : selector.startsWith("button")
        ? []
        : d.isOpen()
          ? [d.scroller]
          : [];
  expect((await sidebarPage("open", "primary", url)).ok).toBe(true);
  expect(d.button.click).toHaveBeenCalledTimes(1);
  await sidebarPage("restore", "primary", url);
  expect(d.isOpen()).toBe(false);
});
it("waits for sidebar DOM after the trigger expands", async () => {
  const d = sidebar();
  let rendered = false;
  const doc = document as unknown as {
    querySelectorAll: (s: string) => unknown[];
  };
  doc.querySelectorAll = (selector) =>
    selector.includes("data-app-shell-sidebar-trigger")
      ? [d.button]
      : selector.startsWith("button")
        ? []
        : rendered
          ? [d.scroller]
          : [];
  let done = false;
  const pending = sidebarPage("open", "primary", url).then((value) => {
    done = true;
    return value;
  });
  await vi.advanceTimersByTimeAsync(500);
  expect(done).toBe(false);
  expect(d.isOpen()).toBe(true);
  rendered = true;
  await vi.advanceTimersByTimeAsync(50);
  expect((await pending).ok).toBe(true);
  await sidebarPage("restore", "primary", url);
  expect(d.isOpen()).toBe(false);
});
it("ignores hidden duplicate shell triggers", async () => {
  const d = sidebar();
  const doc = document as unknown as {
    querySelectorAll: (s: string) => unknown[];
  };
  doc.querySelectorAll = (selector) =>
    selector.includes("data-app-shell-sidebar-trigger")
      ? [{ ...d.button, getClientRects: () => [] }, d.button]
      : selector.startsWith("button")
        ? []
        : d.isOpen()
          ? [d.scroller]
          : [];
  expect((await sidebarPage("open", "primary", url)).ok).toBe(true);
  await sidebarPage("restore", "primary", url);
  expect(d.button.click).toHaveBeenCalledTimes(2);
});
