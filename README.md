# Chat Explorer for ChatGPT

**v0.1-alpha** — a browser extension for organizing ChatGPT chats in an independent Explorer window. This is an early release, not a production-readiness claim. English UI; Chromium/Chrome/Edge and Firefox/Zen builds.

## Features frozen for v0.1

- Nested virtual folders with sibling-level pins, local aliases, chat favorites, colors with shared preset names.
- Folder colors decorate filled folder icons independently of chat color labels: use a folder's context-menu **Color...**. Reset to default restores the yellow folder; names and row backgrounds keep their theme colors.
- Pin folders using their trailing pin control; pinned folders stay within their parent and retain the existing sort order within each group. Favorites contains chats only. Legacy folder favorites migrate to pins with an original-data backup; update all connected installations before syncing this folder metadata.
- Search, sort, Project/color filters and structured search: `name:"language models" project:Study color:Important`. Space-separated tokens use AND.
- Drag a selected item to move the selected chats/folders together; dragging an unselected item moves it alone. Sidebar and main-pane folders accept drops. Self/descendant/system destinations and same-parent no-ops are rejected. Existing Move actions remain available.
- Click an empty main-list surface to clear selection, or drag a rectangle to select visible folders/chats. Ctrl/Cmd rectangle selection adds to the existing selection.
- F2 renames the focused user folder in the sidebar in place, as well as selected main-pane items. Enter saves, Escape cancels, and valid edits save on blur; system navigation cannot be renamed.
- Explorer selection: Ctrl+A selects visible results, Ctrl+Click toggles, Shift+Click selects a range. F2 renames inline; Enter/double-click opens a chat or folder. Text inputs keep their normal shortcuts.
- Command Palette: Ctrl+Shift+P. Default Explorer window shortcut: Ctrl+Shift+E (Command on macOS); browser shortcut settings can change it.
- Add Current Chat, Import Open Tabs and Import Chats. Existing sidebar anchors are used for SPA Open when available; new-tab/new-window and full-navigation fallback remain available.
- Theme JSON import/export/reset; Workspace JSON preview/import/export and a local pre-apply backup.
- Device-local Interface scale (80–140%) in Settings → Appearance, or Ctrl/Cmd `+`, `-`, `0`. This scales the entire Explorer UI, including icons/controls/dialogs; it does not change browser zoom or sync to other devices.
- Optional encrypted cross-device sync through **each user's own Dropbox**.

## Architecture and privacy

ChatGPT source conversations are **never modified**. Explorer folders and rename/remove actions affect local organization only. ChatGPT Projects remain separate source metadata. The extension reads semantic ChatGPT DOM and ordinary tab URLs; it does not call private/undocumented ChatGPT APIs or read ChatGPT cookies/tokens.

Organization is stored in extension `storage.local`. Sync sends only organizational metadata, theme and selected preferences, encrypted with AES-GCM on the device. Conversation message bodies are not exported or synced. Sync Key and Dropbox OAuth tokens are never uploaded with the workspace. No central Chat Explorer sync server or analytics is used by the default Dropbox build.

**Permission disclosure:** the current Dropbox app requests **Full Dropbox access**. Its implementation only uses `/ChatGPT Chat Explorer/chat-explorer-sync.json`, plus a read-only legacy root file during migration. This is a code restriction, not a Dropbox-enforced App Folder sandbox. The permission could allow more access if the code were changed or compromised. [Privacy details](PRIVACY.md) · [Security model](SECURITY.md).

The app key is a public application identifier. Every user authorizes their own Dropbox; data does not go to the developer's Dropbox.

## Development

Use Node.js 22.12+ or 24 LTS and npm. Browser verification of the retained legacy server harness requires Node with `node:sqlite` support.

```sh
npm ci
```

Copy `.env.example` to `.env.local` and set `VITE_DROPBOX_CLIENT_ID` to your **public Full Dropbox app key**. Never put an app secret, OAuth token, Sync Key or workspace export in build configuration. A missing key disables Connect with a configuration message; local Explorer features still work. Legacy provider variables are optional.

```sh
npm run typecheck
npm run lint
npm test
npm run build:chromium
npm run build:firefox
```

Only `dist/chromium/` and `dist/firefox/` are generated. `npm run dev` watches the Chromium build; reload the extension and reopen Explorer after changes.

### Load the extension

- Chrome / Edge: open `chrome://extensions` / `edge://extensions`, enable developer mode, load unpacked **dist/chromium**.
- Firefox / Zen (Firefox 140+): open `about:debugging#/runtime/this-firefox`, Load Temporary Add-on, select **dist/firefox/manifest.json**. Temporary add-ons disappear on browser restart; signed distribution is a separate step.
- Allow the ChatGPT site permission. Each browser profile has separate local storage. Export your workspace before removing an extension or changing its identity.

Dropbox callbacks depend on extension identity. Register the exact runtime `identity.getRedirectURL('dropbox')` in your Dropbox app. See [sync setup](docs/SYNC.md); do not copy another developer's extension IDs.

## Import limits

Import Chats traverses an already-open ChatGPT normal tab. It may visibly scroll the sidebar, temporarily open it, expand Projects and click section-scoped load-more controls. Stop preserves the unique chats found so far. Scroll, Project and sidebar state are restored where possible; navigating away prevents restoration on the new page.

This is DOM-based collection, **not guaranteed full server history**. Unexposed chats, sidebar changes, time/iteration caps and page failures can limit results. Project names are used only with semantic evidence. Import Chats does not silently substitute Import Open Tabs. [Import strategy](docs/IMPORT_STRATEGY.md).

## Dropbox sync

Settings → Sync → Connect Dropbox. An empty remote creates a new encrypted workspace and random **Sync Key**. Save the key privately using **Copy Sync Key**; it is masked until Show. If a remote workspace already exists, copy/paste its key from another connected device and review/apply it. No replacement key is generated for fresh-device onboarding. The key is not stored in Dropbox; uninstall/reinstall or a fresh browser profile may lose the local copy. Local exports/backups are plaintext and must be handled separately.

If no device or saved copy has the key, it cannot be recovered. **Reset sync using this device…** is an explicitly confirmed, destructive replacement: it backs up the local workspace, creates a new key and conditionally replaces the encrypted remote with this device’s local metadata. Remote-only data is lost, and other devices need to disconnect/reconnect with the new key. Empty local workspaces cannot reset a remote; unmigrated legacy root files must first be recovered/migrated with their old key. Short device-pairing codes are not implemented.

Sync is local-first: changes save immediately, startup checks once, five minutes of inactivity triggers a one-shot sync, and closing a dirty Explorer attempts a best-effort sync. There is no focus sync, polling or real-time service. Automatic Sync Off disables automatic attempts; Sync now remains available. Closing the browser/process cannot guarantee delivery.

Remote pulls retain backup and stale-preview checks. Conflicting edits require an explicit choice; there is no automatic merge. Offline errors preserve local changes for a later attempt. Disconnect removes this device’s Dropbox OAuth credentials and remote baseline, preserving its local workspace and Sync Key. Same-profile reconnect reuses a matching key. Change account explicitly requests Dropbox reauthentication; an incompatible key never causes a remote overwrite.

Older root `/chat-explorer-sync.json` files are migrated only when the dedicated file is absent, after key/schema validation. The legacy file is retained. Update all connected devices before migration to avoid old builds continuing to write to the old path. [Migration and conflict details](docs/SYNC.md).

## JSON files

Settings → Appearance / Data manages separate Theme and Workspace files, with a 10 MB import limit. Theme accepts only controlled color/UI tokens, not arbitrary CSS/scripts. Workspace contains folders, chat references/aliases/assignments, favorites, Project metadata and color rules; no conversation bodies or sync credentials. Import validates references/cycles, previews changes and rejects stale previews. Existing items absent from an import are retained. A pre-apply local backup can be exported.

## Verification

```sh
npx playwright install chromium
npm run test:browser
npm run test:browser:dropbox
npm run test:browser:explorer
npm run test:browser:import
```

To use an installed Edge executable, set `PLAYWRIGHT_EXECUTABLE_PATH`. Synthetic profiles/screenshots are generated in ignored `.verification/`. Tests never consume personal DOM snapshots or real account exports.

[Current verification](docs/VERIFICATION.md) separates automated synthetic checks from real-account validation. Chromium Dropbox OAuth and Chromium↔Zen round-trip sync were user-verified before this alpha cleanup; the dedicated-path migration needs a fresh real-account smoke test.

## Repository and release status

Source, synthetic tests, config, dependency locks and docs belong in the public repository. Generated builds, dependencies, profiles, `.env.local` and personal data do not. [Filesystem/public-review audit](docs/REPOSITORY_AUDIT.md).

Google Drive and Cloudflare providers remain internal/legacy with regression tests; neither is the new-user default. `sync-server/` is retained for historical tests, not a required or assumed-active deployment. [Legacy references](docs/legacy/).

No push, release, Dropbox production approval or browser-store submission is part of this preparation. A project LICENSE has **not yet been chosen**; the owner must resolve that before public distribution. [Third-party notices](THIRD_PARTY_NOTICES.md).
