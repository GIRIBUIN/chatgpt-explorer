import { webext } from "../utils/browser";

export type ImportHealth = {
  ok: boolean;
  hasSidebar: boolean;
  url: string;
  visibleConversationCount: number;
  reason?: string;
  diagnostic?: { stage: string; detail: string };
};

// Self-contained, injected in the isolated world. A versioned listener makes
// repeated injection safe, including retries after an extension reload.
export function installImportHealth() {
  const host = globalThis as typeof globalThis & {
    browser?: typeof chrome;
    __chatExplorerHealth?: Parameters<
      typeof chrome.runtime.onMessage.addListener
    >[0];
  };
  const api = host.browser ?? chrome;
  if (host.__chatExplorerHealth) {
    api.runtime.onMessage.removeListener(host.__chatExplorerHealth);
  }
  const listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (
    message,
    sender,
    reply,
  ) => {
    if (sender.id !== api.runtime.id || message?.type !== "IMPORT_CONTENT_PING")
      return false;
    const sidebar = document.querySelector("[data-app-action-sidebar-scroll]");
    const triggers = [
      ...document.querySelectorAll<HTMLButtonElement>(
        'button[data-app-shell-sidebar-trigger="true"][aria-controls="app-shell-sidebar"]',
      ),
    ].filter(
      (button) =>
        button.getClientRects().length > 0 &&
        !button.disabled &&
        button.getAttribute("aria-disabled") !== "true",
    );
    const expanded =
      triggers.length === 1 ? triggers[0].getAttribute("aria-expanded") : null;
    // A closing shell can retain layout rectangles briefly. Its explicit state
    // still takes precedence over that transient DOM presence.
    const sidebarVisible =
      !!sidebar?.getClientRects().length && expanded !== "false";
    const supported = location.origin === "https://chatgpt.com";
    const ids = new Set<string>();
    for (const link of sidebar?.querySelectorAll<HTMLAnchorElement>(
      "a[href]",
    ) ?? []) {
      const match = new URL(link.href, location.href).pathname.match(
        /^\/(?:g\/g-p-[a-f0-9]{32}\/)?c\/([\w-]+)\/?$/i,
      );
      if (!match || link.closest("[hidden],[inert]")) continue;
      const style = getComputedStyle(link);
      if (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        link.getClientRects().length
      )
        ids.add(match[1]);
    }
    reply({
      ok: supported && !!sidebar && sidebarVisible,
      hasSidebar: !!sidebar,
      url: location.href,
      visibleConversationCount: ids.size,
      reason: !supported
        ? "unsupported-page"
        : !sidebar
          ? "sidebar-not-found"
          : !sidebarVisible
            ? "sidebar-closed"
            : undefined,
    });
    return false;
  };
  host.__chatExplorerHealth = listener;
  api.runtime.onMessage.addListener(listener);
}

export async function ensureImportContent(
  tabId: number,
  url: string,
): Promise<ImportHealth> {
  const fail = (reason: string): ImportHealth => ({
    ok: false,
    hasSidebar: false,
    url,
    visibleConversationCount: 0,
    reason,
  });
  try {
    if (new URL(url).origin !== "https://chatgpt.com")
      return fail("unsupported-page");
  } catch {
    return fail("unsupported-page");
  }
  const timeout = <T>(task: Promise<T>, ms: number, reason: string) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(reason)), ms);
      task.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  const ping = async () => {
    const result = (await timeout(
      webext().tabs.sendMessage(
        tabId,
        {
          type: "IMPORT_CONTENT_PING",
        },
        { frameId: 0 },
      ),
      2000,
      "ping-timeout",
    )) as ImportHealth | undefined;
    if (
      !result ||
      typeof result.hasSidebar !== "boolean" ||
      typeof result.visibleConversationCount !== "number"
    )
      throw Error("Invalid health response");
    if (result.url !== url) return fail("tab-navigated");
    return result;
  };
  let stage = "ping";
  try {
    return await ping();
  } catch (firstError) {
    if (import.meta.env.DEV) console.debug("[Convoary import] initial ping", String(firstError));
    try {
      stage = "injection";
      if (!webext().scripting?.executeScript)
        return fail("content-script-unavailable");
      const results = await timeout(
        webext().scripting.executeScript({
          target: { tabId, frameIds: [0] },
          world: "ISOLATED",
          func: installImportHealth,
        }),
        4000,
        "injection-timeout",
      );
      const error = (results[0] as { error?: unknown } | undefined)?.error;
      if (error) throw Error(String(error));
      // executeScript completion guarantees registration finished. The response
      // of the next ping, not a timer, is the readiness barrier for traversal.
      stage = "ping-retry";
      return await ping();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const reason =
        stage === "injection"
          ? "injection-failed"
          : detail === "ping-timeout"
            ? "ping-timeout"
            : /receiving end does not exist|no receiver/i.test(detail)
              ? "content-script-unavailable"
              : "message-failed";
      return { ...fail(reason), diagnostic: { stage, detail } };
    }
  }
}
