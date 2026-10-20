// Only an explicit aria-controls relationship to the semantic sidebar is safe.
// No guessed class, generated ID, localized label or unrelated navigation click.
export async function sidebarPage(
  command: "open" | "restore",
  sessionId: string,
  url: string,
) {
  const host = globalThis as typeof globalThis & {
    __chatExplorerSidebar?: {
      id: string;
      url: string;
      button?: HTMLButtonElement;
      closed: boolean;
    };
  };
  const visible = (el: Element) =>
    el.getClientRects().length > 0 &&
    !el.closest("[hidden],[inert]") &&
    getComputedStyle(el).visibility !== "hidden";
  const sidebar = () =>
    [...document.querySelectorAll("[data-app-action-sidebar-scroll]")].find(
      visible,
    );
  const triggerSelector =
    'button[data-app-shell-sidebar-trigger="true"][aria-controls="app-shell-sidebar"]';
  const triggers = () =>
    [...document.querySelectorAll<HTMLButtonElement>(triggerSelector)].filter(
      (button) =>
        visible(button) &&
        !button.disabled &&
        button.getAttribute("aria-disabled") !== "true",
    );
  const wait = (predicate: () => boolean, ms: number) =>
    new Promise<boolean>((resolve) => {
      const finish = () => {
        clearTimeout(cap);
        clearInterval(poll);
        observer.disconnect();
        resolve(predicate());
      };
      const check = () => {
        if (predicate()) finish();
      };
      const observer = new MutationObserver(check);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      const cap = setTimeout(finish, ms),
        poll = setInterval(check, 50);
      check();
    });
  if (command === "restore") {
    const state = host.__chatExplorerSidebar;
    if (state?.id === sessionId) {
      state.closed = true;
      if (location.href === state.url && state.button) {
        const live = () =>
          state.button?.isConnected
            ? state.button
            : triggers().length === 1
              ? triggers()[0]
              : undefined;
        // Stop can arrive while React is still applying the opening click.
        await wait(
          () =>
            location.href !== state.url ||
            live()?.getAttribute("aria-expanded") === "true",
          700,
        );
        if (location.href !== state.url) return { ok: true };
        const button = live();
        if (!button) return { ok: false, reason: "sidebar-restore-failed" };
        if (button.getAttribute("aria-expanded") === "true") button.click();
        const restored = await wait(
          () =>
            location.href !== state.url ||
            live()?.getAttribute("aria-expanded") === "false",
          1500,
        );
        return {
          ok: restored,
          reason: restored ? undefined : "sidebar-restore-failed",
        };
      }
    } else if (!state || state.closed)
      host.__chatExplorerSidebar = { id: sessionId, url, closed: true };
    return { ok: true };
  }
  if (location.href !== url) return { ok: false, reason: "tab-navigated" };
  if (
    host.__chatExplorerSidebar?.id === sessionId &&
    host.__chatExplorerSidebar.closed
  )
    return { ok: false, reason: "stopped" };
  const primary = triggers();
  if (primary.length > 1) return { ok: false, reason: "sidebar-closed" };
  if (
    sidebar() &&
    (!primary.length || primary[0].getAttribute("aria-expanded") === "true")
  )
    return { ok: true };
  const controls = primary.length
    ? primary
    : [
        ...document.querySelectorAll<HTMLButtonElement>(
          'button[aria-controls][aria-expanded="false"]',
        ),
      ].filter((button) => {
        if (!visible(button) || button.disabled) return false;
        const ids = (button.getAttribute("aria-controls") ?? "")
          .split(/\s+/)
          .filter(Boolean);
        return (
          ids.length === 1 &&
          !!document
            .getElementById(ids[0])
            ?.querySelector("[data-app-action-sidebar-scroll]")
        );
      });
  if (controls.length !== 1) return { ok: false, reason: "sidebar-closed" };
  const button = controls[0];
  const expanded = button.getAttribute("aria-expanded");
  if (expanded !== "true" && expanded !== "false")
    return { ok: false, reason: "sidebar-closed" };
  const state = {
    id: sessionId,
    url,
    button: expanded === "false" ? button : undefined,
    closed: false,
  };
  host.__chatExplorerSidebar = state;
  state.button?.click();
  const opened = await wait(
    () =>
      state.closed ||
      location.href !== url ||
      (button.getAttribute("aria-expanded") === "true" && !!sidebar()),
    5000,
  );
  return {
    ok: opened && !state.closed && location.href === url,
    reason: location.href !== url ? "tab-navigated" : "sidebar-open-timeout",
  };
}
