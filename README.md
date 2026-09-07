# conductor

여러 구독형 AI 코딩 CLI(Claude Code · Antigravity · Gemini · Codex)를 헤드리스 자식 프로세스로 띄우고,
하나의 오케스트레이터가 작업을 분해·배분·수집·검증하는 로컬 런타임.

전체 설계는 [docs/SPEC.md](docs/SPEC.md) 참조.

**현재 상태: M2 완료** — 워커를 전용 git worktree에서 돌린다. 같은 과제를 여러 벤더에 뿌리고 결과를 비교할 수 있으며, 원본 저장소는 건드리지 않는다.

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
│   ├── run.ts              워커 실행 + 렌더링
│   └── workspace.ts        작업 공간 조회·정리
├── adapters/               벤더별 CLI 문법·이벤트 흡수
│   ├── types.ts            AgentAdapter 계약
│   └── {claude,antigravity,gemini,codex}.ts
├── process/
│   ├── exec.ts             PATH 해석 + 프로브 실행
│   └── manager.ts          spawn → 라인 분해 → 정규화 이벤트 스트리밍
├── protocol/
│   ├── events.ts           AgentEvent 스키마 (프로젝트의 계약)
│   └── provider.ts         Provider · TaskRequest
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
