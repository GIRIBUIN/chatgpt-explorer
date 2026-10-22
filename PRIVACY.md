# Convoary Privacy Policy

Last updated: October 21, 2026

Convoary, maintained by GIRIBUIN, organizes, searches and reopens ChatGPT conversation links. This policy covers its local-first operation and optional Dropbox sync.

## Data accessed and stored locally

When you use Add Current Chat, Import Open Tabs or Import Chats, Convoary reads conversation URLs/IDs and titles from matching tabs or ChatGPT's rendered interface, plus available Project names/IDs. Import can open/scroll the sidebar, use load-more controls and traverse Projects; opening a chat clicks its existing link or navigates to its URL. It does not rename, move or delete source conversations or Projects.

Browser APIs can return metadata for other tabs while locating ChatGPT tabs. Nonmatching records are filtered out, not retained as browsing history. Display work areas are used for window placement, not tracking or sync.

Extension-local storage holds:

- Conversation links/IDs, titles/original titles, aliases and local added/last-opened timestamps.
- Virtual folders, hierarchy, pins, favorites, colors/labels and Project metadata.
- Theme, preferences, filters/navigation settings, interface scale and window bounds.
- Workspace/migration/recovery backups, sync baselines, pending-change/error state and scheduling information.
- Dropbox credentials and the Sync Key described below. Temporary window identifiers use extension session storage.

Titles and aliases may themselves contain personal information. Convoary does not collect or store message bodies, prompts, responses or attachments. It does not read ChatGPT cookies, passwords or authentication tokens, use private ChatGPT APIs, record keystrokes, or separately request payment details, precise location or unrelated browsing history.

## Optional Dropbox sync

You authorize your own Dropbox account; data does not go to the developer's Dropbox. Before upload, Web Crypto AES-GCM-256 encrypts workspace metadata, theme and selected opening/sorting/startup preferences on-device, with a fresh random IV for each snapshot.

The encrypted workspace contains folders, chat IDs/URLs, titles/aliases, assignments, favorites, colors/names and Project metadata. It excludes message bodies, OAuth credentials, Sync Key, backup history, window/display settings, interface scale, selection, search input and import progress. Dropbox receives an encrypted snapshot and OAuth/file requests. It can see the envelope's format version, revision, timestamp, IV and ciphertext, file paths/sizes, request timing and ordinary connection information such as your IP address.

Automatic sync runs on Explorer startup, five minutes after the last durable change and best effort on dirty window close. It can be disabled; Sync now remains available. There is no polling/focus sync. Failures preserve local changes. Pulls save a local backup; conflicts require a user choice.

### Dropbox permission and file location

The OAuth grant allows **Full Dropbox access**, using `files.metadata.read`, `files.content.read` and `files.content.write`. Code limits file operations to `/ChatGPT Chat Explorer/chat-explorer-sync.json`, plus read access to `/chat-explorer-sync.json` for legacy migration. These names remain for compatibility. No unrelated Dropbox files are listed or browsed. This code restriction is **not a Dropbox-enforced folder sandbox**.

## OAuth credentials and Sync Key

Dropbox access/refresh tokens, expiry and account ID stay in extension-local storage. Tokens are sent only to Dropbox authentication/file endpoints, not included in the encrypted workspace or exports. Only explicit Connect/Reconnect/Change account opens authorization; background refresh does not open login. Convoary does not request your Dropbox password or additional profile/email scopes.

The Sync Key encrypts/decrypts your workspace. It stays local, is never uploaded to Dropbox or included in Workspace/Theme exports, and is not placed in browser sync storage or logged. Show/Copy requires your action; Copy writes it to your system clipboard. Keep a private copy and use the same key on each device. Fresh profiles/reinstalls may need it from another previously synced device or saved copy. An entered key is validated before acceptance; a wrong key does not overwrite remote data. Interrupted uploads/resets may retain a local draft key for recovery.

**Disconnect Dropbox** removes OAuth tokens and active connection baselines, attempts revocation, and preserves your workspace and Sync Key. A previous account ID may remain locally for account-change detection. Offline revocation can fail; you can also unlink the app in Dropbox settings. Reconnect reuses a valid saved key. **Change account** requests reauthentication, discards the previous baseline and tests the retained key; an incompatible remote requires the correct key.

## Lost-key reset

Convoary cannot recover a lost key from Dropbox. **Reset sync using this device** requires explicit confirmation and a nonempty local workspace. It saves a local backup, generates a new key and conditionally replaces the encrypted remote with this device's workspace. Undecryptable remote-only data is lost; other devices need the new key. Reset never happens automatically.

## Exports, retention and deletion

Workspace/conflict exports and exported backups contain **plaintext metadata**. Conflict exports can include theme/syncable preferences; backups include local app settings. Theme exports contain appearance settings. These exports exclude message bodies, OAuth credentials and Sync Keys. You control where exported files are saved/shared; Convoary does not upload them automatically.

Local data stays in the profile until changed/removed or extension storage is cleared/the extension removed. Removed records may remain in local backups, prior exports or remote snapshots. Disconnect/uninstall does not delete Dropbox files or exports; uninstall may remove the local key. You can remove remote files in Dropbox; its own retention/version-history policies apply.

## Sharing, services and security

Convoary has no developer-operated sync server, analytics, telemetry, advertising, automated remote crash reporting or data sale. Data use/transfer is limited to the features described here, not AI training. Diagnostic warnings may appear locally in the browser console without automated reporting.

Normal ChatGPT page loads/interactions are handled by OpenAI under [its privacy policy](https://openai.com/policies/privacy-policy/); optional authorization/sync uses [Dropbox](https://www.dropbox.com/privacy). GitHub handles visits or messages to project/support pages under its policies. Convoary does not control those services' independent practices.

Encryption does not protect a compromised device, stolen key or plaintext export. Local storage is not an encrypted secret vault: someone controlling your profile/device may access metadata and credentials. Dropbox still sees the envelope/connection metadata described above.

## Contact and updates

For privacy questions, contact GIRIBUIN through the [project issues](https://github.com/GIRIBUIN/convoary/issues). Do not post keys, tokens or personal exports publicly; follow [Security](SECURITY.md) for vulnerability reports. Policy changes will appear here with an updated date.
