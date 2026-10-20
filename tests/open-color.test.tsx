import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clickConversation } from "../src/content/open-chat";
import {
  addConversation,
  colorName,
  defaults,
  normalizeState,
  renameColor,
} from "../src/models/state";
import { migrateColorNames } from "../src/models/migration";
import { ItemDetails } from "../src/components/ItemDetails";
import { loadState } from "../src/storage";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("backs up and persists legacy preset names without a corruption warning", async () => {
  const raw = {
    ...defaults(),
    colorRules: defaults().colorRules.map(({ color, order }) => ({
      color,
      order,
    })),
  };
  const set = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("chrome", {
    storage: {
      local: { get: vi.fn().mockResolvedValue({ explorerState: raw }), set },
    },
  });
  const result = await loadState();
  expect(result.warning).toBe("");
  expect(set.mock.calls[0][0]).toEqual({ migrationBackupColorNames: raw });
  expect(set.mock.calls[1][0].explorerState.colorRules[0].name).toBe("Color 1");
  expect(result.state.conversations).toEqual(raw.conversations);
});
function anchors(paths: string[]) {
  const loc = {
    origin: "https://chatgpt.com",
    href: "https://chatgpt.com/c/current",
  };
  vi.stubGlobal("location", loc);
  const links = paths.map((path) => ({
    href: "https://chatgpt.com" + path,
    closest: () => null,
    getClientRects: () => [1],
    click: vi.fn(() => {
      loc.href = "https://chatgpt.com" + path;
    }),
  }));
  vi.stubGlobal("document", { querySelectorAll: () => links });
  return links;
}
it.each(["/c/general", `/g/g-p-${"a".repeat(32)}/c/project`])(
  "clicks only matching semantic anchor %s",
  async (path) => {
    const links = anchors(["/c/other", path + "/?query=1"]);
    expect(await clickConversation("https://chatgpt.com" + path)).toBe(true);
    expect(links[0].click).not.toHaveBeenCalled();
    expect(links[1].click).toHaveBeenCalledOnce();
  },
);
it("returns false for missing target so existing navigation can be used", async () => {
  const links = anchors(["/c/other"]);
  expect(await clickConversation("https://chatgpt.com/c/missing")).toBe(false);
  expect(links[0].click).not.toHaveBeenCalled();
});
it("falls back if a matching anchor handler does not navigate", async () => {
  vi.useFakeTimers();
  const links = anchors(["/c/target"]);
  links[0].click.mockImplementation(() => {});
  const pending = clickConversation("https://chatgpt.com/c/target");
  await vi.advanceTimersByTimeAsync(1501);
  expect(await pending).toBe(false);
});
it("ignores an external lookalike anchor", async () => {
  const links = anchors(["/c/target"]);
  links[0].href = "https://example.com/c/target";
  expect(await clickConversation("https://chatgpt.com/c/target")).toBe(false);
  expect(links[0].click).not.toHaveBeenCalled();
});
it("adds missing shared names without changing assignments or existing names", () => {
  const original = addConversation(
    defaults(),
    "Alias",
    "https://chatgpt.com/c/a",
    null,
  ).state;
  original.conversations[0].color = "#123456";
  const old = {
    ...original,
    colorRules: [
      { color: "#123456", order: 0 },
      { color: "#ef4444", order: 1, name: "Study" },
    ],
  };
  const migrated = migrateColorNames(old);
  const restored = normalizeState(migrated);
  expect(restored.conversations).toEqual(old.conversations);
  expect(colorName(restored, "#ef4444")).toBe("Study");
  expect(colorName(restored, "#ffffff")).toBe("Neutral");
  expect(colorName(restored, "#123456")).toBe("Color 1");
  expect(old.colorRules[0]).not.toHaveProperty("name");
});
it("renames only the shared preset, preserving conversation references and filter", () => {
  const old = addConversation(
    defaults(),
    "Alias",
    "https://chatgpt.com/c/a",
    null,
  ).state;
  old.settings.colorFilter = old.conversations[0].color;
  const renamed = renameColor(old, "#ffffff", "University");
  expect(renamed.conversations).toBe(old.conversations);
  expect(renamed.settings).toBe(old.settings);
  expect(colorName(renamed, renamed.settings.colorFilter)).toBe("University");
  expect(
    colorName(normalizeState(JSON.parse(JSON.stringify(renamed))), "#ffffff"),
  ).toBe("University");
});
it("allows naming custom presets without editing any chat", () => {
  const old = defaults(),
    renamed = renameColor(old, "#AbCdEf", "Personal");
  expect(renamed.conversations).toBe(old.conversations);
  expect(renamed.colorRules.at(-1)).toMatchObject({
    color: "#abcdef",
    name: "Personal",
  });
  expect(migrateColorNames(renamed)).toBe(renamed);
});
it("keeps row rendering dot-only after a shared preset rename", () => {
  const old = addConversation(
    defaults(),
    "Alias",
    "https://chatgpt.com/c/a",
    null,
  ).state;
  const s = renameColor(old, "#ffffff", "University");
  const html = renderToStaticMarkup(
    <ItemDetails conversation={s.conversations[0]} />,
  );
  expect(html).not.toContain("University");
  expect(html).toContain('class="dot"');
});
