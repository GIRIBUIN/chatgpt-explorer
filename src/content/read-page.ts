export type LinkEvidence = { href: string; title: string };
export type ProjectRowEvidence = {
  id: string;
  name: string;
  collapsed: boolean | null;
};
export type RenderedPage = {
  url: string;
  links: (LinkEvidence & {
    projectHeaders: LinkEvidence[];
    inProjectMain: boolean;
    containerProjectId?: string | null;
    semantic?: boolean;
  })[];
  mainHeading: string | null;
  projectLinks?: LinkEvidence[];
  projects?: ProjectRowEvidence[];
};

// Serialized by chrome.scripting.executeScript; keep this function self-contained.
// Read-only and on demand: no clicks, scroll, observers, fetch, or application state.
export function readRenderedPage(): RenderedPage {
  const visible = (element: Element) => {
    if (element.closest("[hidden],[inert],dialog:not([open])")) return false;
    const hidden = element.closest(
      '[aria-hidden="true"],[data-aria-hidden="true"]',
    );
    // aria-hidden paired with data-aria-hidden is accessibility isolation in
    // observed snapshots, including visibly rendered sidebar links.
    if (hidden && hidden.getAttribute("data-aria-hidden") !== "true")
      return false;
    const style = getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      element.getClientRects().length > 0
    );
  };
  const text = (element: Element) =>
    (element as HTMLElement).innerText
      ?.trim()
      .replace(/\s+/g, " ")
      .slice(0, 300) ||
    element.getAttribute("title")?.trim().slice(0, 300) ||
    "";
  const projectRoute = (href: string) => {
    try {
      const u = new URL(href, location.href);
      return (
        u.origin === "https://chatgpt.com" &&
        /^\/g\/g-p-[a-f0-9]{32}(?:-[^/]+)?\/project\/?$/i.test(u.pathname)
      );
    } catch {
      return false;
    }
  };
  const scopeSelector = 'section,[role="group"],[role="region"],details,li';
  const projectPage = projectRoute(location.href);
  const headings = [
    ...document.querySelectorAll('main h1, [role="main"] h1'),
  ].filter(visible);
  const links: RenderedPage["links"] = [];
  const projectLinks: LinkEvidence[] = [];
  const projects: ProjectRowEvidence[] = [];
  for (const row of document.querySelectorAll<HTMLElement>(
    "[data-app-action-sidebar-project-row]",
  )) {
    if (!visible(row)) continue;
    const id = row.getAttribute("data-app-action-sidebar-project-id") ?? "";
    const name =
      row.getAttribute("data-app-action-sidebar-project-label")?.trim() ?? "";
    const collapsed = row.getAttribute(
      "data-app-action-sidebar-project-collapsed",
    );
    const expanded = row.getAttribute("aria-expanded");
    if (/^g-p-[a-f0-9]{32}$/i.test(id))
      projects.push({
        id,
        name,
        collapsed:
          collapsed === "true" && expanded !== "true"
            ? true
            : collapsed === "false" && expanded !== "false"
              ? false
              : null,
      });
  }
  // Semantic conversation rows first; legacy anchors remain a conservative fallback.
  const anchors = new Set([
    ...document.querySelectorAll<HTMLAnchorElement>(
      'a[data-interactive-row-link="true"]',
    ),
    ...document.querySelectorAll<HTMLAnchorElement>("a[href]"),
  ]);
  for (const anchor of anchors) {
    if (links.length >= 5000) break;
    if (
      !visible(anchor) ||
      anchor.closest("article,[data-message-author-role],pre,code")
    )
      continue;
    const main = anchor.closest('main,[role="main"]');
    const navigation = anchor.closest(
      'nav,aside,[role="navigation"],[role="dialog"],[data-app-action-sidebar-scroll]',
    );
    if (navigation && projectRoute(anchor.href)) {
      const name = anchor.innerText?.trim().replace(/\s+/g, " ").slice(0, 300);
      if (name) projectLinks.push({ href: anchor.href, title: name });
    }
    if (!navigation && main && !projectPage) continue;
    if (!/\/c\/[a-zA-Z0-9-]+\/?(?:[?#]|$)/.test(anchor.href)) continue;
    const semantic =
      anchor.getAttribute("data-interactive-row-link") === "true";
    const threadTitle = anchor.querySelector("[data-thread-title]");
    const title = (
      anchor.getAttribute("aria-label")?.trim() ||
      (threadTitle ? text(threadTitle) : "") ||
      text(anchor)
    ).slice(0, 300);
    if (!title) continue;
    let projectHeaders: LinkEvidence[] = [];
    let scope = anchor.closest(scopeSelector);
    while (scope) {
      const labels = (scope.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id))
        .filter((x): x is HTMLElement => !!x);
      const headers = [
        ...scope.querySelectorAll<HTMLAnchorElement>("a[href]"),
      ].filter((link) => {
        if (
          !projectRoute(link.href) ||
          !visible(link) ||
          link.closest(scopeSelector) !== scope
        )
          return false;
        const heading = link.closest(
          'header,h1,h2,h3,h4,h5,h6,summary,[role="heading"]',
        );
        return (
          !!heading ||
          labels.some((label) => label === link || label.contains(link))
        );
      });
      if (headers.length) {
        projectHeaders = headers.map((link) => ({
          href: link.href,
          title: text(link),
        }));
        break;
      }
      scope = scope.parentElement?.closest(scopeSelector) ?? null;
    }
    links.push({
      href: anchor.href,
      title,
      projectHeaders,
      inProjectMain: !!main && !navigation && projectPage,
      semantic,
      containerProjectId:
        anchor
          .closest("[data-sidebar-project-container-id]")
          ?.getAttribute("data-sidebar-project-container-id")
          ?.match(/^project:(g-p-[a-f0-9]{32})$/i)?.[1] ?? null,
    });
  }
  return {
    url: location.href,
    links,
    projectLinks,
    projects,
    mainHeading:
      projectPage && headings.length === 1 ? text(headings[0]) : null,
  };
}
