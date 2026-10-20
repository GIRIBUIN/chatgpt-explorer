import type { ScrollState } from "./traversal";

// Serialized into the isolated world. State is private to this extension/tab.
// Never clicks links or changes project expansion state.
export async function scrollPage(
  command: "capture" | "start" | "advance" | "restore",
  sessionId = "",
  expectedUrl = location.href,
): Promise<ScrollState | null> {
  const host = globalThis as typeof globalThis & {
    __chatExplorerScroll?: {
      element: HTMLElement;
      original: number;
      restoreTimer: ReturnType<typeof setTimeout>;
      sessionId: string;
      url: string;
    };
    __chatExplorerProjects?: { id: string; closed: boolean };
  };
  const restore = () => {
    const saved = host.__chatExplorerScroll;
    if (!saved) return;
    if (saved.sessionId !== sessionId) return;
    clearTimeout(saved.restoreTimer);
    if (location.href === saved.url) {
      const element = saved.element.isConnected
        ? saved.element
        : document.querySelector<HTMLElement>(
            "[data-app-action-sidebar-scroll]",
          );
      element?.scrollTo({ top: saved.original, behavior: "instant" });
    }
    delete host.__chatExplorerScroll;
  };
  if (command === "restore") {
    restore();
    return null;
  }
  if (location.href !== expectedUrl) throw Error("Page changed");
  if (
    host.__chatExplorerProjects?.id === sessionId &&
    host.__chatExplorerProjects.closed
  )
    throw Error("Import stopped");
  if (
    (command === "start" || command === "capture") &&
    host.__chatExplorerScroll?.sessionId !== sessionId
  ) {
    restore();
    const semantic = [...document.querySelectorAll<HTMLElement>('[data-app-action-sidebar-scroll]')].find((el) => el.getClientRects().length > 0);
    const choices = new Map<HTMLElement, number>();
    // Anchor evidence plus semantic navigation; never scroll the conversation body.
    for (const a of semantic
      ? []
      : document.querySelectorAll<HTMLAnchorElement>(
          'nav a[href],aside a[href],[role="navigation"] a[href]',
        )) {
      let url: URL;
      try {
        url = new URL(a.href);
      } catch {
        continue;
      }
      if (
        url.origin !== "https://chatgpt.com" ||
        !/\/c\/[a-zA-Z0-9-]+\/?$/.test(url.pathname) ||
        a.closest('[hidden],[aria-hidden="true"]') ||
        getComputedStyle(a).visibility === "hidden" ||
        !a.getClientRects().length
      )
        continue;
      for (
        let el = a.parentElement;
        el && el !== document.body;
        el = el.parentElement
      ) {
        if (el.matches('main,[role="main"]')) break;
        const style = getComputedStyle(el);
        if (
          /(auto|scroll)/.test(style.overflowY) &&
          el.clientHeight > 0 &&
          el.scrollHeight > el.clientHeight + 2
        ) {
          choices.set(el, (choices.get(el) ?? 0) + 1);
          break;
        }
      }
    }
    const element =
      semantic ?? [...choices].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!element) return null;
    host.__chatExplorerScroll = {
      element,
      original: element.scrollTop,
      sessionId,
      url: expectedUrl,
      // Best-effort cleanup even if the background context disappears.
      restoreTimer: setTimeout(restore, 210000),
    };
  }
  const saved = host.__chatExplorerScroll;
  if (!saved || !saved.element.isConnected) return null;
  const el = saved.element;
  if (saved.sessionId !== sessionId) throw Error("Stale import");
  if (command === "capture")
    return {
      top: el.scrollTop,
      height: el.scrollHeight,
      viewport: el.clientHeight,
    };
  await new Promise<void>((resolve) => {
    let quiet: ReturnType<typeof setTimeout>;
    const started = Date.now();
    const finish = () => {
      clearTimeout(quiet);
      clearTimeout(cap);
      observer.disconnect();
      resolve();
    };
    const changed = () => {
      clearTimeout(quiet);
      quiet = setTimeout(finish, Math.max(250, 700 - (Date.now() - started)));
    };
    const observer = new MutationObserver(changed);
    observer.observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    const cap = setTimeout(finish, 1400);
    el.scrollTo({
      top:
        command === "start"
          ? 0
          : el.scrollTop + Math.max(1, el.clientHeight * 0.8),
      behavior: "instant",
    });
    changed();
  });
  return {
    top: el.scrollTop,
    height: el.scrollHeight,
    viewport: el.clientHeight,
  };
}
