# Convoary Privacy — v0.1-alpha

This describes the default Dropbox build's behavior, not a legal policy or a guarantee about third-party services.

## Local data

Extension `storage.local` holds chat IDs/URLs, known titles and aliases, virtual folders, favorites, colors/names, Project metadata, theme/preferences and local workspace backups. Device-specific window state and transient UI/import state stay local. ChatGPT message bodies are not stored or synced. Convoary rename/move/remove does not change source conversations.

The extension accesses ChatGPT pages through ordinary URLs and semantic DOM. It does not read ChatGPT cookies/auth tokens or use private ChatGPT APIs.

## Optional Dropbox sync

Users connect their own Dropbox account. Organizational metadata, theme and selected preferences are encrypted with AES-GCM-256 on the device before upload. The remote JSON exposes envelope version, revision, timestamp, IV and ciphertext; network/file sizes and request timing are visible to Dropbox. It does not expose plaintext chat titles, aliases, folder/Project/color names, favorites or theme.

The OAuth app grants **Full Dropbox access** using `files.metadata.read`, `files.content.read`, `files.content.write`. The implementation limits file operations to `/ChatGPT Chat Explorer/chat-explorer-sync.json`; it reads `/chat-explorer-sync.json` only for legacy migration when necessary. No account-wide file listing occurs. This restriction is implemented in code, not enforced by an App Folder permission. Dropbox's own policies apply to its service.

Access/refresh tokens and Sync Key are device-local credentials, separate from Workspace/Theme exports and encrypted sync payloads. Tokens go only to documented Dropbox authentication/file endpoints. The Sync Key never goes to Dropbox. Users transfer it privately to other devices. If it is lost, remote encrypted data cannot be decrypted by this project. Uninstall/reinstall or a fresh browser profile may remove local key storage; copy/paste the key from another connected device or a private saved copy.

Disconnect removes local Dropbox OAuth credentials and connection baselines, preserves the device-local Sync Key, and attempts token revocation. It does not delete the local workspace or remote encrypted file. Revocation can fail offline; users can also unlink the app in Dropbox account settings. Reconnecting in the same browser profile reuses the saved key. A fresh profile still needs the key. Changing accounts uses explicit Dropbox reauthentication; the returned account ID is stored locally for detecting account changes, never shown raw in normal Settings or included in synced metadata. An incompatible key prompts for the correct key without overwriting remote data.

Lost-key reset is a separate destructive action, never automatic: after explicit confirmation and a local backup, a fresh key encrypts this device’s current workspace and replaces the canonical encrypted Dropbox snapshot using a revision precondition. Remote-only data that cannot be decrypted is lost. Other devices must disconnect/reconnect with the new key. Empty local workspaces are blocked from resetting a remote. The new key is device-local; an interrupted reset may retain a device-local draft key for validating a successful-but-unacknowledged upload. Short pairing codes are not implemented.

## Other transfers and exports

The default build has no central Convoary sync server, analytics, telemetry or data-sale/collection endpoint. Dropbox receives the requests required for OAuth and sync. Opening chats loads ChatGPT normally. Legacy provider code is retained for explicit old configurations.

Workspace exports, conflict exports and exported local backups contain **plaintext metadata**. Theme exports contain appearance settings. They do not include conversation content or sync credentials. Users choose where to store/share those files. Local browser profiles are not a protected secret vault: anyone controlling the profile/device may access credentials, plaintext metadata and keys.
