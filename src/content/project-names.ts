import type { RenderedPage } from "./read-page";
import { parseProjectUrl, isProjectId } from "../utils/url";

export type ProjectNameMap = Record<string, string | null>;
// Retain evidence even after virtualized links disappear. A conflict at the
// strongest observed level stays unresolved, rather than using a weaker guess.
export class ProjectNames {
  private evidence = new Map<string, { rank: number; names: Set<string> }>();
  private add(id: string | null, name: string | null, rank: number) {
    if (!id || !name?.trim()) return;
    const value = name.trim().slice(0, 300);
    const old = this.evidence.get(id);
    if (!old || rank > old.rank)
      this.evidence.set(id, { rank, names: new Set([value]) });
    else if (rank === old.rank) old.names.add(value);
  }
  collect(page: RenderedPage) {
    try {
      if (new URL(page.url).origin !== "https://chatgpt.com") return;
    } catch {
      return;
    }
    for (const row of page.projects ?? [])
      if (isProjectId(row.id)) this.add(row.id, row.name, 4);
    for (const link of page.projectLinks ?? [])
      this.add(parseProjectUrl(link.href), link.title, 3);
    for (const link of page.links) {
      const headers = link.projectHeaders;
      const ids = new Set(headers.map((h) => parseProjectUrl(h.href)));
      if (ids.size === 1 && !ids.has(null))
        for (const header of headers)
          this.add(parseProjectUrl(header.href), header.title, 2);
    }
    this.add(parseProjectUrl(page.url), page.mainHeading, 1);
  }
  resolve(): ProjectNameMap {
    return Object.fromEntries(
      [...this.evidence].map(([id, e]) => [
        id,
        e.names.size === 1 ? [...e.names][0] : null,
      ]),
    );
  }
}
