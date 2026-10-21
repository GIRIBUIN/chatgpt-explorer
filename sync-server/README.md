# Legacy Cloudflare sync server

Retained for compatibility and regression tests. The default Dropbox extension does **not** use this server, and no production endpoint is assumed active. Current sync instructions: [Dropbox](../docs/SYNC.md).

The Worker stores sync ID, hashed bearer token, revision, encrypted blob and timestamp in D1. Keys never go to the server. Conditional SQL updates reject stale revisions. Do not log credentials or request bodies.

## Local development

Install root dependencies first. From this directory:

```sh
npm ci
npm run typecheck
npm test
npx wrangler d1 migrations apply chat-explorer-sync --local
npm run dev
```

Tests use the Worker handler and a Node 24 SQLite adapter, not a deployed D1 instance. To build a legacy client, set `VITE_SYNC_PROVIDER=cloudflare` and `VITE_SYNC_ORIGIN=http://127.0.0.1:8787` in root `.env.local`. Only loopback development origins allow HTTP; remote origins require HTTPS.

## Optional deployment

Only if intentionally maintaining a legacy server:

```sh
npx wrangler login
npx wrangler d1 create chat-explorer-sync
# Replace the example database_id in wrangler.jsonc with the returned UUID.
npx wrangler d1 migrations apply chat-explorer-sync --remote
npm run deploy
```

Keep the `DB`, migration-directory and `RATE_LIMITER` bindings. Configure the deployed HTTPS origin in the legacy client build. Review Cloudflare limits and authentication before deployment; none of these commands is needed for Dropbox sync.
