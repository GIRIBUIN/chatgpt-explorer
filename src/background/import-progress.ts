import type { ImportCandidate } from "../models/import";
import { isProjectId, parseConversationUrl } from "../utils/url";
// One instance per scan. Never seeded from storage or previous scan results.
export class ImportProgress {
  private chats = new Set<string>();
  private projects = new Set<string>();
  collect(items: ImportCandidate[], projectIds: unknown[] = []) {
    for (const item of items) {
      const parsed = parseConversationUrl(item.url);
      if (!parsed) continue;
      this.chats.add(parsed.id);
      const projectId = parsed.projectId ?? item.projectId;
      if (isProjectId(projectId)) this.projects.add(projectId);
    }
    for (const id of projectIds) if (isProjectId(id)) this.projects.add(id);
    return this.snapshot();
  }
  snapshot() {
    return { count: this.chats.size, projects: this.projects.size };
  }
}
