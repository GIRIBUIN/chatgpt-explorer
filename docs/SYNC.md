# Dropbox sync

Chat Explorer uses each user's own Dropbox account. A public app key identifies the application; data does not go to the developer's Dropbox. No sync backend or client secret is required.

## Build configuration

1. Create a scoped **Full Dropbox** app in the [Dropbox App Console](https://www.dropbox.com/developers/apps). App Folder apps are not the supported configuration.
2. Enable only `files.metadata.read`, `files.content.read` and `files.content.write`.
3. Register the exact redirect URI from each installed extension:

   ```js
   // Chrome / Edge
   chrome.identity.getRedirectURL('dropbox')
   // Firefox / Zen
   browser.identity.getRedirectURL('dropbox')
   ```

   One Dropbox app can register multiple browser callbacks. Do not copy another installation's redirect.
4. Copy `.env.example` to `.env.local` and set `VITE_DROPBOX_CLIENT_ID` to the public app key. Never add an app secret, access token, refresh token or Sync Key.
5. Run `npm run build:chromium` and `npm run build:firefox`. Missing app keys disable Dropbox connection, without disabling local organization.

Keep Firefox's `browser_specific_settings.gecko.id` stable. Chromium unpacked IDs may depend on the load path; an optional public `VITE_CHROMIUM_EXTENSION_KEY` can preserve a key-derived ID. Never supply a private signing key. Store signing, final callback registration and Dropbox production approval are separate publishing steps.

## Connect devices

- **First device, no remote workspace:** Connect Dropbox creates an encrypted snapshot and a random local Sync Key. Copy the key from Sync settings and keep a private backup.
- **Another device, existing workspace:** connect the same Dropbox account and paste that Sync Key. The extension decrypts and validates before connecting or applying changes. Review any preview/conflict before applying.
- **Same-profile reconnect:** a valid saved key is reused automatically. A wrong key never overwrites the remote workspace.

OAuth authorizes file access; the Sync Key decrypts the workspace. The key is **not stored in Dropbox**, Workspace/Theme exports or browser sync storage. Show/Copy remains available for a saved key even after disconnect. A fresh profile or uninstall/reinstall may lose local key storage. Short pairing codes are not implemented.

**Disconnect** removes OAuth credentials and connection baselines, attempts token revocation, and preserves the workspace and local Sync Key. It does not delete the remote file. **Change account** explicitly requests Dropbox reauthentication; account-specific baselines are discarded before using another account.

## Lost Sync Key

Copy it from a previously synced device, even if that device is now disconnected, or use a private saved copy. The old key cannot be recovered from Dropbox.

If no usable key remains, **Reset sync using this device…** is a separate destructive action. After explicit confirmation and a local backup, it generates a new key and replaces the encrypted remote snapshot with this device's workspace using a revision precondition. Undecryptable remote-only data is lost; other devices need the new key. Empty local workspaces cannot reset a remote. Cancel makes no changes. Legacy root files must be safely migrated before reset.

## Privacy and permissions

The OAuth grant allows **Full Dropbox access**. Application code only operates on:

```text
/ChatGPT Chat Explorer/chat-explorer-sync.json
```

It does not list or browse unrelated Dropbox files. This restriction is in code, not a service-enforced sandbox. The one legacy exception is `/chat-explorer-sync.json`, described below.

Workspace metadata, theme and selected preferences are encrypted on-device with AES-GCM-256. Conversation bodies, ChatGPT credentials, OAuth tokens, Sync Key, backups, window geometry and transient UI state are excluded. Dropbox can see envelope version/revision/timestamp, IV, ciphertext size and request timing. Exported workspace/backup JSON is plaintext metadata. See [Privacy](../PRIVACY.md) and [Security](../SECURITY.md).

## Automatic sync and safety

- Local changes save immediately.
- Automatic sync runs once on Explorer startup, five minutes after the last durable edit, and best effort on dirty Explorer close. Auto Sync Off disables these attempts. Sync now remains available.
- There is no polling or focus sync. Browser termination can interrupt close sync; subsequent startup/manual sync handles durable pending changes.
- Tokens refresh silently. Only explicit Connect/Reconnect opens OAuth. Network/auth failures preserve local data and pending changes; reconnect explicitly if required.
- Dropbox revision-conditional writes prevent stale overwrite. Pulls validate data, recheck local/remote state and save a backup before apply. True conflicts require a choice; equal semantic data does not conflict.
- Metadata-first checks avoid unchanged downloads. Synthetic steady-state file request counts are 1 for up to date, 2 for local-only changes, and 3 for remote-only changes; OAuth refresh is separate. Overlapping triggers share one active sync.

## Old root-file migration

Update all connected installations before migrating; older builds may still write to the old path. The dedicated canonical file always takes priority if both paths exist, without merging or deleting the legacy file.

If the canonical file is absent, the exact old root file can be read. Migration requires its valid key and schema, checks revisions, and conditionally creates/verifies the canonical file. The root file is retained. An established canonical connection never resurrects the old file if the canonical file disappears.

## Legacy providers and verification

Google Drive and Cloudflare implementations remain internal legacy compatibility code, with regression tests. They are not the default UI or required infrastructure. No automatic cross-provider migration occurs. Legacy server instructions live in [sync-server](../sync-server/README.md).

Chromium Dropbox OAuth and Chromium↔Zen sync were previously user-verified. Automated tests and browser scripts use synthetic accounts/API responses; they do not prove live Dropbox behavior after every build. Before distribution, check real-account reconnect, key entry, canonical-path migration, bidirectional sync and final browser identities.
