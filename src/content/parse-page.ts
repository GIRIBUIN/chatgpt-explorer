import type { RenderedPage } from "./read-page";
import type { ImportCandidate } from "../models/import";
import { parseConversationUrl, parseProjectUrl } from "../utils/url";

// Pure interpretation of DOM evidence; no title/slug guessing.
export function parseRenderedPage(page: RenderedPage): ImportCandidate[] {
  try {
    if (new URL(page.url).origin !== "https://chatgpt.com") return [];
  } catch {
    return [];
  }
  const pageId = parseProjectUrl(page.url);
  return page.links.flatMap((link) => {
    const parsed = parseConversationUrl(link.href);
    if (!parsed || !link.title.trim()) return [];
    if (link.containerProjectId && parsed.projectId !== link.containerProjectId)
      return [];
    const headers = link.projectHeaders
      .map((h) => ({ id: parseProjectUrl(h.href), name: h.title.trim() }))
      .filter((h) => h.id && h.name);
    const ids = new Set(headers.map((h) => h.id)),
      names = new Set(headers.map((h) => h.name));
    let contextId = ids.size === 1 && names.size === 1 ? headers[0].id : null;
    let contextName = contextId ? headers[0].name : null;
    if (
      !contextId &&
      link.projectHeaders.length === 0 &&
      link.inProjectMain &&
      pageId &&
      page.mainHeading?.trim()
    ) {
      contextId = pageId;
      contextName = page.mainHeading.trim();
    }
    const projectId = parsed.projectId ?? (link.semantic ? null : contextId);
    const projectName = contextId === projectId ? contextName : null;
    return [{ title: link.title, url: parsed.url, projectId, projectName }];
  });
}
