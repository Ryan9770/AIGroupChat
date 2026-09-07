# conductor

여러 구독형 AI 코딩 CLI(Claude Code · Antigravity · Gemini · Codex)를 헤드리스 자식 프로세스로 띄우고,
하나의 오케스트레이터가 작업을 분해·배분·수집·검증하는 로컬 런타임.

전체 설계는 [docs/SPEC.md](docs/SPEC.md) 참조.

**현재 상태: M3 완료** — 워커가 전용 git worktree에서 돌아가고, 지시가 애매하면 **되묻는다.** 완료는 워커의 명시적 보고 + 오케스트레이터의 판정으로 확정된다.

---

## 요구사항

- Node.js >= 22 (개발/검증 환경: v24.13.0)
- pnpm
- 사용할 AI CLI가 **각 벤더의 공식 절차로 이미 로그인** 되어 있을 것

conductor는 자격증명을 읽거나 저장하거나 전달하지 않는다. 이미 로그인된 공식 바이너리를
공식 헤드리스 모드로 실행할 뿐이다. 자세한 내용은 SPEC §9.1.

## 설치

```bash
pnpm install
```

## 사용

```bash
pnpm doctor
```

각 CLI의 설치·버전·로그인 상태와 헤드리스 능력을 점검한다.

```
PROVIDER     BIN     INST  VERSION  AUTH  PLAN/INFO        OUTPUT       MCP
-----------  ------  ----  -------  ----  ---------------  -----------  --------------
claude       claude  OK    2.1.259  OK    claude.ai / pro  stream-json  per-invocation
antigravity  agy     OK    1.1.27   OK    models: 14       stream-json  pre-registered
gemini       gemini  OK    0.57.0   OK    -                stream-json  pre-registered
codex        codex   OK    0.153.4  ??    -                stream-json  unknown
```

준비된 provider가 하나도 없으면 exit 1.

### 옵션

| 옵션 | 설명 |
|---|---|
| `--offline` | 네트워크를 타는 인증 프로브를 생략한다 |
| `--json` | 사람이 읽는 표 대신 JSON으로 출력한다 (CI용) |
| `--show-argv` | provider별로 conductor가 실제 실행할 커맨드를 미리 보여준다 |

```bash
pnpm dev doctor --show-argv
```

## 워커 실행

```bash
pnpm dev run --agent claude "package.json의 name 필드 값만 답하라"
```

```
provider claude  mode plan
session 6b3cc4ec  model claude-sonnet-5

  ⚙ Read
  ✓ 1	{
`conductor`

────────────────────────────────────────────────────────────
success  elapsed 7.6s  in 6  out 240  cache_w 10,297  cache_r 91,778  cost $0.0620
resume conductor run --agent claude --resume 6b3cc4ec-... "..."
```

### 옵션

| 옵션 | 설명 |
|---|---|
| `-a, --agent <provider>` | 실행할 provider (필수) |
| `-m, --mode <plan\|write>` | `plan`=읽기 전용, `write`=편집 허용 (기본 `plan`) |
| `--model <model>` | 벤더 고유 모델 식별자 |
| `--cwd <path>` | 워커의 실행 디렉토리 |
| `-r, --resume <id>` | 이어갈 세션/대화 ID |
| `--timeout <ms>` | 워커 타임아웃 (기본 900000) |
| `--json` | 정규화 이벤트를 JSONL로 출력 |
| `-w, --workspace` | 전용 git worktree를 만들어 그 안에서 워커를 돌린다 |
| `--clean-empty` | 변경이 없으면 실행 후 worktree를 자동 정리 |
| `-P, --protocol` | 워커 협약을 켠다 (되묻기 + 완료 보고 + 정산) |
| `--auto-answer` | 워커 질문에 사람 대신 자동 응답 (무인 실행용) |
| `-y, --yolo` | 도구 승인 프롬프트 자동 승인 (`--workspace`와 함께 쓸 것) |
| `--no-isolate` | 호스트 컨텍스트 격리 해제 (비용 7.7배) |

exit code: `0` 성공 / `1` 실패·취소 / `2` 잘못된 인자.

### 정규화 이벤트 계약

`--json`을 붙이면 벤더 차이가 사라진 이벤트 스트림이 나온다. 오케스트레이터의 계약이다.

```jsonl
{"kind":"session.started","sessionId":"f93e9019-...","provider":"claude","model":"claude-sonnet-5"}
{"kind":"message.delta","text":"PONG"}
{"kind":"rate_limit","status":"allowed","limitType":"five_hour","utilization":0.54,"resetsAt":1788749400}
{"kind":"usage","inputTokens":2,"outputTokens":5,"cacheCreationTokens":5263,"cacheReadTokens":25583,"costUsd":0.0262}
{"kind":"session.finished","status":"success","durationMs":2210,"numTurns":1}
```

`session.finished`는 워커가 죽든 타임아웃이든 취소든 **항상 정확히 한 번** 나온다.

## 작업 공간 격리

**이것이 안전 경계다.** `--workspace`를 주면 워커 전용 git worktree를 만들어 그 안에서만 돌린다.
망가져도 원본은 무사하므로, `--yolo`(도구 전면 자동 승인)를 안심하고 쓸 수 있다.

```bash
pnpm dev run --agent claude --mode write --workspace --yolo --cwd /path/to/repo "README에 프로젝트 설명을 추가하라"
```

```
provider claude  mode write  workspace claude-write-i2eu5
...
files 1개 변경
  · README.md
workspace /path/to/repo/.conductor/worktrees/claude-write-i2eu5
review    git -C "..." diff HEAD
cleanup   conductor workspace rm claude-write-i2eu5
```

무엇이 바뀌었는지는 **워커의 보고가 아니라 git에게 묻는다.** 워커가 "다 했다"고 해도
파일이 안 바뀌었으면 안 바뀐 것이다.

### 같은 과제를 여러 벤더에 뿌리기

각 워커가 자기 사본에서 일하므로 충돌 없이 병렬 실행하고 결과를 비교할 수 있다.

```bash
pnpm dev run --agent claude      --workspace --yolo --mode write --cwd $REPO "$TASK"
pnpm dev run --agent antigravity --workspace --yolo --mode write --cwd $REPO "$TASK"
pnpm dev workspace list --cwd $REPO
```

```
ID                       BRANCH                             FILES  PATH
antigravity-write-i38fs  conductor/antigravity-write-i38fs  1      .conductor/worktrees/antigravity-write-i38fs
claude-write-i2eu5       conductor/claude-write-i2eu5       1      .conductor/worktrees/claude-write-i2eu5
```

### 작업 공간 관리

```bash
pnpm dev workspace list --cwd <repo>          # conductor가 만든 것만 표시
pnpm dev workspace rm <id> --cwd <repo>       # 커밋 안 된 변경이 있으면 거부
pnpm dev workspace rm <id> --cwd <repo> -f    # 확인 후 강제 제거
```

`conductor/` 접두사 브랜치만 conductor 소유로 본다. 사용자의 다른 worktree는 건드리지 않는다.

**요구사항**: 대상이 git 저장소여야 하고 커밋이 최소 하나 있어야 한다. 아니면 명확히 거부한다 —
조용히 원본에서 돌리는 일은 없다.

## 워커 협약

`--protocol`을 주면 워커에게 **되묻는 방법과 보고하는 방법**을 프롬프트 앞에 붙여 알려준다.

```bash
pnpm dev run --agent claude --mode write --workspace --yolo --protocol --cwd $REPO   "package.json에 license 필드를 추가하라."
```

지시가 애매하면 워커가 추측하지 않고 물어본다.

```
  ? 워커가 질문했습니다
    package.json에 추가할 license 필드 값을 무엇으로 할까요? 저장소에 LICENSE 파일이 없어 기준이 없습니다.
    선택지: MIT / ISC / Apache-2.0 / UNLICENSED
    답변> MIT

  ⚙ Write → package.json

success  elapsed 28.4s  cost $0.0912
report package.json에 코디네이터가 지정한 대로 "license": "MIT" 필드를 추가했다. ...
asked 질문 1건 처리
files 1개 변경  · package.json
```

### 워커가 쓰는 명령

프롬프트 프리앰블로 안내되며, 워커가 셸에서 호출한다. 사람이 직접 칠 일은 없다.

| 명령 | 역할 |
|---|---|
| `worker done --outcome succeeded\|failed --body "<3문장>"` | 완료 보고 (필수, 정확히 한 번) |
| `worker ask --question "..." --options "a,b"` | 질문하고 답이 올 때까지 대기 |
| `worker escalate --subject "..." --body "..."` | 완료 전 막힘 보고 |
| `worker check` | 코디네이터 후속 지시 확인 |
| `worker heartbeat --phase "..."` | 생존 신호 (진행의 증거는 아님) |

### 완료 판정

**워커의 보고는 주장이고, 판정은 오케스트레이터가 한다.**

| 상황 | 결과 |
|---|---|
| `worker done --outcome succeeded` | success (settlement=released) |
| `worker done --outcome failed` | error (retained) |
| **보고 없이 종료** | **error** — 프로세스가 0으로 끝나도 완료로 치지 않는다 |
| succeeded인데 변경 파일 0개 (write 모드) | success + 경고 |

다른 dispatch의 ID로 보고하면 거부한다. 실패한 이전 시도의 늦은 보고가 현재 재시도를
완료 처리하는 걸 막기 위해서다.

### 실행 기록

`<repo>/.conductor/runs/<runId>/` 에 남는다. 전부 JSON이라 `cat`으로 읽을 수 있다.

```
run.json                 목표
tasks/<taskId>.json      할 일
dispatches/<id>.json     시도 + 정산 결과
messages/<id>.json       워커가 보낸 메시지
replies/<msgId>.json     코디네이터의 답변
bin/conductor(.cmd)      워커가 호출하는 실행 심
```

## 픽스처 수집

어댑터의 `buildArgv()`가 만든 커맨드를 실제로 실행해 원시 JSONL을 `fixtures/`에 덤프한다.
M2 정규화 골든 테스트의 입력이 된다.

```bash
pnpm tsx tools/capture-fixture.ts claude
pnpm tsx tools/capture-fixture.ts antigravity
```

> 실제 구독 사용량을 소모한다. 프롬프트는 최소로 유지할 것.

## 개발

```bash
pnpm typecheck
pnpm build
```

## 구조

```
src/
├── index.ts                CLI 진입점
├── commands/
│   ├── doctor.ts           사전 점검
│   ├── run.ts              워커 실행 + 렌더링 + 정산
│   ├── worker.ts           워커가 호출하는 명령 (워커 전용)
│   └── workspace.ts        작업 공간 조회·정리
├── adapters/               벤더별 CLI 문법·이벤트 흡수
│   ├── types.ts            AgentAdapter 계약
│   └── {claude,antigravity,gemini,codex}.ts
├── process/
│   ├── exec.ts             PATH 해석 + 프로브 실행
│   └── manager.ts          spawn → 라인 분해 → 정규화 이벤트 스트리밍
├── protocol/
│   ├── events.ts           AgentEvent 스키마 (프로젝트의 계약)
│   ├── orchestration.ts    Run · Task · Dispatch · 메시지 타입
│   ├── preamble.ts         워커에게 협약을 알려주는 프롬프트
│   └── provider.ts         Provider · TaskRequest
├── orchestration/
│   ├── coordinator.ts      워커 메시지 수신 + 질문 중계
│   └── shim.ts             워커가 호출할 conductor 실행 심
├── store/run-store.ts      파일 기반 Run 저장소 (원자적 rename)
├── workspace/
│   ├── git.ts              git 호출 + porcelain 파서
│   └── worktree.ts         워커 전용 worktree 생성·수집·정리
└── ui/format.ts            테이블 렌더러
tools/
├── capture-fixture.ts      실측 JSONL 덤프
└── measure-isolation.ts    격리 플래그 비용 측정
fixtures/                   골든 테스트 입력
tests/                      픽스처 기반 골든 테스트
```

## 새 provider 추가

1. `src/protocol/provider.ts`의 `PROVIDERS`에 이름 추가
2. 타입체크가 깨진다 — `src/adapters/registry.ts`가 어댑터를 요구한다 (의도된 설계)
3. `AgentAdapter`를 구현: `preflight()`, `buildArgv()`, `parseLine()`, `capability`
4. `pnpm tsx tools/capture-fixture.ts <name>`으로 픽스처를 뜨고, `tests/`에 골든 테스트 추가

`parseLine()`은 **실측 픽스처를 확보한 뒤에** 작성한다. 미실측 벤더는 전부 `unknown`으로
통과시키는 게 맞다 — 추측으로 매핑하면 조용히 틀린 이벤트가 흐른다.

## 알려진 함정

전부 실행으로 확인한 것들이다. 자세한 수치는 [SPEC §5.2](docs/SPEC.md) 참조.

- 🔴 **Windows에서 여러 줄 프롬프트를 argv로 넘기면 첫 줄만 도착한다.** npm `.cmd` 심이
  cmd.exe를 거치는데 개행이 명령 종료로 해석된다. 게다가 exit 0이라 조용히 지나간다.
  claude·gemini·codex는 프롬프트를 **stdin으로** 넘긴다(`promptDelivery`).
  `tests/prompt-delivery.test.ts`에 플랫폼 카나리아를 뒀다.
- **워커가 프로세스 종료로 완료를 알리게 두지 말 것.** 명시적 `worker done`이 없으면 실패로 판정한다.
- **`--yolo`는 `--workspace`와 함께 쓸 것.** 안전 경계는 프롬프트가 아니라 디렉토리다.
  `--workspace` 없이 `--yolo`를 주면 워커가 원본에서 바로 작업한다.
- **agy는 아무 일도 안 하고 `SUCCESS`를 반환할 수 있다.** 헤드리스에 승인자가 없으면 도구가 전부
  거부되는데도 성공으로 보고한다. conductor는 `denied_actions`로 이를 잡아 `error`로 뒤집는다.
- **agy의 `--mode plan`은 읽기 전용이 아니다.** 계획 수립 워크플로우라 토큰을 4배 태운다.
  conductor의 `plan`은 agy 기본 모드로 보낸다. **agy에는 읽기 전용 강제 플래그가 없다.**
- **격리를 끄면 비용이 7.7배가 된다.** `--no-isolate`는 디버깅용이다.
- **격리는 모델 선호도 함께 버린다.** 워커는 기본 모델로 뜨므로 `--model`을 명시할 것.
- **프롬프트 전달 방식이 벤더마다 다르다.** `claude`는 위치 인자, `agy`/`gemini`는 `-p`가 값을 받는 플래그다.
- **claude는 stdin이 열려 있으면 3초를 기다린다.** spawn 시 `stdin: 'ignore'` 필수.
- **Git Bash의 `command -v`를 믿지 말 것.** Node 프로세스와 PATH가 다르다. `whichBin()`이 기준.
- **npm의 `antigravity` 패키지는 구글 제품이 아니다.** 실제 CLI는 `agy`.
