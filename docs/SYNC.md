# Dropbox sync — v0.1-alpha

Dropbox is the default provider for Chrome/Edge and Firefox/Zen. Users authorize **their own Dropbox account**. A public app key identifies the application; it does not route data to the developer's account. No backend, app secret or Dropbox desktop client is required.

## Current permission and file boundaries

Use a scoped **Full Dropbox** application, not an App Folder app. The current development App Folder integration was abandoned after Dropbox-side failures; it is not the supported setup.

Required scopes: `files.metadata.read`, `files.content.read`, `files.content.write`. No account/team/sharing scopes. Full Dropbox permission is broad: the service grant can cover the user's Dropbox. Application code limits file operations to one canonical file:

```text
/ChatGPT Chat Explorer/chat-explorer-sync.json
```

`DROPBOX_FOLDER` / `DROPBOX_PATH` in `src/sync/dropbox.ts` define the location. No directory listing, arbitrary file browser, remote delete or user-file traversal exists. Dropbox upload creates required parent directories; the implementation never lists Dropbox to locate them. A read-only legacy-root exception is described below. This code restriction is **not** a Dropbox-enforced sandbox.

## App Console and build setup

1. In [Dropbox App Console](https://www.dropbox.com/developers/apps), create a scoped app with **Full Dropbox** access.
2. Enable only the three scopes above. Register exact redirect URIs returned by each installed extension's `identity.getRedirectURL('dropbox')`. Multiple browser callbacks can use one app key. Do not reuse a developer's example extension ID without checking your installation.
3. Copy `.env.example` to ignored `.env.local`; set `VITE_DROPBOX_CLIENT_ID` to the public app key. Never set an app secret, generated access token, refresh token or Sync Key in the build environment.
4. Build `npm run build:chromium` and `npm run build:firefox`. Missing app key disables Connect and leaves local features usable.
5. Before broader distribution, separately review Dropbox development-user limits/production approval and final browser-store extension IDs. No app approval or store submission is performed by the project build.

Both browser families use runtime `identity.getRedirectURL('dropbox')` and `identity.launchWebAuthFlow`. Inspect the exact callback from the installed extension context:

```js
// Chromium; Firefox/Zen uses browser.identity.
chrome.identity.getRedirectURL('dropbox')
```

Keep the configured Firefox `browser_specific_settings.gecko.id` stable. Changing it changes the derived callback. The current explicit development ID is retained to avoid invalidating working connections; the publisher must choose/check its final signed identity before store release. Chromium unpacked IDs can depend on load path; an optional **public** `VITE_CHROMIUM_EXTENSION_KEY` preserves the intended key-derived ID. Never use a private signing key. Register each actual development/production callback; no hardcoded personal redirect is used by the auth adapter.

## OAuth lifecycle

Connect/Reconnect is an explicit user action. Authorization uses code flow, PKCE S256, random 256-bit verifier/state, exact callback/state validation and `token_access_type=offline`. Token exchange sends app key, code, verifier, redirect URI and grant type. It sends **no client secret**.

Access token, refresh token and expiry are stored only in extension `storage.local`. A valid token is reused; expiry within 60 seconds triggers silent refresh. A rejected API token is invalidated and silently retried once. Background startup/idle/close never starts interactive consent. Revoked/invalid credentials require explicit Reconnect. Temporary network/429/5xx failures report temporary unavailability and preserve local changes. There is no aggressive retry loop.

Disconnect removes Dropbox OAuth tokens and remote connection baselines before best-effort revoke. It preserves the device-local Sync Key (including a pending first-connection key). Revoke failure cannot block local disconnect. It does not delete remote data or local workspace. Same-profile reconnect reuses the saved key; a fresh profile requests it. A key left in a legacy Dropbox connection is validated independently of its revision/cache; even invalid-connection cleanup preserves that remaining key before deleting the connection record. A valid interrupted-upload draft is also available for Show/Copy and automatic reconnection. Reads never generate a replacement key. Disconnect is not key deletion. Lost-key reset is a separate confirmed replacement, described below.

Normal Connect/Reconnect may reuse the Dropbox web session. **Change account** (or **Connect another account** after disconnect) adds `force_reauthentication=true` to the same PKCE flow. The OAuth token response account ID is stored device-locally to detect account changes, but is not displayed raw in normal Settings and needs no additional scopes. Before accepting a different or unverified account token, the old sync baseline is removed under the sync network lock. A saved key that cannot decrypt the new account’s remote prompts for a correct key without changing that remote or the retained key. A replacement key is retained only after a validated preview is applied (or identical data is acknowledged).

## New workspace, existing workspace and lost keys

- No remote: create the first encrypted workspace with a random key (an interrupted creation may reuse its local draft). A key belonging to another local workspace is not used to initialize a fresh remote.
- Existing remote + matching saved key: validate automatically and reuse the key. Normal same-profile reconnect does not ask again.
- Existing remote + no/wrong key: show **Existing synced workspace found** and a **Paste Sync Key** input. Obtain the key from Sync settings on another connected device. No candidate key or remote write is generated just for onboarding. Decryption and schema validation precede any key replacement/connection; divergent metadata still uses the existing preview/conflict choices.
- Key controls are masked by default, with explicit **Show Sync Key** and **Copy Sync Key** (Copy does not require Show). A retained key remains available under **Saved Sync Key on this device** even after disconnect or while a new connection asks for a key. A mismatched saved key is marked as belonging to a different workspace or older key; displaying/copying it does not make it valid for the current remote. Uninstall/reinstall or a new browser profile may remove local key storage. The key is never stored in Dropbox. No short pairing codes are implemented.

### Explicit lost-key reset

The old key cannot be recovered. When an encrypted canonical remote exists and this device has a nonempty valid local workspace but no usable key, **Reset sync using this device…** offers a read-only review. It warns about loss of remote-only data and the need for other devices to disconnect/reconnect with a new key. A separate checkbox and destructive confirmation are required; Cancel generates no key and makes no mutation.

Confirmation rechecks the local payload hash, OAuth session/account and remote version. It completes the existing local workspace backup before generating a new key and issuing a rev-conditional update of the canonical file. No blind overwrite or new filename is used. Changed previews, failed backups and stale revisions abort. The authoritative upload response becomes the new baseline; the old confirmed key is replaced only after success. A local draft protects the new key if Dropbox accepts an upload but its response is lost; reconnect can validate that draft without another overwrite. Edits made during the upload remain local and dirty against the uploaded snapshot.

Empty local workspaces cannot reset a remote. An unmigrated legacy root file cannot be reset by this path: atomically checking both an old root and a new canonical file is unavailable, so the existing key-validated migration must happen first. The old key, if later found, cannot decrypt the replacement. There is no automatic remote history/rollback provided by this reset.

## Sync Key and encryption

Google/Dropbox authorization and the Sync Key have different roles: OAuth permits file access; the key decrypts the workspace. Use the same private Sync Key on all devices. **It is not stored in Dropbox and cannot be recovered by this project.** It is excluded from remote payloads and Workspace/Theme exports.

Web Crypto AES-GCM-256, fresh random 12-byte IVs and the existing stable AAD/key format are retained. Uploaded JSON contains only:

```json
{"formatVersion":1,"revision":1,"updatedAt":1790000000000,"iv":"base64url","ciphertext":"base64url"}
```

Ciphertext contains folders, chat IDs/URLs, known title references/aliases, favorites, assignments, colors/names, Project metadata, theme and selected preferences. It excludes conversation bodies, OAuth credentials, Sync Key, backups, window geometry and transient UI/import state. Envelope timestamp/revision, ciphertext size and traffic timing are not hidden. Plaintext exported workspaces/backups require separate care.

## Scheduling and safety

Local-first behavior is unchanged: save immediately; startup checks once; the last durable mutation schedules one alarm five minutes later; dirty Explorer close makes a best-effort attempt; Sync now runs immediately. Auto Sync Off disables all automatic attempts. There is no polling, focus sync or real-time service. Browser/process shutdown may interrupt close sync; startup recovers from durable local state.

Fresh `FileMetadata.rev` drives metadata-first checks. Up to date skips content. Downloads validate the exact response metadata. Within a transaction, checked metadata and downloaded/decrypted data are reused. Conditional upload uses `mode={".tag":"update","update":"expected rev"}`, `strict_conflict=true`, `autorename=false`; first creation uses `mode=add`. No blind overwrite or conflicted-copy mode is used. Authoritative upload metadata becomes the baseline. Single-flight/Web Locks and at most one follow-up handle overlapping triggers and edits during sync.

Steady-state file-request counts under the synthetic API: up to date **1** metadata; local-only **2** (metadata + conditional upload); remote-only **3** (metadata + download + pre-apply metadata). OAuth refresh and initial connection/migration are separate. No cross-sync metadata cache conceals remote edits.

Remote application validates decrypted schema, rechecks remote/local versions and creates the existing local backup before apply. Equal semantic data reconciles baseline without a false conflict. True divergence keeps explicit Use this device / Use remote / Export both / Cancel. Network, decrypt or validation failures do not apply remote data or fake a successful baseline.

## Legacy root-file migration

The old location was `/chat-explorer-sync.json`. **Update all connected installations before migration**; older builds continue using their old path and are not coordinated with the new path.

- Look for the dedicated canonical file first. If present, use it without reading, merging or deleting the legacy file. Do not choose files by timestamp or revision.
- If absent and this connection has no canonical baseline, look for the exact legacy root path. Discovery without a key can request the existing Sync Key, but cannot migrate.
- With credentials, download and decrypt the legacy snapshot, validate the shared payload schema, recheck its revision, and conditionally create the dedicated file. Copy the encrypted payload, retaining its application revision. Verify the saved canonical metadata and recheck the legacy revision. Preserve the root file.
- Racing migration/create/write fails safely; a dedicated file is never overwritten to complete migration. If legacy changed during migration, both files remain for explicit review; do not delete either to suppress the error. There is no atomic two-path transaction across clients still using the old path.
- Successful canonical baselines include the path in device-local remote-version state. Future connected syncs never fall back to an old root snapshot if the canonical file is later removed. Reconnect is required for a missing canonical file; no resurrection of stale data.
- New file creation refuses to replace a discovered legacy workspace with a newly generated key. Invalid/wrong-key legacy data leaves local state and both files untouched.

## Other devices and previous providers

Connect the same Dropbox account, paste the existing Sync Key copied from another connected device and review/apply with backup. Different nonempty local/remote workspaces use conflict choices; identical data connects without conflict.

[Google Drive](legacy/SYNC-GOOGLE-DRIVE.md) and [Cloudflare](legacy/SYNC-CLOUDFLARE.md) are retained internal/legacy providers with regression tests. Existing connections keep routing until explicitly disconnected. No legacy remote data is deleted or automatically copied between services. Disconnect locally, then connect Dropbox to initialize from current local metadata. Optional legacy env variables do not configure a new-user provider picker or an assumed-active central server.

## Verification boundary

**User-verified before alpha cleanup:** Full Dropbox PKCE OAuth, Chromium connection/read-write, Chromium↔Zen round-trip with the same account/key. Current automated tests use synthetic Dropbox HTTP responses and isolated browser profiles. They verify protocol contracts, migration, tokens, encryption, backup/conflict, UI and request counts; they do not establish new live consent or cloud writes. Dedicated-folder creation/migration and post-cleanup Chromium↔Zen smoke remain manual checks. See [verification](VERIFICATION.md).

Official references: [Dropbox OAuth/PKCE/offline guide](https://developers.dropbox.com/oauth-guide), [secret-less code/refresh and redirect registration](https://docs.dropboxapi.com/dropbox-api/docs/get-started/authorization), [official file schema: parent-folder writes, rev and strict_conflict](https://github.com/dropbox/dropbox-api-spec/blob/main/files.stone), [token revoke](https://github.com/dropbox/dropbox-api-spec/blob/main/auth.stone), [Mozilla identity](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/identity), [Chrome identity](https://developer.chrome.com/docs/extensions/reference/api/identity).
