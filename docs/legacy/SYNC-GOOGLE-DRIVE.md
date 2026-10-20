> Historical / legacy reference. Not the default v0.1 sync setup. See [current Dropbox sync](../SYNC.md).

# Google Drive sync (legacy)

Google Drive is a retained legacy provider. The default is now [Dropbox dedicated-folder sync](../SYNC.md). Existing Google connections retain their provider and remote data; explicit legacy builds use `VITE_SYNC_PROVIDER=google-drive`. `SyncClient` still owns encryption, canonical hashes, push/pull/conflict decisions, preview validation and backup. `AutoSync` still owns startup, five-minute idle and best-effort Explorer-close scheduling. There is no polling, focus sync, automatic merge or ChatGPT API access.

**Implementation status:** Chromium uses Chrome Extension OAuth through chrome.identity.getAuthToken(). Firefox/Zen retain a separate PKCE adapter. Local tests use a synthetic Google HTTP/identity contract; real account authorization and stale-ETag rejection still require live validation. Do not treat mock success as Google certification. The existing Cloudflare provider/server remain available; nothing was migrated or deleted remotely.

## Storage and privacy

Only `https://www.googleapis.com/auth/drive.appdata` is requested. No email/profile or full Drive scope is requested. Discovery uses `spaces=appDataFolder` and the exact file name `chat-explorer-sync-v1.json`. A private `application=chat-explorer-sync-v1` property validates ownership/schema. An unmarked matching file or multiple candidates is rejected rather than arbitrarily selected.

Drive API v2 is used because its File resource explicitly exposes `etag` alongside the server file `version`. The application accesses only its app-data file, not ordinary user files. The remote JSON is:

```json
{
  "formatVersion": 1,
  "revision": 1,
  "updatedAt": 1790000000000,
  "iv": "base64url-random-12-bytes",
  "ciphertext": "base64url-AES-GCM-ciphertext"
}
```

The encrypted payload reuses Workspace/Theme validation and contains folders, chat IDs/URLs, original title reference, aliases, assignments, favorites, color names/order, Project metadata, theme and selected preferences. Bodies, ChatGPT cookies/tokens, selection/search/dialogs/import progress, device window bounds, local recent times, sync credentials and backup history are excluded. Metadata names/values are never plaintext upload fields.

Each snapshot uses AES-GCM-256 and a new random 12-byte IV. The Sync Key is versioned base64url JSON containing only `version` and a random 256-bit `encryptionKey`. A key-derived local identifier binds existing AES-GCM AAD; it is not sent as a Cloudflare ID/auth token. Google account access grants access to ciphertext; the separately transferred Sync Key enables decryption. Neither the key nor the token is included in Workspace/Theme exports. Keep the key private and recoverable: there is no key recovery service.

Chromium tokens use the native identity cache, including expiry handling; they are not persisted as plaintext extension-local tokens. Firefox tokens and the Sync Key use separate extension-local storage records. These are not encrypted against someone who controls the local browser profile. A temporary creation key is retained locally if the first upload response is lost, so reconnect can preview that remote with the same key. Disconnect clears local sync credentials, OAuth token and this pending key, while preserving workspace and remote data.

## OAuth and setup

### Chromium / Chrome

1. Enable Google Drive API in Google Cloud and configure the consent screen/test users with only `drive.appdata`.
2. Create an OAuth client of application type **Chrome Extension**, associated with the extension ID shown in `chrome://extensions`. This is not a Web Application OAuth client. No authorized HTTPS redirect is configured by this implementation.
3. Put its public client ID in `VITE_GOOGLE_CLIENT_ID_CHROMIUM`. The build injects `manifest.oauth2.client_id` and the single appdata scope. No client secret variable exists.
4. Explicit Settings Connect/Reconnect calls `chrome.identity.getAuthToken({interactive:true})`. All Drive operations and background attempts use `interactive:false`. The extension never directly posts to Google's token endpoint in a Chromium build.

Chrome caches tokens and handles expiration. On a Drive 401, remove that cached token, acquire non-interactively once and retry the same request once. A second 401 invalidates the rejected token and requires Reconnect. No timer retry or login prompt is added to background sync. Disconnect clears this extension's identity cache and local connection/token draft state, without deleting Drive data or revoking the Google account remotely.

**Edge limitation:** do not equate Chromium engine compatibility with Google identity support. Microsoft documents `identity.getAuthToken` as unsupported in Edge. The adapter does not fall back to implicit grant or direct code exchange. Unsupported hosts fail without changing the workspace. Synthetic Edge testing mocks Chrome identity and is not evidence of real Edge Google login support.

### Stable development ID / production

Without a manifest public `key`, the unpacked ID depends on the load path; moving the checkout or loading another output directory can change it. No extension ID is hardcoded. Keep loading the same absolute `dist/chromium` path and confirm the ID after reload. To pin a published extension's ID across paths, optionally set `VITE_CHROMIUM_EXTENSION_KEY` to its public manifest key (from the Chrome Web Store package/dashboard). Never supply a private signing key. Adding a different public key changes the ID and requires a matching OAuth client. Do not invent a key for the existing development ID.

For production, replace the Chromium client ID with a Chrome Extension OAuth client associated with the final Web Store extension ID. Dev/prod IDs are config only, not source constants.

### Firefox / Zen

The separate Firefox adapter retains `identity.launchWebAuthFlow`, authorization code, S256 PKCE, exact redirect/state validation and direct token exchange without a bundled secret. Its client ID is `VITE_GOOGLE_CLIENT_ID_FIREFOX`, but its Google client/redirect/code-exchange compatibility remains unverified. Merely registering the result of `identity.getRedirectURL('google')` does not establish secret-less Google token exchange. Official Mozilla loopback handling plus a separate Google Desktop public client is a conditional candidate requiring a real Google exchange before changing the adapter. A Chrome Extension client ID must not be reused here. Expired Firefox tokens require explicit reconnect; automatic attempts never open interactive auth. See [Firefox/Zen feasibility and measured redirects](FIREFOX_GOOGLE_OAUTH_FEASIBILITY.md).

The old shared `VITE_GOOGLE_CLIENT_ID` is no longer read, so a web client cannot accidentally become the Chromium manifest client.

```powershell
$env:VITE_GOOGLE_CLIENT_ID_CHROMIUM='CHROME_EXTENSION_CLIENT.apps.googleusercontent.com'
$env:VITE_GOOGLE_CLIENT_ID_FIREFOX='SEPARATE_FIREFOX_CLIENT.apps.googleusercontent.com'
npm run build:chromium
npm run build:firefox
```

Load `dist/chromium` / `dist/firefox/manifest.json`. Missing target client ID disables Connect. Only Chromium emits `oauth2`; only Firefox grants the Google token endpoint host. Both grant identity and the exact Drive API host patterns, with no broad HTTPS scope/permission. Neither build contains a client secret.

## Connecting devices

- First device: Settings → Sync → Connect Google Drive. If no app file exists, encrypt and create the current workspace. Show Sync Key and transfer it privately.
- Other device: Connect Google Drive with the same account/project; enter the same Sync Key. Existing remote data always goes through decrypt → schema validation → preview → Apply, with local backup first.
- Reconnect renews OAuth authorization. It does not regenerate the encryption key or blindly replace existing state.
- Sync now runs immediately. Automatic sync defaults On: once per Explorer document startup, after five minutes since the last syncable edit, and on dirty Explorer popup close. Auto Sync Off disables all three automatic paths. Close is best effort, not a delivery guarantee.
- Offline/expired-token failures retain local changes and the true revision/hash baseline. There is no retry daemon. Retry by explicit Sync now/Reconnect, next startup, or another edit followed by the idle deadline.

## Concurrency and safety

The baseline includes the app revision and an opaque token composed of file ID, strong ETag and Google file version. Local canonical hash versus last synced hash and remote token versus last synced token retain the existing four-way decision. Both changed yields the existing conflict UI: Use this device / Use remote / Export both / Cancel.

Every write requires the exact prior token, checks the remote baseline, and sends `If-Match` with the strong file ETag on the media PUT. HTTP 412 maps to the existing conflict path. Missing/weak ETag fails closed. The upload response acknowledges the encrypted document and server file version; one targeted metadata GET then verifies that the same file/version is still current and supplies the canonical ETag (upload representation ETags can differ). This uses Drive's documented monotonically increasing version, which reflects every file change, rather than downloading the just-uploaded bytes again. Media downloads do not send a metadata ETag as `If-Match`; identical metadata queries before/after the download detect concurrent changes. Preview Apply rechecks local hash and remote version with fresh metadata, reusing the already validated payload only when the remote token matches; storage apply rechecks local state after network waits and saves backup before replacement.

### Request reuse

The existing device-local remote token persists the Drive file ID. A new worker/provider can use that ID directly without another appDataFolder search. A cached-ID 404 clears the in-memory ID and performs one discovery; the next successful baseline stores the replacement ID. Only the ID is retained across syncs: each sync still checks fresh metadata. An unchanged token requires no media download. Changed remote contents are downloaded once, with metadata checks around the download and immediately before apply to preserve stale protection.

Checked metadata is reused by the conditional PUT only within the active network operation, then discarded. Calls using the same local store in one extension context share a single Drive Sync Now promise; the existing extension-origin Web Lock also excludes overlapping UI/worker operations. Local edits during that operation allow at most one follow-up; further edits remain dirty for the normal idle alarm. No render/focus/polling trigger is added. Cloudflare uses its existing path.

Measured HTTP counts in fake-Drive unit tests and the two-profile synthetic Edge extension test (not live Google measurements):

| Steady state | Before | After | After breakdown |
| --- | ---: | ---: | --- |
| Up to date | 4 | 1 | 1 metadata GET |
| Local-only change | 13 | 3 | metadata GET, conditional PUT, verification metadata GET |
| Remote-only change | 8 | 4 | metadata GET, media GET, metadata GET, pre-apply metadata GET |

No steady-state row performs files.list. Remote pull retains the extra metadata checks for concurrent remote changes and stale preview protection; it downloads media only once. Initial connect, actual contention, 404 recovery and OAuth retries can require additional requests.

**Concurrency qualification:** the official v2 File resource documents ETag/version; Google's performance guide discusses conditional patch/ETag behavior in general, but does not explicitly guarantee atomic `If-Match` for this exact media upload path. This implementation sends the strongest available precondition and verifies afterwards; it does not claim that post-verification closes every race if Google ignores the precondition. A live test must capture a stale upload receiving 412 and verify the winning ciphertext stayed unchanged. Do not weaken the guard or advertise atomic CAS until that passes. First creation also has no unique-name transaction: simultaneous first-device creation can leave two files; later discovery refuses to proceed, with no automatic delete/merge.

## Legacy compatibility

Cloudflare code is retained as `CloudflareProvider` (`SyncApi` compatibility export), with existing tests/server/credentials intact. Existing Cloudflare connections route to that provider. Internal legacy builds use `VITE_SYNC_PROVIDER=cloudflare` plus the existing `VITE_SYNC_ORIGIN`. No credentials or remote snapshots are automatically converted. To switch, export/backup, disconnect locally, then connect Drive. See [legacy Worker/D1 setup](SYNC-CLOUDFLARE.md). Default Drive builds only keep the Cloudflare host permission if an explicit legacy origin is configured. No production deployment was performed.

## Verification required

Automated synthetic tests cover encrypted discovery/create/read/update, missing token, malformed/multiple files, preconditions, network/auth failure, PKCE/state/redirect validation, both namespaces, existing SyncClient preview/push/pull/conflict/stale protection, backup and AutoSync startup/idle/close/off/recovery. They do not contact Google.

Before releasing: real Chrome↔Zen OAuth/code exchange, shared appDataFolder across browser clients, creation and key recovery, stale-ETag 412/no overwrite, two-way startup/idle/close, conflict choices, expired-token reconnect without a background prompt, Disconnect without deletion. Test on a disposable account/workspace first.

Official sources: [Drive app data](https://developers.google.com/workspace/drive/api/guides/appdata), [v2 File ETag/version](https://developers.google.com/workspace/drive/api/reference/rest/v2/files), [Drive upload](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [Drive patch/ETag discussion](https://developers.google.com/workspace/drive/api/guides/performance), [Google PKCE/installed clients](https://developers.google.com/identity/protocols/oauth2/native-app), [Google web code exchange](https://developers.google.com/identity/protocols/oauth2/web-server), [Firefox identity](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/identity).

