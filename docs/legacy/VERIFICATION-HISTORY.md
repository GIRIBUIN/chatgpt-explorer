> Historical verification log. Old test totals, provider descriptions and account-validation status are not the current alpha result. See [current verification](../VERIFICATION.md).

# Verification — Explorer UX / Import progress / Settings

## 최종 실행 결과 (2026-10-19)

- npm run typecheck: PASS (workspace.ts TS2554 없음; text helper의 maxLength 인자 확인)
- npm run lint: PASS
- npm test: 192 tests / 15 files PASS (이전 152개 유지, UX 34개 및 session progress 6개 추가)
- npm run build:chromium: PASS
- npm run build:firefox: PASS
- dist에는 chromium/ 및 firefox/만 존재

## Explorer synthetic Edge verification

`PLAYWRIGHT_EXECUTABLE_PATH`를 설치된 Edge로 지정하여 `node scripts/verify-explorer-browser.mjs` 실행: PASS.

- Ctrl/Shift selection, visible-only Ctrl+A, input 단축키 보호, Esc
- F2 및 context-menu inline rename; Enter/Esc/blank/blur
- chat/folder double-click Open; color dot은 Color editor
- Project/Color 동시 필터 및 free/structured/quoted/original-title search
- Command Palette 검색/disabled Rename, 다중 Move/Color, palette Rename focus
- toolbar ⋯에 Theme & Workspace 없음; gear Settings에서 Appearance/Data 접근
- Theme JSON import/export/invalid-token rejection/reset/reload persistence
- Workspace export, preview/cancel/apply, Apply 직전 정확한 backup
- preview 후 실제 진행 중 Import를 Stop하여 underlying workspace 변경: stale 경고 및 Apply disabled, 클릭 시 backup/state overwrite 없음
- Theme 및 Workspace 각각 10 MB + 1 byte 파일 거부
- last workspace backup 파일 다운로드
- 500px light/dark 화면 캡처 확인, page/runtime error 없음

## Import synthetic Edge verification

`node scripts/verify-import-browser.mjs`: PASS.

- MV3 ping/injection, closed sidebar auto-open, direct visible scrolling
- 반복 load-more, Project 이름, Stop partial merge, dedup
- scroll/Project/sidebar 원래 상태 복원, 임시 탭 생성 없음
- 첫 세션 progress 이벤트 0/0 → 3 chats / 1 project, Stop 완료 메시지 3/1
- 새 세션은 이전 storage가 있어도 0/0부터 시작; 중간 batch 증가, 최종 9/1
- 기존 채팅도 이번 세션 발견 개수에 포함하며 duplicate는 증가시키지 않음
- General/Project semantic anchor click 시 synthetic router document 유지
- anchor 없는 chat은 기존 full navigation fallback
- 기존 alias/favorite/shared color name/filter persistence 유지

## 카운터 진단 범위

변경 전에도 background의 후보 Map은 scan마다 생성됐으며 storage 총수를 읽는 경로는 없었습니다. 시작 시 명시적 0 이벤트가 없었고, 첫 DOM 읽기가 스크롤 밖을 포함한 렌더링 항목을 한꺼번에 수집할 수 있었습니다. 지금은 별도 session ID별 진행 상태와 고유 ID 집합을 사용하고 초기 0 및 Stop 최종 snapshot을 보장합니다. DOM에 이미 162개가 있으면 첫 읽기에서 162로 증가할 수 있으며 이는 storage count 재사용과 다릅니다. 실제 계정에서 보고된 162/13 고정 현상 자체는 재현했다고 주장하지 않습니다.

## 범위 및 남은 수동 확인

모든 browser 검증은 설치된 Edge의 isolated profile + synthetic ChatGPT fixture입니다. 실제 로그인 계정·tmp 사용자 HTML은 사용하지 않았습니다. 실제 ChatGPT private API, cookie/token, 본문 export, 임의 CSS/script injection은 추가하지 않았습니다.

- 실제 Chrome/Edge/Firefox/Zen 로그인 계정에서 progress와 lazy loading/Project/Stop 복원 확인
- Firefox/Zen 실제 실행 및 OS shortcut/창 상태/restart 확인
- 실제 계정 SPA router 및 fallback 확인
- 원격 history 전체 import는 보장하지 않음
- 구형 전체 `npm run test:browser` suite는 이번 최종 검증 범위가 아님. 기존 Project landing toast timeout 이력이 해결됐다고 주장하지 않음. 요청된 두 집중 suite는 모두 실행.

Git repository가 없어 commit은 생성하지 않았습니다.
## Settings UI consistency (2026-10-19 추가)

- Appearance/Data는 기존 dialog label/hint, padding, dialog-actions 버튼 border/radius/spacing을 공유합니다.
- Theme/Workspace의 native file input은 hidden이며 Import JSON 버튼이 file picker를 엽니다.
- Theme / Reset theme / Workspace / Backup은 label + description + 왼쪽 정렬된 버튼 구조입니다. action row는 wrap을 허용합니다.
- Edge synthetic UX 검증에서 두 실제 Import 버튼의 filechooser 연결, native file input 비노출, Save/Cancel과 동일한 border/radius/font-size, 500px 가로 overflow 없음 및 화면 캡처를 확인했습니다.
- Theme/Workspace validation, preview, stale protection, backup, size-limit 회귀 검증 PASS.
- typecheck/lint, 192 tests, Chromium/Firefox build PASS. 실제 로그인 계정 및 Firefox/Zen 실브라우저 검증은 이번 UI 수정에서 수행하지 않았습니다.

## Manual Sync MVP final verification (2026-10-19)

- Preserved native-fetch wrapper, startup-folder normalization/validation, credential isolation, conditional revision updates, stale local-hash/remote-revision checks, backup-before-apply and size limits.
- Fixed loopback validation: ordinary Chromium and Firefox modes now both accept HTTP localhost / 127.0.0.1 / [::1]. Remote HTTP, credentialed URLs, paths and query strings remain rejected. Added 10 origin cases.
- Firefox's prior disabled Sync and Chromium's test endpoint were different build-time configurations, not separate sync implementations. Both current bundles/host permissions use http://127.0.0.1:8787. Firefox additionally declares its optional data-consent permissions; it is not intentionally disabled.
- Root typecheck/lint PASS; 238 tests PASS (230 extension/shared tests + 8 server tests, all previous 192 retained). Server typecheck and separate 8-test suite PASS.
- Chromium and Firefox local-origin builds PASS. Production HTTPS manifest cases also covered by tests. No root legacy dist artifacts.
- Actual Wrangler 4.151.1 local Worker/D1: migration state confirmed, server Ready on 127.0.0.1:8787. Two isolated Edge extension profiles used real network requests (no routing) for Enable, Connect preview/Apply, revision 1→2 push/pull, conflict Cancel/Use remote, backup and Disconnect. PASS. This is local D1, not Cloudflare production.
- The browser test now waits for stored revision AND folder count through the service-worker storage API before asserting pull completion. This fixed premature test reads without changing sync logic.
- Existing Explorer UX synthetic Edge suite PASS, including Settings layout/JSON/backup, selection/input guards, rename, double click, color/filter/search and palette. Selector now checks every reused Settings section instead of assuming only one section exists.
- Existing Import synthetic Edge suite PASS: MV3 injection/ping, visible scrolling, load-more, Stop/partial/dedup, Project names/state restore, sidebar restore, SPA Open/fallback. No Import core changes.
- Crypto tampering/wrong key, auth rejection, unknown-ID indistinguishability, revision conflicts, limits, metadata-only payload, stale previews and backup failure protection are tested. Local D1 aggregate audit checks auth-hash shape/envelope validity and absence of synthetic plaintext folder names without printing credentials.
- Registry dependency installation was blocked by environment EACCES. Wrangler is already a declared devDependency; verification used the existing npm cache executable on PATH. User should run npm install --prefix sync-server in a normal terminal before npm run dev. Wrangler-generated .wrangler files are excluded from lint/build/source tracking.

Remaining manual checks: actual Edge↔Firefox/Zen extension pairing and Firefox data-consent UI; deployed HTTPS Worker/D1; actual signed-in ChatGPT regression. Zen executable exists but no automated Zen extension session was verified. No production deployment was performed. Local test profiles/server data are synthetic and do not contain user ChatGPT content.

- Actual local Worker shutdown/restart check PASS: existing Edge profile showed network error while server was stopped, local workspace remained identical, and Sync Now returned Already up to date after restarting the same local D1.
- Final command rerun: root typecheck/lint/238 tests and server typecheck/8 tests PASS. Both default unconfigured builds and both loopback-configured builds PASS. Final dist/chromium and dist/firefox explicitly target http://127.0.0.1:8787; bundle strings and exact-origin host_permissions verified. The dist root contains only these two target directories.
- Local D1 aggregate audit: 5 synthetic snapshots, 5 SHA-256-shaped auth hashes, 5 valid encrypted envelopes, 0 rows containing synthetic plaintext folder names. Secrets were not printed.

## Low-frequency Auto Sync (2026-10-19)

- Existing manual SyncClient/protocol/crypto/server unchanged apart from a shared network lock. Device-local automatic state and one-shot alarms added; no interval/focus/activation polling.
- Hash-based dirty detection, coalescing, early-alarm check, ON/OFF, startup, disconnected behavior, failure without retry, persisted-deadline recovery and both namespace alarm adapters tested with a fake clock.
- Shared storage adapter backs up before pull, checks for intervening local edits before writing, and uses a same-origin Web Lock also used by Explorer commits. It keeps network waits outside the local-write lock. Stale local edits and invalid-credential Disconnect regression tests included.
- Actual isolated Edge profiles + separate local Wrangler/D1 passed manual Sync regression and automatic A→B / B→A push/startup pull, backup, conflict/no silent overwrite, Off and manual Sync while Off. Auto test simulates elapsed five minutes by adjusting only fixture-local timestamps, then fires the real browser alarm.
- Explorer UX and Import synthetic Edge suites passed. UX assertions now await persisted-filter rendering instead of assuming synchronous DOM updates after selection.
- User-configured remote D1 binding was left unchanged. A separate ignored local-only Wrangler config/database was used for this verification. No remote deployment or remote data was modified.
- Actual Chrome↔Zen manual connectivity is user-reported. This iteration's automatic Chrome↔Zen/Firefox flow, Firefox permission persistence, and browser-OS suspend/restart timing still require manual confirmation. No real logged-in ChatGPT account was used by automated tests.

Final Auto Sync totals: 21 new tests; 259 total PASS (251 extension/shared + 8 server). Root typecheck/lint PASS; server typecheck/8 tests PASS; Chromium/Firefox builds PASS with the same local loopback test origin. New alarms permission appears in both manifests. Production endpoint/deployment configuration was not changed; final local dist artifacts require rebuilding with the user's HTTPS VITE_SYNC_ORIGIN for production use.

## Google Drive provider (2026-10-19)

- SyncProvider I/O boundary added; CloudflareProvider/SyncApi compatibility and server remain. Google Drive is the new default build/UI provider. Existing connections still dispatch to Cloudflare with the configured legacy origin.
- Drive appDataFolder only, private marker, exact file name, multiple-file rejection; API v2 ETag/version precondition, If-Match PUT and post-write revalidation. Encryption/payload validation, SyncClient conflicts/stale/backup and AutoSync scheduling reused. Import core unchanged.
- Authorization code + S256 PKCE, exact identity redirect/state validation, no client secret/implicit grant, appdata scope only. Interactive connect/reconnect is separate from noninteractive provider token reads. Short-lived tokens expire into explicit reconnect; no refresh-token storage.
- 36 new Drive/OAuth/auto/client tests; 313 total PASS (305 extension/shared + 8 legacy server), retaining all prior 277. Root typecheck/lint and server typecheck/separate 8 tests PASS. Both final target builds PASS.
- Synthetic Edge Drive UI PASS: two isolated profiles, mocked Google identity callback/token/Drive HTTP, encrypted creation, key hidden until requested, existing-remote key input/preview/backup/Apply, Disconnect removes token/credentials and retains metadata/remote. This is NOT real Google OAuth or Drive validation.
- Existing Explorer UX and Import synthetic Edge suites PASS. Cloudflare manual two-profile routed Worker/SQLite suite PASS with explicit legacy build configuration.
- Final dist contains only chromium/ and firefox/, built for Google Drive with no client ID or test origin. Connect is intentionally disabled until VITE_GOOGLE_CLIENT_ID is configured. A separate temporary build with a synthetic client ID was used only for the browser test, then replaced.
- No real Google account/client was available. Chrome↔Zen OAuth interoperability, same-project appData visibility, real stale-ETag HTTP 412 behavior, live startup/idle/close and reconnect are still manual verification requirements. Google documentation does not establish the exact secret-free cross-browser OAuth-client configuration or an atomic guarantee for this media-upload path; do not advertise production readiness from mocked tests. See SYNC.md qualification and setup.
- No Cloudflare deployment, remote data migration/deletion, Google user files, cookies or ChatGPT account data were accessed.

## Chromium native Google identity (2026-10-20)

- Replaced Chromium extension-side code/PKCE exchange with chrome.identity.getAuthToken. Interactive requests only originate from Connect/Reconnect; all provider/background token requests are non-interactive. Identity cache handles expiration. A 401 invalidates the token and permits one non-interactive reacquisition/request retry; second rejection requires reconnect. Disconnect clears extension identity cache plus local token/draft state, not workspace or Drive data.
- Firefox PKCE implementation moved intact into its own adapter. Target-specific client IDs are VITE_GOOGLE_CLIENT_ID_CHROMIUM and VITE_GOOGLE_CLIENT_ID_FIREFOX. Chromium's native adapter uses Chrome bindings even on hosts exposing a browser alias. No implicit/secret/backend fallback added.
- Latest user-supplied Chromium client ID is configured in ignored .env.local. No extension ID is hardcoded; no public manifest key was supplied. Current unpacked ID remains path-dependent. Optional VITE_CHROMIUM_EXTENSION_KEY accepts a public key to pin a production ID.
- Generated Chromium oauth2 uses the supplied client and only drive.appdata. Chromium manifest and compiled JS contain no direct Google token endpoint. Firefox has no Chromium oauth2/key and retains its token endpoint permission. Firefox client remains unconfigured until supplied separately.
- 17 added tests, 330 total PASS (322 extension/shared + 8 server); previous 313 retained. Root typecheck/lint and both builds PASS. Legacy server 8-test regression PASS.
- Synthetic Edge Drive UI PASS using mocked Chrome identity: token-endpoint route rejects unexpected direct POSTs; encrypted creation/key/preview/backup/Apply/Disconnect still work. Existing synthetic Explorer UX and Import verification passed. No real Google account authorization/appDataFolder read/write was performed by the agent.
- Microsoft documents Edge getAuthToken as unsupported. Synthetic Edge identity results must not be advertised as real Edge Google OAuth support. Real Chrome Google account selection/consent/native token/Drive read-write, and Firefox/Zen's separate client/redirect compatibility, remain manual checks.

References: https://developer.chrome.com/docs/extensions/reference/api/identity , https://developer.chrome.com/docs/extensions/reference/manifest/oauth2 , https://developer.chrome.com/docs/extensions/reference/manifest/key , https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support

## Drive first-connect HTTP 412 fix (2026-10-20)

- User reports successful real Chrome native OAuth followed by HTTP 412 during connection. Source traced metadata ETag reuse on the alt=media GET; this could fail before connection state was saved and repeat on existing-file discovery.
- Removed that media GET precondition; coherent metadata reads before/after retain concurrent-change detection. Create/update verification compares file ID, server version and exact encrypted document, then stores the latest metadata GET token. Upload response ETags are not assumed identical to metadata GET ETags. Conditional writes and true stale-write rejection remain.
- Disconnected Drive errors no longer instruct the user to run an unavailable Sync now action. Existing remote data still requires key/decryption/validation/preview/Apply; no remote files or saved keys were removed.
- Five added regressions; 335 tests PASS (327 extension/shared + 8 legacy server). Final root typecheck, lint and Chromium build PASS.
- Two-profile synthetic Edge Drive verification PASS with media requests rejecting metadata If-Match with 412 and upload responses using a distinct ETag: encrypted create, Connected/Sync now, existing-remote preview/backup/Apply and Disconnect. This is a mocked Google contract, not live account verification.
- Agent browser inventory exposed no browser sessions. User confirmation of real Chrome Connected/Sync now after extension reload remains pending. Firefox auth, Cloudflare and AutoSync architecture were not changed.

## Semantic false-conflict correction (2026-10-20)

- User confirmed real Chrome Drive connection/read now works, but Sync now displayed a zero-diff conflict. Payload audit found no revision, ETag, envelope timestamp/IV/ciphertext, credentials or dirty state in the semantic hash. The missing guard was equality between current local plaintext and validated/decrypted remote plaintext before surfacing a two-sided baseline change as conflict.
- Identical plaintext now acknowledges the latest remote baseline without a PUT, local replacement or conflict. Transaction-time local-hash/connection checks preserve concurrent edits. The same guard handles a 409 write race; true divergence still previews. Existing AutoSync success handling clears dirty/pending conflict.
- Normalize remote entity array order just as local payload does. Sync diff now reports original-title clearing and color-rule deletion, which merge-only Workspace import diff did not represent.
- Ten added tests, 345 total PASS (337 extension/shared + 8 legacy server). Final typecheck, lint, Chromium build and synthetic two-profile Drive UI verification PASS. Encryption/provider protocol/AutoSync scheduling unchanged.
- Real Chrome Sync now after this fix still requires user verification; synthetic tests do not contact Google.

## Drive HTTP request deduplication (2026-10-20)

- Traced before changes: SyncClient.now -> GoogleDriveProvider.get -> readRemote/discover performed list + metadata + media + metadata (4 requests). A local push repeated that group in put's preflight and verify (13 total including PUT). Remote pull repeated it in check/apply (8 total). Settings effects only read local state; startup is guarded once, dirty observers schedule alarms, and the existing Web Lock excludes overlapping extension contexts.
- Reuse persisted file ID from the device-local opaque remote token, recover cached-ID 404 via one discovery, check fresh metadata before deciding whether media is needed, scope checked-write preflight to one network operation, reuse validated remote bytes/plaintext after fresh version validation, verify writes with one targeted metadata GET. No persistent remote-metadata cache was added.
- Same-store Drive Sync Now calls share a promise; at most one follow-up handles edits during an active sync. Existing extension-origin Web Lock remains. Cloudflare path/request counts, scheduling policy, encryption, conflicts, stale validation and backups retained.
- 19 added regressions, 364 total PASS (356 extension/shared + 8 legacy server). Includes a manual request joining a clean close: manual remote checking is retained without duplicate GETs. Root typecheck/lint, Chromium and Firefox production builds PASS. Legacy server typecheck and separate 8-test run PASS.
- Synthetic Edge two-profile Drive UI/request measurement PASS: up to date 4 -> 1 HTTP request; local-only 13 -> 3; remote-only 8 -> 4. No steady-state list; no unchanged/local-only media; remote pull media exactly once. Settings key show/hide rerenders issue no requests. Encrypted creation, existing-remote preview/backup/Apply and Disconnect still pass.
- Existing synthetic Explorer UX verification and Import integration verification PASS. Import core, OAuth adapters, permissions and UI source were not changed.
- Browser inventory exposes no live sessions. Real signed-in Chrome/Google Drive DevTools request counts and Firefox/Zen live behavior remain manual checks; measured browser counts above use synthetic Google endpoints, not the user's account.

## Firefox / Zen OAuth feasibility gate (2026-10-20)

- Conclusion CONDITIONAL. Official Mozilla identity setup documents a loopback redirect alternative since Firefox 86; Google Desktop OAuth documents public clients, PKCE and an optional client_secret. This yields a candidate, not a validated Google client/redirect/token combination. Current web code-model documentation describes backend exchange; no blanket secret-less Web Application assumption was made.
- Installed Zen 1.23.3b / Gecko 158.0 measured the real getRedirectURL('google') for chat-explorer@local.invalid: https://9b719694906f95c69763d62176c0137dfab4f833.extensions.allizom.org/google. The real identity API also successfully intercepted its documented http://127.0.0.1/mozoauth2/9b719694906f95c69763d62176c0137dfab4f833 callback from a synthetic local authorization redirect with dummy code/state. This did not involve Google consent or tokens.
- Probe used an isolated unsigned temporary add-on/profile. The first attempt could not launch sandboxed child processes in this environment; the successful API probe disabled out-of-process extensions in that isolated test profile only. No user profile, credentials or production browser settings were accessed or modified. Ignored .verification artifacts are not shipped.
- Firefox Client ID is not configured. No Google Cloud Console registration, valid Google code exchange, Firefox/Zen Google login, Drive access or Chrome↔Zen Drive sync was verified in this task. Production adapter changes are gated on a separate Desktop client and actual secret-less exchange. No backend or unsupported auth workaround was implemented.
- Production source/permissions/Chromium identity/shared Drive logic unchanged. Documentation records candidate, exact measured redirects, client/extension ID requirements, expiry limitations and the minimal broker fallback design. Added 0 unit tests; baseline 364 PASS (356 extension/shared + 8 server). Root typecheck/lint, Chromium/Firefox builds, server typecheck and separate 8-test run PASS. Both output bundle hashes match the preceding request-performance build.
