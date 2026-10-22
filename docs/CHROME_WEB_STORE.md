# Chrome Web Store privacy form

Copy the text below into the corresponding fields. Audited on October 21, 2026 against `dist/chromium/manifest.json`, version `0.1.0.2` (package `0.1.0-alpha.2`), using the Dropbox build. Recheck the generated manifest if build configuration changes.

## Single purpose

Convoary helps users organize, search and reopen their ChatGPT conversation links in an Explorer-style window, using local folders, aliases, favorites and color labels, with optional encrypted Dropbox sync of that organization across their own browsers and devices.

## Permission justifications

### storage

Stores conversation links/titles, folders, aliases, favorites, colors, preferences, window bounds, local backups and sync credentials in extension-local storage so organization persists across restarts. Session storage retains temporary window identifiers used to open chats in the correct browser window.

### tabs

Inspects open-tab URLs and matching ChatGPT tab titles for Add Current Chat, Import Open Tabs and locating an existing tab when reopening a saved conversation. Nonmatching tab records are filtered out and are not retained as browsing history.

### system.display

Reads display work areas and the primary-display flag to center, restore and keep the separate Explorer window within usable screen bounds, including multi-monitor setups. Display information is not uploaded.

### scripting

Executes bundled functions on ChatGPT pages to import conversation titles/links and Project metadata from the rendered interface, operate sidebar scrolling/load-more controls, restore sidebar state and click existing conversation links when opening chats. No downloaded scripts are injected.

### alarms

Schedules a one-shot automatic sync five minutes after the last durable workspace change. Chrome alarms allow this pending work to survive background service-worker suspension; no periodic polling alarm is used.

### identity

Uses identity.getRedirectURL and identity.launchWebAuthFlow for user-initiated Dropbox Connect, Reconnect and Change account authorization with authorization-code PKCE. This lets users authorize their own Dropbox for encrypted sync. Background token refresh does not open interactive login.

## Host permissions

These are the exact entries in the audited Chromium build. If the dashboard provides one host-permission justification field, paste these explanations together. The endpoint descriptions describe application code usage, not a claim that browser host permissions enforce endpoint-only access.

### https://chatgpt.com/*

Accesses the rendered ChatGPT sidebar and Project interface to import conversation titles, links and Project metadata, and to click matching sidebar links when opening saved chats. It does not collect conversation message bodies or ChatGPT cookies/authentication tokens, or call private ChatGPT APIs.

### https://api.dropboxapi.com/oauth2/token

Exchanges the user's Dropbox authorization code with its PKCE verifier and silently refreshes expiring OAuth access tokens so optional encrypted sync can continue without repeated login prompts.

### https://api.dropboxapi.com/2/files/get_metadata

Checks the dedicated encrypted sync file's existence and revision before synchronizing, including the exact old root file during legacy migration. It does not list unrelated Dropbox files.

### https://api.dropboxapi.com/2/auth/token/revoke

Attempts to revoke the stored Dropbox access token when the user disconnects Dropbox. Local disconnect completes even if this network request fails.

### https://content.dropboxapi.com/2/files/download

Downloads the encrypted workspace snapshot from the dedicated sync file, or the exact legacy root file during migration, for on-device decryption, validation and synchronization.

### https://content.dropboxapi.com/2/files/upload

Uploads the workspace snapshot only after on-device encryption. Dedicated-path uploads use create or revision-conditional update semantics to prevent silent stale overwrites; no plaintext workspace or Sync Key is uploaded.

## Remote-code declaration

**Answer: No.**

All executable extension code and dependencies are bundled in the extension package. ChatGPT page functions run from packaged code through chrome.scripting. Dropbox responses are processed as OAuth/file metadata or encrypted JSON data, not executable code. Dropbox's authorization website is opened through the browser identity flow; its scripts are not loaded into the extension. The extension does not download or execute remote JavaScript or WebAssembly, or use remote script imports/eval.

## Privacy policy URL

After publishing the updated policy, use this URL if it is accessible without signing in:

https://github.com/GIRIBUIN/convoary/blob/main/PRIVACY.md

## Implementation checks and submission notes

- The base `public/manifest.json` has five permissions; `scripts/manifest.ts` adds **identity** and the five Dropbox host entries to the actual build. Identity remains necessary. No permission was added or removed during this documentation task.
- The audited build requests no `cookies`, `history`, `activeTab`, `downloads`, `<all_urls>`, Google API or Cloudflare host permission. Dropbox's `www.dropbox.com` authorization page is handled through identity, not a separate requested host entry.
- File operations use `/ChatGPT Chat Explorer/chat-explorer-sync.json`, with an exact legacy-root read exception. Dropbox OAuth grants **Full Dropbox** access; this path confinement is implemented in code, not an App Folder sandbox.
- OAuth tokens, account identifiers, Sync Key, sync baselines, window/display settings and temporary UI state are not serialized into the remote workspace. The account ID may remain locally after Disconnect for account-change detection. Message bodies are not collected or exported.
- Legacy Google Drive/Cloudflare modules remain in source for compatibility. They are not the default provider or additional requested hosts in this submission build. Their API URL strings do not by themselves mean remotely hosted executable code is loaded.
- Source checks: `src/storage/index.ts`, `src/utils/discovery.ts`, `src/background/index.ts`, `src/background/import.ts`, `src/content/read-page.ts`, `src/sync/dropbox-auth.ts`, `src/sync/dropbox.ts`, `src/sync/dropbox-key.ts`, `src/sync/dropbox-connection.ts`, `src/sync/dropbox-recovery.ts`, `src/sync/store.ts`, `src/sync/payload.ts`, `src/models/workspace.ts` and `src/sync/crypto.ts`. The built HTML/JS/CSS were also checked for remote script imports, eval/new Function, importScripts and WebAssembly.

Official guidance: [Privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), [privacy policy requirements](https://developer.chrome.com/docs/webstore/program-policies/privacy), [remotely hosted code](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code). These are implementation disclosures, not a guarantee of store approval.
