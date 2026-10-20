# v0.1-alpha verification — 2026-10-20

## Scope and baseline

The current repository baseline was **420 passing tests**, not the older recorded 364. Alpha cleanup adds dedicated Dropbox path/legacy migration, accurate Full Dropbox/key/error copy, safe recovery categories, local-file exclusion and reproducible browser tooling. Import algorithms, encryption/payload protocol and automatic-sync policy were not redesigned.

Version: package `0.1.0-alpha.1`, browser manifests `0.1.0` (numeric extension format).

## Final checks

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | **456 PASS**, 26 files: 448 extension/shared + 8 legacy server |
| Added tests | **36** since the 420-test cleanup baseline (3 icon + 17 UI-preference tests added in later tasks); original tests retained |
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


## UI hierarchy / folder colors / interface scale — 2026-10-20

- Baseline entering this task: 439 tests. Added 17 tests; current total **456** (448 extension/shared + 8 retained server). Earlier alpha counts above are historical to that cleanup.
- Ordinary Settings actions are text-only; status, warning/error and security icons remain. Navigation/main toolbar stay icon + text; Sort's visible label is removed while its accessible label remains.
- Optional folder `color` uses a separate decoration editor with shared HEX swatches, independent of chat colorRules. Shared FolderIcon renders yellow default or custom-color fill, retaining name/selection theme colors. Workspace/sync preserve the optional field; old JSON without it still imports. Update connected installations before sharing colored-folder metadata because older strict validators do not know the new optional field.
- Interface scale is optional local `explorerState.settings.uiScale`, validated at 80/90/100/110/120/130/140. Existing documents without the field retain 100% without a migration. Workspace/Theme exports and sync preferences exclude scale; incoming sync retains the local scale.
- Root `--ui-scale` uses CSS zoom, not browser zoom API. Viewport/modal bounds and fixed-menu pointer coordinates account for scale. A document capture listener handles Ctrl/Cmd +/-/0 even in inputs/dialogs, preserving ordinary edit/selection shortcuts.
- `node scripts/verify-ui-preferences-browser.mjs` / `npm run test:browser:preferences`: synthetic Edge PASS at 500/900px and 80/100/140%. Checked independent folder editor/shared HEX swatches, nested/selected icons, persistence, Settings buttons, modal/document bounds, input/textarea/contenteditable shortcuts and unchanged browser native zoom. Narrow command bars keep their existing internal horizontal scroll; long tree names truncate with ellipsis.
- Existing Explorer, Import and Dropbox synthetic browser regressions PASS. No new live Dropbox/ChatGPT or native Firefox/macOS verification is claimed. Source sync coordination, provider, crypto and Import algorithms are unchanged.


## Folder color / favorite correction — 2026-10-20

- Folder decoration edits only `Folder.color`; normalization no longer adds folder HEX values to chat colorRules. Existing rules remain intact. Workspace and encrypted Dropbox round trips accept independent folder HEX values.
- The folder dialog contains HEX swatches, custom picker, optional HEX entry and Reset to default; chat label/name/shared-rule editing remains chat-only.
- FolderIcon always uses a filled icon: default yellow or the stored custom color. A common trailing favorite button serves nested tree folders and list folders/chats, with filled gold status, accessible toggle names/pressed state and hover/focus outlines when inactive. `--favorite-color` has light/dark values.
- Added 5 tests: **461 passing** (453 extension/shared + 8 legacy server); typecheck, lint, Chromium/Firefox builds and diff whitespace check PASS.
- Synthetic Edge preferences smoke PASS: independent custom HEX persistence with unchanged chat rules, nested trailing alignment, chat action placement without row selection, hover/focus reveal, light/dark favorite tokens, and 80/100/140% layouts at 500/900px. Screenshots inspected in light/dark. Existing Explorer, Import and Dropbox synthetic regressions PASS. No real-account Dropbox/ChatGPT or native Firefox/Zen verification was performed for this correction.


## Folder/chat row hover correction — 2026-10-20

- Removed native folder name titles. A shared TruncatedName component measures actual ellipsis overflow and shows a theme-styled tooltip after 600ms only for clipped names. Row/button keyboard focus is reused; Escape, blur, pointer leave, scrolling and resizing dismiss/cancel it. Tooltip position accounts for local UI scale.
- Folder tree/list hover uses a subtle neutral row token, without name/icon recoloring. Selected blue backgrounds win over hover. Existing reserved favorite slots and custom folder colors remain unchanged.
- Synthetic Edge preferences PASS for normal/hover/selected/selected+hover in both tree and list, delayed truncated folder/chat tooltips, no tooltip for complete names, favorite hover/focus and stable label/control positions. Explorer UX regression PASS. No native Firefox/Zen verification claimed.
- Final checks: 462 tests PASS (454 extension/shared + 8 retained server), typecheck/lint PASS, Chromium/Firefox builds PASS, git diff whitespace check PASS.


## Ctrl+A main-view selection — 2026-10-20

- Ctrl/Cmd+A listens on the Explorer document, including fresh body focus, without requiring an existing item selection. It uses only the current visibleItems and retains the previous first-visible-item anchor policy. Other row/click/navigation handlers remain unchanged.
- Text inputs, textarea and actual contenteditable editing retain native Select All. Modals/palette retain their existing shortcut boundary. Focused filter selects permit selecting main-view items; other keyboard shortcuts still retain their prior select guard.
- Synthetic Edge Explorer verification covers no prior selection, existing selection, Inbox/Folder/Favorites, search/color/project filtering, empty results, native search/inline rename/modal input Select All, and Ctrl/Shift click/rename/Open regressions.
- Final automated checks: 463 tests (455 extension/shared + 8 legacy server), typecheck, lint and Chromium/Firefox builds PASS. Native Firefox/Zen behavior was not directly tested.


## Folder pins / chat favorites — 2026-10-20

- Folder metadata uses optional `pinned`, with no runtime folder favorite field. Root and nested sibling groups use the existing name/direction ordering inside pinned/unpinned groups. Pins never reparent or hoist nested folders. Home shows folders under Folders, and Favorites contains chats only.
- Tree/list folder actions use trailing IconPin/IconPinFilled, inherited foreground, no favorite/gold color; chat star controls are unchanged. Hover/focus reveals unpinned outlines without shifting labels. Context-menu/palette folder actions now pin/unpin; chat Favorite commands affect chats only.
- Local legacy `favorite` migrates to `pinned` and removes the old field after preserving `migrationBackupFolderPins`. Explicit pinned=false wins. Legacy Workspace/sync input is accepted and normalized; new export/sync contains only pinned for folders. Update connected installations together because older strict schema readers do not recognize pinned.
- Added 9 tests: **472 passing** (464 extension/shared + 8 legacy server). Covers root/nested/multiple pin ordering, descending/unpin ordering, idempotent backed-up migration, optional field validation, Workspace/sync round trips and unchanged chat stars. Dropbox regression checks pin and unpin propagation with independent folder colors.
- Typecheck/lint, Chromium/Firefox builds and diff whitespace check PASS. Synthetic Edge preferences, Explorer, Import and Dropbox browser regressions PASS, including actual root/nested UI pin order, selected foreground, trailing alignment, persistence, chat-only Favorites and unchanged chat favorite display. No fresh real-account Dropbox or native Firefox/Zen run is claimed.


## Folder main pane / chat-only filters — 2026-10-20

- Existing direct-child collection, folders-first rendering and shared sidebar/row navigation were already present. The final project/color-filter branch incorrectly cleared all folders. Removed that branch; chat filters now leave child folders visible. Existing global text/structured search scope and folder-name matching remain unchanged.
- Folder rows keep colored icons, empty Color cells, em-dash Last opened and trailing pin/menu controls. Pin groups use existing folder ordering; chats retain their sort. No items appears only when both visible groups are empty. Ctrl+A uses the combined visible list.
- Audited mixed selection: Move validates destinations for every selected folder, and confirmed Remove retains existing folder reparent/Inbox semantics. Folder/chat color editors have distinct meanings, so mixed Color actions are disabled in context menu/palette and guarded before opening.
- Added 3 tests: **475 passing** (467 extension/shared + 8 retained server). Typecheck/lint, Chromium/Firefox builds and diff whitespace check PASS.
- Synthetic Edge preferences covers folders-only/chats-only/mixed/empty views, direct-vs-descendant boundaries, pins, ascending/descending chat order, chat-only filters, folder cells/actions, combined Ctrl+A, mixed Color guard, nested double-click/Enter, and unchanged global folder search. Existing Explorer UX smoke PASS. Native Firefox/Zen UI and live accounts were not tested for this correction.


## Multi-item folder drag/drop — 2026-10-20

- HTML drag carries an ID-only batch: an existing selected source uses all visible selected movable items; an unselected source becomes a single-item selection. Covered descendants travel inside their selected ancestor rather than being flattened. No drag-specific state is persisted or synced.
- Sidebar folder rows (including collapsed targets) and main-pane folder rows share drop validation and existing moveItem metadata updates. Entire batches are revalidated inside the existing storage lock against fresh state. Missing/self/descendant/system targets are rejected; same-parent-only drops are no-ops, while already-placed members of a meaningful batch are skipped. No partial save on failure.
- Existing valid/invalid target outlines are reused; a small status badge reports item count. Selection remains highlighted during native drag, clears after successful save without automatic navigation, and survives drag cancellation. Existing context-menu/palette Move remains available. Hover auto-expand is intentionally omitted to avoid adding collapse-state/timer behavior in this correction.
- Added 18 unit/integration tests: **493 passing** (485 extension/shared + 8 retained server), including preserved aliases, original titles, favorites, colors, project metadata, pins and nested children; Workspace and encrypted Dropbox round trips retain changes.
- Typecheck/lint, Chromium/Firefox builds and git diff whitespace check PASS. New `npm run test:browser:drag` uses native mouse/HTML drag in isolated Edge with synthetic metadata: 3 chats/main target, unselected-only/collapsed sidebar target, 2 folders/nested destination, mixed batch, Ctrl+A, live count/selection, invalid self/descendant/same-parent/system drops, and Escape cancellation PASS. Existing Explorer/preferences/Import/Dropbox browser regressions PASS. No native Firefox/Zen drag or fresh real-account Dropbox verification is claimed.


## Empty-surface / marquee selection — 2026-10-20

- Pointer Events/capture starts only on the main pane/list/empty-state background, excluding row descendants, headings, native scrollbar bounds and controls. Plain empty click clears selection, right-click/modifier clicks preserve it. A 4px viewport threshold separates click from rectangle selection; row starts retain native multi-drag.
- The rectangle uses the theme accent border/10% fill with pointer-events:none. Intersection candidates are current visible item keys rendered as main rows, never sidebar/hidden/filter-excluded items. Plain marquee replaces selection; Ctrl/Cmd is additive (not toggle), preserving a valid anchor. Escape/pointer cancellation restores the original selection. Navigation/view changes end the gesture; normal navigation and successful move clearing remain intact. A pending empty press still clears if inline rename blur-save reorders the view before mouse-up.
- Coordinates convert client positions and row bounds into main content coordinates using CSS zoom plus scroll offsets. Edge auto-scroll is intentionally omitted; manual wheel scrolling updates intersection/rectangle selection during capture. The first selected row receives keyboard focus after release, reusing existing Enter/arrow/rename behavior.
- Added 10 unit tests: **503 passing** (495 extension/shared + 8 retained server). Final typecheck/lint, Chromium/Firefox builds and git diff whitespace check PASS.
- New `npm run test:browser:marquee`: native synthetic Edge Pointer Events PASS for 4-chat and mixed rectangles, plain clear, row/header/toolbar/input/favorite/pin/right-click exclusions, threshold, replace/additive Ctrl+Cmd, filtered rows, Escape, scrollbar/wheel behavior, inline rename blur-save race, and rectangle-to-native 4-chat/mixed drag. Verified rectangle bounds at 80/100/140%, inspected light/dark screenshots. Existing native drag, Explorer and preferences regressions PASS. No native Firefox/Zen or live-account verification was performed for this selection-only change.


## Sidebar F2 inline rename — 2026-10-20

- F2 resolves a focused sidebar user-folder row before considering main selection; Home/Favorites/Inbox/FOLDERS and text editing are excluded. The existing rename state has a UI surface marker, so exactly one shared InlineRename is rendered. Sidebar context-menu Rename uses that surface too, without parent navigation or filter reset.
- Same InlineRename/renameItem/commit path for Enter, Escape, blank-name handling and blur saves; no new persistence or sync schema. Current folder/ancestor labels update sidebar, breadcrumb and heading from the same state. Color/pin/parent/children/chat metadata remains unchanged.
- Sidebar input auto-focuses/selects its value and restores the name-button focus on keyboard completion, without taking focus back after blur navigation. Editing is outside the navigation button. Its pin/chevron are disabled and non-input pointerdown in that row keeps editing focus; existing drag guard disables folder dragging.
- Added 3 tests: **506 passing** (498 extension/shared + 8 retained server), including shared folder validation, Workspace round trip and encrypted Dropbox rename propagation. Final typecheck/lint, Chromium/Firefox builds and git diff whitespace check PASS.
- New `npm run test:browser:sidebar-rename`: synthetic Edge root/nested/current/ancestor F2, selected input focus, Enter/Escape/blank/blur, label/breadcrumb/title updates without navigation, focus restoration, system/input exclusions, pin/icon/drag guards, context Rename, main folder/chat F2 and reload persistence PASS. Existing Explorer, native drag, marquee and preferences regressions PASS. Screenshot inspected. Native Firefox/Zen and live-account sync were not tested for this UI correction.
