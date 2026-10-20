> Historical / legacy reference. Not the default v0.1 sync setup. See [current Dropbox sync](../SYNC.md).

# Legacy/internal Cloudflare sync

Retained for compatibility and regression testing. The default provider is now Dropbox; see [current sync setup and live-verification limitations](../SYNC.md). Build this legacy UI with `VITE_SYNC_PROVIDER=cloudflare` and `VITE_SYNC_ORIGIN`.

Settings → Sync uses a self-hosted Cloudflare Worker + D1. There is no periodic polling, account system, sharing, telemetry, or ChatGPT API access. Low-frequency automatic sync is described below.

## Data and security

- A version-1 payload contains Workspace JSON (folders, conversation IDs/URLs, original title reference, aliases, folder/color assignments, favorites, Project metadata, color names/order), Theme JSON, and open/sort/startup preferences.
- Conversation bodies, ChatGPT credentials/cookies, runtime import state, selection, search, dialogs, window bounds, local recent timestamps, backup history and sync credentials are excluded.
- Web Crypto AES-GCM-256 encrypts each snapshot with a new random 12-byte IV. AAD binds the sync ID and format version. The encryption key never goes to the Worker.
- D1 stores only sync_id, SHA-256 auth_hash, revision, encrypted_blob and updated_at. The server can see identifiers, ciphertext size and request timing, but cannot decrypt metadata without the Sync Code. Transport uses HTTPS.
- Sync Code is base64url JSON: version, syncId, authToken, encryptionKey and configured origin. Each credential is generated independently using 32 random bytes. **Anyone with the code can read and replace this sync workspace. Keep it private.** There is no key recovery service.
- Credentials are kept in extension local storage, separately from Explorer state. Workspace/Theme exports never include them. Show sync code is explicit; secrets are not logged.
- Maximum plaintext snapshot: 700,000 UTF-8 bytes; encrypted envelope: 1,000,000 bytes; server request body: 1,010,000 bytes. This MVP uploads a complete snapshot, not deltas.
- Server CORS permits extension origins, requires bearer authentication, and rejects malformed bodies and revisions. Conditional SQL updates prevent blind overwrites. Worker logging is disabled; do not add request-body or Authorization logging.
- Rate limiting is 30 requests/minute per IP per Cloudflare location. It is basic abuse mitigation, not a global quota or comprehensive public-service abuse prevention. Configure Cloudflare account limits before public deployment.

## Using two devices

1. Build/install each extension with the same configured Worker origin.
2. PC A: Settings → Sync → Enable Sync. This uploads the encrypted current snapshot, revision 1.
3. Show sync code; privately transfer it to PC B.
4. PC B: Connect Existing → paste code → review changes → Apply. Nothing is replaced before Apply. A local workspace backup is saved first.
5. Automatic sync checks once on Explorer startup and five minutes after the last durable edit. Click Sync now whenever you want to synchronize immediately. Unchanged/unchanged is a no-op; local-only changes push; remote-only changes pull; changes on both devices show a conflict.
6. Choose Use this device, Use remote, Export both, or Cancel. Export both produces decrypted metadata JSON for your private comparison, without credentials or bodies. There is no automatic merge.

Sync applies a **complete organization snapshot**, including removal of local Explorer entries absent remotely. This never deletes ChatGPT conversations. Unlike merge-only Workspace JSON import, sync needs replacement semantics to propagate folder/chat removals. Use remote always saves the previous full local state through the existing backup system. Settings → Data can export the latest backup. A backup-write failure prevents apply.

Before Connect/Conflict Apply, both the current canonical local payload hash and latest server revision must still match the preview. Otherwise regenerate the preview. PUT atomically checks expectedRevision and increments it; concurrent writers receive HTTP 409. Changes made locally during an upload remain detectable on the next sync.

Disconnect removes only this device's sync credentials. It preserves Explorer metadata and the remote snapshot. There is no remote delete or remote backup history in this MVP. Keep the Explorer window open until a manual operation completes; after an interrupted request, run Sync now again. A failed first Enable response can leave an unreachable encrypted workspace on the server.

## Cloudflare setup (run yourself; not deployed by this project task)

Prerequisites: Node 24+, npm, Cloudflare account. Root dependencies are required for tests.

```powershell
npm install
cd sync-server
npm install
npx wrangler login
npx wrangler d1 create chat-explorer-sync
```

Copy the returned database UUID into `sync-server/wrangler.jsonc` → `d1_databases[0].database_id`. Keep the `DB` binding, migration directory and RATE_LIMITER binding.

```powershell
npx wrangler d1 migrations apply chat-explorer-sync --local
npm run dev
# Separate terminal, before production deploy:
npm run typecheck
npm test
npx wrangler d1 migrations apply chat-explorer-sync --remote
npm run deploy
```

After deployment, put the actual origin (no path) in root `.env.local`:

```dotenv
VITE_SYNC_ORIGIN=https://chat-explorer-sync.YOUR-SUBDOMAIN.workers.dev
```

```powershell
cd ..
npm run build:chromium
npm run build:firefox
```

Load `dist/chromium` in Chrome/Edge; load `dist/firefox/manifest.json` in Firefox/Zen. The generated manifests grant only the configured origin plus the existing ChatGPT origin. No endpoint is configured by default: Sync controls explain that a build configuration is needed. Firefox requests the declared optional website-content/authentication-data collection consent before network sync. Firefox/Zen real-browser consent and sync still require manual verification.

For local development, set `$env:VITE_SYNC_ORIGIN='http://127.0.0.1:8787'` in PowerShell, then run both `npm run build:chromium` and `npm run build:firefox` in that same shell. Both targets read the same environment variable. HTTP is accepted only for exact localhost, 127.0.0.1 and [::1] loopback hosts; remote production origins require HTTPS. Mode-specific `.env.chromium.local` / `.env.firefox.local` may differ, so prefer a shared `.env.local` or shell variable. Rebuild with the actual HTTPS Worker origin before distributing.

## Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run build:chromium
npm run build:firefox
npm run typecheck --prefix sync-server
npm test --prefix sync-server
```

Server/client tests execute the Worker handler and real SQLite SQL through a small D1 interface adapter. This checks conditional updates and integration, but is **not** a deployed Cloudflare/D1 runtime test. Wrangler local migrations/dev were also verified through the actual extension network path; production and Firefox/Zen smoke tests remain separate.

The optional `scripts/verify-sync-browser.mjs` requires the same Playwright installation as existing browser scripts. Build Chromium with `VITE_SYNC_ORIGIN=https://sync.example.com` for this test only. It routes that exact synthetic origin into the Worker+SQLite harness in two isolated Edge profiles, checks Enable/Connect preview/Apply, push/pull, conflict/backup, hidden code and Disconnect. It does not contact a production server or use a signed-in ChatGPT account. Rebuild without the test origin afterwards.

Official references: [D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [Worker rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [Firefox data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

### Local verification notes (2026-10-19)

`npm run dev` invokes the declared local Wrangler devDependency. Run `npm install --prefix sync-server` first; root `npm install` alone does not install this separate package. A working cached `npx wrangler` does not mean the package-local executable is installed. This agent environment denied registry access (EACCES); local verification used cached Wrangler 4.151.1 on the process PATH. No dependency was replaced with a global/cache-specific path in source.

To run the existing browser suite against a real local Worker instead of the routed test harness, build both targets with the loopback origin and set `SYNC_TEST_ORIGIN=http://127.0.0.1:8787` before `node scripts/verify-sync-browser.mjs`. Keep `npm run dev` running. The final local builds currently target that loopback endpoint; an absent server correctly causes a network error. Both bundles and manifests include the identical endpoint. These are development artifacts, not a deployed sync service.

## Low-frequency automatic sync

Automatic sync defaults **On** for connected devices, including existing connections. Settings → Sync → Automatic sync can turn it Off without disconnecting; Sync now remains available. This setting and all dirty/deadline/error/conflict state are device-local in `explorerAutoSync`, outside Workspace/Theme/sync exports.

Allowed automatic requests are limited to:

- one check when a new Explorer document starts (not when it receives focus);
- one attempt after the last durable syncable edit has been idle for five minutes.
- one best-effort flush when the Explorer popup closes, only if Automatic sync is On and local changes remain dirty.

There are no periodic alarms, polling, focus requests, WebSockets or retry daemon. Storage saves happen first. The canonical versioned sync payload hash determines whether a mutation is relevant. Aliases/folders/favorites/colors/color names/Project metadata/theme and synced preferences count; selection/search/filter/dialog/import progress/window bounds do not. Repeated edits move the same one-shot alarm deadline. Chromium and Firefox share the existing `webext()` namespace adapter and require the `alarms` permission.

Dirty state and the last-change/deadline are persisted. Worker initialization/browser startup restores missing scheduling without making a startup network request itself. An alarm rechecks connection, enabled state, dirty state and elapsed idle time before calling the unchanged `SyncClient.now()`. Browser sleep/throttling can delay an alarm; it is not a five-minute real-time guarantee. If the worker terminates mid-attempt, the next Explorer startup, new edit or Sync now can retry. There is no periodic recovery loop.

A failed startup/idle attempt retains local data/dirty/error and clears its deadline. A failed close flush preserves its existing idle deadline instead of inventing a retry alarm. Startup, another durable edit or Sync now can also retry. Turning Off clears the alarm and disables startup, idle and close sync; an already-started request may complete. A successful manual operation clears pending work if its saved baseline matches the current payload. Edits during an upload remain dirty and get a later deadline.

Automatic conflicts preserve both sides, persist a pending-conflict flag and deliver the existing conflict preview to an open Explorer. Open Settings to choose Use this device / Use remote / Export both / Cancel. If the Explorer was closed, the next startup refreshes the preview; with Auto Sync Off, use Sync now to review it. No side is automatically selected.

Manual and automatic operations use the same encryption, conditional revision protocol, stale-preview checks and backup-before-pull adapter. Same-origin Web Locks exclude concurrent network syncs and serialize short storage writes across Explorer/worker contexts. Network waits happen outside the write lock; immediately before a pull write, local state and credentials are compared again. An intervening local edit rejects that pull rather than overwriting it. Existing Import algorithms are unchanged.

Firefox automatic attempts only inspect previously granted data-collection permissions; they never request permission without a user gesture. Use manual Sync now if consent is needed.

Verification: `node scripts/verify-auto-sync-browser.mjs` uses the same configured origin/Playwright prerequisites as the manual suite. It advances only synthetic persisted timestamps, then fires a real one-shot browser alarm, rather than changing the five-minute production delay. Actual Edge profiles tested A→B and B→A automatic push/startup pull, backup, conflict/no-overwrite, Off and manual sync. This is not an automated Firefox/Zen validation.

API references: [WebExtension alarms](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/alarms), [Web Locks](https://www.w3.org/TR/web-locks/).

### Best-effort Explorer close flush

The background `windows.onRemoved` handler checks the Explorer popup identity, also recorded in session storage to survive worker suspension. It does not respond to arbitrary browser-window closure, React unmount, focus, or a beforeunload fetch. A normal browser window containing an Explorer tab is not registered as an Explorer popup.

Close sync requires a connected workspace, Automatic sync On, and dirty state. Automatic attempts are single-flight; manual/automatic network operations share the existing Web Lock. Under that lock the close path rechecks the canonical payload hash against the synced baseline before any GET, so a just-completed manual sync does not cause another request. A clean local snapshot does not pull remote-only changes on close; the next startup handles them. Changed snapshots use the existing revision/conflict pipeline, backup and stale checks.

Success clears dirty and the pending idle alarm. Failure preserves local metadata, the true synced baseline and any existing idle deadline. Conflict stays pending for the next Explorer startup/Settings review; no modal is forced onto a closing window. Closing never waits for sync or asks for confirmation. Browser/process termination can interrupt or prevent the hook entirely: this is **not a delivery guarantee**. Startup and five-minute idle sync remain necessary safety nets.

`scripts/verify-close-sync-browser.mjs` validates real popup window removal, two-way close push/startup pull, clean-close zero requests and close/alarm coalescing in isolated Edge profiles. Use the same test-origin/build configuration as the other sync suites. It is not a Chrome↔Zen production-account test.

