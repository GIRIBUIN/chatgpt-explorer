# v0.1-alpha verification — 2026-10-20

## Scope and baseline

The current repository baseline was **420 passing tests**, not the older recorded 364. Alpha cleanup adds dedicated Dropbox path/legacy migration, accurate Full Dropbox/key/error copy, safe recovery categories, local-file exclusion and reproducible browser tooling. Import algorithms, encryption/payload protocol and automatic-sync policy were not redesigned.

Version: package `0.1.0-alpha.1`, browser manifests `0.1.0` (numeric extension format).

## Final checks

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | **436 PASS**, 24 files: 428 extension/shared + 8 legacy server |
| Added tests | **16**; all 420 existing tests retained |
| `npm run build:chromium` | PASS |
| `npm run build:firefox` | PASS |
| `npm run typecheck --prefix sync-server` | PASS |
| `npm test --prefix sync-server` | **8 PASS**; already included in root total, not added twice |
| Dropbox-only public config manifests | PASS, no Google OAuth/Google/Cloudflare hosts when optional legacy env is absent |
| Dist layout | Only `chromium/` and `firefox/` at root |
| Ignore-rule / npm pack dry-run audit | PASS; 133 npm candidate files, 0 excluded-path violations; 135 Git-ignore-filtered source candidates |
| Source/config security scan | No real credential-like literals/private keys/personal paths detected; synthetic test tokens are intentional. Candidate whitespace/conflict-marker audit: 0 issues |
| Git tracked/staged/history/whitespace checks | UNAVAILABLE: this directory has no `.git`; no repository was initialized |

Node prints an experimental `node:sqlite` warning for the retained server harness. This is not an authentication/network test or a real deployed D1 test.

## Synthetic browser verification

Run with an installed Edge executable through `PLAYWRIGHT_EXECUTABLE_PATH`, or install Playwright Chromium with `npx playwright install chromium`. Playwright is a normal root devDependency; ignored `.verification/tools` is not required. All generated profiles/screenshots remain ignored.

- `npm run test:browser:dropbox`: PASS. Isolated extension UI profiles with fake documented Dropbox endpoints: Full access disclosure, disconnected/connected copy, PKCE/offline token issuance, encrypted dedicated-path creation, Sync Key/preview/Apply/backup, equal/nonempty first-connect behavior, bidirectional profile push/pull, refresh, conflict/explicit resolution, Disconnect/revoke and validated legacy-root migration. No live Dropbox account was used.
- Steady-state file API counts: up to date **1**; local-only **2**; remote-only **3**. No content download on unchanged metadata, no listing/unrelated file operations. OAuth refresh counted separately.
- `npm run test:browser:explorer`: PASS. Selection/input guards, F2/context-menu inline rename, Enter/Esc/blur, double-click, color dot, Project/color/search, palette, Theme JSON, Workspace validation/preview/stale rejection/backup, 10 MB limits, persistence and narrow/light/dark layout; no page errors.
- `npm run test:browser:import`: PASS. MV3 ping/injection, direct scroll, repeated load-more, progress reset/increment/dedup, Stop partial merge, alias/favorite/Project name preservation, sidebar/Project/scroll restoration, no temporary tabs, SPA click/full-navigation fallback and color naming.
- `npm run test:browser`: PASS. Comprehensive synthetic DOM/general/Project import, Stop/re-run, Open/default/new-tab/new-window and complete browser-restart persistence. Old synthetic browser-window initial navigation could precede routing and hit a Chrome error page; re-navigation after attachment now keeps the fixture isolated. Its virtual fixture also lacked a bottom-row neighbor and UTF-8 declaration; those fixture errors were corrected without weakening collection/name assertions. Product Import behavior was not changed to accommodate a test.
- Settings Sync screenshot at 500px was inspected: same existing rows/descriptions/buttons, wrapped actions, accurate Full Dropbox and key guidance. No native file input was introduced. Existing native modal focus/Esc behavior and visible CSS focus outlines remain. The tree folder icon is now decorative (`aria-hidden`) so its button accessible name is the folder name, consistent with list rows.

Unit regression adds wrong-key/invalid-schema migration rejection, legacy retention, canonical priority, missing-canonical no-resurrection, conditional-create protection, fixed-path-only access, provider-local path-marker exclusion, transient OAuth failures and safe background recovery categories. Existing startup/idle/close/manual/OFF/single-flight/stale/conflict/encryption tests remain.

## Actual account verification boundary

**VERIFIED — user-reported before alpha cleanup:** Chromium Full Dropbox OAuth, actual remote read/write and Chrome/Chromium↔Zen round-trip with the same Dropbox account and Sync Key.

**UNVERIFIED after this change:** new dedicated-folder creation, root-file migration and fresh real-account Chromium↔Zen smoke. Synthetic Edge profiles are not real Chrome↔Zen account validation. Standard signed Firefox/AMO identity and final store callbacks also require human checking. No production approval, deployment, release or store submission was performed.

Manual smoke checklist:

1. Export local Workspace/Sync Key privately; update all connected installations before migrating paths.
2. Reconnect/Sync now; verify `/ChatGPT Chat Explorer/chat-explorer-sync.json` in the user's Dropbox. Legacy root remains, never auto-deleted.
3. Verify Chrome edit/push → Zen startup/pull, then reverse; check the same key, backup, true conflict and semantic equality.
4. Verify token expiry/refresh, revoked access/reconnect, temporary Dropbox failure/offline dirty retention, five-minute idle and best-effort dirty-close behavior.
5. Review Full Dropbox grant, final extension identity/redirect registration, project LICENSE and private security reporting before distribution.

## Repository cleanup boundary

[Root-by-root audit](REPOSITORY_AUDIT.md) documents every item, include/exclude decisions and legacy source references. Recursive deletion of `.verification/` and `tmp/` was rejected by execution policy; their contents remain local and ignored, not candidate public artifacts. The agent did not bypass that rejection or print private snapshot/env contents.

Older provider/account/fixture investigations and historical test totals are preserved under [legacy verification history](legacy/VERIFICATION-HISTORY.md), not presented as current release evidence.
