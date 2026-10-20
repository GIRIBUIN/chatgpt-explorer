import { expect, it } from "vitest";
import { ImportProgress } from "../src/background/import-progress";
const p = "g-p-" + "a".repeat(32),
  q = "g-p-" + "b".repeat(32);
const chat = (id: string) => ({
  title: id,
  url: `https://chatgpt.com/c/${id}`,
});
it("new import starts at zero", () =>
  expect(new ImportProgress().snapshot()).toEqual({ count: 0, projects: 0 }));
it("unique chats increment including chats already in storage", () => {
  const s = new ImportProgress();
  s.collect([chat("existing")]);
  expect(s.collect([chat("new")]).count).toBe(2);
});
it("duplicate chat across batches and project routes increments only once", () => {
  const s = new ImportProgress();
  s.collect([chat("same")]);
  expect(
    s.collect([{ ...chat("same"), url: `https://chatgpt.com/g/${p}/c/same` }]),
  ).toEqual({ count: 1, projects: 1 });
});
it("project rows and conversation project IDs deduplicate", () => {
  const s = new ImportProgress();
  expect(s.collect([{ ...chat("a"), projectId: p }], [p, p, q])).toEqual({
    count: 1,
    projects: 2,
  });
});
it("previous session does not leak", () => {
  const a = new ImportProgress();
  a.collect([chat("old")], [p]);
  const b = new ImportProgress();
  expect(b.snapshot()).toEqual({ count: 0, projects: 0 });
  expect(b.collect([chat("fresh")])).toEqual({ count: 1, projects: 0 });
});
it("Stop snapshot retains only discovered partial counts", () => {
  const s = new ImportProgress();
  s.collect([chat("a"), chat("b"), chat("a")], [p]);
  expect(s.snapshot()).toEqual({ count: 2, projects: 1 });
});
