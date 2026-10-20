import type { AppState, Item, Conversation } from "./types";
import { colorName } from "./state";
export const itemKey = (i: Item) => `${i.kind}:${i.id}`;
export function selectItems(
  previous: string[],
  anchor: string | null,
  clicked: string,
  visible: string[],
  ctrl = false,
  shift = false,
) {
  if (shift && anchor && visible.includes(anchor)) {
    const a = visible.indexOf(anchor),
      b = visible.indexOf(clicked);
    const range = visible.slice(Math.min(a, b), Math.max(a, b) + 1);
    return {
      ids: ctrl ? [...new Set([...previous, ...range])] : range,
      anchor,
    };
  }
  return {
    ids: ctrl
      ? previous.includes(clicked)
        ? previous.filter((x) => x !== clicked)
        : [...previous, clicked]
      : [clicked],
    anchor: clicked,
  };
}
export const isTextInput = (target: Element, includeSelect = true) =>
  !!target.closest(includeSelect ? 'input,textarea,select' : 'input,textarea') ||
  (target as HTMLElement).isContentEditable === true;
export function searchTokens(query: string) {
  return (query.match(/(?:name:|color:|project:)?"[^"]*"|[^\s]+/gi) ?? [])
    .map((raw) => {
      const match = /^(name|color|project):(.*)$/i.exec(raw);
      return {
        field: match?.[1].toLowerCase() ?? "",
        value: (match?.[2] ?? raw).replace(/^"|"$/g, "").toLocaleLowerCase(),
      };
    })
    .filter((t) => t.value);
}
export function matchesSearch(
  query: string,
  fields: { name: string; color?: string; project?: string },
) {
  return searchTokens(query).every((token) => {
    const value = token.field
      ? (fields[token.field as keyof typeof fields] ?? "")
      : Object.values(fields).join(" ");
    return value.toLocaleLowerCase().includes(token.value);
  });
}
export function matchesChat(
  s: AppState,
  c: Conversation,
  query: string,
  project: string,
) {
  return (
    (project === "all" ||
      (project === "none" ? !c.projectId : c.projectId === project)) &&
    (s.settings.colorFilter === "all" || c.color === s.settings.colorFilter) &&
    matchesSearch(query, {
      name: `${c.title} ${c.originalTitle ?? ""}`,
      color: colorName(s, c.color),
      project: c.projectName ?? "",
    })
  );
}
export function renameItem(s: AppState, item: Item, value: string): AppState {
  const name = value.trim().slice(0, 300);
  if (!name) return s;
  return item.kind === "folder"
    ? {
        ...s,
        folders: s.folders.map((f) => (f.id === item.id ? { ...f, name } : f)),
      }
    : {
        ...s,
        conversations: s.conversations.map((c) =>
          c.id === item.id ? { ...c, title: name } : c,
        ),
      };
}
