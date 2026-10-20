# Privacy — v0.1-alpha

This describes the default Dropbox build's behavior, not a legal policy or a guarantee about third-party services.

## Local data

Extension `storage.local` holds chat IDs/URLs, known titles and aliases, virtual folders, favorites, colors/names, Project metadata, theme/preferences and local workspace backups. Device-specific window state and transient UI/import state stay local. ChatGPT message bodies are not stored or synced. Explorer rename/move/remove does not change source conversations.

The extension accesses ChatGPT pages through ordinary URLs and semantic DOM. It does not read ChatGPT cookies/auth tokens or use private ChatGPT APIs.

## Optional Dropbox sync

Users connect their own Dropbox account. Organizational metadata, theme and selected preferences are encrypted with AES-GCM-256 on the device before upload. The remote JSON exposes envelope version, revision, timestamp, IV and ciphertext; network/file sizes and request timing are visible to Dropbox. It does not expose plaintext chat titles, aliases, folder/Project/color names, favorites or theme.

The OAuth app grants **Full Dropbox access** using `files.metadata.read`, `files.content.read`, `files.content.write`. The implementation limits file operations to `/ChatGPT Chat Explorer/chat-explorer-sync.json`; it reads `/chat-explorer-sync.json` only for legacy migration when necessary. No account-wide file listing occurs. This restriction is implemented in code, not enforced by an App Folder permission. Dropbox's own policies apply to its service.

Access/refresh tokens and Sync Key are device-local credentials, separate from Workspace/Theme exports and encrypted sync payloads. Tokens go only to documented Dropbox authentication/file endpoints. The Sync Key never goes to Dropbox. Users transfer it privately to other devices. If it is lost, remote encrypted data cannot be recovered by this project.

Disconnect removes local sync credentials and attempts token revocation. It does not delete the local workspace or remote encrypted file. Revocation can fail offline; users can also unlink the app in Dropbox account settings. Save the key before disconnecting if the remote workspace is still needed.

## Other transfers and exports

The default build has no central Chat Explorer sync server, analytics, telemetry or data-sale/collection endpoint. Dropbox receives the requests required for OAuth and sync. Opening chats loads ChatGPT normally. Legacy providers are retained for explicit old configurations; their historical documentation is separate.

Workspace exports, conflict exports and exported local backups contain **plaintext metadata**. Theme exports contain appearance settings. They do not include conversation content or sync credentials. Users choose where to store/share those files. Local browser profiles are not a protected secret vault: anyone controlling the profile/device may access credentials, plaintext metadata and keys.
