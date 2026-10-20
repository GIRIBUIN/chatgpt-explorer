import type { AppState, Settings } from "../models/types";
import { defaults, validLocation } from "../models/state";
import {
  exportWorkspace,
  parseWorkspace,
  applyWorkspace,
  workspaceDiff,
  type Workspace,
} from "../models/workspace";
import { parseTheme, keys, object, type Theme } from "../models/theme";
import { canonical } from "./crypto";
export type Payload = {
  version: 1;
  workspace: Workspace;
  theme: Theme | null;
  preferences: Pick<
    Settings,
    "defaultOpenBehavior" | "sort" | "direction" | "startup" | "startupFolderId"
  >;
};
export function payload(s: AppState): Payload {
  const w = exportWorkspace(s);
  w.folders.sort((a, b) => a.id.localeCompare(b.id, "en"));
  w.chats.sort((a, b) => a.id.localeCompare(b.id, "en"));
  w.colorRules = w.colorRules
    .map((r) => ({ color: r.color, name: r.name, order: r.order }))
    .sort((a, b) => a.order - b.order || a.color.localeCompare(b.color, "en"));
  const { defaultOpenBehavior, sort, direction, startup, startupFolderId } =
    s.settings;
  const validStartupFolder = w.folders.some((f) => f.id === startupFolderId)
    ? startupFolderId
    : null;
  return parsePayload({
    version: 1,
    workspace: w,
    theme: s.theme ?? null,
    preferences: {
      defaultOpenBehavior,
      sort,
      direction,
      startup: startup === "folder" && !validStartupFolder ? "home" : startup,
      startupFolderId: validStartupFolder,
    },
  });
}
export function parsePayload(raw: unknown): Payload {
  const r = object(raw);
  keys(r, ["version", "workspace", "theme", "preferences"]);
  if (r.version !== 1) throw Error("Unsupported sync payload version.");
  const workspace = parseWorkspace(r.workspace),
    theme = r.theme === null ? null : parseTheme(r.theme),
    p = object(r.preferences);
  keys(p, [
    "defaultOpenBehavior",
    "sort",
    "direction",
    "startup",
    "startupFolderId",
  ]);
  if (
    !["reuse", "new-tab", "new-window"].includes(
      String(p.defaultOpenBehavior),
    ) ||
    !["name", "color", "opened", "added"].includes(String(p.sort)) ||
    !["asc", "desc"].includes(String(p.direction)) ||
    !["last", "home", "favorites", "folder"].includes(String(p.startup)) ||
    (p.startupFolderId !== null &&
      (typeof p.startupFolderId !== "string" ||
        !workspace.folders.some((f) => f.id === p.startupFolderId))) ||
    (p.startup === "folder" && !p.startupFolderId)
  )
    throw Error("Invalid sync preferences.");
  return {
    version: 1,
    // Entity array insertion order is not an Explorer metadata change.
    workspace: {
      ...workspace,
      folders: [...workspace.folders].sort((a, b) => a.id.localeCompare(b.id, "en")),
      chats: [...workspace.chats].sort((a, b) => a.id.localeCompare(b.id, "en")),
      colorRules: [...workspace.colorRules].sort((a, b) => a.order - b.order || a.color.localeCompare(b.color, "en")),
    },
    theme,
    preferences: p as Payload["preferences"],
  };
}
export function applyPayload(s: AppState, p: Payload): AppState {
  // Sync replaces organization (including deletions); JSON import remains merge-only.
  const fresh = applyWorkspace(defaults(), p.workspace);
  const next: AppState = {
    ...s,
    folders: fresh.folders.map((f) => ({
      ...f,
      createdAt:
        s.folders.find((old) => old.id === f.id)?.createdAt ?? f.createdAt,
    })),
    conversations: fresh.conversations.map((c) => {
      const old = s.conversations.find((x) => x.id === c.id);
      return {
        ...c,
        createdAt: old?.createdAt ?? c.createdAt,
        lastOpenedAt: old?.lastOpenedAt ?? null,
      };
    }),
    colorRules: p.workspace.colorRules,
    settings: { ...s.settings, ...p.preferences },
  };
  if (p.theme) next.theme = p.theme;
  else delete next.theme;
  next.settings.lastLocation = validLocation(next, s.settings.lastLocation);
  next.settings.collapsed = s.settings.collapsed.filter((id) =>
    next.folders.some((f) => f.id === id),
  );
  return next;
}
export function syncDiff(s: AppState, p: Payload) {
  const local = payload(s);
  return {
    ...workspaceDiff(s, p.workspace),
    // Sync can also clear an optional folder color; merge-only JSON import keeps it.
    foldersChanged: p.workspace.folders.filter(f => {
      const old = local.workspace.folders.find(x => x.id === f.id);
      return old && canonical(old) !== canonical(f);
    }).length,
    // Workspace JSON import is merge-only; sync also represents clearing/removal.
    chatsChanged: p.workspace.chats.filter(c => {
      const old = local.workspace.chats.find(x => x.id === c.id);
      if (!old) return false;
      const metadata = ({ displayName: _name, folderId: _folder, ...rest }: typeof c) => {
        void _name; void _folder; return rest;
      };
      return canonical(metadata(old)) !== canonical(metadata(c));
    }).length,
    colorRulesChanged: p.workspace.colorRules.filter(c =>
      !local.workspace.colorRules.some(old => canonical(old) === canonical(c)),
    ).length + local.workspace.colorRules.filter(c =>
      !p.workspace.colorRules.some(next => next.color === c.color),
    ).length,
    foldersRemoved: s.folders.filter(
      (f) => !p.workspace.folders.some((r) => r.id === f.id),
    ).length,
    chatsRemoved: s.conversations.filter(
      (c) => !p.workspace.chats.some((r) => r.id === c.id),
    ).length,
    themeChanged: canonical(s.theme ?? null) !== canonical(p.theme),
    preferencesChanged:
      canonical(payload(s).preferences) !== canonical(p.preferences),
  };
}
