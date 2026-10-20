import { describe, it, expect } from "vitest";
import {
  addConversation,
  ancestors,
  canMoveFolder,
  defaults,
  deleteFolder,
  moveItem,
  normalizeState,
  sortConversations,
  startupLocation,
} from "../src/models/state";
import { parseConversationUrl } from "../src/utils/url";
import { navigate, travel } from "../src/utils/navigation";
import { clampBounds } from "../src/utils/bounds";
import type { AppState, Folder } from "../src/models/types";
const folder = (id: string, parentId: string | null = null): Folder => ({
  id,
  name: id,
  parentId,
  favorite: false,
  createdAt: 1,
});
function nested() {
  const s = defaults();
  for (let i = 0; i < 8; i++)
    s.folders.push(folder(`f${i}`, i ? `f${i - 1}` : null));
  return s;
}
describe("virtual folders", () => {
  it("supports deep nesting and rejects self/descendant cycles at the mutation boundary", () => {
    const s = nested();
    expect(ancestors(s.folders, "f7")).toHaveLength(8);
    expect(canMoveFolder(s.folders, "f0", "f7")).toBe(false);
    expect(canMoveFolder(s.folders, "f0", "f0")).toBe(false);
    expect(() => moveItem(s, { kind: "folder", id: "f0" }, "f7")).toThrow();
    expect(canMoveFolder(s.folders, "f7", "f0")).toBe(true);
    expect(canMoveFolder(s.folders, "f7", "missing")).toBe(false);
  });
  it("promotes child folders, preserves their conversations and moves direct chats to Inbox", () => {
    let s = nested();
    s = addConversation(
      s,
      "direct",
      "https://chatgpt.com/c/direct",
      "f1",
    ).state;
    s = addConversation(
      s,
      "nested",
      "https://chatgpt.com/c/nested",
      "f2",
    ).state;
    s.settings.lastLocation = "folder:f1";
    s.settings.startupFolderId = "f1";
    const next = deleteFolder(s, "f1");
    expect(next.folders.find((f) => f.id === "f2")?.parentId).toBe("f0");
    expect(next.conversations.map((c) => c.folderId)).toEqual([null, "f2"]);
    expect(next.conversations.map((c) => c.url)).toEqual(
      s.conversations.map((c) => c.url),
    );
    expect(next.settings.lastLocation).toBe("home");
    expect(next.settings.startupFolderId).toBeNull();
  });
  it("moves conversation metadata without changing its project or URL", () => {
    const s = addConversation(
      nested(),
      "test",
      `https://chatgpt.com/g/g-p-${"a".repeat(32)}-name/c/123`,
      "f0",
    ).state;
    const next = moveItem(s, { kind: "conversation", id: "123" }, "f7");
    expect(next.conversations[0]).toEqual({
      ...s.conversations[0],
      folderId: "f7",
    });
    expect(() =>
      moveItem(s, { kind: "conversation", id: "123" }, "missing"),
    ).toThrow();
  });
});
describe("conversation identity and URLs", () => {
  it("deduplicates the same ID across canonical, query and project URLs without overwriting alias", () => {
    const s = addConversation(
      defaults(),
      "alias",
      "https://chatgpt.com/c/123?x=1",
      null,
    ).state;
    const result = addConversation(
      s,
      "new",
      "https://chatgpt.com/g/unknown/c/123/",
      null,
    );
    expect(result.duplicate).toBe(true);
    expect(result.state.conversations).toHaveLength(1);
    expect(result.conversation.title).toBe("alias");
  });
  it.each([
    "https://chatgpt.com/",
    "https://chatgpt.com/g/project",
    "https://chatgpt.com/share/123",
    "http://chatgpt.com/c/a",
    "https://chatgpt.com.evil/c/a",
    "https://user@chatgpt.com/c/a",
    "javascript:alert(1)",
    "https://chatgpt.com/c/a/extra",
    "https://chatgpt.com/c/%2F",
  ])("rejects non-conversation URLs: %s", (url) =>
    expect(parseConversationUrl(url)).toBeNull(),
  );
  it("extracts only explicit project identifiers, leaving uncertain routes null", () => {
    expect(parseConversationUrl("https://chatgpt.com/c/a?x=y#z")).toEqual({
      id: "a",
      url: "https://chatgpt.com/c/a",
      projectId: null,
    });
    expect(
      parseConversationUrl("https://chatgpt.com/g/g-custom/c/a")?.projectId,
    ).toBeNull();
    expect(
      parseConversationUrl(
        `https://chatgpt.com/g/g-p-${"a".repeat(32)}-llm/c/a`,
      )?.projectId,
    ).toBe(`g-p-${"a".repeat(32)}`);
  });
});
describe("sorting, history and startup", () => {
  it("uses explicit color priority, including custom colors, with direction", () => {
    let s = defaults();
    s = addConversation(s, "A", "https://chatgpt.com/c/a", null).state;
    s = addConversation(s, "B", "https://chatgpt.com/c/b", null).state;
    s.conversations[0].color = "#000001";
    s.conversations[1].color = "#ffffff";
    s.colorRules = [
      { color: "#ffffff", order: 0 },
      { color: "#000001", order: 1 },
    ];
    s.settings.sort = "color";
    expect(sortConversations(s, s.conversations).map((c) => c.id)).toEqual([
      "b",
      "a",
    ]);
    s.settings.direction = "desc";
    expect(sortConversations(s, s.conversations).map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);
  });
  it("backs/forwards and truncates the forward branch after a new visit", () => {
    let h = navigate({ entries: ["home"], index: 0 }, "folder:a");
    h = navigate(h, "folder:b");
    h = travel(h, -1);
    expect(h.entries[h.index]).toBe("folder:a");
    expect(travel(h, 1).entries[2]).toBe("folder:b");
    h = navigate(h, "inbox");
    expect(h.entries).toEqual(["home", "folder:a", "inbox"]);
    expect(travel(h, 10).index).toBe(2);
    expect(travel(h, -10).index).toBe(0);
  });
  it("restores special views and falls back from a deleted startup folder", () => {
    const s = defaults();
    s.settings.lastLocation = "favorites";
    expect(startupLocation(s)).toBe("favorites");
    s.settings.startup = "folder";
    s.settings.startupFolderId = "missing";
    expect(startupLocation(s)).toBe("home");
  });
});
describe("defensive persistence and bounds", () => {
  it("repairs cycles, duplicate IDs, missing parents and dangling conversations", () => {
    const raw = {
      ...defaults(),
      folders: [
        folder("a", "b"),
        folder("b", "a"),
        folder("a"),
        folder("c", "missing"),
      ],
      conversations: [
        { url: "https://chatgpt.com/c/a", folderId: "missing", title: "safe" },
        { url: "https://chatgpt.com/c/a" },
        { url: "javascript:x" },
      ],
    };
    const s = normalizeState(raw);
    expect(s.folders).toHaveLength(3);
    for (const f of s.folders)
      expect(
        ancestors(s.folders, f.id).filter((p) => p.id === f.id),
      ).toHaveLength(1);
    expect(s.conversations).toHaveLength(1);
    expect(s.conversations[0].folderId).toBeNull();
    expect(s.folders.find((f) => f.id === "c")?.parentId).toBeNull();
  });
  it.each([
    null,
    42,
    [],
    { folders: [null, 42], settings: { collapsed: 42 } },
    { conversations: [null], colorRules: [null] },
  ])("starts with malformed data: %j", (raw) =>
    expect(() => normalizeState(raw)).not.toThrow(),
  );
  it("round trips valid state without losing metadata", () => {
    const s = addConversation(
      nested(),
      "Alias",
      "https://chatgpt.com/c/a",
      "f7",
    ).state;
    expect(normalizeState(s)).toEqual(s);
  });
  it("fits disconnected-monitor bounds into a smaller or negative-coordinate display", () => {
    expect(
      clampBounds(
        { left: 8000, top: 9000, width: 900, height: 650 },
        { left: 0, top: 0, width: 800, height: 600 },
      ),
    ).toEqual({ left: 0, top: 0, width: 800, height: 600 });
    const b = clampBounds(
      { left: 0, top: 0, width: 900, height: 650 },
      { left: -1920, top: 0, width: 1920, height: 1080 },
    );
    expect(b.left).toBe(-900);
  });
  it("normalization is idempotent", () => {
    const s = normalizeState({
      folders: [folder("a", "b"), folder("b", "a")],
      settings: { sort: "garbage" },
    } as unknown as AppState);
    expect(normalizeState(s)).toEqual(s);
  });
});
