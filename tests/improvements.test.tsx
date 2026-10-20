/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { t } from "../src/i18n";
import { discoverChats } from "../src/utils/discovery";
import { importChats } from "../src/models/import";
import { addConversation, defaults } from "../src/models/state";
import { ItemDetails } from "../src/components/ItemDetails";
import { formatDate } from "../src/utils/date";

const windowFixture = (
  type: "normal" | "popup",
  id: number,
  tabs: Partial<chrome.tabs.Tab>[],
) =>
  ({
    id,
    type,
    tabs: tabs.map((t) => ({ windowId: id, ...t })),
  }) as chrome.windows.Window;
describe("English presentation", () => {
  it("resolves English keys and interpolates values", () => {
    expect(t("search")).toBe("Search");
    expect(t("itemMenu", { name: "Example" })).toBe("Actions for Example");
  });
  it("keeps Korean literals out of main UI and feedback modules", () => {
    for (const file of [
      "src/explorer/App.tsx",
      "src/components/Dialog.tsx",
      "src/components/ItemDetails.tsx",
      "src/i18n/index.ts",
      "src/storage/index.ts",
      "src/background/index.ts",
    ])
      expect(
        import.meta.glob<string>("../src/**/*.{ts,tsx}", {
          query: "?raw",
          import: "default",
          eager: true,
        })[`../${file}`],
      ).not.toMatch(/[\u3131-\u318e\uac00-\ud7a3]/);
  });
  it("renders a text-first conversation with a color dot and no visible HEX", () => {
    const c = addConversation(
      defaults(),
      "Example",
      "https://chatgpt.com/c/a",
      null,
    ).conversation;
    c.color = "#a855f7";
    const html = renderToStaticMarkup(<ItemDetails conversation={c} />);
    expect(html).toContain('class="dot"');
    expect(html).not.toContain("chat-icon");
    expect(html).not.toContain("▤");
    expect(html.replace(/<[^>]*>/g, "")).toBe("Example");
  });
  it("preserves folder icons and project badges", () => {
    const c = addConversation(
      defaults(),
      "Project",
      "https://chatgpt.com/g/g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-study/c/a",
      null,
    ).conversation;
    expect(renderToStaticMarkup(<ItemDetails conversation={c} />)).toContain(
      "<small",
    );
    expect(
      renderToStaticMarkup(
        <ItemDetails
          folder={{
            id: "f",
            name: "Folder",
            parentId: null,
            pinned: false,
            createdAt: 0,
          }}
        />,
      ),
    ).toContain("folder-icon");
  });
  it("formats dates consistently", () => {
    expect(formatDate(new Date(2026, 9, 18).getTime())).toBe("2026-10-18");
    expect(formatDate(null)).toBe("—");
  });
});
describe("tab discovery and import", () => {
  it("excludes popups, non-conversation URLs and non-ChatGPT hosts", () => {
    const result = discoverChats([
      windowFixture("popup", 1, [
        { id: 1, url: "https://chatgpt.com/c/popup" },
      ]),
      windowFixture("normal", 2, [
        { id: 2, url: "https://chatgpt.com/" },
        { id: 3, url: "https://chatgpt.com.evil/c/a" },
        { id: 4, url: "https://chatgpt.com/c/valid" },
      ]),
    ]);
    expect(result.map((c) => c.id)).toEqual(["valid"]);
  });
  it("returns multiple distinct candidates in recent order, with active tabs breaking ties", () => {
    const result = discoverChats([
      windowFixture("normal", 1, [
        {
          id: 1,
          url: "https://chatgpt.com/c/old",
          lastAccessed: 10,
          active: true,
        },
        { id: 2, url: "https://chatgpt.com/c/new", lastAccessed: 30 },
        {
          id: 3,
          url: "https://chatgpt.com/c/tie",
          lastAccessed: 30,
          active: true,
        },
      ]),
      windowFixture("normal", 2, [
        {
          id: 4,
          url: "https://chatgpt.com/c/new?duplicate=1",
          lastAccessed: 5,
        },
      ]),
    ]);
    expect(result.map((c) => c.id)).toEqual(["tie", "new", "old"]);
  });
  it("deduplicates Current Chat without changing existing metadata", () => {
    const initial = addConversation(
      defaults(),
      "Keep alias",
      "https://chatgpt.com/c/a",
      null,
    ).state;
    const result = addConversation(
      initial,
      "Tab title",
      "https://chatgpt.com/c/a?new=1",
      null,
    );
    expect(result.duplicate).toBe(true);
    expect(result.state).toBe(initial);
  });
  it("imports only new IDs into Inbox and preserves existing folder/alias/color", () => {
    let s = defaults();
    s.folders = [
      { id: "f", name: "Folder", parentId: null, createdAt: 0, pinned: true },
    ];
    s = addConversation(s, "Keep alias", "https://chatgpt.com/c/a", "f").state;
    s.conversations[0].color = "#123456";
    const result = importChats(s, [
      { title: "Overwrite?", url: "https://chatgpt.com/c/a" },
      { title: "New", url: "https://chatgpt.com/c/b" },
      { title: "Duplicate", url: "https://chatgpt.com/g/unknown/c/b" },
    ]);
    expect(result.added).toBe(1);
    expect(result.state.conversations[0]).toEqual(s.conversations[0]);
    expect(result.state.conversations[1].folderId).toBeNull();
    expect(
      importChats(result.state, [
        { title: "New", url: "https://chatgpt.com/c/b" },
      ]).added,
    ).toBe(0);
  });
  it("extracts explicit project identifiers and leaves uncertain ones null", () => {
    const found = discoverChats([
      windowFixture("normal", 1, [
        {
          id: 1,
          url: "https://chatgpt.com/g/g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-study/c/project",
        },
        { id: 2, url: "https://chatgpt.com/g/unknown/c/unknown" },
      ]),
    ]);
    const result = importChats(defaults(), found);
    expect(result.state.conversations.map((c) => c.projectId)).toEqual([
      "g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      null,
    ]);
  });
});
