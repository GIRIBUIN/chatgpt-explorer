# 참고 OSS 조사와 설계 결정

조사일: 2026-10-18. 대상: [glyndavidson/chatgpt-folders](https://github.com/glyndavidson/chatgpt-folders), main branch. 저장소를 fork/clone하거나 기반 코드로 가져오지 않았습니다. 아래 파일을 원격으로 읽고 설계와 edge case만 참고했습니다.

| 대상 | 관찰 | 이번 구현의 선택 |
| --- | --- | --- |
| [layoutState.js](https://github.com/glyndavidson/chatgpt-folders/blob/main/App/layoutState.js) | 버전이 있는 압축 folder record, child entry, 대화 ID 압축/복원, folder별 key와 chunk, 늦게 나타나는 대화의 pending mapping | 단일 versioned snapshot, parentId와 conversation.folderId. DOM 대기/placeholder 없음 |
| [storageService.js](https://github.com/glyndavidson/chatgpt-folders/blob/main/App/storageService.js) | 기본 sync 저장소, promise queue로 쓰기 순서 유지, 환경에 따른 localStorage fallback | chrome.storage.local만 사용. UI 변경 저장 직렬화, 실패 표시, 원본 복구 사본, 미래 버전 읽기 전용 |
| [folderManager.js](https://github.com/glyndavidson/chatgpt-folders/blob/main/App/folderManager.js) | parent 관계와 wrapper 관계 갱신, 삭제 확인 후 root 반환 동작, 이동 시 DOM container와 부모 갱신 | DOM과 독립적인 평면 데이터 모델. 삭제한 폴더의 직접 대화는 Inbox, 자식 폴더는 상위로 승격 |
| [dragController.js](https://github.com/glyndavidson/chatgpt-folders/blob/main/App/dragController.js) | folder/chat drop 대상 분기, destination의 조상 순회로 self/descendant 방지 | drag UI와 Move 메뉴 양쪽이 동일한 pure mutation 검증 사용. normalize 시에도 cycle 복구 |
| [folderMenu.js](https://github.com/glyndavidson/chatgpt-folders/blob/main/App/folderMenu.js) | new/rename/delete callback, viewport 안에 메뉴 배치, Escape·외부 클릭으로 종료 | 독립 Explorer의 custom menu + native dialog. 로컬 alias만 변경, 삭제 확인, 키보드 대체 경로 |

이름 변경은 identity를 바꾸지 않습니다. 이름이 같은 폴더도 ID가 다르면 허용합니다. URL이 달라도 대화 ID가 같으면 기존 항목으로 안내합니다. 폴더를 이동해도 conversation의 projectId/URL을 건드리지 않습니다. 손상된 parent reference나 cycle은 복구 사본을 만든 뒤 가능한 데이터만 보존합니다.

참고 OSS의 sidebar DOM injection, MutationObserver, CSS, 레이아웃, persistence chunk 구현 및 실제 코드는 가져오지 않았습니다. 원본은 sync storage를 사용하지만 이 프로젝트는 요구사항대로 local storage를 사용합니다.

API 동작 확인: [Chrome windows](https://developer.chrome.com/docs/extensions/reference/api/windows), [system.display](https://developer.chrome.com/docs/extensions/reference/api/system/display), [commands](https://developer.chrome.com/docs/extensions/reference/api/commands). 별도 popup window는 action.default_popup 없이 service worker가 생성합니다.
