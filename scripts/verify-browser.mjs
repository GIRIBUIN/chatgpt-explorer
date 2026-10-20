// Optional synthetic integration check: npx playwright install chromium
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
import { chromium } from 'playwright';
await fs.mkdir(path.join(root, '.verification'), { recursive: true });
const profile = await fs.mkdtemp(path.join(root, ".verification/v3-profile-"));
const fixture = await fs.readFile(
  path.join(root, "tests/fixtures/chatgpt-sidebar.html"),
  "utf8",
);
const virtualFixture = await fs.readFile(
  path.join(root, "tests/fixtures/chatgpt-semantic-sidebar.html"),
  "utf8",
);
const options = {
  channel: "chromium",
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
    : {}),
  args: [
    `--disable-extensions-except=${root}/dist/chromium`,
    `--load-extension=${root}/dist/chromium`,
  ],
  viewport: { width: 900, height: 650 },
};
let context;
try {
  context = await chromium.launchPersistentContext(profile, options);
} catch (error) {
  console.error(
    "Browser environment could not start. Install Windows Chromium with: npx playwright install chromium. No application assertions ran.",
  );
  throw error;
}
async function getWorker() {
  return (
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  );
}
async function popup(worker) {
  const pending = context.waitForEvent("page");
  await worker.evaluate(() =>
    chrome.windows.create({
      url: chrome.runtime.getURL("explorer.html"),
      type: "popup",
      width: 900,
      height: 650,
    }),
  );
  return pending;
}
async function routePages() {
  await context.route("https://chatgpt.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: route.request().url().includes("fixture=virtual")
        ? virtualFixture
        : route.request().url() === "https://chatgpt.com/"
          ? fixture
          : route.request().url().endsWith("/project")
            ? `<!doctype html><title>Local AI - ChatGPT</title><nav data-app-action-sidebar-scroll><a data-interactive-row-link="true" href="/c/general" aria-label="General conversation">General conversation</a><section><h2 data-app-action-sidebar-section-heading="Projects">Projects</h2><div data-app-action-sidebar-project-row data-app-action-sidebar-project-id="g-p-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" data-app-action-sidebar-project-label="Local AI" data-app-action-sidebar-project-collapsed="false" aria-expanded="true" role="button">Local AI</div><div data-sidebar-project-container-id="project:g-p-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"><a data-interactive-row-link="true" href="/g/g-p-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-local/c/project-main" aria-label="Project landing chat">Project landing chat</a></div></section></nav><main><h1>Local AI</h1></main>`
            : "<!doctype html><title>Open conversation - ChatGPT</title><main><article>Fixture content</article></main>",
    }),
  );
}
try {
  // These are sanitized synthetic states, never files from tmp/.
  const ts = await import("typescript");
  const source = await fs.readFile(
    path.join(root, "src/content/read-page.ts"),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  const { readRenderedPage } = await import(
    "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
  );
  const fixturePage = await context.newPage();
  for (const [name, expected] of [
    ["loaded-sidebar", 4],
    ["alternate-visibility", 4],
    ["project-loading", 0],
  ]) {
    const html = await fs.readFile(
      path.join(root, "tests/fixtures", name + ".html"),
      "utf8",
    );
    await fixturePage.route("https://chatgpt.com/**", (route) =>
      route.fulfill({ contentType: "text/html", body: html }),
    );
    await fixturePage.goto("https://chatgpt.com/");
    const evidence = await fixturePage.evaluate(readRenderedPage);
    assert.equal(evidence.links.length, expected, name);
    if (expected) {
      assert.equal(
        evidence.links.filter((link) => link.containerProjectId === null)
          .length,
        2,
      );
      assert.equal(evidence.projects.length, 2);
    }
    await fixturePage.unroute("https://chatgpt.com/**");
  }
  console.log(
    "Synthetic DOM fixtures passed: loaded, loading, alternate visibility.",
  );
  await fixturePage.close();
  await routePages();
  let worker = await getWorker();
  let page = await popup(worker);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
  const save = async () => {
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  };
  const more = () => page.getByLabel("More actions", { exact: true }).click();
  const read = () =>
    worker.evaluate(
      async () =>
        (await chrome.storage.local.get("explorerState")).explorerState,
    );
  const normalCount = () =>
    worker.evaluate(
      async () =>
        (await chrome.windows.getAll({ windowTypes: ["normal"] })).length,
    );
  assert.equal(
    await page
      .locator(".commandbar > button")
      .filter({ hasText: /^Add Chat$/ })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Import Chats", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "No ChatGPT page found." })
    .waitFor();
  await page.getByRole("button", { name: "New Folder", exact: true }).click();
  await page.getByLabel("Display name", { exact: true }).fill("Mine");
  await save();
  await page.locator(".item-row").filter({ hasText: "Mine" }).dblclick();
  await more();
  await page
    .getByRole("button", { name: "Add by URL...", exact: true })
    .click();
  await page.getByLabel("Display name", { exact: true }).fill("My alias");
  await page
    .getByLabel("Conversation URL", { exact: true })
    .fill("https://chatgpt.com/c/career");
  await save();
  await worker.evaluate(async () => {
    const { explorerState: s } =
      await chrome.storage.local.get("explorerState");
    s.conversations[0].favorite = true;
    s.conversations[0].color = "#a855f7";
    s.conversations[0].lastOpenedAt = 123;
    await chrome.storage.local.set({ explorerState: s });
  });
  await page.reload();
  await page.getByRole("heading", { name: "Mine", exact: true }).waitFor();
  const normal = context.pages().find((p) => p !== page);
  await normal.goto("https://chatgpt.com/");
  await page.bringToFront();
  await page.getByRole("button", { name: "Import Chats", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Imported 3 chats." })
    .waitFor();
  let s = await read();
  assert.equal(s.conversations.length, 4);
  const existing = s.conversations.find((c) => c.id === "career");
  assert.equal(existing.title, "My alias");
  assert.equal(existing.folderId, s.folders[0].id);
  assert.equal(existing.favorite, true);
  assert.equal(existing.color, "#a855f7");
  assert.equal(existing.lastOpenedAt, 123);
  assert.equal(existing.projectName, "AI Career");
  assert.equal(
    s.conversations.find((c) => c.id === "worker").projectName,
    "Local AI",
  );
  assert.equal(s.conversations.find((c) => c.id === "general").projectId, null);
  assert.equal(
    s.conversations.find((c) => c.id === "unknown").projectName,
    null,
  );
  assert(
    !s.conversations.some((c) =>
      ["hidden", "css-hidden", "body-link", "external"].includes(c.id),
    ),
  );
  assert((await page.locator(".item-row").innerText()).includes("AI Career"));
  await page.getByRole("button", { name: /Inbox/ }).click();
  assert((await page.locator(".file-list").innerText()).includes("Local AI"));
  await page.getByRole("button", { name: "Import Chats", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Nothing new to import." })
    .waitFor();
  const projectPending = context.waitForEvent("page");
  await worker.evaluate(() =>
    chrome.windows.create({
      type: "normal",
      url: "https://chatgpt.com/g/g-p-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-local/project",
    }),
  );
  const project = await projectPending;
  await project.waitForLoadState();
  // Browser-created windows can navigate before Playwright attaches its route.
  // Reload the synthetic URL after attachment; never rely on a live request.
  await project.goto('https://chatgpt.com/g/g-p-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-local/project');
  // This assertion targets one synthetic page, independent of headless window
  // activation timestamps. Tab-selection ordering is covered by unit tests.
  await normal.close();
  await page.bringToFront();
  await page.getByRole("button", { name: "Import Chats", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Imported 1 chats." })
    .waitFor();
  assert.equal(
    (await read()).conversations.find((c) => c.id === "project-main")
      .projectName,
    "Local AI",
  );
  const current = await context.newPage();
  await current.goto("https://chatgpt.com/c/current");
  await page.bringToFront();
  await page
    .getByRole("button", { name: "Add Current Chat", exact: true })
    .click();
  await page
    .locator(".item-row")
    .filter({ hasText: "Open conversation" })
    .waitFor();
  assert((await read()).conversations.some((c) => c.id === "current"));
  await current.goto("https://chatgpt.com/c/tab-only");
  await page.bringToFront();
  await more();
  await page
    .getByRole("button", { name: "Import Open Tabs", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Imported 1 chats." })
    .waitFor();
  assert((await read()).conversations.some((c) => c.id === "tab-only"));
  await page.getByRole("button", { name: "Mine", exact: true }).click();
  let row = page.locator(".item-row").filter({ hasText: "My alias" });
  const count = context.pages().length;
  await row.dblclick();
  await page.waitForFunction(
    async () =>
      (await chrome.storage.local.get("explorerState")).explorerState
        .conversations[0].lastOpenedAt > 123,
  );
  assert.equal(context.pages().length, count);
  assert.equal(page.isClosed(), false);
  await page.bringToFront();
  await row.getByRole("button", { name: "Actions for My alias", exact: true }).click();
  let pending = context.waitForEvent("page");
  await page
    .getByRole("menuitem", { name: "Open in New Tab", exact: true })
    .click();
  await pending;
  assert.equal(context.pages().length, count + 1);
  await page.bringToFront();
  await row.getByRole("button", { name: "Actions for My alias", exact: true }).click();
  const windows = await normalCount();
  pending = context.waitForEvent("page");
  await page
    .getByRole("menuitem", { name: "Open in New Window", exact: true })
    .click();
  await pending;
  assert.equal(await normalCount(), windows + 1);
  await page.bringToFront();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByLabel("Default open behavior", { exact: true })
    .selectOption("new-tab");
  await save();
  pending = context.waitForEvent("page");
  await row.dblclick();
  await pending;
  await page.bringToFront();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByLabel("Default open behavior", { exact: true })
    .selectOption("new-window");
  await save();
  await row.click();
  pending = context.waitForEvent("page");
  await page.keyboard.press("Enter");
  await pending;
  await page.bringToFront();
  // Synthetic semantic attributes supplied by the user; not a live capture.
  const semanticPending = context.waitForEvent("page");
  await worker.evaluate(() =>
    chrome.windows.create({
      type: "normal",
      url: "https://chatgpt.com/?fixture=virtual",
    }),
  );
  const semantic = await semanticPending;
  await semantic.waitForLoadState();
  await semantic.goto('https://chatgpt.com/?fixture=virtual');
  for (const other of context.pages())
    if (other !== page && other !== semantic) await other.close();
  await semantic.evaluate(() => {
    const scroller = document.querySelector("[data-app-action-sidebar-scroll]");
    scroller.scrollTop = 320;
    window.importScrollEvents = 0;
    scroller.addEventListener("scroll", () => window.importScrollEvents++);
  });
  const beforePages = context.pages().length;
  await page.bringToFront();
  await page.getByRole("button", { name: "Import Chats", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: /[3-9] chats/ })
    .waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Import stopped." })
    .waitFor({ timeout: 15000 });
  assert.equal(context.pages().length, beforePages);
  const partial = (await read()).conversations.filter((c) =>
    c.id.startsWith("semantic-"),
  );
  assert(partial.length > 0);
  const state = () =>
    semantic.evaluate(() => ({
      top: document.querySelector("[data-app-action-sidebar-scroll]").scrollTop,
      expanded: [
        ...document.querySelectorAll("[data-app-action-sidebar-project-row]"),
      ].map((r) => r.getAttribute("aria-expanded")),
      url: location.href,
    }));
  assert.deepEqual(await state(), {
    top: 320,
    expanded: ["false", "true"],
    url: "https://chatgpt.com/?fixture=virtual",
  });
  await page.getByRole("button", { name: "Import Chats", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: /Imported \d+ chats\.|Nothing new to import/ })
    .waitFor({ timeout: 180000 });
  const scanned = (await read()).conversations.filter((c) =>
    c.id.startsWith("semantic-"),
  );
  assert.equal(scanned.length, 12);
  assert.equal(
    scanned.find((c) => c.id === "semantic-a").projectName,
    "Local ai",
  );
  assert.equal(scanned.find((c) => c.id === "semantic-b").projectName, "매일");
  assert(!(await read()).conversations.some((c) => c.id === "wrong-project"));
  assert.equal(context.pages().length, beforePages);
  assert.deepEqual(await state(), {
    top: 320,
    expanded: ["false", "true"],
    url: "https://chatgpt.com/?fixture=virtual",
  });
  assert(await semantic.evaluate(() => window.importScrollEvents > 0));
  await semantic.close();
  await page.screenshot({ path: ".verification/v3-light.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 500, height: 650 });
  await page.screenshot({ path: ".verification/v3-narrow.png" });
  assert.deepEqual(errors, []);
  const persisted = await read();
  await context.close();
  context = await chromium.launchPersistentContext(profile, options);
  await routePages();
  worker = await getWorker();
  page = await popup(worker);
  await page.getByRole("heading", { name: "Mine", exact: true }).waitFor();
  assert.deepEqual(await read(), persisted);
  assert.equal((await read()).settings.defaultOpenBehavior, "new-window");
  console.log(
    "PASS: DOM injection, general + two project groups + project landing, hidden/body/unknown exclusions, preservation/enrichment, duplicate import, Add by URL overflow, Add Current Chat, explicit open-tabs import, reuse/new-tab/new-window, default double-click/Enter, full browser restart persistence, light/dark/narrow.",
  );
} catch (error) {
  for (const failedPage of context.pages()) {
    console.error(
      "Synthetic test page",
      failedPage.url(),
      await failedPage
        .locator('[role="status"]')
        .allTextContents()
        .catch(() => []),
    );
  }
  throw error;
} finally {
  await context.close();
}
