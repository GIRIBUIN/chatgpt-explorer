import { ImportProgress } from "./import-progress";
import { webext } from "../utils/browser";
import { ensureImportContent } from "./import-health";
import { parseConversationUrl, parseProjectUrl } from "../utils/url";
import { traverseChats } from "../content/traversal";
import { sidebarPage } from "../content/sidebar-page";
import { loadMorePage } from "../content/load-more";
import { projectPage } from "../content/project-page";
import { scrollPage } from "../content/scroll-page";
import { readRenderedPage } from "../content/read-page";
import { parseRenderedPage } from "../content/parse-page";
import { ProjectNames } from "../content/project-names";
import type { ImportCandidate } from "../models/import";

type Session = { id: string; controller: AbortController; deadline: number };
let active: { session: Session; task: ReturnType<typeof performScan> } | null =
  null;

export function stopImport(id: string) {
  if (!active || active.session.id !== id) return false;
  active.session.controller.abort();
  return true;
}
export function scanChats(id: string = crypto.randomUUID()) {
  if (active) return active.task;
  const session = {
    id,
    controller: new AbortController(),
    deadline: Date.now() + 180000,
  };
  const task = performScan(session).finally(() => {
    active = null;
  });
  active = { session, task };
  return task;
}
// Bound browser calls from the background context as well: hidden-page timers
// may be throttled indefinitely. Stop interrupts a pending call, not collected data.
function bounded<T>(
  promise: Promise<T>,
  ms: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => finish(() => reject(Error("Import stopped")));
    const timer = setTimeout(
      () => finish(() => reject(Error("Import timeout"))),
      Math.max(1, ms),
    );
    const finish = (callback: () => void) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      callback();
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}
async function performScan(session: Session) {
  const signal = session.controller.signal;
  const call = <T>(task: Promise<T>) =>
    bounded(task, Math.min(10000, session.deadline - Date.now()), signal);
  let windows: chrome.windows.Window[] = [];
  const candidates = new Map<string, ImportCandidate[]>();
  const projects = new ProjectNames();
  const processed = new Set<string>();
  const discovered = new ImportProgress();
  let failureReason: string | null = null;
  let failedPages = 0,
    limitedPages = 0;
  let target: chrome.tabs.Tab | undefined;
  let restoreSidebar: (() => Promise<unknown>) | null = null;
  const progress = () => {
    void webext()
      .runtime.sendMessage({
        type: "import-progress",
        sessionId: session.id,
        ...discovered.snapshot(),
      })
      .catch(() => {});
  };
  progress(); // Explicit zero before target lookup or bootstrap.
  try {
    windows = await call(
      webext().windows.getAll({ populate: true, windowTypes: ["normal"] }),
    );
    target = windows
      .filter((w) => w.type === "normal")
      .flatMap((w) => w.tabs ?? [])
      .filter((tab) => {
        try {
          return (
            tab.id !== undefined &&
            new URL(tab.url ?? "").origin === "https://chatgpt.com"
          );
        } catch {
          return false;
        }
      })
      .sort(
        (a, b) =>
          (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0) ||
          Number(!!b.active) - Number(!!a.active) ||
          a.id! - b.id!,
      )[0];
    if (!target) failureReason = "no-chatgpt-tab";
    if (target && !signal.aborted) {
      const tabId = target.id!,
        url = target.url!;
      let health = await call(ensureImportContent(tabId, url));
      if (
        !health.ok &&
        ["sidebar-not-found", "sidebar-closed"].includes(health.reason ?? "")
      ) {
        restoreSidebar = async () => {
          const results = await bounded(
            webext().scripting.executeScript({
              target: { tabId },
              world: "ISOLATED",
              func: sidebarPage,
              args: ["restore", session.id, url],
            }),
            3000,
          );
          if (results[0]?.result?.ok === false)
            throw Error("Sidebar restore failed");
        };
        const opened = await call(
          webext().scripting.executeScript({
            target: { tabId },
            world: "ISOLATED",
            func: sidebarPage,
            args: ["open", session.id, url],
          }),
        );
        if (!opened[0]?.result?.ok) {
          failureReason = !health.hasSidebar && opened[0]?.result?.reason === "sidebar-closed"
            ? "sidebar-not-found"
            : opened[0]?.result?.reason ?? "sidebar-closed";
          throw Error(failureReason);
        }
        health = await call(ensureImportContent(tabId, url));
      }
      if (!health.ok) {
        failureReason = health.reason ?? "message-failed";
        console.warn("[Convoary import] bootstrap", health.diagnostic);
        throw Error(health.reason);
      }
      if (import.meta.env.DEV) console.debug("[Convoary import] health", {
        hasSidebar: health.hasSidebar,
        visibleConversationCount: health.visibleConversationCount,
      });
      const loadMore = async (id = "") => {
        if (signal.aborted) return undefined;
        const results = await call(
          webext().scripting.executeScript({
            target: { tabId },
            world: "ISOLATED",
            func: loadMorePage,
            args: [session.id, url, id],
          }),
        );
        return results[0]?.result;
      };
      const project = async (
        command: "begin" | "expand" | "advance" | "close" | "restore",
        id?: string,
      ) => {
        const task = webext().scripting.executeScript({
          target: { tabId },
          world: "ISOLATED",
          func: projectPage,
          args:
            id === undefined
              ? [command, session.id, url]
              : [command, session.id, url, id],
        });
        const result =
          command === "close" || command === "restore"
            ? await bounded(task, 6500)
            : await call(task);
        return result[0]?.result;
      };
      const control = async (
        command: "capture" | "start" | "advance" | "restore",
      ) => {
        const task = webext().scripting.executeScript({
          target: { tabId },
          world: "ISOLATED",
          func: scrollPage,
          args: [command, session.id, url],
        });
        const results =
          command === "restore" ? await bounded(task, 3000) : await call(task);
        const value = results[0]?.result;
        return value && typeof value.top === "number" ? value : null;
      };
      const read = async () => {
        const results = await call(
          webext().scripting.executeScript({
            target: { tabId },
            world: "ISOLATED",
            func: readRenderedPage,
          }),
        );
        const page = results[0]?.result;
        if (!page || page.url !== url) throw Error("Page changed");
        if (import.meta.env.DEV) console.debug("[Convoary import] read", {
          links: page.links.length,
          projects: page.projects?.length ?? 0,
        });
        if (page.links.length <= 1 && health.visibleConversationCount > 1)
          console.warn("[Convoary import] parser-count-mismatch", {
            expected: health.visibleConversationCount,
            actual: page.links.length,
          });
        projects.collect(page);
        const items = parseRenderedPage(page);
        discovered.collect(items, [
          ...(page.projects ?? []).map((row) => row.id),
          ...(page.projectLinks ?? []).map((link) =>
            parseProjectUrl(link.href),
          ),
        ]);
        for (const item of items) {
          const id = parseConversationUrl(item.url)!.id;
          const evidence = candidates.get(id) ?? [];
          if (!evidence.some((x) => JSON.stringify(x) === JSON.stringify(item)))
            evidence.push(item);
          candidates.set(id, evidence);
        }
        progress();
        return { page, items };
      };
      try {
        // Capture before any row clicks (including the initial viewport scan).
        await control("capture");
        await project("begin");
        const result = await traverseChats(
          {
            read: async () => {
              const snapshot = await read();
              for (const row of snapshot.page.projects ?? []) {
                if (signal.aborted || Date.now() >= session.deadline) break;
                if (processed.has(row.id)) continue;
                processed.add(row.id);
                try {
                  const expanded = await project("expand", row.id);
                  if (signal.aborted) break;
                  if (expanded?.ok) {
                    snapshot.items.push(...(await read()).items);
                    const projectDeadline = Math.min(
                      session.deadline,
                      Date.now() + 20000,
                    );
                    for (
                      let step = 0;
                      step < 24 &&
                      !signal.aborted &&
                      Date.now() < projectDeadline;
                      step++
                    ) {
                      const moved = await project("advance", row.id);
                      if (signal.aborted) break;
                      if (!moved || !("more" in moved) || !moved.more) {
                        const batch = await loadMore(row.id);
                        if (signal.aborted) break;
                        if (!batch?.clicked) break;
                      }
                      snapshot.items.push(...(await read()).items);
                    }
                  }
                } catch (error) {
                  if (!signal.aborted) {
                    failedPages++;
                    console.warn("[Convoary import] project", error);
                  }
                } finally {
                  try {
                    await project("close", row.id);
                  } catch {
                    failedPages++;
                  }
                }
              }
              return snapshot.items;
            },
            start: () => control("start"),
            advance: async () => {
              const state = await control("advance");
              if (!state) throw Error("Sidebar unavailable");
              if (!signal.aborted) {
                const batch = await loadMore();
                if (batch?.clicked) return (await control("capture")) ?? state;
              }
              return state;
            },
            restore: async () => {}, // Restore Projects before the original scrollTop, below.
          },
          () => {},
          {
            iterations: 160,
            milliseconds: Math.min(150000, session.deadline - Date.now()),
          },
          Date.now,
          () => signal.aborted,
        );
        if (result.failed) {
          failedPages++;
          console.warn("[Convoary import] traversal", result.failure);
        }
        if (result.limited) limitedPages++;
      } finally {
        // Cleanup is deliberately independent of the stopped signal.
        try {
          const restored = await project("restore");
          if (restored?.ok === false) failedPages++;
        } catch {
          failedPages++;
        }
        try {
          await control("restore");
        } catch {
          failedPages++;
        }
      }
    }
  } catch (error) {
    if (!signal.aborted) {
      failedPages++;
      failureReason ??=
        error instanceof Error && error.message === "Page changed"
          ? "tab-navigated"
          : "traversal-failed";
      console.warn("[Convoary import]", failureReason, error);
    }
  }
  if (restoreSidebar) {
    try {
      await restoreSidebar();
    } catch (error) {
      failedPages++;
      failureReason ??= "sidebar-restore-failed";
      console.warn("[Convoary import] sidebar restore", error);
    }
  }
  const items = [...candidates.values()].flat();

  return {
    sessionId: session.id,
    targetTabId: target?.id,
    candidates: items,
    projectNames: projects.resolve(),
    failureReason: failureReason ?? (failedPages ? "traversal-failed" : null),
    failedPages: Math.min(1, failedPages),
    limitedPages,
    pageCount: target ? 1 : 0,
    stopped: signal.aborted,
    progress: discovered.snapshot(),
  };
}
