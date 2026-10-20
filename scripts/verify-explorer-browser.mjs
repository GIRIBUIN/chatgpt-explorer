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
  const read = () =>
    worker.evaluate(
      async () =>
        (await chrome.storage.local.get("explorerState")).explorerState,
    );
  await explorer.getByRole("button", { name: /Inbox/ }).click();
  await worker.evaluate(async () => {
    const { explorerState: s } =
      await chrome.storage.local.get("explorerState");
    const project = "g-p-" + "a".repeat(32);
    s.folders = [
      {
        id: "folder-one",
        name: "Folder One",
        parentId: null,
        favorite: false,
        createdAt: 1,
      },
    ];
    s.conversations = Array.from({ length: 5 }, (_, i) => ({
      id: `chat-${i}`,
      title: `Chat ${i}`,
      originalTitle: `Source ${i}`,
      url: `https://chatgpt.com/c/chat-${i}`,
      projectId: i < 2 ? project : null,
      projectName: i < 2 ? "Study" : null,
      folderId: null,
      color: i < 3 ? "#ef4444" : "#ffffff",
      favorite: false,
      createdAt: i,
      lastOpenedAt: null,
    }));
    s.colorRules.find((c) => c.color === "#ef4444").name = "Important";
    s.settings.lastLocation = "inbox";
    await chrome.storage.local.set({ explorerState: s });
  });
  await explorer.reload();
  const rows = explorer.locator(".item-row");
  async function visibleRows(expected) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && await rows.count() !== expected)
      await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(await rows.count(), expected);
  }
  await rows.first().waitFor();
  await visibleRows(5);
  await rows.nth(0).click();
  await rows.nth(2).click({ modifiers: ["Control"] });
  assert.equal(await explorer.locator(".item-row.selected").count(), 2);
  await rows.nth(4).click({ modifiers: ["Shift"] });
  assert.equal(await explorer.locator(".item-row.selected").count(), 3);
  await explorer.keyboard.press("Escape");
  assert.equal(await explorer.locator(".item-row.selected").count(), 0);
  const search = explorer.getByRole("searchbox", {
    name: "Search",
    exact: true,
  });
  await search.fill("project:Study color:Important");
  await visibleRows(2);
  await rows.first().click();
  await explorer.keyboard.press("Control+a");
  assert.equal(await explorer.locator(".item-row.selected").count(), 2);
  await search.focus();
  await explorer.keyboard.press("Control+a");
  await explorer.keyboard.press("Delete");
  await visibleRows(5);
  assert.equal((await read()).conversations.length, 5);
  await rows.first().click();
  await explorer.keyboard.press("F2");
  const rename = explorer.getByRole("textbox", { name: "Rename", exact: true });
  await rename.waitFor();
  assert.equal(await explorer.getByRole("dialog").count(), 0);
  assert.equal(
    await rename.evaluate((e) => e.selectionEnd - e.selectionStart),
    6,
  );
  await rename.fill("Alias Zero");
  await rename.press("Enter");
  await rename.waitFor({ state: "hidden" });
  assert.equal((await read()).conversations[0].title, "Alias Zero");
  await rows.first().click();
  await explorer.keyboard.press("F2");
  await rename.fill("Wrong");
  await rename.press("Escape");
  assert.equal((await read()).conversations[0].title, "Alias Zero");
  await rows.first().click();
  await explorer.keyboard.press("F2");
  await rename.fill("  ");
  await rename.press("Enter");
  assert.equal((await read()).conversations[0].title, "Alias Zero");
  await rows.first().click({ button: "right" });
  await explorer.getByRole("menuitem", { name: /Rename/ }).click();
  await rename.fill("Blur Alias");
  await search.click();
  await rename.waitFor({ state: "hidden" });
  assert.equal((await read()).conversations[0].title, "Blur Alias");
  await search.fill('name:"Source 0"');
  await visibleRows(1);
  await search.fill("");
  await explorer
    .getByLabel("Project filter", { exact: true })
    .selectOption({ label: "Study" });
  await visibleRows(2);
  await explorer
    .getByLabel("Color filter", { exact: true })
    .selectOption("#ffffff");
  await visibleRows(0);
  await explorer
    .getByLabel("Project filter", { exact: true })
    .selectOption("none");
  await visibleRows(2);
  await explorer
    .getByLabel("Project filter", { exact: true })
    .selectOption("all");
  await explorer
    .getByLabel("Color filter", { exact: true })
    .selectOption("all");
  await rows.first().locator(".truncate").click();
  assert.equal(await explorer.getByRole("dialog").count(), 0);
  await rows
    .first()
    .getByRole("button", { name: "Color...", exact: true })
    .click();
  await explorer.getByRole("dialog").waitFor();
  await explorer.getByRole("button", { name: "Cancel", exact: true }).click();
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ["Control"] });
  await explorer.keyboard.press("Control+Shift+p");
  const palette = explorer.getByRole("dialog", {
    name: "Command Palette",
    exact: true,
  });
  await palette.waitFor();
  assert(
    await palette
      .getByRole("button", { name: "Rename", exact: true })
      .isDisabled(),
  );
  await palette.getByLabel("Search commands").fill("Move");
  await palette.getByLabel("Search commands").press("Enter");
  await explorer
    .getByLabel("Destination folder", { exact: true })
    .selectOption("folder-one");
  await explorer.getByRole("button", { name: "Save", exact: true }).click();
  await explorer.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    (await read()).conversations.filter((c) => c.folderId === "folder-one")
      .length,
    2,
  );
  await explorer.getByRole("button", { name: /Home/ }).first().click();
  const folderRow = explorer
    .locator(".item-row")
    .filter({ hasText: "Folder One" });
  await folderRow.dblclick();
  await visibleRows(2);
  await rows.first().dblclick();
  await chat.waitForURL(/chat-/);
  assert.equal(
    await explorer
      .getByRole("textbox", { name: "Rename", exact: true })
      .count(),
    0,
  );
  await explorer.getByRole("button", { name: /Inbox/ }).click();
  await rows.first().click();
  await explorer.keyboard.press("Delete");
  await explorer.getByRole("dialog").waitFor();
  await explorer.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal((await read()).conversations.length, 5);
  await rows.first().click();
  await rows.nth(1).click({ modifiers: ["Control"] });
  await explorer.keyboard.press("Control+Shift+p");
  await palette.getByLabel("Search commands").fill("Color");
  await palette.getByLabel("Search commands").press("Enter");
  await explorer
    .getByRole("dialog")
    .getByRole("button", { name: "Color 4", exact: true })
    .click();
  await explorer.getByRole("button", { name: "Save", exact: true }).click();
  await explorer.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    (await read()).conversations.filter((c) => c.color === "#3b82f6").length,
    2,
  );
  await rows.first().click();
  await explorer.keyboard.press("Control+Shift+p");
  await palette.getByLabel("Search commands").fill("Rename");
  await palette.getByLabel("Search commands").press("Enter");
  await rename.waitFor();
  assert(await rename.evaluate((e) => document.activeElement === e));
  await rename.press("Escape");
  await explorer.getByLabel("More actions", { exact: true }).click();
  assert.equal(
    await explorer
      .getByRole("button", { name: "Theme & Workspace", exact: true })
      .count(),
    0,
  );
  await explorer.getByLabel("More actions", { exact: true }).click();
  await explorer.getByRole("button", { name: "Settings", exact: true }).click();
  const data = explorer.getByRole("dialog", {
    name: "Settings",
    exact: true,
  });
  await data.waitFor();
  await explorer.setViewportSize({ width: 500, height: 650 });
  assert.equal(await data.locator('input[type="file"]:visible').count(), 0);
  await data
    .getByRole("heading", { name: "Appearance", exact: true })
    .scrollIntoViewIfNeeded();
  await data.evaluate((dialog) => {
    const heading = dialog.querySelector(".data-settings h3");
    dialog.scrollTop +=
      heading.getBoundingClientRect().top -
      dialog.getBoundingClientRect().top -
      70;
  });
  await explorer.screenshot({ path: ".verification/settings-data-500.png" });
  const actionStyles = await data
    .getByRole("group", { name: "Theme", exact: true })
    .getByRole("button", { name: "Import JSON", exact: true })
    .evaluate((e) => {
      const s = getComputedStyle(e);
      return [s.borderWidth, s.borderRadius, s.fontSize];
    });
  const cancelStyles = await data
    .getByRole("button", { name: "Cancel", exact: true })
    .evaluate((e) => {
      const s = getComputedStyle(e);
      return [s.borderWidth, s.borderRadius, s.fontSize];
    });
  assert.deepEqual(actionStyles, cancelStyles);
  assert(
    await data
      .locator(".data-settings")
      .evaluateAll((sections) => sections.every((e) => e.scrollWidth <= e.clientWidth)),
  );
  const upload = (value) => ({
    name: "synthetic.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(value)),
  });
  const theme = {
    version: 1,
    name: "Test Theme",
    colors: {
      background: "#112233",
      surface: "#223344",
      surfaceHover: "#334455",
      text: "#eeeeee",
      textMuted: "#aaaaaa",
      border: "#445566",
      accent: "#abcdef",
    },
    ui: { radius: 6, density: "comfortable", fontSize: 14 },
  };
  const themeChooser = explorer.waitForEvent("filechooser");
  await data
    .getByRole("group", { name: "Theme", exact: true })
    .getByRole("button", { name: "Import JSON", exact: true })
    .click();
  await (await themeChooser).setFiles(upload(theme));
  await explorer.waitForFunction(
    () => document.documentElement.style.getPropertyValue("--bg") === "#112233",
  );
  const downloadTheme = explorer.waitForEvent("download");
  await data
    .getByRole("button", { name: "Export Theme JSON", exact: true })
    .click();
  assert.equal(
    (await downloadTheme).suggestedFilename(),
    "chat-explorer-theme.json",
  );
  await data
    .getByLabel("Import Theme JSON", { exact: true })
    .setInputFiles(upload({ ...theme, css: "bad" }));
  await data.getByRole("alert").waitFor();
  assert.equal((await read()).theme.name, "Test Theme");
  const download = explorer.waitForEvent("download");
  await data
    .getByRole("button", { name: "Export Workspace JSON", exact: true })
    .click();
  const file = await download;
  assert.equal(file.suggestedFilename(), "chat-explorer-workspace.json");
  const workspace = JSON.parse(await fs.readFile(await file.path(), "utf8"));
  assert(!JSON.stringify(workspace).includes("messages"));
  workspace.chats[0].displayName = "Workspace Alias";
  workspace.chats[0].favorite = true;
  workspace.folders.push({
    id: "new-folder",
    name: "Imported Folder",
    parentId: null,
    favorite: false,
  });
  workspace.chats[0].folderId = "new-folder";
  const workspaceChooser = explorer.waitForEvent("filechooser");
  await data
    .getByRole("group", { name: "Workspace", exact: true })
    .getByRole("button", { name: "Import JSON", exact: true })
    .click();
  await (await workspaceChooser).setFiles(upload(workspace));
  await data.getByRole("heading", { name: "Preview", exact: true }).waitFor();
  assert.notEqual((await read()).conversations[0].title, "Workspace Alias");
  await data
    .getByRole("region", { name: "Preview", exact: true })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  assert.notEqual((await read()).conversations[0].title, "Workspace Alias");
  await data
    .getByLabel("Import Workspace JSON", { exact: true })
    .setInputFiles(upload(workspace));
  const before = await read();
  await data.getByRole("button", { name: "Apply", exact: true }).click();
  await data
    .getByRole("heading", { name: "Preview", exact: true })
    .waitFor({ state: "hidden" });
  assert.equal((await read()).conversations[0].title, "Workspace Alias");
  assert.equal((await read()).conversations[0].folderId, "new-folder");
  assert.deepEqual(
    await worker.evaluate(
      async () =>
        (await chrome.storage.local.get("workspaceBackup")).workspaceBackup
          .state,
    ),
    before,
  );
  await data.getByRole("button", { name: "Close", exact: true }).click();
  await explorer.reload();
  assert.equal((await read()).theme.name, "Test Theme");
  await explorer.waitForFunction(
    () => document.documentElement.style.getPropertyValue("--bg") === "#112233",
  );
  await explorer.getByRole("button", { name: "Settings", exact: true }).click();
  await data.getByRole("button", { name: "Reset Theme", exact: true }).click();
  await explorer.waitForFunction(
    () => !document.documentElement.style.getPropertyValue("--bg"),
  );
  assert.equal((await read()).theme, undefined);
  await data.getByRole("button", { name: "Close", exact: true }).click();
  // A genuine in-flight Import changes App's workspace after a preview is made.
  await chat.goto("https://chatgpt.com/c/fixture?slow");
  await explorer.evaluate(() => {
    window.scanSession = null;
    chrome.runtime.onMessage.addListener((m) => {
      if (m.type === "import-progress") window.scanSession = m.sessionId;
    });
  });
  await explorer
    .getByRole("button", { name: "Import Chats", exact: true })
    .click();
  await chat.waitForFunction(() => window.loadMoreClicks === 1);
  await explorer.getByRole("button", { name: "Settings", exact: true }).click();
  await data
    .getByLabel("Import Workspace JSON", { exact: true })
    .setInputFiles(upload(workspace));
  await data.getByRole("heading", { name: "Preview", exact: true }).waitFor();
  assert(
    await data.getByRole("button", { name: "Apply", exact: true }).isEnabled(),
  );
  const beforeStaleBackup = await worker.evaluate(
    async () =>
      (await chrome.storage.local.get("workspaceBackup")).workspaceBackup,
  );
  await explorer.evaluate(() =>
    chrome.runtime.sendMessage({
      type: "stop-import",
      sessionId: window.scanSession,
    }),
  );
  await data
    .getByRole("alert")
    .filter({ hasText: "Workspace changed" })
    .waitFor();
  assert(
    await data.getByRole("button", { name: "Apply", exact: true }).isDisabled(),
  );
  // Attempting even a DOM click does not bypass the disabled state.
  await data
    .getByRole("button", { name: "Apply", exact: true })
    .evaluate((e) => e.click());
  assert.deepEqual(
    await worker.evaluate(
      async () =>
        (await chrome.storage.local.get("workspaceBackup")).workspaceBackup,
    ),
    beforeStaleBackup,
  );
  for (const label of ["Import Workspace JSON", "Import Theme JSON"]) {
    await data.getByLabel(label, { exact: true }).setInputFiles({
      name: "oversized.json",
      mimeType: "application/json",
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 32),
    });
    await data
      .getByRole("alert")
      .filter({ hasText: "File exceeds 10 MB." })
      .waitFor();
  }
  const backupDownload = explorer.waitForEvent("download");
  await data
    .getByRole("button", { name: "Export last workspace backup", exact: true })
    .click();
  assert.equal(
    (await backupDownload).suggestedFilename(),
    "chat-explorer-workspace-backup.json",
  );
  await data.getByRole("button", { name: "Close", exact: true }).click();
  await explorer.setViewportSize({ width: 500, height: 650 });
  await explorer.screenshot({ path: ".verification/explorer-ux-500.png" });
  await explorer.emulateMedia({ colorScheme: "dark" });
  await explorer.screenshot({ path: ".verification/explorer-ux-dark-500.png" });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: visible selection/input guards, inline rename save/cancel/blur, double-click open, color click, combined project/color/search, palette/bulk move, theme import/export/reset/persistence, workspace preview/cancel/apply/backup; no page errors.",
  );
} finally {
  await context.close();
}

