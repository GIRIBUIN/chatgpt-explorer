# Third-party notices

## 설계 참고: chatgpt-folders

- 출처: https://github.com/glyndavidson/chatgpt-folders
- 저자: Glyn Davidson
- upstream 라이선스: MIT (https://github.com/glyndavidson/chatgpt-folders/blob/main/LICENSE)
- 참고 범위: ID 기반 매핑, 중첩 폴더, 조상 순회에 의한 cycle 방지, 저장 직렬화, 삭제 시 보존, 메뉴 edge case.
- 재사용 범위: **소스 코드, CSS, 아이콘, 이미지 재사용 없음**. 독립 코드베이스로 작성했습니다. 실제 조사 파일과 설계 차이는 docs/OSS_RESEARCH.md에 기록했습니다.

## 패키지

React / React DOM 및 빌드·검증 도구는 npm dependency로 사용합니다. 정확한 버전은 package-lock.json에 고정되어 있고 각 패키지의 LICENSE 파일은 node_modules의 해당 패키지에 포함됩니다. Vite production bundle은 dependency의 legal comment를 보존합니다.

## Tabler Icons

내부 UI SVG 아이콘은 `@tabler/icons-react`를 사용합니다. 앱/브랜드 아이콘은 포함하지 않습니다.
출처: https://github.com/tabler/tabler-icons — MIT License.

Copyright (c) 2020-2026 Paweł Kuna

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
