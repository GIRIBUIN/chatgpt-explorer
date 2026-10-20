// Serialized into the isolated content world. Only explicit button rows can be
// toggled; links, generated IDs and locale-dependent text are never clicked.
export async function projectPage(
  command: "begin" | "expand" | "advance" | "close" | "restore",
  sessionId: string,
  expectedUrl: string,
  projectId?: string,
) {
  type Entry = { row: HTMLElement; top: number };
  type State = {
    id: string;
    url: string;
    changed: Map<string, Entry>;
    views: Map<string, number>;
    closed: boolean;
    timer?: ReturnType<typeof setTimeout>;
  };
  const host = globalThis as typeof globalThis & {
    __chatExplorerProjects?: State;
  };
  const rows = () => [
    ...document.querySelectorAll<HTMLElement>(
      "[data-app-action-sidebar-project-row]",
    ),
  ];
  const find = (id: string) =>
    rows().find(
      (row) => row.getAttribute("data-app-action-sidebar-project-id") === id,
    );
  const collapsed = (row: HTMLElement) => {
    const c = row.getAttribute("data-app-action-sidebar-project-collapsed"),
      e = row.getAttribute("aria-expanded");
    return c === "true" && e !== "true"
      ? true
      : c === "false" && e !== "false"
        ? false
        : null;
  };
  const wait = (predicate: () => boolean, timeout = 3000) =>
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
        attributes: true,
        childList: true,
        subtree: true,
      });
      const cap = setTimeout(finish, timeout),
        poll = setInterval(check, 100);
      check();
    });
  const restoreOne = async (state: State, id: string) => {
    const entry = state.changed.get(id);
    if (!entry || location.href !== state.url) return;
    let row = find(id);
    if (!row && !entry.row.isConnected) {
      document
        .querySelector<HTMLElement>("[data-app-action-sidebar-scroll]")
        ?.scrollTo({ top: entry.top, behavior: "instant" });
      await wait(() => !!find(id) || location.href !== state.url, 1500);
      row = find(id);
    }
    row ??= entry.row.isConnected ? entry.row : undefined;
    if (!row || location.href !== state.url)
      throw Error("Project restore unavailable");
    // An expansion may still be settling when Stop arrives. Allow its attributes
    // to settle before restoring; never toggle an already collapsed row.
    await wait(
      () => collapsed(row!) !== null || location.href !== state.url,
      800,
    );
    if (location.href !== state.url) return;
    if (collapsed(row) === false) {
      row.click();
      if (
        !(await wait(
          () =>
            location.href !== state.url || collapsed(find(id) ?? row!) === true,
        ))
      )
        throw Error("Project restore timeout");
    }
    if (collapsed(find(id) ?? row) === true) state.changed.delete(id);
    else throw Error("Project state uncertain");
  };
  const restoreAll = async (state: State) => {
    state.closed = true;
    clearTimeout(state.timer);
    let ok = true;
    for (const id of state.changed.keys()) {
      try {
        await restoreOne(state, id);
      } catch {
        ok = false;
      }
    }
    return ok;
  };
  if (command === "begin") {
    if (location.href !== expectedUrl) throw Error("Page changed");
    const old = host.__chatExplorerProjects;
    if (old?.id === sessionId && old.closed) throw Error("Stale import");
    if (old && !old.closed) await restoreAll(old);
    const state: State = {
      id: sessionId,
      url: expectedUrl,
      changed: new Map(),
      views: new Map(),
      closed: false,
    };
    state.timer = setTimeout(() => void restoreAll(state), 200000);
    host.__chatExplorerProjects = state;
    return { ok: true };
  }
  const state = host.__chatExplorerProjects;
  if (!state && command === "restore") {
    host.__chatExplorerProjects = {
      id: sessionId,
      url: expectedUrl,
      changed: new Map(),
      views: new Map(),
      closed: true,
    };
    return { ok: true };
  }
  if (!state || state.id !== sessionId) return { ok: false };
  if (command === "restore") return { ok: await restoreAll(state) };
  if (location.href !== state.url || state.closed)
    throw Error("Page changed or import stopped");
  if (!projectId || !/^g-p-[a-f0-9]{32}$/i.test(projectId))
    throw Error("Invalid project");
  const scroller = document.querySelector<HTMLElement>(
    "[data-app-action-sidebar-scroll]",
  );
  if (command === "close") {
    await restoreOne(state, projectId);
    const top = state.views.get(projectId);
    if (top !== undefined && location.href === state.url)
      scroller?.scrollTo({ top, behavior: "instant" });
    state.views.delete(projectId);
    return { ok: true };
  }
  if (command === "advance") {
    const container = [
      ...document.querySelectorAll<HTMLElement>(
        "[data-sidebar-project-container-id]",
      ),
    ].find(
      (el) =>
        el.getAttribute("data-sidebar-project-container-id") ===
        `project:${projectId}`,
    );
    if (
      !scroller ||
      !container ||
      container.getBoundingClientRect().bottom <=
        scroller.getBoundingClientRect().bottom + 2
    )
      return { ok: true, more: false };
    const top = scroller.scrollTop;
    await new Promise<void>((resolve) => {
      const start = Date.now();
      let quiet: ReturnType<typeof setTimeout>;
      const finish = () => {
        clearTimeout(quiet);
        clearTimeout(cap);
        observer.disconnect();
        resolve();
      };
      const changed = () => {
        clearTimeout(quiet);
        quiet = setTimeout(finish, Math.max(250, 700 - (Date.now() - start)));
      };
      const observer = new MutationObserver(changed);
      observer.observe(scroller, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      const cap = setTimeout(finish, 1800);
      scroller.scrollTo({
        top: top + scroller.clientHeight * 0.8,
        behavior: "instant",
      });
      changed();
    });
    return { ok: true, more: scroller.scrollTop > top + 1 };
  }
  const row = find(projectId);
  if (
    !row ||
    row.getAttribute("role") !== "button" ||
    row.matches("a") ||
    row.closest("[inert],[hidden]") ||
    !row.getClientRects().length
  )
    return { ok: false };
  state.views.set(projectId, scroller?.scrollTop ?? 0);
  const initiallyCollapsed = collapsed(row);
  if (initiallyCollapsed === null) return { ok: false };
  if (initiallyCollapsed) {
    state.changed.set(projectId, { row, top: scroller?.scrollTop ?? 0 });
    row.click();
    const expanded = await wait(
      () =>
        state.closed ||
        location.href !== state.url ||
        collapsed(find(projectId) ?? row) === false,
    );
    if (!expanded || state.closed || location.href !== state.url)
      throw Error("Project expansion interrupted");
  }
  // Expanded rows can still be loading. Observe their child lists even when no
  // click was needed. Multiple nested containers can share the same project ID.
  const started = Date.now();
  const loaded = await wait(() => {
    if (state.closed || location.href !== state.url) return true;
    const containers = [
      ...document.querySelectorAll<HTMLElement>(
        "[data-sidebar-project-container-id]",
      ),
    ].filter(
      (el) =>
        el.getAttribute("data-sidebar-project-container-id") ===
        `project:${projectId}`,
    );
    if (!containers.length) return false;
    const usable = (el: Element) =>
      !el.closest("[hidden],[inert]") &&
      getComputedStyle(el).display !== "none" &&
      getComputedStyle(el).visibility !== "hidden" &&
      el.getClientRects().length > 0;
    if (
      containers.some((container) =>
        [...container.querySelectorAll<HTMLAnchorElement>("a[href]")].some(
          (link) => {
            const u = new URL(link.href, location.href);
            return (
              u.origin === "https://chatgpt.com" &&
              u.pathname.startsWith(`/g/${projectId}/c/`) &&
              usable(link)
            );
          },
        ),
      )
    )
      return true;
    const loading = containers.some((container) =>
      [
        ...container.querySelectorAll('[role="status"],[aria-busy="true"]'),
      ].some(
        (el) =>
          usable(el) &&
          (el.getAttribute("aria-busy") === "true" || !!el.textContent?.trim()),
      ),
    );
    return !loading && Date.now() - started >= 700;
  }, 6000);
  if (state.closed || location.href !== state.url)
    throw Error("Project expansion interrupted");
  if (!loaded) throw Error("Project loading timeout");
  return { ok: true };
}
