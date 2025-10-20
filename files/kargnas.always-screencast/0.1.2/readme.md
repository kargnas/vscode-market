# Always Screencast

VS Code 확장으로, 에디터를 실행할 때마다 Screencast Mode를 강제로 활성화해 발표·강의·데모 중 키 입력이 항상 시각화되도록 보장한다.

## 기능

- `onStartupFinished` 시점에 자동으로 `screencastMode.enabled` 전역 설정을 `true` 로 업데이트
- 사용자가 수동으로 끄더라도 VS Code 재시작 시 다시 켜짐
- 추가 이벤트 리스너 없이 한 번만 실행해 리소스 사용 최소화

## 설치 & 사용

1. 이 저장소를 클론하거나 VSIX 패키지를 설치한다.
2. VS Code를 재시작하면 Screencast Mode가 바로 켜진 상태로 시작한다.

> UI에 노출되는 문구는 `AGENTS.md` 의 `<uxui_writing_style>` 규칙(토스 구어체형 높임말)을 따라 작성한다.

## 개발 흐름

- VS Code 1.80 이상에서 동작하도록 타깃을 지정했다.
- 로직은 `out/extension.js` 에 위치하며, 활성화될 때 한 번만 설정을 업데이트한다.
- Node.js 20 LTS 이상에서 `npm install` 을 실행하면 추가 설정 없이 즉시 준비가 끝난다.

## 패키징 (VSIX)

1. Node.js 20 LTS 이상 환경에서 `npm run install:vscode` 를 실행하면 VSIX 생성과 VS Code 설치가 연속으로 진행된다.
   - 내부적으로 `npx --yes @vscode/vsce package` → `code --install-extension always-screencast-*.vsix` 순서로 동작한다.
   - Node 20 미만 버전에서는 `vsce` 가 정상 동작하지 않으므로, 반드시 Node 업데이트 후 실행해야 한다.

생성된 VSIX 파일은 확장 보기(`Extensions: Install from VSIX...`)에서 설치할 수 있다.

## 향후 개선 아이디어

- 사용자 환경에 따라 워크스페이스 단위가 아닌 다른 범위를 선택할 수 있는 설정 제공
- Screencast 설정 외에도 데모에 필요한 추가 설정 묶음을 지원하는 프로필 기능
- 자동 릴리즈 워크플로 개선(릴리즈 노트 커스터마이즈, 서명 추가 등)

## CI/CD

- `main` 브랜치에 커밋이 푸시되면 `.github/workflows/release.yml` 이 실행되어 VSIX를 빌드하고 GitHub Release를 생성한다.
- 릴리즈 태그는 `package.json` 의 버전을 기반으로 `v<version>` 형태로 생성되므로, 릴리즈 전에는 반드시 `package.json` 버전을 업데이트해야 한다.
- 동일 버전으로 이미 릴리즈되어 있으면 워크플로가 실패하니, 태그 충돌을 피하려면 매 번 새 버전으로 커밋한다.
