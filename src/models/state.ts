import { parseTheme } from "./theme";
import { uiScale } from './ui-scale';
import { folderPinned } from './folders';
import { t } from "../i18n";
import type { AppState, Conversation, Folder, Item, Location } from "./types";
import { parseConversationUrl, isProjectId } from "../utils/url";
export const presets = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#3b82f6",
  "#22c55e",
  "#a855f7",
  "#ffffff",
];
export const defaultColorName = (color: string, index: number) =>
  color.toLowerCase() === "#ffffff"
    ? t("neutral")
    : t("customColorNumber", { number: index + 1 });
export function colorName(s: AppState, color: string) {
  const index = s.colorRules.findIndex((r) => r.color === color.toLowerCase());
  return (
    s.colorRules[index]?.name?.trim() ||
    defaultColorName(color, index < 0 ? s.colorRules.length : index)
  );
}
export function renameColor(
  s: AppState,
  color: string,
  name: string,
): AppState {
  if (!validColor(color) || !name.trim()) throw Error(t("enterAName"));
  const key = color.toLowerCase(),
    existing = s.colorRules.find((r) => r.color === key);
  const clean = name.trim().slice(0, 100);
  return {
    ...s,
    colorRules: existing
      ? s.colorRules.map((r) => (r.color === key ? { ...r, name: clean } : r))
      : [
          ...s.colorRules,
          { color: key, order: s.colorRules.length, name: clean },
        ],
  };
}
export const defaults = (): AppState => ({
  version: 2,
  folders: [],
  conversations: [],
  colorRules: presets.map((color, order) => ({
    color,
    order,
    name: defaultColorName(color, order),
  })),
  settings: {
    defaultOpenBehavior: "reuse",
    startup: "last",
    startupFolderId: null,
    lastLocation: "home",
    rememberBounds: true,
    alwaysCentered: false,
    sort: "name",
    direction: "asc",
    colorFilter: "all",
    collapsed: [],
  },
});
export function ancestors(folders: Folder[], id: string | null): Folder[] {
  const result: Folder[] = [];
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const f = folders.find((x) => x.id === id);
    if (!f) break;
    result.unshift(f);
    id = f.parentId;
  }
  return result;
}
export function canMoveFolder(
  folders: Folder[],
  id: string,
  parentId: string | null,
) {
  return (
    folders.some((f) => f.id === id) &&
    (!parentId || folders.some((f) => f.id === parentId)) &&
    !ancestors(folders, parentId).some((f) => f.id === id)
  );
}
export function moveItem(
  state: AppState,
  item: Item,
  parentId: string | null,
): AppState {
  if (parentId && !state.folders.some((f) => f.id === parentId))
    throw Error(t("destinationFolderNotFound"));
  if (item.kind === "folder") {
    if (!canMoveFolder(state.folders, item.id, parentId))
      throw Error(t("cannotMoveAFolderIntoItselfOrItsChildren"));
    return {
      ...state,
      folders: state.folders.map((f) =>
        f.id === item.id ? { ...f, parentId } : f,
      ),
    };
  }
  return {
    ...state,
    conversations: state.conversations.map((c) =>
      c.id === item.id ? { ...c, folderId: parentId } : c,
    ),
  };
}
export function deleteFolder(state: AppState, id: string): AppState {
  const folder = state.folders.find((f) => f.id === id);
  if (!folder) return state;
  const next = {
    ...state,
    folders: state.folders
      .filter((f) => f.id !== id)
      .map((f) =>
        f.parentId === id ? { ...f, parentId: folder.parentId } : f,
      ),
    conversations: state.conversations.map((c) =>
      c.folderId === id ? { ...c, folderId: null } : c,
    ),
  };
  return {
    ...next,
    settings: {
      ...next.settings,
      lastLocation: validLocation(next, next.settings.lastLocation),
      startupFolderId:
        next.settings.startupFolderId === id
          ? null
          : next.settings.startupFolderId,
      collapsed: next.settings.collapsed.filter((x) => x !== id),
    },
  };
}
export function addConversation(
  state: AppState,
  title: string,
  url: string,
  folderId: string | null,
) {
  const parsed = parseConversationUrl(url);
  if (!parsed) throw Error(t("enterAValidChatGPTConversationURL"));
  const existing = state.conversations.find(
    (c) => c.id === parsed.id || c.url === parsed.url,
  );
  if (existing) return { state, conversation: existing, duplicate: true };
  if (!title.trim()) throw Error(t("enterADisplayName"));
  if (folderId && !state.folders.some((f) => f.id === folderId))
    throw Error(t("folderNotFound"));
  const conversation: Conversation = {
    ...parsed,
    projectName: null,
    title: title.trim(),
    folderId,
    color: "#ffffff",
    favorite: false,
    createdAt: Date.now(),
    lastOpenedAt: null,
  };
  return {
    state: { ...state, conversations: [...state.conversations, conversation] },
    conversation,
    duplicate: false,
  };
}
export function validLocation(s: AppState, value: unknown): Location {
  if (value === "home" || value === "favorites" || value === "inbox")
    return value;
  if (
    typeof value === "string" &&
    value.startsWith("folder:") &&
    s.folders.some((f) => f.id === value.slice(7))
  )
    return value as Location;
  return "home";
}
export function startupLocation(s: AppState): Location {
  return validLocation(
    s,
    s.settings.startup === "last"
      ? s.settings.lastLocation
      : s.settings.startup === "folder"
        ? `folder:${s.settings.startupFolderId}`
        : s.settings.startup,
  );
}
export function sortConversations(s: AppState, items: Conversation[]) {
  const ranks = new Map(s.colorRules.map((r) => [r.color, r.order]));
  const sign = s.settings.direction === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    let delta = 0;
    switch (s.settings.sort) {
      case "color":
        delta =
          (ranks.get(a.color) ?? Infinity) - (ranks.get(b.color) ?? Infinity);
        break;
      case "added":
        delta = a.createdAt - b.createdAt;
        break;
      case "opened":
        delta = (a.lastOpenedAt ?? 0) - (b.lastOpenedAt ?? 0);
        break;
    }
    return (
      sign *
      (delta || a.title.localeCompare(b.title, undefined, { numeric: true }))
    );
  });
}
const record = (x: unknown): Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : {};
const array = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown, fallback = "") =>
  typeof x === "string" ? x : fallback;
const time = (x: unknown) =>
  typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0;
export const validColor = (x: unknown): x is string =>
  typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x);
export function assignColor(s: AppState, items: Item[], color: string | null): AppState {
  if (color !== null && !validColor(color)) throw Error(t('enterAColorAsRRGGBB'));
  const normalized = color?.toLowerCase();
  return {
    ...s,
    folders: s.folders.map(f => {
      if (!items.some(i => i.kind === 'folder' && i.id === f.id)) return f;
      const next = { ...f };
      if (normalized) next.color = normalized;
      else delete next.color;
      return next;
    }),
    conversations: s.conversations.map(c => normalized && items.some(i => i.kind === 'conversation' && i.id === c.id)
      ? { ...c, color: normalized } : c),
  };
}
export function normalizeState(raw: unknown): AppState {
  const s = defaults(),
    r = record(raw);
  const ids = new Set<string>();
  for (const value of array(r.folders)) {
    const f = record(value),
      id = str(f.id);
    if (!id || ids.has(id)) continue;
    ids.add(id);
    s.folders.push({
      id,
      name: str(f.name).trim() || t("untitledFolder"),
      parentId: typeof f.parentId === "string" ? f.parentId : null,
      pinned: folderPinned(f),
      createdAt: time(f.createdAt),
      ...(validColor(f.color) ? { color: f.color.toLowerCase() } : {}),
    });
  }
  for (const f of s.folders) {
    if (
      f.parentId &&
      (!ids.has(f.parentId) ||
        ancestors(s.folders, f.parentId).some((p) => p.id === f.id))
    )
      f.parentId = null;
  }
  const chats = new Set<string>();
  for (const value of array(r.conversations)) {
    const c = record(value),
      parsed = parseConversationUrl(str(c.url));
    if (!parsed || chats.has(parsed.id)) continue;
    chats.add(parsed.id);
    s.conversations.push({
      ...parsed,
      projectId:
        parsed.projectId ?? (isProjectId(c.projectId) ? c.projectId : null),
      projectName:
        (parsed.projectId || isProjectId(c.projectId)) &&
        (!parsed.projectId || !c.projectId || parsed.projectId === c.projectId)
          ? str(c.projectName).trim().slice(0, 300) || null
          : null,
      ...(typeof c.originalTitle === "string"
        ? { originalTitle: c.originalTitle.slice(0, 300) }
        : {}),
      title: str(c.title).trim() || t("untitledChat"),
      folderId:
        typeof c.folderId === "string" && ids.has(c.folderId)
          ? c.folderId
          : null,
      color: validColor(c.color) ? c.color.toLowerCase() : "#ffffff",
      favorite: c.favorite === true,
      createdAt: time(c.createdAt),
      lastOpenedAt:
        typeof c.lastOpenedAt === "number" ? time(c.lastOpenedAt) : null,
    });
  }
  const rules = array(r.colorRules)
    .map(record)
    .filter((r) => validColor(r.color))
    .sort((a, b) => time(a.order) - time(b.order));
  const colors = [
    ...new Set([
      ...rules.map((r) => str(r.color).toLowerCase()),
      ...presets,
      ...s.conversations.map((c) => c.color),
    ]),
  ];
  s.colorRules = colors.map((color, order) => ({
    color,
    order,
    name:
      str(rules.find((r) => str(r.color).toLowerCase() === color)?.name)
        .trim()
        .slice(0, 100) || defaultColorName(color, order),
  }));
  if (r.theme !== undefined) {
    try {
      s.theme = parseTheme(r.theme);
    } catch {
      /* Invalid custom themes fall back to OS colors. */
    }
  }
  const preferences = record(r.settings);
  if (preferences.uiScale !== undefined) s.settings.uiScale = uiScale(preferences.uiScale);
  if (typeof preferences.projectFilter === "string")
    s.settings.projectFilter = preferences.projectFilter;
  if (
    preferences.defaultOpenBehavior === "new-tab" ||
    preferences.defaultOpenBehavior === "new-window"
  )
    s.settings.defaultOpenBehavior = preferences.defaultOpenBehavior;
  if (
    ["last", "home", "favorites", "folder"].includes(str(preferences.startup))
  )
    s.settings.startup = preferences.startup as AppState["settings"]["startup"];
  if (["name", "color", "opened", "added"].includes(str(preferences.sort)))
    s.settings.sort = preferences.sort as AppState["settings"]["sort"];
  s.settings.direction = preferences.direction === "desc" ? "desc" : "asc";
  s.settings.startupFolderId =
    typeof preferences.startupFolderId === "string" &&
    ids.has(preferences.startupFolderId)
      ? preferences.startupFolderId
      : null;
  s.settings.lastLocation = validLocation(s, preferences.lastLocation);
  s.settings.rememberBounds = preferences.rememberBounds !== false;
  s.settings.alwaysCentered = preferences.alwaysCentered === true;
  s.settings.colorFilter = validColor(preferences.colorFilter)
    ? preferences.colorFilter.toLowerCase()
    : "all";
  s.settings.collapsed = array(preferences.collapsed).filter(
    (x): x is string => typeof x === "string" && ids.has(x),
  );
  return s;
}
