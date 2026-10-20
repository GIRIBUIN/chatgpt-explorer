import { clickConversation } from "../content/open-chat";
import { installAutoSync } from "../sync/background";
const autoSync = installAutoSync();
import { rememberExplorerWindow, consumeExplorerClose } from "../sync/window";
import { scanChats, stopImport } from "./import";
export { scanChats, stopImport } from "./import";

import { webext } from "../utils/browser";
import { t } from "../i18n";
import { discoverChats } from "../utils/discovery";
import { normalizeState } from "../models/state";
import { STATE_KEY } from "../storage";
import { clampBounds, isBounds } from "../utils/bounds";
import { parseConversationUrl } from "../utils/url";
import type { Bounds, OpenBehavior } from "../models/types";

const explorerUrl = webext().runtime.getURL("explorer.html");
let opening: Promise<void> | null = null;
let explorerId: number | undefined;
async function normalWindow() {
  // Firefox does not support getLastFocused's windowTypes option.
  const last = await webext()
    .windows.getLastFocused()
    .catch(() => undefined);
  if (last?.type === "normal") return last;
  const windows = await webext().windows.getAll({ populate: true });
  return windows
    .filter((w) => w.type === "normal")
    .sort(
      (a, b) =>
        Number(!!b.focused) - Number(!!a.focused) ||
        Math.max(0, ...(b.tabs ?? []).map((t) => t.lastAccessed ?? 0)) -
          Math.max(0, ...(a.tabs ?? []).map((t) => t.lastAccessed ?? 0)),
    )[0];
}
async function openWindow() {
  // Scan actual windows after every worker restart; never trust a persisted window ID.
  const windows = await webext().windows.getAll({ populate: true });
  const existing = windows.find((w) =>
    w.tabs?.some((t) => t.url === explorerUrl),
  );
  if (existing?.id !== undefined) {
    explorerId = existing.id;
    if (existing.type === "popup") await rememberExplorerWindow(existing.id);
    await webext().windows.update(existing.id, {
      focused: true,
      ...(existing.state === "minimized" ? { state: "normal" as const } : {}),
    });
    return;
  }
  const source = await normalWindow().catch(() => undefined);
  if (source?.id !== undefined)
    await webext().storage.session.set({ sourceWindowId: source.id });
  const data = await webext().storage.local.get([STATE_KEY, "windowBounds"]);
  const settings = normalizeState(data[STATE_KEY]).settings;
  const saved =
    settings.rememberBounds && isBounds(data.windowBounds)
      ? data.windowBounds
      : null;
  const displays =
    (await webext()
      .system?.display?.getInfo()
      .catch(() => [])) ?? [];
  const contains = (b: Bounds, x: number, y: number) =>
    x >= b.left && x < b.left + b.width && y >= b.top && y < b.top + b.height;
  const anchor = saved && !settings.alwaysCentered ? saved : source;
  const area =
    (
      displays.find(
        (d) =>
          anchor &&
          contains(
            d.workArea,
            (anchor.left ?? 0) + (anchor.width ?? 0) / 2,
            (anchor.top ?? 0) + (anchor.height ?? 0) / 2,
          ),
      ) ??
      displays.find((d) => d.isPrimary) ??
      displays[0]
    )?.workArea ??
    (typeof screen !== "undefined"
      ? {
          left: (screen as Screen & { availLeft?: number }).availLeft ?? 0,
          top: (screen as Screen & { availTop?: number }).availTop ?? 0,
          width: screen.availWidth,
          height: screen.availHeight,
        }
      : {
          left: source?.left ?? 0,
          top: source?.top ?? 0,
          width: source?.width ?? 1280,
          height: source?.height ?? 800,
        });
  let bounds: Bounds = saved ?? { left: 0, top: 0, width: 900, height: 650 };
  if (!saved || settings.alwaysCentered) {
    const center = source ?? area;
    bounds = {
      ...bounds,
      left: Math.round(
        (center.left ?? area.left) +
          ((center.width ?? area.width) - bounds.width) / 2,
      ),
      top: Math.round(
        (center.top ?? area.top) +
          ((center.height ?? area.height) - bounds.height) / 2,
      ),
    };
  }
  bounds = clampBounds(bounds, area);
  const created = await webext().windows.create({
    url: explorerUrl,
    type: "popup",
    focused: true,
    ...bounds,
  });
  explorerId = created?.id;
  if (explorerId !== undefined) await rememberExplorerWindow(explorerId);
}
export function openExplorer() {
  if (!opening)
    opening = openWindow().finally(() => {
      opening = null;
    });
  return opening;
}
const launch = () => {
  void openExplorer().catch((error) =>
    console.error("Explorer window:", error),
  );
};
webext().action.onClicked.addListener(launch);
webext().commands.onCommand.addListener((command) => {
  if (command === "open-explorer") launch();
});
webext().windows.onRemoved.addListener((id) => {
  const knownExplorer = id === explorerId;
  if (knownExplorer) explorerId = undefined;
  void consumeExplorerClose(id)
    .then(isExplorer => isExplorer ? autoSync?.close() : undefined)
    .catch(() => {}); // Best effort; never hold the closing UI open.
});
webext().windows.onFocusChanged.addListener((id) => {
  if (id < 0) return;
  void webext()
    .windows.get(id)
    .then((w) =>
      w.type === "normal"
        ? webext().storage.session.set({ sourceWindowId: id })
        : undefined,
    )
    .catch(() => {});
});
webext().windows.onBoundsChanged?.addListener((w) => {
  void (async () => {
    if (w.state !== "normal" || !isBounds(w)) return;
    if (w.id !== explorerId) {
      const full = await webext().windows.get(w.id!, { populate: true });
      if (!full.tabs?.some((t) => t.url === explorerUrl)) return;
      explorerId = w.id;
    }
    await webext().storage.local.set({
      windowBounds: {
        left: w.left,
        top: w.top,
        width: w.width,
        height: w.height,
      },
    });
  })().catch((error) => console.error("Window bounds:", error));
});
async function currentChat() {
  return discoverChats(
    await webext().windows.getAll({ populate: true, windowTypes: ["normal"] }),
  );
}
export async function openChat(url: string, explicitMode?: OpenBehavior) {
  const parsed = parseConversationUrl(url);
  if (!parsed) throw Error(t("unsupportedConversationURL"));
  const mode =
    explicitMode ??
    normalizeState((await webext().storage.local.get(STATE_KEY))[STATE_KEY])
      .settings.defaultOpenBehavior;
  if (mode === "new-window") {
    await webext().windows.create({
      url: parsed.url,
      type: "normal",
      focused: true,
    });
    return;
  }
  async function newTab() {
    const win = await normalWindow().catch(() => undefined);
    if (win?.id !== undefined) {
      await webext().tabs.create({
        windowId: win.id,
        url: parsed!.url,
        active: true,
      });
      await webext().windows.update(win.id, {
        focused: true,
        ...(win.state === "minimized" ? { state: "normal" as const } : {}),
      });
    } else
      await webext().windows.create({
        url: parsed!.url,
        type: "normal",
        focused: true,
      });
  }
  if (mode === "new-tab") {
    await newTab();
    return;
  }
  const queried = await webext().tabs.query({ url: "https://chatgpt.com/*" });
  const allowed = await Promise.all(
    queried.map(async (tab) => {
      try {
        return (await webext().windows.get(tab.windowId)).type === "normal";
      } catch {
        return false;
      }
    }),
  );
  const tabs = queried
    .filter((_tab, i) => allowed[i])
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  const target =
    tabs.find((t) => parseConversationUrl(t.url ?? "")?.id === parsed.id) ??
    tabs.find((t) => parseConversationUrl(t.url ?? "")) ??
    tabs[0];
  if (target?.id !== undefined) {
    let clicked = false;
    try {
      clicked = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 2500);
        webext()
          .scripting.executeScript({
            target: { tabId: target.id! },
            world: "ISOLATED",
            func: clickConversation,
            args: [parsed.url],
          })
          .then(
            (results) => {
              clearTimeout(timer);
              resolve(results[0]?.result === true);
            },
            () => {
              clearTimeout(timer);
              resolve(false);
            },
          );
      });
    } catch {
      /* Keep the existing full-navigation fallback. */
    }
    await webext().tabs.update(
      target.id,
      clicked ? { active: true } : { url: parsed.url, active: true },
    );
    await webext().windows.update(target.windowId, {
      focused: true,
      ...((await webext().windows.get(target.windowId)).state === "minimized"
        ? { state: "normal" as const }
        : {}),
    });
  } else {
    await newTab();
  }
}
webext().runtime.onMessage.addListener((message: unknown, sender, reply) => {
  if (sender.id !== webext().runtime.id || sender.url !== explorerUrl)
    return false;
  if (!message || typeof message !== "object") return false;
  const m = message as {
    type?: string;
    url?: string;
    mode?: OpenBehavior;
    sessionId?: string;
  };
  if (m.type === "stop-import") {
    reply({
      ok: true,
      value: typeof m.sessionId === "string" && stopImport(m.sessionId),
    });
    return false;
  }
  const task =
    m.type === "current-chat" || m.type === "import-open-tabs"
      ? currentChat()
      : m.type === "import-chats"
        ? scanChats(m.sessionId)
        : m.type === "open-chat" && typeof m.url === "string"
          ? openChat(
              m.url,
              ["reuse", "new-tab", "new-window"].includes(m.mode ?? "")
                ? m.mode
                : undefined,
            )
          : null;
  if (!task) return false;
  void task
    .then((value) => reply({ ok: true, value }))
    .catch((e: unknown) =>
      reply({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
  return true;
});
