> LEGACY — retained for Cloudflare regression tests only. The default Dropbox build does not use this server. The example D1 ID must be replaced before explicit deployment; no production endpoint is assumed active.

# Sync Worker

Cloudflare Worker + D1 encrypted snapshot API. See [legacy setup and security](../docs/legacy/SYNC-CLOUDFLARE.md) for configuration, migrations, local development and deployment commands.

`npm run typecheck` checks the Worker source. `npm test` uses root Vitest and Node 24 SQLite with the production migration/SQL; it is not a real D1 runtime test. Run root `npm install` first, then install this directory's Wrangler dependency to use `npm run dev` / `npm run deploy`.
