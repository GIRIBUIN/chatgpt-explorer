import type { AppState } from "./types";
import { addConversation } from "./state";
import { isProjectId, parseConversationUrl } from "../utils/url";
import type { ProjectNameMap } from "../content/project-names";
export type ImportCandidate = {
  title: string;
  url: string;
  projectId?: string | null;
  projectName?: string | null;
};
export function importChats(
  state: AppState,
  candidates: ImportCandidate[],
  projectNames: ProjectNameMap = {},
) {
  let next = state,
    added = 0,
    existed = 0,
    projectNamesUpdated = 0,
    metadataUpdated = 0;
  const groups = new Map<string, ImportCandidate[]>();
  for (const candidate of candidates) {
    const parsed = parseConversationUrl(candidate.url);
    if (!parsed || !candidate.title.trim()) continue;
    const group = groups.get(parsed.id) ?? [];
    group.push(candidate);
    groups.set(parsed.id, group);
  }
  for (const [id, group] of groups) {
    const evidence = group.map((c) => {
      const parsed = parseConversationUrl(c.url)!;
      const projectId =
        parsed.projectId ?? (isProjectId(c.projectId) ? c.projectId : null);
      const sourceName =
        projectId &&
        (!parsed.projectId || !c.projectId || parsed.projectId === c.projectId)
          ? c.projectName?.trim().slice(0, 300) || null
          : null;
      const projectName =
        projectId && Object.hasOwn(projectNames, projectId)
          ? projectNames[projectId]
          : sourceName;
      return { ...c, ...parsed, projectId, projectName };
    });
    const ids = new Set(evidence.map((c) => c.projectId).filter(Boolean));
    const projectId = ids.size === 1 ? [...ids][0]! : null;
    const names = new Set(
      evidence
        .filter((c) => c.projectId === projectId)
        .map((c) => c.projectName)
        .filter(Boolean),
    );
    const projectName = projectId && names.size === 1 ? [...names][0]! : null;
    const canonical =
      ids.size > 1
        ? `https://chatgpt.com/c/${id}`
        : (evidence.find(
            (c) => parseConversationUrl(c.url)?.projectId === projectId,
          )?.url ?? evidence[0].url);
    const existing = next.conversations.find((c) => c.id === id);
    if (!existing) {
      next = addConversation(next, evidence[0].title, canonical, null).state;
      next = {
        ...next,
        conversations: next.conversations.map((c) =>
          c.id === id
            ? { ...c, originalTitle: evidence[0].title, projectId, projectName }
            : c,
        ),
      };
      added++;
      continue;
    }
    existed++;
    if (!projectId || (existing.projectId && existing.projectId !== projectId))
      continue;
    const updatedName = existing.projectName ?? projectName;
    const updatedUrl =
      !parseConversationUrl(existing.url)?.projectId &&
      parseConversationUrl(canonical)?.projectId
        ? canonical
        : existing.url;
    if (
      existing.projectId !== projectId ||
      existing.projectName !== updatedName ||
      existing.url !== updatedUrl
    ) {
      if (!existing.projectName && updatedName) projectNamesUpdated++;
      metadataUpdated++;
      next = {
        ...next,
        conversations: next.conversations.map((c) =>
          c.id === id
            ? { ...c, projectId, projectName: updatedName, url: updatedUrl }
            : c,
        ),
      };
    }
  }
  // A collapsed project's name may be visible even when its chats aren't.
  let enriched = false;
  const conversations = next.conversations.map((c) => {
    const name =
      c.projectId && isProjectId(c.projectId)
        ? projectNames[c.projectId]
        : null;
    if (c.projectName || !name?.trim()) return c;
    projectNamesUpdated++;
    metadataUpdated++;
    enriched = true;
    return { ...c, projectName: name.trim().slice(0, 300) };
  });
  if (enriched) next = { ...next, conversations };
  return { state: next, added, existed, projectNamesUpdated, metadataUpdated };
}
