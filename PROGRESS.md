# Conductor 진행 상황

> 업데이트: 2026-09-07
>
> 목표: Claude Code, Antigravity(`agy`), Codex 같은 터미널 AI를 하나의 오케스트레이터가 연결하고, 각 AI가 서로 다른 작업 공간에서 협업하도록 만든다.

## 한눈에 보는 상태

| 단계 | 상태 | 쉽게 말하면 |
|---|---|---|
| M0 | 완료 | 각 AI 프로그램이 설치되어 있고 실행 가능한지 확인 |
| M1 | 완료 | AI를 실행하고 응답을 표준 형식으로 읽기 |
| M2 | 완료 | AI마다 독립된 작업 공간을 만들어 서로 간섭하지 않게 하기 |
| M2a | 구현 완료, 통합 검증 보완 중 | 실제 Claude/Antigravity/Codex 출력에 맞춰 연결부를 튼튼하게 만들기 |
| M3 | 완료 | AI가 질문하고, 진행 상황을 알리고, 완료 보고를 남기는 대화 규칙 만들기 |
| M4 | 예정 | 여러 AI에게 일을 나누고 결과를 합치는 스케줄러 만들기 |

## 현재 기준으로 사용할 AI

- **Claude Code**: 실제 실행 확인 완료.
- **Antigravity(`agy`)**: 실제 실행 확인 완료. 현재 우선 테스트 대상이다.
- **Codex CLI**: 로그인 상태 확인 완료. 지원되는 모델을 지정하면 읽기 작업과 이어하기를 확인할 수 있다.
- **Gemini CLI**: 연결 코드와 파서는 있지만 Google 로그인 검증은 보류한다. 현재 목표에는 필요하지 않다.

## 완료한 기능

### M0 — 기본 실행 확인

- `doctor` 명령으로 Claude, Antigravity, Gemini, Codex CLI의 설치와 로그인 상태를 점검한다.
- Claude/Antigravity/Gemini/Codex별 실행 명령을 한 곳에서 관리한다.
- Codex는 `codex login status`로 ChatGPT 로그인 상태를 확인했다.
- 현재 실제 우선순위는 Claude + `agy` + Codex다.

### M1 — AI 실행 엔진

- AI 프로세스를 실행하고 stdout/stderr를 읽는 프로세스 매니저를 만들었다.
- 각 AI의 제각각인 출력을 공통 `AgentEvent` 형식으로 바꾼다.
- Claude와 Antigravity로 실제 `PONG` 응답을 확인했다.
- Windows에서 여러 줄 프롬프트가 잘리는 문제를 확인하고, 가능한 AI에는 stdin 전달 방식을 적용했다.
- 호스트 프로젝트의 MCP/설정/스킬을 기본적으로 격리해 불필요한 비용과 간섭을 줄였다.

### M2 — 작업 공간 분리

- `--workspace` 옵션으로 Git worktree 기반의 독립 작업 공간을 만든다.
- `workspace list`, `workspace rm` 명령을 추가했다.
- 작업 공간은 원본 저장소 아래 `.conductor/worktrees`에 만들어진다.
- Claude와 Antigravity를 각각 별도 worktree에서 실행해 원본 저장소가 변경되지 않는 것을 확인했다.
- 삭제 시 경로가 Conductor 관리 영역 안에 있는지 확인하고, 안전하게 정리한다.

### M2a — 실제 CLI 연결 안정화

- Codex 실제 출력에 맞춘 parser, 로그인 상태 확인, 모델/샌드박스/stdin/resume 옵션을 반영했다.
- 지원 모델을 지정한 Codex 읽기 실행과 resume 실행을 확인했다.
- Codex 계정에서 기본 모델이 지원되지 않을 수 있어 `--model` 지정 경로를 열어 두었다.
- Gemini의 실제 출력 형식에 맞춘 parser와 reference fixture를 추가했다. 단, 실제 로그인 검증은 보류한다.
- 스트림 중복 이벤트 제거와 실패 원인 분류를 위한 상태 처리기를 추가했다.
- 프로세스가 실패했는데 성공 이벤트가 먼저 오는 경우에도 최종 결과를 실패로 판정하도록 수정했다.
- 테스트용 가짜 AI 프로세스와 실제 프로세스 매니저 통합 테스트를 추가했다.

### M3 — 워커 협약과 대화방

- AI를 실행할 때 작업 ID, 실행 ID, 담당 워커 ID를 환경변수로 주입한다.
- 실행별 상태와 메시지를 파일로 저장한다.
- 워커가 사용할 수 있는 명령을 추가했다.
  - `worker ask`: 모호한 부분을 질문하고 답을 기다린다.
  - `worker heartbeat`: 현재 진행 단계를 알린다.
  - `worker done`: 완료 또는 실패 결과를 보고한다.
  - `worker escalate`: 사람이 판단해야 할 문제를 올린다.
  - `worker check`: 새 알림을 확인한다.
- 즉, 현재는 별도 웹 화면 대신 실행 폴더의 메시지 파일이 AI와 오케스트레이터 사이의 대화방 역할을 한다.
- 실제 Claude 실행에서 AI가 라이선스를 질문하고, 사람이 `MIT`라고 답한 뒤 `package.json`을 만들고 완료 보고를 남기는 흐름을 확인했다.
- 오래된 dispatch ID로 보고하는 것을 거부해, 이전 작업 결과가 새 작업에 섞이지 않도록 했다.
- M3 기본 구현은 커밋 `68f4ef0`에 저장되어 있다.

## 검증 결과

### 통과

- TypeScript 타입 검사: 통과
- TypeScript 빌드: 통과
- M2a adapter/parser 테스트: **16개 통과**
- 프로세스 매니저 테스트: **8개 통과**
- M2a 관련 테스트 합계: **24개 통과**
- `git diff --check`: 통과

### 현재 확인이 필요한 항목

- 전체 테스트는 **70개 중 66개 통과, 4개 실패**했다.
- 실패한 4개는 기존 M3의 Windows 워커 CLI 통합 테스트이며, `conductor` shim 실행 경로에서 발생한다.
- 따라서 M2a의 핵심 adapter와 프로세스 매니저 테스트는 통과했지만, 전체 통합 테스트를 최종 완료 상태로 보지는 않는다.
- `pnpm` 명령은 현재 실행 환경의 `C:\Users\Admin\AppData` 접근 권한 오류로 실행되지 않았고, 로컬 Node 실행 파일로 타입 검사/빌드를 확인했다.

## 사용 예시

```powershell
# 설치/로그인 상태 확인
pnpm doctor

# agy를 독립 작업 공간에서 실행
pnpm dev run --agent antigravity --mode write --workspace --yolo "README를 정리해줘"

# Claude를 협약 모드로 실행
pnpm dev run --agent claude --mode write --workspace --protocol "이 기능을 구현해줘"

# Codex는 필요하면 지원 모델을 지정
pnpm dev run --agent codex --model gpt-5.4-mini "변경 사항을 읽기 전용으로 검토해줘"

# 작업 공간 확인/삭제
pnpm dev workspace list
pnpm dev workspace rm <workspace-id>
```

## 다음 작업

1. Windows `conductor` shim 실행 경로를 고쳐 전체 테스트 70개를 통과시킨다.
2. Claude + Antigravity + Codex를 기본 provider 조합으로 문서와 실행 옵션에 정리한다.
3. M4에서 하나의 큰 요청을 여러 작업으로 나누고, 작업 순서와 의존성을 관리한다.
4. 각 AI의 결과를 diff로 검토한 뒤 승인된 결과만 원본 브랜치에 반영한다.
5. 이후 quota, 재시도, 실패한 AI를 다른 AI로 넘기는 failover를 추가한다.

## 현재 작업 트리

- Git 저장소 초기화 완료.
- 기본 브랜치: `main`.
- M3 커밋 이후 M2a adapter, 상태 처리, 테스트, fixture 변경이 아직 작업 트리에 남아 있다.
- 비밀키와 로그인 토큰은 저장소에 기록하지 않는다.
