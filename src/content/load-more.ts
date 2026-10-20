// Serialized into the same isolated world as Project/scroll controllers.
export async function loadMorePage(
  sessionId: string,
  url: string,
  projectId = "",
) {
  const host = globalThis as typeof globalThis & {
    __chatExplorerProjects?: { id: string; closed: boolean };
    __chatExplorerLoadMore?: {
      id: string;
      attempts: Map<string, number>;
      clicks: number;
    };
  };
  const stopped = () =>
    location.href !== url ||
    host.__chatExplorerProjects?.id !== sessionId ||
    host.__chatExplorerProjects.closed;
  if (stopped()) return { clicked: false, changed: false };
  const scroller = document.querySelector<HTMLElement>(
    "[data-app-action-sidebar-scroll]",
  );
  if (!scroller) return { clicked: false, changed: false };
  const visible = (el: Element) =>
    !el.closest("[hidden],[inert]") &&
    el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== "hidden";
  const candidates = [
    ...scroller.querySelectorAll<HTMLButtonElement>('button[type="button"]'),
  ].filter((button) => {
    if (
      !visible(button) ||
      button.disabled ||
      button.getAttribute("aria-disabled") === "true" ||
      button.hasAttribute("aria-haspopup")
    )
      return false;
    if (
      !/^(더\s*보기|show more|load more|more)$/i.test(button.innerText.trim())
    )
      return false;
    const section = button.closest("[data-app-action-sidebar-section-heading]");
    const kind = section?.getAttribute(
      "data-app-action-sidebar-section-heading",
    );
    if (kind !== "Projects" && kind !== "Recents") return false;
    if (
      !button.closest('[role="listitem"]') ||
      !button.closest('[role="list"]')
    )
      return false;
    const container = button
      .closest("[data-sidebar-project-container-id]")
      ?.getAttribute("data-sidebar-project-container-id");
    if (projectId && container !== `project:${projectId}`) return false;
    if (!projectId && container?.startsWith("project:")) return false;
    const rect = button.getBoundingClientRect(),
      view = scroller.getBoundingClientRect();
    return rect.top < view.bottom && rect.bottom > view.top;
  });
  const button = candidates[0];
  if (!button) return { clicked: false, changed: false };
  const scope =
    button.closest("[data-sidebar-project-container-id]") ??
    button.closest('[role="list"]')!;
  const signature = () =>
    [...scope.querySelectorAll("a[href],[data-app-action-sidebar-project-id]")]
      .map(
        (el) =>
          el.getAttribute("href") ??
          el.getAttribute("data-app-action-sidebar-project-id"),
      )
      .join("|");
  const before = signature(),
    height = scroller.scrollHeight;
  const state =
    host.__chatExplorerLoadMore?.id === sessionId
      ? host.__chatExplorerLoadMore
      : { id: sessionId, attempts: new Map<string, number>(), clicks: 0 };
  host.__chatExplorerLoadMore = state;
  const key = `${projectId || button.closest("[data-app-action-sidebar-section-heading]")?.getAttribute("data-app-action-sidebar-section-heading")}:${before}`;
  if ((state.attempts.get(key) ?? 0) >= 2 || state.clicks >= 40 || stopped())
    return { clicked: false, changed: false };
  state.attempts.set(key, (state.attempts.get(key) ?? 0) + 1);
  state.clicks++;
  const changed = await new Promise<boolean>((resolve, reject) => {
    let sawLoading = false;
    const altered = () =>
      signature() !== before || scroller.scrollHeight !== height;
    const finish = () => {
      clearTimeout(cap);
      clearInterval(poll);
      observer.disconnect();
      resolve(altered());
    };
    const check = () => {
      const loading =
        !!scope.querySelector('[aria-busy="true"]') ||
        [...scope.querySelectorAll('[role="status"]')].some(
          (el) => visible(el) && !!el.textContent?.trim(),
        );
      if (stopped() || altered() || (sawLoading && !loading)) finish();
      sawLoading ||= loading;
    };
    const observer = new MutationObserver(check);
    observer.observe(scroller, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    const cap = setTimeout(finish, 5000),
      poll = setInterval(check, 100);
    try {
      if (!stopped()) button.click();
      check();
    } catch (error) {
      clearTimeout(cap);
      clearInterval(poll);
      observer.disconnect();
      reject(error);
    }
  });
  return { clicked: true, changed };
}
