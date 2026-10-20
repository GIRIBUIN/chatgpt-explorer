import { parseConversationUrl } from "./url";
import { t } from "../i18n";

export type ChatCandidate = {
  id: string;
  title: string;
  url: string;
  projectId: string | null;
  tabId: number;
  windowId: number;
  lastAccessed: number;
  active: boolean;
};
// No page access: only tabs belonging to normal browser windows are eligible.
export function discoverChats(
  windows: chrome.windows.Window[],
): ChatCandidate[] {
  const candidates = windows
    .filter((w) => w.type === "normal")
    .flatMap((w) =>
      (w.tabs ?? []).flatMap((tab) => {
        const parsed = parseConversationUrl(tab.url ?? "");
        if (!parsed || tab.id === undefined || w.id === undefined) return [];
        return [
          {
            ...parsed,
            title:
              tab.title?.replace(/\s*[-–|]\s*ChatGPT\s*$/, "").trim() ||
              t("untitledChat"),
            tabId: tab.id,
            windowId: w.id,
            lastAccessed: tab.lastAccessed ?? 0,
            active: !!tab.active,
          },
        ];
      }),
    )
    .sort(
      (a, b) =>
        b.lastAccessed - a.lastAccessed ||
        Number(b.active) - Number(a.active) ||
        a.tabId - b.tabId,
    );
  const seen = new Set<string>();
  return candidates.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}
