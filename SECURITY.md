# Convoary Security — v0.1-alpha

## Reporting a vulnerability

Do not put tokens, Sync Keys, personal workspaces or exploitable details in a public issue. Use the repository's private vulnerability reporting channel if enabled. If unavailable, ask the maintainer for a private reporting method without including the sensitive details. A monitored security email has not been established yet.

## Model and limitations

- The default provider is each user's own Dropbox. There is no required Convoary sync backend.
- Dropbox OAuth uses authorization code + PKCE S256, random verifier/state and exact redirect validation. No client/app secret is bundled. The app key is public; it is not an OAuth token.
- Access/refresh tokens stay in extension local storage. Background token refresh is silent; only explicit Connect/Reconnect opens authorization. A failed request keeps local data/dirty state, without aggressive retries.
- Workspace snapshots use Web Crypto AES-GCM-256, a fresh random 12-byte IV and stable AAD. Tokens and Sync Key are excluded from remote payloads and Workspace/Theme exports.
- Dropbox `rev`-conditional uploads (`strict_conflict=true`, `autorename=false`) reject stale writes. Local hash/remote-version validation and backup-before-pull protect application of stale previews. There is no automatic conflict merge.
- Full Dropbox OAuth permission is broader than the application's dedicated-path behavior. A malicious or compromised extension with this grant could access more Dropbox files. Code confinement is not a service-enforced sandbox.
- Encryption does not protect against a compromised device/browser profile, stolen Sync Key, malicious extension update, plaintext exports, denial of service or all rollback attacks. Envelope metadata and traffic sizes/timing are visible. There is no remote backup history or key-recovery service.
- Close sync is best effort; process termination may prevent completion. Local storage plus startup/idle/manual sync remain the recovery mechanisms.

## Repository handling

Never commit `.env.local`, OAuth tokens, app/client secrets, Sync Keys, personal snapshots/exports, browser profiles or token dumps. Public OAuth app keys/client IDs may appear in an installed build but examples must contain no personal values. Generated `dist/`, dependencies, coverage, logs and verification artifacts are ignored.

Use only synthetic fixtures. Keep dependency locks and third-party notices. Do not enable a legacy Cloudflare deployment merely to run the default Dropbox extension. Review permissions, final extension identities/redirects, production app approval, repository license and the private reporting channel before public distribution.
