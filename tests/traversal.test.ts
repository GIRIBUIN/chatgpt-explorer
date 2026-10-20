import { expect, it, vi } from "vitest";
import { traverseChats, type TraversalPort } from "../src/content/traversal";
import { importChats, type ImportCandidate } from "../src/models/import";
import { defaults, addConversation } from "../src/models/state";

const chat = (id: string): ImportCandidate => ({
  title: id,
  url: `https://chatgpt.com/c/${id}`,
});
function fixture(pages: ImportCandidate[][]) {
  let index = 0;
  const bottom = { top: 100, height: 200, viewport: 100 };
  const port: TraversalPort = {
    read: vi.fn(async () => pages[index]),
    start: vi.fn(async () => bottom),
    advance: vi.fn(async () => {
      index = Math.min(index + 1, pages.length - 1);
      return bottom;
    }),
    restore: vi.fn(async () => {}),
  };
  return port;
}
it("accumulates virtualized pages after previous nodes disappear and deduplicates IDs", async () => {
  const port = fixture([[chat("a")], [chat("b"), chat("b")], [chat("c")]]);
  const progress = vi.fn();
  const result = await traverseChats(port, progress);
  expect(result.candidates.map((c) => c.title)).toEqual(["a", "b", "c"]);
  expect(progress).toHaveBeenLastCalledWith(3);
  expect(port.restore).toHaveBeenCalledOnce();
  expect(result.failed).toBe(false);
});
it("waits for four stable bottom passes without new IDs before terminating", async () => {
  const port = fixture([[chat("a")]]);
  await traverseChats(port, () => {});
  expect(port.advance).toHaveBeenCalledTimes(4);
});
it("terminates an immovable non-bottom scroller after eight stable passes", async () => {
  const port = fixture([[chat("a")]]);
  const state = { top: 0, height: 1000, viewport: 100 };
  port.start = vi.fn(async () => state);
  port.advance = vi.fn(async () => state);
  await traverseChats(port, () => {});
  expect(port.advance).toHaveBeenCalledTimes(8);
});
it("does not stop while scrollHeight grows even without new IDs", async () => {
  const port = fixture([[chat("a")]]);
  let height = 200;
  port.advance = vi.fn(async () => ({
    top: 0,
    height: (height += 100),
    viewport: 100,
  }));
  const result = await traverseChats(port, () => {}, {
    iterations: 9,
    milliseconds: 10000,
  });
  expect(result.limited).toBe(true);
  expect(port.advance).toHaveBeenCalledTimes(9);
});
it("enforces a hard iteration cap even when each step discovers new IDs", async () => {
  const port = fixture(Array.from({ length: 20 }, (_, i) => [chat(String(i))]));
  const result = await traverseChats(port, () => {}, {
    iterations: 5,
    milliseconds: 10000,
  });
  expect(result.candidates).toHaveLength(6);
  expect(result.limited).toBe(true);
  expect(port.restore).toHaveBeenCalledOnce();
});
it("enforces a wall-clock cap and still restores", async () => {
  const port = fixture([[chat("a")]]);
  let time = 0;
  const result = await traverseChats(
    port,
    () => {},
    { iterations: 100, milliseconds: 2 },
    () => time++,
  );
  expect(result.limited).toBe(true);
  expect(port.advance).toHaveBeenCalledTimes(1);
  expect(port.restore).toHaveBeenCalledOnce();
});
it("restores original position on success", async () => {
  const port = fixture([[chat("a")]]);
  let position = 73;
  const original = position;
  port.start = async () => {
    position = 0;
    return { top: 0, height: 200, viewport: 100 };
  };
  port.restore = async () => {
    position = original;
  };
  await traverseChats(port, () => {});
  expect(position).toBe(73);
});
it("restores on traversal failure and retains earlier results", async () => {
  const port = fixture([[chat("a")]]);
  port.advance = vi.fn(async () => {
    throw Error("detached sidebar");
  });
  const result = await traverseChats(port, () => {});
  expect(result.failed).toBe(true);
  expect(result.candidates).toEqual([chat("a")]);
  expect(port.restore).toHaveBeenCalledOnce();
});
it("reports cleanup failure without discarding discovered conversations", async () => {
  const port = fixture([[chat("a")]]);
  port.restore = async () => {
    throw Error("closed tab");
  };
  const result = await traverseChats(port, () => {});
  expect(result.failed).toBe(true);
  expect(result.candidates).toHaveLength(1);
});
it("falls back to the current snapshot when no safe scroller exists", async () => {
  const port = fixture([[chat("a")]]);
  port.start = async () => null;
  expect((await traverseChats(port, () => {})).candidates).toHaveLength(1);
  expect(port.advance).not.toHaveBeenCalled();
});
it("preserves different project evidence across pages and enriches missing names", async () => {
  const a = "g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    b = "g-p-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const port = fixture([
    [chat("a")],
    [{ ...chat("a"), projectId: a, projectName: "Career" }],
    [{ ...chat("b"), projectId: b, projectName: "Local" }],
  ]);
  const state = addConversation(
    defaults(),
    "My alias",
    chat("a").url,
    null,
  ).state;
  state.folders.push({
    id: "f",
    name: "Folder",
    parentId: null,
    pinned: false,
    createdAt: 1,
  });
  state.conversations[0] = {
    ...state.conversations[0],
    folderId: "f",
    color: "#a855f7",
    favorite: true,
    lastOpenedAt: 123,
  };
  const before = { ...state.conversations[0] };
  const result = importChats(
    state,
    (await traverseChats(port, () => {})).candidates,
  );
  expect(result.added).toBe(1);
  expect(result.state.conversations[0]).toEqual({
    ...before,
    projectId: a,
    projectName: "Career",
  });
  expect(result.state.conversations[1]).toMatchObject({
    projectId: b,
    projectName: "Local",
    folderId: null,
  });
});
it("checks Stop between iterations and preserves already collected pages", async () => {
  const port = fixture([[chat("a")], [chat("b")], [chat("c")]]);
  let stopped = false;
  const result = await traverseChats(
    port,
    (count) => {
      if (count === 2) stopped = true;
    },
    undefined,
    Date.now,
    () => stopped,
  );
  expect(result.stopped).toBe(true);
  expect(result.failed).toBe(false);
  expect(result.candidates.map((c) => c.title)).toEqual(["a", "b"]);
  expect(port.advance).toHaveBeenCalledTimes(1);
  expect(port.restore).toHaveBeenCalledOnce();
});
