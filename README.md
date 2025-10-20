ㄱ # VSCode Market

프라이빗 VS Code 확장을 자동으로 수집·배포하는 커스텀 마켓플레이스 템플릿이다. `github.com/kargnas` 계정에 존재하는 `vscode-ext-` 프리픽스 저장소를 주기적으로 스캔해 최신 `.vsix` 릴리스를 내려받고, `index.json` 및 정적 자산을 재구성해 GitHub Pages나 Cloudflare Pages로 배포할 수 있다.

## 핵심 특징

- 🔄 **자동 동기화**: GitHub Actions 스케줄러가 1시간마다 실행되어 확장 메타데이터와 바이너리를 동기화한다.
- 📦 **정적 호스팅 최적화**: `extensions/`(VSIX)와 `files/`(manifest/README/icon 등)를 구조화해 정적 호스트에서 곧바로 서비스 가능.
- 🧾 **VS Code 호환 API**: Cloudflare Pages Functions를 통해 `extensionquery` 및 `item` 엔드포인트를 제공, `extensions.gallery` 설정과 호환.
- 🗂️ **가벼운 프런트**: 루트 `index.html`이 `index.json`을 읽어 카드형 리스트를 렌더링한다.

## 디렉터리 구조

| 경로 | 설명 |
| --- | --- |
| `index.json` | 최신 동기화 결과. VS Code API와 웹 UI가 참고한다. |
| `extensions/` | 확장별 `.vsix` 파일 저장소. `publisher.extension-version.vsix` 형태. |
| `files/` | 확장에서 추출한 `package.json`, `extension.vsixmanifest`, `README`, `icon` 등. |
| `scripts/update-index.mjs` | GitHub API를 호출해 최신 릴리스 → 정적 자산으로 변환하는 스크립트. |
| `functions/api/extensionquery.ts` | VS Code Marketplace 호환 `POST /api/extensionquery`. |
| `functions/items/index.ts` | `GET /items?itemName=` 핸들러. 개별 확장 상세를 반환. |
| `.github/workflows/sync-extensions.yml` | 1시간 주기 동기화 파이프라인. |
| `templates/extension-release-workflow.yml` | 각 확장 저장소에서 VSIX 릴리스 자동화에 바로 쓸 수 있는 최소 GitHub Actions 워크플로 템플릿. |
| `index.html`, `styles.css` | 간단한 카탈로그 UI. |

## 로컬 실행

1. Node.js 20+ 준비.
2. 의존성 설치:
   ```bash
   npm install
   ```
3. 동기화 스크립트 실행:
   ```bash
   npm run update:index
   ```
   - 필요 시 환경변수:
     - `GITHUB_OWNER`: 기본값 `kargnas`
     - `GITHUB_REPO_PREFIX`: 기본값 `vscode-ext-`
     - `GITHUB_TOKEN`: GitHub API 토큰 (퍼블릭 저장소만 사용 시 기본 토큰으로 충분)
     - `MARKET_BASE_URL`: 정적 파일이 노출될 도메인(예: `https://market.example.com`). 지정 시 `files`/`extensions` 경로가 절대 URL로 채워진다.
4. `index.html`을 파일 서버로 열어 결과 확인. 간단하게는 `npx http-server .` 등 정적 서버를 사용한다.

## GitHub Actions 동기화

- 워크플로: `.github/workflows/sync-extensions.yml`
- 트리거: 수동(`workflow_dispatch`) 또는 매시 정시(`0 * * * *`).
- 필요한 시크릿/변수 (모두 선택 사항):
  - `MARKET_SYNC_TOKEN` (Secret): 기본 `GITHUB_TOKEN`으로 충분하며, 프라이빗 저장소/높은 레이트 제한이 필요할 때만 PAT 지정.
  - `MARKET_OWNER` (Variable): 기본값은 `github.repository_owner`. 다른 조직 소유 리포를 모니터링할 때만 설정.
  - `MARKET_PREFIX` (Variable): 기본값 `vscode-ext-`. 프리픽스가 다르면 수정.
  - `MARKET_BASE_URL` (Variable): 정적 호스트 절대 URL. 설정하지 않으면 상대 경로(`/files/...`)를 유지.
- 스크립트 성공 후 `index.json`, `extensions/`, `files/`에 변경이 있으면 `chore: sync extensions` 커밋으로 푸시.

- `templates/extension-release-workflow.yml`을 각 `vscode-ext-*` 저장소의 `.github/workflows/release.yml` 같은 이름으로 복사하면 된다.
- 트리거: `main` 브랜치로 푸시하거나 수동 실행(`workflow_dispatch`). 수동 실행 시 `patch/minor/major` 중 원하는 버전 증가폭을 선택할 수 있으며 기본값은 `patch`.
- 동작 순서
  1. `npm ci`
  2. Git 사용자 정보 설정
  3. 최근 동일 마이너 버전의 최초 태그와 현재 `main`의 차이를 분석해, `.css`, `.md`, `.html`, `index.json`, 바이너리 제외 파일에서 줄 수 합계가 500 이상이면 자동으로 `minor`, 그렇지 않으면 기본 `patch`(또는 `RELEASE_INCREMENT`) 버전 증가 → `chore: release vX.Y.Z` 커밋/태그 생성. 수동 실행 시 입력값이 있으면 이를 우선 적용.
  4. `npx @vscode/vsce package --out ./dist`
  5. 커밋/태그를 원격으로 푸시
  6. `softprops/action-gh-release@v2`로 릴리스 생성 및 `.vsix` 업로드
- 커밋 메시지가 `chore: release ...`인 경우 재귀 실행을 방지하기 위해 자동 스킵된다.
- 추가 PAT 없이 `secrets.GITHUB_TOKEN`으로 커밋/태그/릴리스 작업이 가능하다.
- 옵션 환경 변수 / 입력 값
  - 리포지터리 Variable `RELEASE_INCREMENT`: 자동 분석 결과가 500 미만일 때 적용되는 기본 증가폭. 기본값은 `patch`.
  - 수동 실행 Input `increment`: 워크플로를 직접 호출할 때 버전 증가폭을 즉시 지정. 미지정 시 자동 분석 → `RELEASE_INCREMENT` 순으로 결정.

## 배포 전략

### GitHub Pages (정적 전용)

1. Settings → Pages에서 `Deploy from branch`를 활성화하고 기본 브랜치의 `/` 또는 `/docs`를 선택.
2. 동기화 워크플로가 `index.json`/`extensions/`/`files/`를 업데이트하면 Pages가 곧바로 최신 버전을 서빙한다.
3. **주의**: GitHub Pages는 `POST /api/extensionquery` 같은 서버리스 함수를 지원하지 않는다. VS Code 내 갤러리 연동은 Cloudflare Pages 같은 서버리스 환경을 이용하고, GitHub Pages는 다운로드 카탈로그 용도로만 쓰는 것이 안전하다.

### Cloudflare Pages + Functions (권장)

1. Cloudflare Pages 프로젝트 생성 후 이 저장소를 연결한다.
2. **Build settings**: Build command `npm install && npm run update:index`, Output directory `.`.
3. Functions 활성화 후 `functions/` 디렉터리를 그대로 사용한다.
4. 환경 변수 설정:
   - `GITHUB_OWNER`, `GITHUB_REPO_PREFIX`, `GITHUB_TOKEN`, `MARKET_BASE_URL` (필요 시)
5. 배포가 완료되면 아래 VS Code 설정으로 직접 마켓플레이스를 지정 가능:
   ```json
   {
     "extensions.gallery": {
       "serviceUrl": "https://<your-pages-domain>/api",
       "cacheUrl": "https://<your-pages-domain>",
       "itemUrl": "https://<your-pages-domain>/items"
     }
   }
   ```

## index.json 스키마 (요약)

```jsonc
{
  "generatedAt": "ISO-8601",
  "source": {
    "owner": "kargnas",
    "prefix": "vscode-ext-",
    "repositoryCount": 2
  },
  "extensions": [
    {
      "extensionId": "<GUID>",
      "extensionName": "always-screencast",
      "displayName": "Always Screencast",
      "shortDescription": "...",
      "publisher": {
        "displayName": "kargnas",
        "publisherId": "<GUID>",
        "publisherName": "kargnas",
        "domain": null,
        "isDomainVerified": false
      },
      "versions": [
        {
          "version": "1.0.0",
          "lastUpdated": "2025-10-20T11:00:00Z",
          "files": [
            { "assetType": "Microsoft.VisualStudio.Services.VSIXPackage", "source": "https://.../extensions/...vsix" },
            { "assetType": "Microsoft.VisualStudio.Services.Content.Details", "source": "https://.../files/.../readme.md" }
          ],
          "targetPlatform": "universal",
          "sha256": "...",
          "size": 12345
        }
      ],
      "tags": ["typescript"],
      "categories": ["Productivity"],
      "releaseDate": "...",
      "lastUpdated": "...",
      "flags": "",
      "identifier": "kargnas.always-screencast",
      "repository": "https://github.com/kargnas/vscode-ext-always-screencast",
      "homepage": null,
      "license": "MIT"
    }
  ]
}
```

## VS Code 설정 및 테스트

1. Cloudflare Pages 배포 후 VS Code `settings.json`에 아래 항목 추가.
   ```json
   "extensions.gallery": {
     "serviceUrl": "https://<your-pages-domain>/api",
     "cacheUrl": "https://<your-pages-domain>",
     "itemUrl": "https://<your-pages-domain>/items"
   }
   ```
2. 명령 팔레트 → “Extensions: Show Recommended Extensions” 등으로 커스텀 마켓이 정상 호출되는지 확인.
3. 필요 시 개발자 도구에서 `POST /api/extensionquery` 응답을 모니터링한다.

## 추가 TODO 아이디어

- 다중 버전 유지: 최신 버전 외에도 최근 3개 릴리스를 `versions[]`에 누적하도록 확장.
- 다운로드 통계: Cloudflare 애널리틱스/Workers KV를 활용해 설치 카운트 수집.
- 관리자 대시보드: `index.json`을 기반으로 수동 업로드/삭제 기능을 제공하는 관리 UI 구축.
