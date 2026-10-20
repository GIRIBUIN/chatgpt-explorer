// Isolated synthetic integration; never uses a signed-in account or tmp snapshots.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
import { chromium } from 'playwright';
await fs.mkdir(path.join(root, '.verification'), { recursive: true });
const profile = await fs.mkdtemp(
  path.join(root, ".verification/import-profile-"),
);
const html = await fs.readFile(
  path.join(root, "tests/fixtures/sidebar-load-more.html"),
  "utf8",
);
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
    : {}),
  args: [
    `--disable-extensions-except=${root}/dist/chromium`,
    `--load-extension=${root}/dist/chromium`,
  ],
});
try {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 10000 }));
  const errors = [];
  worker.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await context.route("https://chatgpt.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  const chat = context.pages()[0];
  await chat.goto("https://chatgpt.com/c/fixture?slow");
  const opened = context.waitForEvent("page");
  await worker.evaluate(() =>
    chrome.windows.create({
      type: "popup",
      url: chrome.runtime.getURL("explorer.html"),
    }),
  );
  const explorer = await opened;
  explorer.on("pageerror", (error) => errors.push(error.message));
  await explorer.addInitScript(() => {
    window.progressEvents = [];
    chrome.runtime.onMessage.addListener((m) => {
      if (m.type === "import-progress") window.progressEvents.push(m);
    });
  });
  await explorer.evaluate(() => {
    window.progressEvents = [];
    chrome.runtime.onMessage.addListener((m) => {
      if (m.type === "import-progress") window.progressEvents.push(m);
    });
  });
  const progressEvents = () => explorer.evaluate(() => window.progressEvents);
  const start = () =>
    explorer.getByRole("button", { name: "Import Chats", exact: true }).click();
  const read = () =>
    worker.evaluate(
      async () =>
        (await chrome.storage.local.get("explorerState")).explorerState,
    );
  const restored = async () => {
    const value = await chat.evaluate(() => ({
      closed: document.getElementById("app-shell-sidebar").hidden,
      project: window.fixtureSidebarContent
        .querySelector("[data-app-action-sidebar-project-row]")
        .getAttribute("aria-expanded"),
      top: window.fixtureSidebarContent.scrollTop,
    }));
    assert.deepEqual(value, { closed: true, project: "false", top: 0 });
  };
  const tabCount = await worker.evaluate(
    async () => (await chrome.tabs.query({})).length,
  );
  await start();
  await chat.waitForFunction(() => window.loadMoreClicks === 1);
  await explorer.getByRole("button", { name: "Stop", exact: true }).click();
  await explorer
    .getByRole("status")
    .filter({ hasText: "Import stopped." })
    .waitFor();
  assert.equal(
    (await read()).conversations.length,
    3,
    "Stop keeps first collection and Project",
  );
  const stoppedEvents = await progressEvents();
  assert.deepEqual([stoppedEvents[0].count, stoppedEvents[0].projects], [0, 0]);
  assert.deepEqual(
    [stoppedEvents.at(-1).count, stoppedEvents.at(-1).projects],
    [3, 1],
  );
  assert(
    (await explorer.getByRole("status").innerText()).includes(
      "3 chats · 1 projects found",
    ),
  );
  await restored();
  await worker.evaluate(async () => {
    const { explorerState: s } =
      await chrome.storage.local.get("explorerState");
    s.conversations[0].title = "Protected alias";
    s.conversations[0].favorite = true;
    await chrome.storage.local.set({ explorerState: s });
  });
  await explorer.reload();
  await chat.goto("https://chatgpt.com/c/fixture");
  await start();
  await explorer
    .getByRole("status")
    .filter({ hasText: "Imported 6 chats." })
    .waitFor();
  const completeEvents = await progressEvents();
  assert.deepEqual(
    [completeEvents[0].count, completeEvents[0].projects],
    [0, 0],
  );
  assert.notEqual(completeEvents[0].sessionId, stoppedEvents[0].sessionId);
  assert.equal(completeEvents.at(-1).count, 9);
  assert.equal(completeEvents.at(-1).projects, 1);
  assert(completeEvents.some((e) => e.count > 3 && e.count < 9));
  assert(
    completeEvents.every(
      (e, i) => !i || e.count >= completeEvents[i - 1].count,
    ),
  );
  const state = await read();
  assert.equal(state.conversations.length, 9);
  assert.equal(new Set(state.conversations.map((c) => c.id)).size, 9);
  assert(
    state.conversations.some(
      (c) => c.title === "Protected alias" && c.favorite,
    ),
  );
  assert.equal(
    state.conversations.find((c) => c.id === "project-chat").projectName,
    "Project A",
  );
  assert.equal(await chat.evaluate(() => window.loadMoreClicks), 2);
  assert((await chat.evaluate(() => window.scrollEvents)) > 0);
  await restored();
  assert.equal(
    await worker.evaluate(async () => (await chrome.tabs.query({})).length),
    tabCount,
  );
  // The fixture owns a tiny app router; the extension only clicks its anchor.
  await chat.locator('[data-app-shell-sidebar-trigger="true"]').click();
  const boot = await chat.evaluate(() => window.fixtureBootId);
  await explorer.evaluate(() =>
    chrome.runtime.sendMessage({
      type: "open-chat",
      url: "https://chatgpt.com/c/batch-0",
      mode: "reuse",
    }),
  );
  await chat.waitForURL("https://chatgpt.com/c/batch-0");
  assert.equal(
    await chat.evaluate(() => window.fixtureBootId),
    boot,
    "general SPA preserves document",
  );
  await chat.locator("[data-app-action-sidebar-project-row]").click();
  await explorer.evaluate(() =>
    chrome.runtime.sendMessage({
      type: "open-chat",
      url: "https://chatgpt.com/g/g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/c/project-chat",
      mode: "reuse",
    }),
  );
  await chat.waitForURL("**/c/project-chat");
  assert.equal(
    await chat.evaluate(() => window.fixtureBootId),
    boot,
    "Project SPA preserves document",
  );
  await explorer.evaluate(() =>
    chrome.runtime.sendMessage({
      type: "open-chat",
      url: "https://chatgpt.com/c/not-in-sidebar",
      mode: "reuse",
    }),
  );
  await chat.waitForURL("**/c/not-in-sidebar");
  await chat.waitForFunction(
    (old) => window.fixtureBootId !== undefined && window.fixtureBootId !== old,
    boot,
  );
  await explorer.getByRole("button", { name: /Inbox/ }).click();
  await explorer.locator(".item-row").first().click({ button: "right" });
  await explorer
    .getByRole("menuitem", { name: "Color...", exact: true })
    .click();
  await explorer.getByRole("button", { name: "Color 1", exact: true }).click();
  await explorer.getByLabel("Color name", { exact: true }).fill("Study");
  await explorer.getByRole("button", { name: "Save", exact: true }).click();
  await explorer.getByRole("dialog").waitFor({ state: "hidden" });
  await explorer
    .getByLabel("Color filter", { exact: true })
    .selectOption({ label: "Study" });
  await explorer.waitForFunction(
    () => document.querySelectorAll(".item-row").length === 1,
  );
  assert.equal(await explorer.locator(".item-row").count(), 1);
  const beforeRename = (await read()).conversations;
  await explorer.getByRole("button", { name: "Settings", exact: true }).click();
  await explorer
    .getByLabel("Name for #ef4444", { exact: true })
    .fill("University");
  await explorer.getByRole("button", { name: "Save", exact: true }).click();
  await explorer.getByRole("dialog").waitFor({ state: "hidden" });
  assert.deepEqual(
    (await read()).conversations,
    beforeRename,
    "shared name edit does not rewrite assignments",
  );
  await explorer.reload();
  await explorer
    .getByLabel("Color filter", { exact: true })
    .selectOption({ label: "University" });
  await explorer.waitForFunction(
    () => document.querySelectorAll(".item-row").length === 1,
  );
  assert.equal(await explorer.locator(".item-row").count(), 1);
  assert(
    !(await explorer.locator(".item-row").innerText()).includes("University"),
  );
  assert.equal(
    (await read()).colorRules.find((r) => r.color === "#ef4444").name,
    "University",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: MV3 ping/injection, visible scrolling, repeated load-more, Stop partial merge, dedup, alias/favorite/name preservation, sidebar/Project/scroll restore, no temporary tabs; general/Project SPA clicks, full-navigation fallback, shared color names/filter/persistence.",
  );
} finally {
  await context.close();
}
