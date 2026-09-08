import type { BaseDrift } from '../workspace/worktree.js';

export interface PreambleParams {
  taskId: string;
  dispatchId: string;
  taskSpec: string;
  workerHandle: string;
  /** 워커가 셸에서 호출할 conductor 실행 경로 (공백 포함 가능 — 이미 인용되어 있다). */
  cli: string;
  /** worktree가 기준보다 뒤처졌을 때만 채운다. */
  baseDrift?: BaseDrift;
  /** 질문을 받아줄 사람이 붙어 있는가. 없으면 ask를 권하지 않는다. */
  canAsk: boolean;
  /** 팀장(Leader / Design) 역할인가. AiKA 모드 위임 가이드라인을 주입한다. */
  isLeader?: boolean | undefined;
}

/**
 * 워커에게 협약을 알려주는 프리앰블. 프롬프트 맨 앞에 붙는다.
 *
 * MCP가 아니라 텍스트인 이유: 벤더마다 MCP 등록 방식이 다르고 agy는 호출 시점
 * 주입이 아예 안 된다. 프롬프트 앞에 텍스트를 붙이는 건 네 벤더에서 똑같이 동작한다. ADR-7
 *
 * 작성 원칙(Orca에서 배움): **행동 규칙은 해당 명령 예제 바로 위 주석에 둔다.**
 * LLM 독자는 예제에 닻을 내리고 뒤따르는 산문은 대충 읽는다. 규칙을 문서 끝에
 * 모아두면 읽히지 않는다.
 */
export function buildDispatchPreamble(params: PreambleParams): string {
  const { cli, workerHandle, taskId, dispatchId } = params;
  const ids = `--task-id ${taskId} --dispatch-id ${dispatchId}`;

  const leaderBlock = params.isLeader
    ? `
  # =========================================================================
  # [AiKA 모드: 토큰 절약 및 하위 워커 위임 수칙 (팀장 전용)]
  # 규칙: 직접 100라인이 넘는 큰 파일을 Read하거나 보일러플레이트 코드를 짜느라
  # 비싼 컨텍스트와 5시간 쿼터 토큰을 낭비하지 마세요.
  # 대신 아래의 선언형 경량 모드(antigravity 워커)를 호출하여 압축 요약본만 받으세요.
  #
  # 1. 대용량 파일 분석 위임 (antigravity 기반):
  #    -> 대상 파일을 분석하여 인터페이스/시그니처/의존성 압축 요약본만 반환받습니다.
  ${cli} mode run bulk-reader --files "<파일경로또는패턴>" --query "<분석목표/질의>"
  #
  # 2. 보일러플레이트/단위 테스트 초안 생성 위임 (antigravity 기반):
  #    -> 정형화된 코드 생성을 하위 워커에게 위임하고 결과 요약을 보고받습니다.
  ${cli} mode run draft-writer --spec "<작업명세>" --context "<참고파일또는패턴>"
  # =========================================================================
`
    : '';

  const askBlock = params.canAsk
    ? `
  # 코디네이터에게 질문하고 답이 올 때까지 기다린다.
  #
  # 규칙(반드시 지킬 것): 사용자에게 직접 묻는 대화창을 절대 열지 마라.
  # 너는 헤드리스로 실행 중이라 그런 창은 아무도 볼 수 없고, 세션이 그대로 멈춘다.
  # 사람에게 닿는 유일한 통로는 아래 ask다.
  #
  # 지시가 애매하면 추측하지 말고 물어라. 추측한 결과물은 되돌리는 비용이 더 크다.
  ${cli} worker ask --question "<질문>" --options "<선택지,쉼표로,구분(선택)>"
`
    : `
  # 이 실행에는 질문에 답할 사람이 없다. ask는 쓰지 마라.
  # 애매한 부분은 가정을 세워 진행하고, 그 가정을 worker_done 본문에 명시하라.
`;

  const header = `=== 과제 ===
${params.taskSpec}

지금 이 과제를 수행하세요. 아래는 수행 방법이 아니라 **결과를 보고하는 방법**입니다.

---

당신은 conductor라는 멀티 에이전트 오케스트레이터가 배치한 워커입니다.
당신의 워커 핸들: ${workerHandle}
Task ID: ${taskId}   Dispatch ID: ${dispatchId}

코디네이터와는 아래 명령으로만 소통합니다. 이메일·이슈 댓글 등 다른 경로로
사람에게 연락하려 하지 마세요.

=== 사용 가능한 명령 ===

\`\`\`sh
  # 작업 결과를 보고한다. (필수 — 정확히 한 번)
  #
  # 규칙: --body는 3문장 요약이어야 한다. 무엇을 했고, 무엇을 발견했고, 무엇이 남았는지.
  # 코디네이터는 본문을 먼저 읽고 필요할 때만 산출물을 연다. 빈 본문은 보내지 마라.
  #
  # 규칙: 요청받은 일을 끝냈으면 --outcome succeeded, 아니면 --outcome failed.
  # 실패를 산문에만 적고 succeeded로 보내지 마라. 그냥 조용히 끝내지도 마라 —
  # 이 보고가 없으면 코디네이터는 작업을 실패로 판정한다.
  ${cli} worker done --outcome succeeded --body "<3문장 요약>" ${ids}
${leaderBlock}${askBlock}
  # 완료 전에 막혔을 때. 코디네이터가 뭔가 해줘야 진행할 수 있는 경우.
  ${cli} worker escalate --subject "막힘: <이유>" --body "<상세>" ${ids}

  # 코디네이터의 후속 지시를 확인한다. 아무것도 너를 중단시키지 않으므로,
  # 새 파일을 건드리기 전이나 테스트 실행 후처럼 자연스러운 지점에서 직접 확인해라.
  ${cli} worker check ${ids}
\`\`\`

=== worker done을 보낸 뒤 ===

보고를 보내면 이 작업에서 당신의 차례는 끝납니다. 멈추고 더 이상 행동하지 마세요.
새로운 일을 시작하지 말고, 대기 루프를 돌지 말고, check를 반복 호출하지 마세요.
코디네이터는 이미 완료를 기록했고 추가 출력을 기대하지 않습니다.`;

  const drift = params.baseDrift ? buildDriftSection(params.baseDrift) : '';

  // 과제를 맨 앞에 두고 끝에서 한 번 더 확인시킨다.
  // 처음엔 과제를 맨 뒤에 뒀는데, 워커가 바로 위의 "보고 후 멈춰라"에 걸려
  // "지시가 없다"고 답했다(실측). 협약 문서가 과제를 덮어버린 것이다.
  return `${header}${drift}

---

지금 할 일: ${params.taskSpec}
끝나면 반드시 \`worker done\`으로 보고하세요.`;
}

/**
 * 기준 브랜치보다 뒤처졌을 때만 붙는 섹션.
 *
 * 멀쩡한 worktree에까지 띄우면 워커가 이 경고를 무시하도록 학습한다.
 * 호출자는 실제로 뒤처졌을 때만 baseDrift를 채워야 한다.
 */
function buildDriftSection(drift: BaseDrift): string {
  const subjects = drift.recentSubjects.map((s) => `  - ${s}`).join('\n');
  return `

=== 기준 코드 드리프트 ===
당신의 작업 트리는 ${drift.base}보다 ${drift.behind}개 커밋 뒤처져 있습니다.
${drift.base}에는 있고 여기에는 없는 최근 커밋:
${subjects}

과제와 관련 있어 보이면 먼저 가져오거나(\`git pull --rebase\`), 코디네이터에게 escalate 하세요.`;
}
