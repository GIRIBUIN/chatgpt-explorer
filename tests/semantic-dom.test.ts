import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { readRenderedPage } from "../src/content/read-page";
import { parseRenderedPage } from "../src/content/parse-page";
import { projectPage } from "../src/content/project-page";
import { scrollPage } from "../src/content/scroll-page";
import { ProjectNames } from "../src/content/project-names";
const a = "g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  b = "g-p-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const url = "https://chatgpt.com/c/current";
// Minimal DOM boundary doubles model the supplied semantic attributes. The HTML
// fixture exercises real selector matching in the optional browser suite.
function dom() {
  const scroller = {
    scrollTop: 73,
    scrollHeight: 1200,
    clientHeight: 400,
    isConnected: true,
    getClientRects: () => [1],
    scrollTo: vi.fn(({ top }: { top: number }) => {
      scroller.scrollTop = top;
    }),
    getBoundingClientRect: () => ({ bottom: 400 }),
  };
  const row = (id: string, name: string, collapsed: boolean) => {
    const attrs: Record<string, string> = {
      "data-app-action-sidebar-project-id": id,
      "data-app-action-sidebar-project-label": name,
      "data-app-action-sidebar-project-collapsed": String(collapsed),
      "aria-expanded": String(!collapsed),
      role: "button",
    };
    return {
      attrs,
      isConnected: true,
      getAttribute: (key: string) => attrs[key] ?? null,
      getClientRects: () => [1],
      closest: () => null,
      matches: () => false,
      click: vi.fn(() => {
        const closed =
          attrs["data-app-action-sidebar-project-collapsed"] === "true";
        attrs["data-app-action-sidebar-project-collapsed"] = String(!closed);
        attrs["aria-expanded"] = String(closed);
      }),
    };
  };
  const rows = [row(a, "Local ai", true), row(b, "매일", false)];
  const containers = rows.map((r) => ({
    getAttribute: () =>
      `project:${r.attrs["data-app-action-sidebar-project-id"]}`,
    querySelector: () => (r.attrs["aria-expanded"] === "true" ? {} : null),
    querySelectorAll: (selector: string) =>
      selector === "a[href]" && r.attrs["aria-expanded"] === "true"
        ? [
            {
              href: `https://chatgpt.com/g/${r.attrs["data-app-action-sidebar-project-id"]}/c/child`,
              closest: () => null,
              getClientRects: () => [1],
            },
          ]
        : [],
    getBoundingClientRect: () => ({ bottom: 300 }),
  }));
  const anchor = (
    href: string,
    aria: string | null,
    thread: string,
    visible: string,
    index?: number,
  ) => ({
    href: `https://chatgpt.com${href}`,
    innerText: visible,
    getClientRects: () => [1],
    getAttribute: (key: string) =>
      key === "aria-label"
        ? aria
        : key === "data-interactive-row-link"
          ? "true"
          : null,
    querySelector: (s: string) =>
      s === "[data-thread-title]" && thread
        ? { innerText: thread, getAttribute: () => null }
        : null,
    closest: (s: string) => {
      if (s.includes("[hidden]"))
        return index !== undefined &&
          rows[index].attrs["aria-expanded"] === "false"
          ? {}
          : null;
      if (s === "[data-sidebar-project-container-id]")
        return index === undefined ? null : containers[index];
      if (s.startsWith("nav,")) return scroller;
      return null;
    },
  });
  const anchors = [
    anchor("/c/general", "Clean title", "Thread", "Noise menu"),
    anchor(`/g/${a}/c/one`, null, "Thread title", "Noise", 0),
    anchor(`/g/${b}/c/two`, null, "", "Visible title", 1),
  ];
  const querySelectorAll = vi.fn((s: string) => {
    if (s === "[data-app-action-sidebar-project-row]") return rows;
    if (s === "[data-sidebar-project-container-id]") return containers;
    if (s === "[data-app-action-sidebar-scroll]") return [scroller];
    if (s === "a[href]" || s === 'a[data-interactive-row-link="true"]')
      return anchors;
    return [];
  });
  vi.stubGlobal("document", {
    documentElement: {},
    querySelectorAll,
    querySelector: (s: string) =>
      s === "[data-app-action-sidebar-scroll]" ? scroller : null,
    getElementById: () => null,
  });
  vi.stubGlobal("location", { href: url });
  vi.stubGlobal("getComputedStyle", () => ({
    display: "block",
    visibility: "visible",
  }));
  vi.stubGlobal(
    "MutationObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  return { scroller, rows, anchors, containers, querySelectorAll };
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  for (const key of ["__chatExplorerScroll", "__chatExplorerProjects"])
    Reflect.deleteProperty(globalThis, key);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("reads explicit ID/label/collapse metadata independent of locale", () => {
  dom();
  const page = readRenderedPage();
  expect(page.projects).toEqual([
    { id: a, name: "Local ai", collapsed: true },
    { id: b, name: "매일", collapsed: false },
  ]);
  const names = new ProjectNames();
  names.collect(page);
  expect(names.resolve()).toEqual({ [a]: "Local ai", [b]: "매일" });
});
it("prefers aria-label and excludes inert or collapsed children", () => {
  dom();
  const page = readRenderedPage();
  expect(page.links.map((l) => l.title)).toEqual([
    "Clean title",
    "Visible title",
  ]);
  expect(parseRenderedPage(page).map((c) => c.projectId)).toEqual([null, b]);
});
it("uses thread title before surrounding visible text", () => {
  const { rows } = dom();
  rows[0].click();
  expect(readRenderedPage().links[1].title).toBe("Thread title");
});
it("rejects href project ID inconsistent with its semantic container", () => {
  const { rows, anchors } = dom();
  rows[0].click();
  anchors[1].href = `https://chatgpt.com/g/${b}/c/wrong`;
  expect(
    parseRenderedPage(readRenderedPage()).some((c) => c.url.endsWith("/wrong")),
  ).toBe(false);
});
it("uses the explicit scroller and restores its original position", async () => {
  const { scroller } = dom();
  await scrollPage("capture", "s", url);
  const work = scrollPage("start", "s", url);
  await vi.advanceTimersByTimeAsync(1500);
  await work;
  expect(scroller.scrollTop).toBe(0);
  const step = scrollPage("advance", "s", url);
  await vi.advanceTimersByTimeAsync(1500);
  await step;
  expect(scroller.scrollTop).toBe(320);
  await scrollPage("restore", "s", url);
  expect(scroller.scrollTop).toBe(73);
});
it("temporarily expands a collapsed button, reads children and restores it", async () => {
  const { rows } = dom();
  await projectPage("begin", "s", url);
  expect((await projectPage("expand", "s", url, a)).ok).toBe(true);
  expect(readRenderedPage().links.some((l) => l.href.endsWith("/one"))).toBe(
    true,
  );
  await projectPage("close", "s", url, a);
  expect(rows[0].attrs["aria-expanded"]).toBe("false");
  expect(rows[0].click).toHaveBeenCalledTimes(2);
});
it("preserves an already expanded Project without toggling", async () => {
  const { rows } = dom();
  await projectPage("begin", "s", url);
  await projectPage("expand", "s", url, b);
  await projectPage("close", "s", url, b);
  await projectPage("restore", "s", url);
  expect(rows[1].click).not.toHaveBeenCalled();
  expect(rows[1].attrs["aria-expanded"]).toBe("true");
});
it("Stop cleanup restores the open Project and blocks stale expansion", async () => {
  const { rows } = dom();
  await projectPage("begin", "s", url);
  await projectPage("expand", "s", url, a);
  await projectPage("restore", "s", url);
  expect(rows[0].attrs["aria-expanded"]).toBe("false");
  await expect(projectPage("expand", "s", url, a)).rejects.toThrow();
});
it("restores after an expansion handler throws after changing the DOM", async () => {
  const { rows } = dom();
  const click = rows[0].click.getMockImplementation()!;
  rows[0].click.mockImplementationOnce(() => {
    click();
    throw Error("handler failed");
  });
  await projectPage("begin", "s", url);
  await expect(projectPage("expand", "s", url, a)).rejects.toThrow();
  expect((await projectPage("restore", "s", url)).ok).toBe(true);
  expect(rows[0].attrs["aria-expanded"]).toBe("false");
});
it("does not navigate back or mutate new page state after URL navigation", async () => {
  const { rows, scroller } = dom();
  await scrollPage("capture", "s", url);
  await projectPage("begin", "s", url);
  await projectPage("expand", "s", url, a);
  vi.stubGlobal("location", { href: "https://chatgpt.com/c/other" });
  scroller.scrollTop = 500;
  await projectPage("restore", "s", url);
  await scrollPage("restore", "s", url);
  expect(rows[0].click).toHaveBeenCalledTimes(1);
  expect(scroller.scrollTop).toBe(500);
});

it.each(["chats", "pinned"])(
  "does not mistake %s container for a Project",
  (kind) => {
    const { anchors } = dom();
    const original = anchors[0].closest;
    anchors[0].closest = ((selector: string) =>
      selector === "[data-sidebar-project-container-id]"
        ? { getAttribute: () => kind }
        : original(selector)) as typeof original;
    expect(parseRenderedPage(readRenderedPage())[0].url).toContain(
      "/c/general",
    );
  },
);
it("keeps visually rendered accessibility-isolated links", () => {
  const { anchors } = dom();
  const original = anchors[0].closest;
  anchors[0].closest = ((selector: string) =>
    selector.startsWith("[aria-hidden=")
      ? { getAttribute: () => "true" }
      : original(selector)) as typeof original;
  expect(parseRenderedPage(readRenderedPage())[0].title).toBe("Clean title");
});
it("excludes genuinely hidden aria subtrees", () => {
  const { anchors } = dom();
  const original = anchors[0].closest;
  anchors[0].closest = ((selector: string) =>
    selector.startsWith("[aria-hidden=")
      ? { getAttribute: () => null }
      : original(selector)) as typeof original;
  expect(
    readRenderedPage().links.some((link) => link.href.endsWith("/general")),
  ).toBe(false);
});
it("waits for an already expanded loading Project, then collects matching links", async () => {
  const { containers, rows } = dom();
  const ready = containers[1].querySelectorAll;
  let loading = true;
  containers[1].querySelectorAll = ((selector: string) =>
    loading
      ? selector === "a[href]"
        ? []
        : [
            {
              textContent: "Loading chats",
              getAttribute: () => null,
              closest: () => null,
              getClientRects: () => [1],
            },
          ]
      : ready(selector)) as typeof ready;
  await projectPage("begin", "s", url);
  let done = false;
  const pending = projectPage("expand", "s", url, b).then((value) => {
    done = true;
    return value;
  });
  await vi.advanceTimersByTimeAsync(2500);
  expect(done).toBe(false);
  loading = false;
  await vi.advanceTimersByTimeAsync(100);
  expect((await pending).ok).toBe(true);
  expect(rows[1].click).not.toHaveBeenCalled();
  await projectPage("restore", "s", url);
});
it.each(["stop", "timeout"])(
  "restores a Project during loading on %s",
  async (mode) => {
    const { containers, rows } = dom();
    containers[0].querySelectorAll = ((selector: string) =>
      selector === "a[href]"
        ? []
        : [
            {
              textContent: "Loading chats",
              getAttribute: () => null,
              closest: () => null,
              getClientRects: () => [1],
            },
          ]) as unknown as (typeof containers)[0]["querySelectorAll"];
    await projectPage("begin", "s", url);
    const pending = projectPage("expand", "s", url, a).catch((error) => error);
    await vi.advanceTimersByTimeAsync(500);
    if (mode === "stop") await projectPage("restore", "s", url);
    await vi.advanceTimersByTimeAsync(6000);
    expect(await pending).toBeInstanceOf(Error);
    await projectPage("restore", "s", url);
    expect(rows[0].attrs["aria-expanded"]).toBe("false");
  },
);
