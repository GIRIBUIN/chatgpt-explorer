# Import 전략

## Chromium bootstrap / load-more 후속 수정

최신 dist/chromium을 Chromium 계열 Edge에서 실행해 ping 성공 후 Project begin 주입 실패를 재현했습니다. executeScript args의 마지막 undefined를 Chromium이 `Value is unserializable`로 거부했으며 outer catch가 이를 message-failed로 표시했습니다. 선택 인자를 생략한 뒤 동일 fixture의 4 chats / 2 Project names 수집이 완료됐습니다. [Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)의 JSON-serializable args 계약을 따릅니다.

Health는 top frame에 ping하고 필요 시 주입 완료를 기다린 뒤 다시 ping합니다. no-chatgpt-tab, content-script-unavailable, injection-failed, ping-timeout, message-failed, sidebar-not-found, sidebar-closed, sidebar-open-timeout, tab-navigated, traversal-failed를 구분합니다. timeout 및 stage/detail을 기록하며 manifest/host permission은 변경하지 않았습니다.

tmp 세 snapshot에서 load-more 버튼은 각각 1개였습니다. 두 파일에서는 Projects section의 list/listitem, 나머지 하나에서는 Project container 내부 list/listitem에 있었습니다. 고유 load-more data attribute는 없으므로 해당 구조와 제한된 locale 문자열을 함께 검사합니다. Recents는 동일한 안전 경계를 적용한 지원 경로이며 일반 대화용 버튼이 snapshot에 캡처됐다고 주장하지 않습니다.

사용자가 후속으로 확인한 shell trigger 계약은 button[data-app-shell-sidebar-trigger="true"][aria-controls="app-shell-sidebar"]입니다. 이를 우선하여 visible/enabled 후보와 aria-expanded를 확인합니다. closed일 때 scroller subtree가 없어도 클릭 후 expanded=true 및 scroller 등장을 기다립니다. 종료/Stop/error에는 확장이 열었던 경우만 false 상태로 복원합니다. 기존 aria-controls 영역 관계는 보수적 fallback으로 남깁니다. locale text/class/nth-child는 사용하지 않습니다.

Load-more는 최대 5초간 링크/행/height/loading 변화를 기다립니다. 동일 목록 무변화 2회, 전체 클릭 40회 및 기존 session/time/iteration cap으로 제한합니다. Stop 후 다음 클릭은 없고 partial merge, Project/scroll 복원 후 전체 sidebar 상태를 복원합니다. 이미 시작된 ChatGPT UI 로딩 요청 자체를 취소하거나 내부 API에 접근하지는 않습니다.

세션은 기존 service worker 메모리에 있습니다. 작업 중 API 호출과 progress가 반복되며 각 대기는 짧게 제한됩니다. 강제 worker/browser 종료 후 세션을 재개하는 기능은 추가하지 않았습니다.

## 세 가지 역할

- Add Current Chat: 열린 normal 창의 conversation 후보 하나를 현재 virtual folder에 등록.
- Import Open Tabs: 열린 conversation 탭의 metadata만 Inbox로 등록.
- Import Chats: 기존 ChatGPT normal tab 중 lastAccessed가 가장 최근인 탭 하나의 sidebar + Project를 직접 탐색. 동률이면 active, 이후 tab ID 순. 없으면 No ChatGPT page found.

탭 생성/제거, URL 변경, 다른 창으로 focus 이동을 하지 않습니다. sidebar가 움직이고 접힌 Project가 잠깐 펼쳐지는 것은 의도된 동작입니다.

## Semantic DOM 근거

사용자가 제공한 실제 DOM attribute를 우선합니다. fixture는 이 정보를 반영한 **synthetic semantic fixture**이며 실제 계정 DOM 캡처가 아닙니다.

- 전체 scroller: `[data-app-action-sidebar-scroll]`. health check에서 부재하면 sidebar-not-found. 기존 helper의 nav/aside fallback은 보존.
- Project 구역 표식: `[data-app-action-sidebar-section-heading="Projects"]`. 지역화된 visible heading text를 비교하지 않음. heading이 별도 노드인 경우도 있으므로 명시적 sidebar Project row attribute로 행을 찾음.
- 행: `[data-app-action-sidebar-project-row]`, id/label/collapsed 및 aria-expanded를 읽음. ID는 기존 엄격한 g-p-32hex 파서와 일치해야 함.
- 대화: semantic interactive row link를 먼저 읽고 href를 검증. 제목은 aria-label → data-thread-title → visible text.
- Project container: `data-sidebar-project-container-id="project:<id>"`. container가 있을 때 href의 Project ID가 다르면 제외. General semantic link를 heuristic heading으로 Project에 편입하지 않음.

Project 이름은 explicit id/label > navigation Project href/name > 명확한 section heading > landing main heading 순으로 평가합니다. 세션 동안 누적하며 가장 강한 단계의 충돌은 null로 보류합니다. 기존 이름은 덮지 않고 누락만 보강합니다. alias/folderId/color/favorite/lastOpenedAt은 유지합니다.

## Traversal / 복원

1. target tab ID/URL, 원래 scrollTop을 저장하고 content session을 생성.
2. 현재 화면의 conversation과 Project metadata를 즉시 누적.
3. 발견된 Project 행은 가상화로 사라지기 전에 순차 처리. 명시적으로 collapsed이고 role=button인 행만 click. 원래 expanded 행은 그대로 유지.
4. attribute 변경과 child DOM을 제한시간 내 확인. Project container/href 관계를 검증해 수집. 큰 Project 영역은 최대 24단계/20초 안에서 추가 스크롤.
5. 해당 Project를 원래 접힘 상태로 돌리고 처리 전 스크롤 위치 복원.
6. 전체 sidebar는 viewport 80%씩 이동, DOM mutation 안정화와 실제 위치/높이/새 ID를 확인. 바닥 정체 4회, 중간 정체 8회, 전체 최대 160단계/150초, 세션 약 180초.
7. finally에서 남은 Project 상태를 먼저 복원하고 마지막에 전체 scrollTop 복원.

처리 순서는 권장안의 “전체 스크롤 후 Projects” 대신 viewport별 Project 처리입니다. 가상화로 행이 제거되기 전에 처리·원복하기 위해 선택했습니다. 대화 evidence는 매 read 직후 background Map에 보관하므로 Project 작업 도중 중지/실패해도 앞서 읽은 결과가 남습니다.

## Stop / 실패

UUID 세션과 AbortController를 유지합니다. stale Stop은 무시하고 반복 Stop은 안전합니다. 주요 browser call과 iteration 사이에서 취소를 확인합니다. cleanup은 취소 signal과 분리되어 실행됩니다. Stop은 데이터 폐기가 아니라 부분 merge이며 신규는 Inbox, 중복은 ID 기준으로 처리합니다. 열린 탭 자동 fallback은 없습니다. Import Open Tabs는 명시적으로 실행할 때만 사용합니다.

명령에는 세션 ID와 원래 URL을 전달합니다. URL이 바뀌면 새 페이지를 클릭/스크롤하거나 이전 URL로 되돌리지 않습니다. 탭 종료·DOM 제거·browser runtime 실패 시 복원은 best effort이며 수집 결과는 유지합니다. 강제 browser/worker 종료는 finally 및 Explorer commit을 보장하지 못합니다. content watchdog도 Project와 scroll 복원을 시도합니다.

## 한계

전체 server history를 보장하지 않습니다. UI 미노출/삭제/권한 없는 대화, 별도의 내부 scroller 또는 더 보기 버튼 뒤의 기록은 누락될 수 있습니다. Project 상태가 불명확하면 클릭하지 않습니다. DOM이 교체되거나 로딩이 제한시간을 넘으면 부분 결과가 반환됩니다. 실제 계정의 lazy loading/Project nesting과 Firefox/Zen 동작은 수동 검증이 필요합니다.

## 다음 대안: 로컬 Data Export importer (미구현)

[OpenAI의 Data Export](https://help.openai.com/en/articles/7260999-exporting-your-chatgpt-history-and-data)로 사용자가 받은 ZIP의 conversations JSON을 직접 선택하는 방식을 다음 후보로 권장합니다. UI 스크롤보다 초기 대량 등록에 안정적인 입력이 될 수 있지만, 실제 export schema와 제공되는 기록 범위를 확인해야 합니다.

구현 순서:

1. 사용자가 로컬 JSON을 선택. 파일을 외부로 전송하지 않음.
2. 지원 schema를 명시하고 크기·레코드 수·ID·title을 검증. 알 수 없는 형식은 안전하게 거부.
3. 본문/message tree는 저장하지 않음. ID/title에서 navigation metadata만 추출.
4. 미리보기와 중복/신규 개수 표시 후 기존 import merger로 Inbox 등록.
5. Project 정보가 export에 없다면 null 유지. 본문이나 title로 추측하지 않음.

Export schema가 공식 고정 계약이라고 가정하지 않습니다. 파일 fixture 기반 호환성 테스트 및 대용량 처리 설계가 필요하므로 이번 작업에서는 구현하지 않았습니다. private endpoint/token/cookie를 사용하지 않는 이유는 원본 계정 권한과 내부 API 변화에 의존하지 않고, 사용자가 직접 볼 수 있거나 제공한 데이터만 다루기 위해서입니다.


## 실제 snapshot 분석에 따른 보정
3개 HTML의 SHA-256은 모두 달랐습니다. 내용 기준 상태는 (1) 13 Project rows / 55 conversation links의 loaded 상태, (2) 5 rows / 24 links 및 loading status가 있는 접근성 격리 상태, (3) 같은 5 rows / 24 links 구조에서 data-aria-hidden이 없는 상태입니다. 실제 사용자 ID/title은 fixture에 복사하지 않았습니다.

일반 대화에도 `data-sidebar-project-container-id="chats"` / `"pinned"`가 있으므로 `project:g-p-<32hex>`만 Project 경계로 해석합니다. 중첩 container가 같은 ID를 공유할 수 있습니다. `aria-hidden=true`와 `data-aria-hidden=true`의 조합은 관찰된 접근성 격리 표식으로, 그것만으로 시각적 숨김을 단정하지 않습니다. 실제 hidden/inert, layout rectangle, CSS display/visibility를 함께 검사합니다. data 표식 없이 aria-hidden만 있는 subtree는 제외합니다.

이미 expanded인 Project도 로딩 중일 수 있습니다. matching href의 실제 자식 링크를 찾거나 role=status/aria-busy 로딩 표시가 사라지고 최소 안정화 시간이 지나면 진행합니다. 최대 6초 후 timeout을 기록하고 부분 결과를 보존합니다. Project 클릭에 따른 expanded attribute 대기는 별도로 제한됩니다. 로딩 문자열의 언어에는 의존하지 않습니다.

Import는 ping → 필요 시 주입 → ping 재시도 → capture/read → traversal → restore → merge 순서입니다. 기존 구현도 on-demand scripting 주입 방식이었으므로, “reload 후 static content script가 없음”을 원인으로 확정하지 않습니다. health/read/traversal 단계별 로그로 실제 계정의 runtime 예외를 구분합니다.
