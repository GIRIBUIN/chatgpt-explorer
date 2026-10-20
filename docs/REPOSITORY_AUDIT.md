# v0.1-alpha public repository review

Audit date: 2026-10-20. Scope: dedicated Dropbox path/migration, accurate Full Dropbox disclosure, safety/copy cleanup, reproducible verification and public-file boundaries. No feature expansion, auto-push, release, store submission or Dropbox production approval.

## Root classification

Every current top-level item is listed below. KEEP means public source/config/documentation, not a command to stage it.

| Path | Decision | Reason |
| --- | --- | --- |
| `.verification/` | KEEP BUT GITIGNORE | Generated profiles/screenshots/logs/cache and obsolete one-off local experiments. Browser scripts now use declared root Playwright; they only need this directory as an output location. Recursive removal was rejected by execution policy, so old local artifacts remain excluded. |
| `dist/` | KEEP BUT GITIGNORE | Generated Chromium/Firefox builds; only these two target directories belong here. Generate release artifacts later. |
| `docs/` | KEEP | Current sync/import/verification documentation; historical provider/research/verification documents separated under `legacy/`. |
| `node_modules/` | KEEP BUT GITIGNORE | Installed dependencies, reproducible from lockfile. |
| `public/` | KEEP | Only the used source manifest remains; `scripts/manifest.ts` consumes it. |
| `scripts/` | KEEP | Manifest generator plus reusable synthetic browser checks; see inventory below. |
| `src/` | KEEP | Runtime application and preserved provider implementations. |
| `sync-server/` | LEGACY - REVIEW REQUIRED | Cloudflare Worker/D1 is not needed by default runtime, but its handler/harness is exercised by unit and browser regression tests. Keep source, migrations, config and lock; ignore nested dependencies/Wrangler state. Actual D1 ID and duplicate remote binding removed. |
| `tests/` | KEEP | Synthetic fixtures/unit tests, including valuable Google/Cloudflare regression contracts. No personal snapshots copied here. |
| `tmp/` | KEEP BUT GITIGNORE | Three private reference HTML snapshots, not runtime/test inputs. Requested physical cleanup was blocked by execution policy. Remove manually if no longer needed; never publish. |
| `.env.example` | KEEP | Empty public identifiers/default provider only; legacy variables explicitly optional. No secret values. |
| `.env.local` | KEEP BUT GITIGNORE | Local build configuration. Contents never printed; not a public file. |
| `.gitignore` | KEEP | Local env, generated artifacts, dependencies, coverage, logs/profiles and root personal-export patterns excluded; `.env.example` and synthetic fixtures preserved. |
| `eslint.config.js` | KEEP | Used by lint. |
| `explorer.html` | KEEP | Explicit Vite runtime entry. No rename needed. |
| `package-lock.json` | KEEP | Root dependency versions/integrity, including declared browser-test tooling. |
| `package.json` | KEEP | Private package, v0.1.0-alpha.1, builds/checks/browser commands. |
| `PRIVACY.md` | KEEP | Technical data handling/permission disclosure. |
| `README.md` | KEEP | Public alpha scope, setup, privacy, limitations and release boundaries. |
| `SECURITY.md` | KEEP | Encryption/token model, limitations and private-reporting guidance. |
| `THIRD_PARTY_NOTICES.md` | KEEP | Preserved design-reference provenance and dependency license guidance. |
| `tsconfig.json` | KEEP | Used by typecheck. |
| `vite.config.ts` | KEEP | Target build/manifests and optional provider configuration. |

`LICENSE` is absent. No project license or copyright holder was invented. The owner must choose one before public distribution. No `.git` directory exists here: `git status`, `git ls-files`, `git check-ignore` and `git diff --check` cannot inspect tracking/staging/history. No repository was initialized and nothing was added/committed/pushed. Re-run those checks after the owner establishes the intended Git repository.

## Script/source references before cleanup

- `manifest.ts`: imported by Vite and manifest tests — KEEP.
- `verify-browser.mjs`: `npm run test:browser`, shared Explorer/import/window restart checks — KEEP. Its Project fixture and ambiguous row menu selector were aligned with current semantic contracts; browser-created synthetic windows now re-navigate after Playwright attaches routing, avoiding an unintended real network/error page. The semantic virtual fixture now renders its bottom intersecting row and declares UTF-8; decorative folder icons are hidden from accessible names. Runtime parser behavior is unchanged.
- `verify-explorer-browser.mjs`, `verify-import-browser.mjs`, `verify-dropbox-browser.mjs`: root browser scripts and documented current regression checks — KEEP.
- `verify-drive-browser.mjs`: retained Google synthetic regression; requires explicit legacy Google build — KEEP.
- `verify-sync-browser.mjs`, `verify-auto-sync-browser.mjs`, `verify-close-sync-browser.mjs`: retained Cloudflare/coordinator legacy verification; import the server harness and require the documented explicit legacy build — KEEP.
- All eight browser scripts import root `playwright` and create ignored `.verification/` output as needed. No script needs `.verification/tools` or its one-off scripts. The existing Playwright version/lock metadata was moved to root devDependencies, not upgraded. npm validated the resulting lockfile offline.
- No runtime/test reads `tmp/*.html`. The remaining `tmp` references are comments asserting synthetic-only fixtures, not filesystem reads.
- No unused public assets existed to remove. One unreferenced synthetic fixture (`chatgpt-virtual-sidebar.html`) was removed after searching source/tests/scripts/docs. The remaining six HTML fixtures have browser-script references; retained Google/Cloudflare tests still run.
- Historical Google/Cloudflare setup and Firefox feasibility docs moved to `docs/legacy/`. Previous verification history is retained there, clearly separate from current results.

## Security/file checks

Publication-source text scan found no private key blocks, long credential-like literals, personal absolute paths or personal development OAuth IDs in intended source/config/docs. Synthetic token strings exist in tests by design. OAuth app keys/client IDs are public identifiers, not secrets. `.env.local` was inspected only for credential-variable-name alerts; no contents/values were printed.

No runtime `console.log` was present. Three useful import debug statements are now development-only; bounded operational warnings/errors remain. No token/key logging or telemetry was introduced. The legacy Wrangler config now has an all-zero example D1 ID and no remote-enabled extra binding; no central production endpoint is assumed.

Ignore rules were checked with the installed Git-ignore-compatible parser: local env/generated/profile/export paths are excluded, `.env.example` and fixtures remain included. This is **not** a claim that `git check-ignore` succeeded in a nonexistent repository. npm pack dry-run also verified no local env, tmp/profile/node_modules/dist/log paths in its candidate files; no package was published. `private: true` remains.

Builds use explicit source entries and do not read tmp/private snapshots. Default Dropbox-only public builds were checked without optional Google/Cloudflare config: no Google OAuth/host or Cloudflare host permission. A local optional legacy client/origin can deliberately add its permissions; review the generated manifest before distribution.

## Final root tree

```text
.verification/                  ignored local/generated
 dist/                          ignored generated
   chromium/
   firefox/
 docs/
   legacy/
 node_modules/                  ignored dependencies
 public/
 scripts/
 src/
 sync-server/                   retained legacy regression
 tests/
   fixtures/
 tmp/                           ignored private references
 .env.example
 .env.local                     ignored local
 .gitignore
 eslint.config.js
 explorer.html
 package-lock.json
 package.json
 PRIVACY.md
 README.md
 SECURITY.md
 THIRD_PARTY_NOTICES.md
 tsconfig.json
 vite.config.ts
```

## Human review before publication

1. Establish the intended Git repository; inspect `git status --short`, `git ls-files`, `git check-ignore .env.local`, `git diff --check`, and history before the first push. Ensure no local/generated/private path was force-added.
2. Choose LICENSE/copyright and enable a private vulnerability reporting channel/contact.
3. Manually remove `.verification/` old artifacts and `tmp/` private snapshots if no longer needed (automated recursive cleanup was rejected). They remain ignored meanwhile.
4. Update every connected installation, then live-test dedicated-path creation/root migration, Chromium→Zen and Zen→Chromium, reconnect/expiry, startup/idle/close and real Dropbox errors. Existing user-verified round-trip predates this path change.
5. Verify final extension IDs, exact Dropbox callbacks, Full Dropbox permission disclosure and production-user approval separately. No store/release/deployment action has been performed.

**READY FOR GITHUB PUBLIC REVIEW: YES** — source/UI/documentation and exclusion rules are prepared for human review. This is not permission to push, a completed Git history audit, a distribution-license decision or a claim of new real-account verification.
