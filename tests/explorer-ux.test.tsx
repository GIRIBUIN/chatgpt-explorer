import { describe, it, expect } from "vitest";
import {
  defaults,
  addConversation,
  normalizeState,
  renameColor,
} from "../src/models/state";
import {
  itemKey,
  selectItems,
  matchesSearch,
  matchesChat,
  renameItem,
  isTextInput,
} from "../src/models/explorer";
import { defaultTheme, parseTheme, themeVariables } from "../src/models/theme";
import {
  exportWorkspace,
  parseWorkspace,
  workspaceDiff,
  applyWorkspace,
} from "../src/models/workspace";
import { renderToStaticMarkup } from "react-dom/server";
import { ItemDetails } from "../src/components/ItemDetails";
import { CommandPalette } from "../src/components/CommandPalette";
const make = () =>
  addConversation(
    defaults(),
    "Attention",
    "https://chatgpt.com/c/chat-one",
    null,
  ).state;
const project = "g-p-" + "a".repeat(32);
describe("Explorer selection and rename", () => {
  it("keys distinguish folders and chats", () =>
    expect(itemKey({ kind: "folder", id: "one" })).not.toBe(
      itemKey({ kind: "conversation", id: "one" }),
    ));
  it("Ctrl click toggles without discarding other items", () => {
    expect(selectItems(["a"], "a", "b", ["a", "b"], true).ids).toEqual([
      "a",
      "b",
    ]);
    expect(selectItems(["a", "b"], "b", "a", ["a", "b"], true).ids).toEqual([
      "b",
    ]);
  });
  it("Shift range follows visible order and keeps anchor", () =>
    expect(
      selectItems(["a"], "a", "c", ["a", "b", "c", "d"], false, true),
    ).toEqual({ ids: ["a", "b", "c"], anchor: "a" }));
  it("missing anchor selects clicked item", () =>
    expect(
      selectItems(["hidden"], "hidden", "b", ["a", "b"], false, true).ids,
    ).toEqual(["b"]));
  it("text input guard recognizes editable targets", () =>
    expect(isTextInput({ closest: () => ({}) } as unknown as Element)).toBe(
      true,
    ));
  it('text input guard recognizes inherited/empty/plaintext-only contenteditable state', () => {
    expect(isTextInput({ closest: () => null, isContentEditable: true } as unknown as Element)).toBe(true);
    expect(isTextInput({ closest: () => null, isContentEditable: false } as unknown as Element)).toBe(false);
    const select = { closest: (selector: string) => selector.includes('select') ? {} : null } as unknown as Element;
    expect(isTextInput(select)).toBe(true);
    expect(isTextInput(select, false)).toBe(false);
  });
  it("inline save trims while blank leaves data unchanged", () => {
    const s = make();
    expect(renameItem(s, { kind: "conversation", id: "chat-one" }, "  ")).toBe(
      s,
    );
    expect(
      renameItem(s, { kind: "conversation", id: "chat-one" }, " New ")
        .conversations[0].title,
    ).toBe("New");
  });
  it("rename does not change original title or assignments", () => {
    const s = make();
    s.conversations[0].originalTitle = "Original";
    const next = renameItem(
      s,
      { kind: "conversation", id: "chat-one" },
      "Alias",
    );
    expect(next.conversations[0]).toEqual({
      ...s.conversations[0],
      title: "Alias",
    });
  });
});
describe("Search and project filters", () => {
  const fields = {
    name: "Attention 언어 개념",
    color: "Important Study",
    project: "플젝 아이디어",
  };
  it.each([
    "attention",
    "Attention Study",
    "color:Study",
    "name:Attention",
    'project:"플젝 아이디어"',
    'name:"언어 개념" color:Important',
    'attention project:"플젝 아이디어"',
  ])("matches AND query %s", (query) =>
    expect(matchesSearch(query, fields)).toBe(true),
  );
  it("missing token fails AND", () =>
    expect(matchesSearch("Attention Missing", fields)).toBe(false));
  it("commas are not AND operators", () =>
    expect(matchesSearch("Attention,Study", fields)).toBe(false));
  it("malformed quotes do not throw", () =>
    expect(() => matchesSearch('name:"unfinished', fields)).not.toThrow());
  it("project and color apply together, original title searchable", () => {
    let s = make();
    s = renameColor(s, "#ffffff", "Study");
    const c = {
      ...s.conversations[0],
      projectId: project,
      projectName: "Career",
      originalTitle: "Original",
    };
    expect(matchesChat(s, c, "Original Study", "all")).toBe(true);
    expect(matchesChat(s, c, "", "none")).toBe(false);
    expect(matchesChat(s, c, "", project)).toBe(true);
    s.settings.colorFilter = "#ef4444";
    expect(matchesChat(s, c, "", project)).toBe(false);
    expect(matchesChat(make(), make().conversations[0], "", "none")).toBe(true);
  });
});
describe("Theme JSON", () => {
  it("roundtrips supported tokens", () =>
    expect(parseTheme(JSON.parse(JSON.stringify(defaultTheme)))).toEqual(
      defaultTheme,
    ));
  it("rejects CSS payloads and extra tokens", () => {
    expect(() =>
      parseTheme({
        ...defaultTheme,
        colors: { ...defaultTheme.colors, text: "url(javascript:x)" },
      }),
    ).toThrow();
    expect(() => parseTheme({ ...defaultTheme, css: "body{}" })).toThrow();
  });
  it("rejects unsupported UI tokens and invalid JSON", () => {
    expect(() =>
      parseTheme({ ...defaultTheme, ui: { ...defaultTheme.ui, fontSize: 90 } }),
    ).toThrow();
    expect(() => JSON.parse("{")).toThrow();
  });
  it("persists and reloads theme; reset retains OS defaults", () => {
    const s = make();
    s.theme = defaultTheme;
    expect(normalizeState(JSON.parse(JSON.stringify(s))).theme).toEqual(
      defaultTheme,
    );
    delete s.theme;
    expect(normalizeState(s).theme).toBeUndefined();
  });
  it("maps only controlled variables", () => {
    expect(themeVariables(defaultTheme)["--bg"]).toBe("#ffffff");
    expect(Object.keys(themeVariables(defaultTheme))).not.toContain("css");
  });
});
describe("Workspace JSON", () => {
  it("roundtrips metadata without conversation content or settings", () => {
    const s = make();
    Object.assign(s.conversations[0], {
      content: "secret",
      messages: ["private"],
    });
    const w = exportWorkspace(s);
    expect(parseWorkspace(JSON.parse(JSON.stringify(w)))).toEqual(w);
    expect(JSON.stringify(w)).not.toMatch(
      /secret|private|settings|lastOpenedAt/,
    );
  });
  it("rejects unknown fields and invalid references", () => {
    const w = exportWorkspace(make());
    expect(() => parseWorkspace({ ...w, content: [] })).toThrow();
    w.chats[0].folderId = "missing";
    expect(() => parseWorkspace(w)).toThrow();
    w.chats[0].folderId = null;
    w.chats[0].color = "#123456";
    expect(() => parseWorkspace(w)).toThrow();
  });
  it("rejects cycles and nonexistent parents", () => {
    const w = exportWorkspace(make());
    w.folders = [
      { id: "a", name: "A", parentId: "b", pinned: false },
      { id: "b", name: "B", parentId: "a", pinned: false },
    ];
    expect(() => parseWorkspace(w)).toThrow("cycle");
    w.folders[0].parentId = "missing";
    expect(() => parseWorkspace(w)).toThrow("parent");
  });
  it("rejects duplicate chat IDs and unsafe URLs", () => {
    const w = exportWorkspace(make());
    w.chats.push({ ...w.chats[0] });
    expect(() => parseWorkspace(w)).toThrow("Duplicate");
    w.chats.pop();
    w.chats[0].url = "https://evil.example/c/chat-one";
    expect(() => parseWorkspace(w)).toThrow();
  });
  it("previews diff without mutating and applies metadata only", () => {
    const s = make();
    s.conversations[0].lastOpenedAt = 42;
    const w = exportWorkspace(s);
    w.folders.push({
      id: "f",
      name: "Folder",
      parentId: null,
      pinned: false,
    });
    w.chats[0].folderId = "f";
    w.chats[0].displayName = "Renamed";
    w.chats[0].favorite = true;
    const diff = workspaceDiff(s, w);
    expect(diff).toMatchObject({
      foldersAdded: 1,
      chatsMoved: 1,
      aliasesRenamed: 1,
      chatsRemoved: 0,
    });
    expect(s.conversations[0].title).toBe("Attention");
    expect(applyWorkspace(s, w).conversations[0]).toMatchObject({
      title: "Renamed",
      folderId: "f",
      favorite: true,
      lastOpenedAt: 42,
    });
  });
  it("retains chats absent from imported file", () => {
    const s = make();
    const w = exportWorkspace(s);
    w.chats = [];
    expect(applyWorkspace(s, w).conversations).toEqual(s.conversations);
  });
  it("validates retained hierarchy after merge", () => {
    const s = make();
    s.folders = [
      { id: "a", name: "A", parentId: "b", pinned: false, createdAt: 0 },
      { id: "b", name: "B", parentId: null, pinned: false, createdAt: 0 },
    ];
    const w = exportWorkspace(s);
    w.folders = [
      { id: "a", name: "A", parentId: null, pinned: false },
      { id: "b", name: "B", parentId: "a", pinned: false },
    ];
    expect(() => applyWorkspace(s, w)).not.toThrow();
  });
  it("retains original titles and shared names through storage", () => {
    let s = make();
    s.conversations[0].originalTitle = "Source";
    s = renameColor(s, "#ffffff", "Work");
    s.settings.projectFilter = "none";
    expect(normalizeState(s)).toEqual(s);
  });
});
describe("Compact UI contracts", () => {
  it("color is an editor button, not row text", () => {
    const c = make().conversations[0];
    const html = renderToStaticMarkup(<ItemDetails conversation={c} />);
    expect(html).toContain("color-dot-button");
    expect(html).not.toContain("Neutral");
    expect(html).not.toContain("Color 1");
  });
  it("inline name slot replaces displayed alias", () => {
    const html = renderToStaticMarkup(
      <ItemDetails
        conversation={make().conversations[0]}
        nameEditor={<input aria-label="Rename" />}
      />,
    );
    expect(html).toContain('aria-label="Rename"');
    expect(html).not.toContain("Attention");
  });
  it("palette disables unavailable commands", () => {
    const html = renderToStaticMarkup(
      <CommandPalette
        close={() => {}}
        commands={[
          { label: "Rename", enabled: false, run: () => {} },
          { label: "Open", enabled: true, run: () => {} },
        ]}
      />,
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain("Search commands");
  });
});
