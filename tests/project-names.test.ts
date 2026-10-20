import { expect, it } from "vitest";
import { ProjectNames } from "../src/content/project-names";
import { importChats } from "../src/models/import";
import { defaults } from "../src/models/state";
import type { RenderedPage } from "../src/content/read-page";
const a = "g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  b = "g-p-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const link = (id: string, title: string) => ({
  href: `https://chatgpt.com/g/${id}/project`,
  title,
});
const page = (
  projectLinks: RenderedPage["projectLinks"] = [],
): RenderedPage => ({
  url: "https://chatgpt.com/",
  links: [],
  mainHeading: null,
  projectLinks,
});
it("maps navigation names independently from conversations and retains them after DOM removal", () => {
  const names = new ProjectNames();
  names.collect(page([link(a, "LLM"), link(b, "Local AI")]));
  names.collect(page());
  expect(names.resolve()).toEqual({ [a]: "LLM", [b]: "Local AI" });
  const result = importChats(
    defaults(),
    [a, b].map((id, i) => ({
      url: `https://chatgpt.com/g/${id}/c/chat-${i}`,
      title: String(i),
    })),
    names.resolve(),
  );
  expect(result.state.conversations.map((c) => c.projectName)).toEqual([
    "LLM",
    "Local AI",
  ]);
});
it("prefers navigation evidence to section and landing headings", () => {
  const names = new ProjectNames();
  names.collect({ ...page(), url: link(a, "").href, mainHeading: "Landing" });
  names.collect({
    ...page(),
    links: [
      {
        href: "https://chatgpt.com/c/a",
        title: "[Guess]",
        projectHeaders: [link(a, "Section")],
        inProjectMain: false,
      },
    ],
  });
  expect(names.resolve()[a]).toBe("Section");
  names.collect(page([link(a, "Navigation")]));
  expect(names.resolve()[a]).toBe("Navigation");
});
it("conflicting strongest names stay unresolved even after weaker evidence", () => {
  const names = new ProjectNames();
  names.collect(page([link(a, "LLM")]));
  names.collect(page([link(a, "Other")]));
  names.collect({ ...page(), url: link(a, "").href, mainHeading: "LLM" });
  expect(names.resolve()[a]).toBeNull();
  const result = importChats(
    defaults(),
    [
      {
        title: "[LLM] title",
        url: `https://chatgpt.com/g/${a}/c/a`,
        projectName: "Weaker",
      },
    ],
    names.resolve(),
  );
  expect(result.state.conversations[0].projectName).toBeNull();
});
it("enriches existing unseen chats without changing user metadata or known names", () => {
  let state = importChats(defaults(), [
    { title: "My alias", url: `https://chatgpt.com/g/${a}/c/a` },
  ]).state;
  state = {
    ...state,
    conversations: state.conversations.map((c) => ({
      ...c,
      folderId: "f",
      color: "#a855f7",
      favorite: true,
      lastOpenedAt: 456,
    })),
  };
  const before = state.conversations[0];
  const enriched = importChats(state, [], { [a]: "LLM" });
  expect(enriched.state.conversations[0]).toEqual({
    ...before,
    projectName: "LLM",
  });
  expect(enriched.projectNamesUpdated).toBe(1);
  expect(importChats(enriched.state, [], { [a]: "Wrong" }).state).toBe(
    enriched.state,
  );
  expect(importChats(state, [], { [a]: null }).state).toBe(state);
});
it("does not infer names from conversation titles, unknown URLs or another origin", () => {
  const names = new ProjectNames();
  names.collect(
    page([{ href: "https://chatgpt.com/g/unknown/project", title: "Guess" }]),
  );
  names.collect({ ...page([link(a, "Wrong")]), url: "https://example.com/" });
  expect(names.resolve()).toEqual({});
});
