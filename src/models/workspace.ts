import type { AppState, Folder, Conversation, ColorRule } from "./types";
import { parseConversationUrl, isProjectId } from "../utils/url";
import { validColor, colorName } from "./state";
import { object, keys, text } from "./theme";
export type Workspace = {
  version: 1;
  folders: Pick<Folder, "id" | "name" | "parentId" | "favorite">[];
  chats: {
    id: string;
    url: string;
    originalTitle: string | null;
    displayName: string;
    folderId: string | null;
    color: string;
    favorite: boolean;
    projectId: string | null;
    projectName: string | null;
  }[];
  colorRules: Required<ColorRule>[];
};
export function exportWorkspace(s: AppState): Workspace {
  return {
    version: 1,
    folders: s.folders.map(({ id, name, parentId, favorite }) => ({
      id,
      name,
      parentId,
      favorite,
    })),
    chats: s.conversations.map((c) => ({
      id: c.id,
      url: c.url,
      originalTitle: c.originalTitle ?? null,
      displayName: c.title,
      folderId: c.folderId,
      color: c.color,
      favorite: c.favorite,
      projectId: c.projectId,
      projectName: c.projectName,
    })),
    colorRules: s.colorRules.map((r) => ({
      ...r,
      name: colorName(s, r.color),
    })),
  };
}
export function parseWorkspace(raw: unknown): Workspace {
  const r = object(raw);
  keys(r, ["version", "folders", "chats", "colorRules"]);
  if (
    r.version !== 1 ||
    !Array.isArray(r.folders) ||
    !Array.isArray(r.chats) ||
    !Array.isArray(r.colorRules)
  )
    throw Error("Invalid workspace schema.");
  const unique = (items: unknown[], field: string) => {
    const ids = new Set<string>();
    for (const item of items) {
      const id = text(object(item)[field]);
      if (ids.has(id)) throw Error("Duplicate ID.");
      ids.add(id);
    }
    return ids;
  };
  const folderIds = unique(r.folders, "id");
  unique(r.chats, "id");
  const colors = unique(r.colorRules, "color");
  for (const raw of r.colorRules) {
    const c = object(raw);
    keys(c, ["color", "name", "order"]);
    text(c.name, false, 100);
    if (
      !validColor(c.color) ||
      c.color !== c.color.toLowerCase() ||
      !Number.isSafeInteger(c.order) ||
      Number(c.order) < 0
    )
      throw Error("Invalid color rule.");
  }
  const parents = new Map<string, string | null>();
  for (const raw of r.folders) {
    const f = object(raw);
    keys(f, ["id", "name", "parentId", "favorite"]);
    text(f.name, false, 300);
    if (
      typeof f.favorite !== "boolean" ||
      (f.parentId !== null &&
        (typeof f.parentId !== "string" || !folderIds.has(f.parentId)))
    )
      throw Error("Invalid parent.");
    parents.set(String(f.id), f.parentId as string | null);
  }
  for (const id of folderIds) {
    const seen = new Set<string>();
    let next: string | null = id;
    while (next !== null) {
      if (seen.has(next)) throw Error("Folder cycle.");
      seen.add(next);
      next = parents.get(next) ?? null;
    }
  }
  for (const raw of r.chats) {
    const c = object(raw);
    keys(c, [
      "id",
      "url",
      "originalTitle",
      "displayName",
      "folderId",
      "color",
      "favorite",
      "projectId",
      "projectName",
    ]);
    text(c.displayName, false, 300);
    if (c.originalTitle !== null) text(c.originalTitle, false, 300);
    if (c.projectName !== null) text(c.projectName, false, 300);
    const url = parseConversationUrl(text(c.url));
    if (
      !url ||
      url.id !== c.id ||
      typeof c.favorite !== "boolean" ||
      (c.folderId !== null &&
        (typeof c.folderId !== "string" || !folderIds.has(c.folderId))) ||
      !colors.has(String(c.color)) ||
      (c.projectId !== null && !isProjectId(c.projectId)) ||
      (url.projectId && url.projectId !== c.projectId) ||
      (!c.projectId && c.projectName)
    )
      throw Error("Invalid chat reference.");
  }
  return r as unknown as Workspace;
}
export function applyWorkspace(s: AppState, w: Workspace): AppState {
  const folders = new Map(s.folders.map((f) => [f.id, f]));
  for (const f of w.folders)
    folders.set(f.id, {
      ...folders.get(f.id),
      ...f,
      createdAt: folders.get(f.id)?.createdAt ?? Date.now(),
    });
  const chats = new Map(s.conversations.map((c) => [c.id, c]));
  for (const c of w.chats) {
    const old = chats.get(c.id);
    const next: Conversation = {
      ...old,
      id: c.id,
      url: c.url,
      title: c.displayName,
      folderId: c.folderId,
      color: c.color,
      favorite: c.favorite,
      projectId: c.projectId,
      projectName: c.projectName,
      createdAt: old?.createdAt ?? Date.now(),
      lastOpenedAt: old?.lastOpenedAt ?? null,
    };
    if (c.originalTitle !== null) next.originalTitle = c.originalTitle;
    chats.set(c.id, next);
  }
  const rules = new Map(s.colorRules.map((c) => [c.color, c]));
  for (const c of w.colorRules) rules.set(c.color, c);
  const next = {
    ...s,
    folders: [...folders.values()],
    conversations: [...chats.values()],
    colorRules: [...rules.values()].sort((a, b) => a.order - b.order),
  };
  // Validate the combined hierarchy too: retained folders can point into updated ones.
  parseWorkspace(exportWorkspace(next));
  return next;
}
export function workspaceDiff(s: AppState, w: Workspace) {
  const next = applyWorkspace(s, w);
  return {
    foldersAdded: next.folders.length - s.folders.length,
    foldersChanged: w.folders.filter((f) =>
      s.folders.some(
        (old) =>
          old.id === f.id &&
          (old.name !== f.name ||
            old.parentId !== f.parentId ||
            old.favorite !== f.favorite),
      ),
    ).length,
    chatsAdded: next.conversations.length - s.conversations.length,
    chatsMoved: w.chats.filter((c) =>
      s.conversations.some(
        (old) => old.id === c.id && old.folderId !== c.folderId,
      ),
    ).length,
    aliasesRenamed: w.chats.filter((c) =>
      s.conversations.some(
        (old) => old.id === c.id && old.title !== c.displayName,
      ),
    ).length,
    chatsChanged: w.chats.filter((c) =>
      s.conversations.some(
        (old) =>
          old.id === c.id &&
          (old.color !== c.color ||
            old.favorite !== c.favorite ||
            old.projectId !== c.projectId ||
            old.projectName !== c.projectName ||
            old.url !== c.url ||
            (c.originalTitle !== null &&
              old.originalTitle !== c.originalTitle)),
      ),
    ).length,
    colorRulesChanged: w.colorRules.filter(
      (c) =>
        !s.colorRules.some(
          (old) =>
            old.color === c.color &&
            old.order === c.order &&
            colorName(s, old.color) === c.name,
        ),
    ).length,
    chatsRemoved: 0,
  };
}
