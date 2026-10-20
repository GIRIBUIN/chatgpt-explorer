import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { defaults, addConversation, normalizeState } from "../src/models/state";
import { migrateV1 } from "../src/models/migration";
import { importChats } from "../src/models/import";
import { parseRenderedPage } from "../src/content/parse-page";
import type { RenderedPage } from "../src/content/read-page";
import { ItemDetails } from "../src/components/ItemDetails";
import { loadState } from "../src/storage";
const projectA = "g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const projectB = "g-p-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const fixture: RenderedPage = {
  url: "https://chatgpt.com/",
  mainHeading: null,
  links: [
    {
      href: "https://chatgpt.com/c/general",
      title: "General conversation",
      projectHeaders: [],
      inProjectMain: false,
    },
    {
      href: "https://chatgpt.com/c/career",
      title: "AI direction",
      projectHeaders: [
        {
          href: `https://chatgpt.com/g/${projectA}-career/project`,
          title: "AI Career",
        },
      ],
      inProjectMain: false,
    },
    {
      href: `https://chatgpt.com/g/${projectB}-local/c/worker`,
      title: "worker",
      projectHeaders: [
        {
          href: `https://chatgpt.com/g/${projectB}-local/project`,
          title: "Local AI",
        },
      ],
      inProjectMain: false,
    },
  ],
};
describe("project import evidence", () => {
  it("imports general and distinct projects into Inbox with correct names", () => {
    const result = importChats(defaults(), parseRenderedPage(fixture));
    expect(result.added).toBe(3);
    expect(
      result.state.conversations.map((c) => [
        c.id,
        c.projectId,
        c.projectName,
        c.folderId,
      ]),
    ).toEqual([
      ["general", null, null, null],
      ["career", projectA, "AI Career", null],
      ["worker", projectB, "Local AI", null],
    ]);
    expect(normalizeState(result.state)).toEqual(result.state);
  });
  it("uses the project landing heading only for its main region, not general sidebar links", () => {
    const p = {
      ...fixture,
      url: `https://chatgpt.com/g/${projectA}-career/project`,
      mainHeading: "AI Career",
      links: [{ ...fixture.links[0], inProjectMain: true }, fixture.links[0]],
    };
    const parsed = parseRenderedPage(p);
    expect(parsed[0].projectName).toBe("AI Career");
    expect(parsed[1].projectName).toBeNull();
  });
  it("does not invent names from unknown routes, mismatched IDs or ambiguous groups", () => {
    const links = [
      {
        ...fixture.links[1],
        projectHeaders: [
          { href: "https://chatgpt.com/g/unknown/project", title: "Guess" },
        ],
      },
      { ...fixture.links[2], projectHeaders: fixture.links[1].projectHeaders },
      {
        ...fixture.links[1],
        projectHeaders: [
          ...fixture.links[1].projectHeaders,
          ...fixture.links[2].projectHeaders,
        ],
      },
    ];
    expect(
      parseRenderedPage({ ...fixture, links }).map((c) => c.projectName),
    ).toEqual([null, null, null]);
    expect(parseRenderedPage({ ...fixture, url: "invalid" })).toEqual([]);
    expect(
      parseRenderedPage({
        ...fixture,
        url: `https://chatgpt.com/g/${projectA}/project`,
        mainHeading: "Page title",
        links: [{ ...links[2], inProjectMain: true }],
      })[0].projectName,
    ).toBeNull();
  });
  it("displays actual project names and falls back only when missing", () => {
    const c = importChats(defaults(), parseRenderedPage(fixture)).state
      .conversations[1];
    const markup = renderToStaticMarkup(<ItemDetails conversation={c} />);
    expect(markup).toContain("AI Career");
    expect(markup).not.toContain(">Project<");
    expect(markup).toContain('title="AI Career"');
    expect(
      renderToStaticMarkup(
        <ItemDetails conversation={{ ...c, projectName: null }} />,
      ),
    ).toContain(">Project<");
  });
  it("deduplicates and enriches only source metadata, preserving all user metadata", () => {
    let s = defaults();
    s.folders = [
      { id: "f", name: "Mine", parentId: null, favorite: false, createdAt: 5 },
    ];
    s = addConversation(
      s,
      "My alias",
      "https://chatgpt.com/c/career",
      "f",
    ).state;
    s.conversations[0] = {
      ...s.conversations[0],
      color: "#123456",
      favorite: true,
      lastOpenedAt: 123,
    };
    const before = s.conversations[0];
    const result = importChats(s, [
      ...parseRenderedPage(fixture),
      ...parseRenderedPage(fixture),
    ]);
    expect(result.added).toBe(2);
    expect(result.existed).toBe(1);
    expect(result.projectNamesUpdated).toBe(1);
    expect(result.state.conversations[0]).toEqual({
      ...before,
      projectId: projectA,
      projectName: "AI Career",
    });
    const again = importChats(result.state, parseRenderedPage(fixture));
    expect(again.added).toBe(0);
    expect(again.projectNamesUpdated).toBe(0);
    expect(again.state).toBe(result.state);
  });
  it("does not overwrite a known conflicting project or use conflicting imported names", () => {
    const s = importChats(defaults(), parseRenderedPage(fixture)).state;
    const result = importChats(s, [
      {
        title: "Bad",
        url: "https://chatgpt.com/c/career",
        projectId: projectB,
        projectName: "Wrong",
      },
    ]);
    expect(result.state).toBe(s);
    const c = fixture.links[1];
    const ambiguous = parseRenderedPage({
      ...fixture,
      links: [
        c,
        {
          ...c,
          projectHeaders: [{ ...c.projectHeaders[0], title: "Other name" }],
        },
      ],
    });
    expect(
      importChats(defaults(), ambiguous).state.conversations[0].projectName,
    ).toBeNull();
  });
  it("canonical project URL enrichment does not lose alias or name on an open-tab-only reimport", () => {
    const s = importChats(defaults(), parseRenderedPage(fixture)).state;
    const result = importChats(s, [
      {
        title: "source",
        url: `https://chatgpt.com/g/${projectA}-career/c/career`,
      },
    ]);
    expect(result.state.conversations[1].title).toBe("AI direction");
    expect(result.state.conversations[1].projectName).toBe("AI Career");
    expect(normalizeState(result.state)).toEqual(result.state);
  });
});
describe("v1 additive migration", () => {
  function oldState() {
    const s = addConversation(
      defaults(),
      "Alias",
      "https://chatgpt.com/c/old",
      null,
    ).state;
    const { defaultOpenBehavior: unused, ...settings } = s.settings;
    void unused;
    return {
      ...s,
      version: 1,
      settings,
      conversations: s.conversations.map(({ projectName: unused, ...c }) => {
        void unused;
        return c;
      }),
    };
  }
  it("adds null names and reuse preference without changing existing fields", () => {
    const old = oldState();
    const upgraded = normalizeState(migrateV1(old));
    expect(upgraded.version).toBe(2);
    expect(upgraded.settings.defaultOpenBehavior).toBe("reuse");
    expect(upgraded.conversations[0]).toEqual({
      ...old.conversations[0],
      projectName: null,
    });
    expect(old.version).toBe(1);
  });
  it("backs up v1 before saving v2, without a corruption warning", async () => {
    const old = oldState();
    const set = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", {
      storage: {
        local: { get: vi.fn().mockResolvedValue({ explorerState: old }), set },
      },
    });
    const result = await loadState();
    expect(result.warning).toBe("");
    expect(set.mock.calls[0][0]).toEqual({ migrationBackupV1: old });
    expect(set.mock.calls[1][0].explorerState.version).toBe(2);
  });
  it("does not overwrite v1 when its backup fails", async () => {
    const old = oldState();
    const set = vi.fn().mockRejectedValue(Error("quota"));
    vi.stubGlobal("chrome", {
      storage: {
        local: { get: vi.fn().mockResolvedValue({ explorerState: old }), set },
      },
    });
    await expect(loadState()).rejects.toThrow("quota");
    expect(set).toHaveBeenCalledTimes(1);
  });
});
