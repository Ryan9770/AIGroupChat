import { getAdapter } from '../adapters/registry.js';
import type { AgentEvent } from '../protocol/events.js';
import type { DiscussionParticipant, DiscussionSpec } from '../protocol/discussion.js';
import type { Provider } from '../protocol/provider.js';
import { runAgent } from '../process/manager.js';

const MAX_TURN_CHARS = 900;
const MAX_SCRIBE_TURN_CHARS = 4_000;
const RECENT_CONTEXT_TURNS = 3;
const MAX_ROLLING_SUMMARY_CHARS = 1_600;

export const DEFAULT_SUMMARY_INSTRUCTIONS =
  '핵심 합의와 이견, 기능과 역할, 장점과 단점, SMART 분석, SWOT 분석, 우선순위별 개선안과 다음 실행 단계를 정리하세요.';

export interface DiscussionTurn {
  number: number;
  provider: Provider;
  role: string;
  text: string;
  error?: string;
  /** UI text was shortened; the scribe still receives the longer archived text. */
  truncated?: boolean;
  originalChars?: number;
}

export interface DiscussionContribution {
  speech: string;
  rollingSummary?: string;
}

export interface DiscussionProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  thinkingTokens: number;
  costUsd: number;
  usageEvents: number;
  unpricedUsageEvents: number;
}

export interface DiscussionUsage extends DiscussionProviderUsage {
  byProvider: Partial<Record<Provider, DiscussionProviderUsage>>;
}

export interface DiscussionSpeechRequest {
  provider: Provider;
  prompt: string;
  cwd: string;
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type DiscussionSpeaker = (request: DiscussionSpeechRequest) => Promise<string>;

export interface DiscussionOptions {
  spec: DiscussionSpec;
  cwd: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  speak?: DiscussionSpeaker;
  onAgentEvent?: (provider: Provider, event: AgentEvent) => void;
  onTurnStart?: (turn: number, totalTurns: number, participant: DiscussionParticipant) => void;
  onTurnEnd?: (turn: DiscussionTurn) => void;
  onSummaryStart?: (provider: Provider) => void;
  onSummaryEnd?: (provider: Provider, text: string) => void;
}

export interface DiscussionResult {
  topic: string;
  turns: DiscussionTurn[];
  summary: string;
  scribe: Provider;
  failedTurns: number;
  usage: DiscussionUsage;
}

export class DiscussionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscussionError';
  }
}

export function formatTranscript(turns: DiscussionTurn[]): string {
  return turns
    .map((turn) => {
      const body = turn.error ? `[발언 실패] ${turn.error}` : turn.text;
      return `[${turn.number}턴 · ${turn.provider} · ${turn.role}]\n${body}`;
    })
    .join('\n\n');
}

function buildClosingRoundInstruction(spec: DiscussionSpec, turn: number): string {
  const firstClosingTurn = Math.max(1, spec.turns - spec.participants.length + 1);
  if (turn < firstClosingTurn) return '';

  const position = turn - firstClosingTurn + 1;
  return `최종 입장 라운드 ${position}/${spec.participants.length}:
- 주제에서 이번 턴에 요구한 분석을 수행한 뒤 반드시 자신의 최종 입장을 남기세요.
- [최종 선택], [예비 선택], [핵심 근거], [남은 이견], [신뢰도 0~100]을 빠짐없이 적으세요.
- 새 후보를 만들거나 다른 역할의 표를 대신 추론하지 마세요.`;
}

export function buildDiscussionTurnPrompt(
  spec: DiscussionSpec,
  participant: DiscussionParticipant,
  turn: number,
  turns: DiscussionTurn[],
  rollingSummary = '',
): string {
  const recentTurns = turns.slice(-RECENT_CONTEXT_TURNS);
  const transcript = recentTurns.length > 0 ? formatTranscript(recentTurns) : '(첫 발언입니다.)';
  const priorSummary = rollingSummary || '(아직 누적 요약이 없습니다.)';

  return `당신은 여러 AI가 참여하는 구조화 토론의 발언자입니다.

토론 주제:
${spec.topic}

당신의 역할/관점: ${participant.role}
현재 차례: ${turn}/${spec.turns}턴

이전 토론 누적 요약:
${priorSummary}

최근 ${RECENT_CONTEXT_TURNS}개 발언:
${transcript}

${buildClosingRoundInstruction(spec, turn)}

규칙:
1. 필요한 경우 현재 프로젝트를 읽고 근거를 확인하되 토론과 관련된 작업만 수행하세요.
2. 앞선 발언을 단순 반복하지 말고 동의, 반론, 보완 중 자신의 관점을 분명히 하세요.
3. 추상적인 평가보다 구체적인 근거, 위험, 실행 방안을 제시하세요.
4. 이번 발언 뒤에도 다른 모델이 맥락을 이어갈 수 있도록 누적 요약을 갱신하세요.
5. 발언은 800자 이내, 누적 요약은 1,200자 이내의 한국어로 작성하세요.
6. 반드시 아래 형식만 사용하세요. 누적 요약에는 지금까지의 핵심 주장과 아래 다섯 항목을 보존하세요.
7. 이전 요약에 있던 후보명, 채택·탈락 이유, 출처와 이견을 임의로 삭제하지 말고 짧게 압축하세요.
8. 점수를 사용할 때는 평가 기준·가중치·후보별 원점수를 함께 남기고, 근소한 점수 차이는 동률 가능성이 있다고 표시하세요.
9. 외부 근거가 없는 시장 수치나 성공 기준은 사실처럼 단정하지 말고 반드시 가설로 표시하세요.

<speech>
이번 차례의 발언
</speech>
<rolling-summary>
[후보 레지스트리] 후보명, 한 줄 정의, 현재 상태
[채택·탈락 결정] 결정 시점과 이유
[근거·출처] 확인된 사실과 출처, 출처 없는 주장은 가정으로 표시
[검증되지 않은 가정] 아직 테스트가 필요한 주장과 수치
[합의·이견] 명시적 합의와 남은 반론
</rolling-summary>`;
}

export function buildDiscussionSummaryPrompt(
  spec: DiscussionSpec,
  turns: DiscussionTurn[],
  rollingSummary = '',
): string {
  return `당신은 이 토론의 서기입니다. 새로운 주장이나 근거를 추가하지 말고 아래 전체 토론 기록을 근거로 최종 보고서를 작성하세요.

토론 주제:
${spec.topic}

보조 누적 요약:
${rollingSummary || '(누적 요약 없음)'}

전체 토론 기록:
${turns.length > 0 ? formatTranscript(turns) : '(발언 없음)'}

정리 요구사항:
${spec.summaryInstructions || DEFAULT_SUMMARY_INSTRUCTIONS}

기록 검증 규칙:
- 역할별 최종 선택은 해당 역할의 원문 발언에 명시된 경우에만 표로 기록하세요. 누적 요약만으로 누락된 투표를 만들어내지 마세요.
- 점수 총계는 원문에 평가 기준, 가중치와 원점수가 모두 있을 때만 재현 가능한 점수로 표시하세요.
- 상위 후보의 차이가 주관적 채점 오차보다 작아 보이면 단독 승자로 과장하지 말고 사실상 동률 또는 민감도 위험을 명시하세요.
- 출처 없는 판매량, CTR, 시장 규모와 인과 주장은 검증된 시장 근거가 아니라 가설로 분리하세요.
- 프로토타입, 수직 슬라이스, 출시 범위를 서로 다른 단계로 구분하세요.

반드시 다음을 지키세요:
- 다수 의견을 사실처럼 단정하지 말고 합의된 내용과 남은 이견을 구분하세요.
- 근거가 약한 주장과 추가 검증이 필요한 부분을 표시하세요.
- SMART와 SWOT이 요구된 경우 각각 명확한 섹션으로 작성하세요.
- 마지막에 우선순위가 있는 개선 계획과 다음 행동을 제시하세요.
- 한국어 Markdown으로 작성하세요.`;
}

export function parseDiscussionContribution(raw: string): DiscussionContribution {
  const text = raw.trim();
  const speech = text.match(/<speech>\s*([\s\S]*?)\s*<\/speech>/i)?.[1]?.trim();
  const rollingSummaryMatch = text.match(
    /<rolling-summary>\s*([\s\S]*?)\s*<\/rolling-summary>/i,
  );
  const rollingSummary = rollingSummaryMatch?.[1]?.trim();

  if (!speech && rollingSummaryMatch) {
    const recoveredSpeech = text
      .replace(rollingSummaryMatch[0], '')
      .replace(/^\s*<speech>\s*/i, '')
      .replace(/\s*<\/speech>\s*$/i, '')
      .trim();
    return {
      speech: recoveredSpeech || text,
      ...(rollingSummary ? { rollingSummary } : {}),
    };
  }

  if (!speech) {
    const summaryStart = text.search(/<rolling-summary>/i);
    if (summaryStart >= 0) {
      const recoveredSpeech = text
        .slice(0, summaryStart)
        .replace(/^\s*<speech>\s*/i, '')
        .replace(/\s*<\/speech>\s*$/i, '')
        .trim();
      const recoveredSummary = text
        .slice(summaryStart)
        .replace(/^<rolling-summary>\s*/i, '')
        .replace(/\s*<\/rolling-summary>\s*$/i, '')
        .trim();
      return {
        speech: recoveredSpeech || text,
        ...(recoveredSummary ? { rollingSummary: recoveredSummary } : {}),
      };
    }

    return { speech: text };
  }
  return {
    speech,
    ...(rollingSummary ? { rollingSummary } : {}),
  };
}

export async function runDiscussion(options: DiscussionOptions): Promise<DiscussionResult> {
  const { spec } = options;
  if (spec.turns < 10 || spec.turns > 20) {
    throw new DiscussionError('토론 턴 수는 10~20이어야 합니다');
  }
  if (spec.participants.length < 2) {
    throw new DiscussionError('참여자는 두 명 이상이어야 합니다');
  }

  const usage = createDiscussionUsage();
  const onAgentEvent = (provider: Provider, event: AgentEvent) => {
    if (event.kind === 'usage') addDiscussionUsage(usage, provider, event);
    options.onAgentEvent?.(provider, event);
  };
  const speak = options.speak ?? ((request) => runDiscussionSpeech(request, onAgentEvent));
  const turns: DiscussionTurn[] = [];
  const scribeTurns: DiscussionTurn[] = [];
  let rollingSummary = '';

  for (let index = 0; index < spec.turns; index += 1) {
    if (options.signal?.aborted) throw new DiscussionError('토론이 취소되었습니다');

    const participant = spec.participants[index % spec.participants.length]!;
    const number = index + 1;
    options.onTurnStart?.(number, spec.turns, participant);

    let turn: DiscussionTurn;
    let scribeTurn: DiscussionTurn;
    try {
      const contribution = parseDiscussionContribution(
        await speak({
          provider: participant.provider,
          prompt: buildDiscussionTurnPrompt(spec, participant, number, turns, rollingSummary),
          cwd: options.cwd,
          ...(participant.model ? { model: participant.model } : {}),
          ...(options.signal ? { signal: options.signal } : {}),
          ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
        }),
      );
      const fullText = requireSpeech(contribution.speech);
      const text = limitTurn(fullText);
      const wasTruncated = fullText.length > MAX_TURN_CHARS;
      turn = {
        number,
        provider: participant.provider,
        role: participant.role,
        text,
        ...(wasTruncated ? { truncated: true, originalChars: fullText.length } : {}),
      };
      scribeTurn = {
        number,
        provider: participant.provider,
        role: participant.role,
        text: limitScribeTurn(fullText),
      };
      rollingSummary = contribution.rollingSummary
        ? limitRollingSummary(contribution.rollingSummary)
        : appendFallbackSummary(rollingSummary, scribeTurn);
    } catch (error) {
      if (options.signal?.aborted) throw new DiscussionError('토론이 취소되었습니다');
      const message = error instanceof Error ? error.message : String(error);
      turn = { number, provider: participant.provider, role: participant.role, text: '', error: message };
      scribeTurn = turn;
      rollingSummary = appendFallbackSummary(rollingSummary, turn);
    }

    turns.push(turn);
    scribeTurns.push(scribeTurn);
    options.onTurnEnd?.(turn);
  }

  if (options.signal?.aborted) throw new DiscussionError('토론이 취소되었습니다');
  options.onSummaryStart?.(spec.scribe.provider);
  const summary = (await speak({
    provider: spec.scribe.provider,
    prompt: buildDiscussionSummaryPrompt(spec, scribeTurns, rollingSummary),
    cwd: options.cwd,
    ...(spec.scribe.model ? { model: spec.scribe.model } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  })).trim();
  if (!summary) throw new DiscussionError('서기가 빈 최종 보고서를 반환했습니다');
  options.onSummaryEnd?.(spec.scribe.provider, summary);

  return {
    topic: spec.topic,
    turns,
    summary,
    scribe: spec.scribe.provider,
    failedTurns: turns.filter((turn) => turn.error !== undefined).length,
    usage,
  };
}

export function createDiscussionUsage(): DiscussionUsage {
  return {
    ...emptyProviderUsage(),
    byProvider: {},
  };
}

export function addDiscussionUsage(
  totals: DiscussionUsage,
  provider: Provider,
  event: Extract<AgentEvent, { kind: 'usage' }>,
): void {
  const providerTotals = totals.byProvider[provider] ?? emptyProviderUsage();
  for (const target of [totals, providerTotals]) {
    target.inputTokens += event.inputTokens;
    target.outputTokens += event.outputTokens;
    target.cacheCreationTokens += event.cacheCreationTokens ?? 0;
    target.cacheReadTokens += event.cacheReadTokens ?? 0;
    target.thinkingTokens += event.thinkingTokens ?? 0;
    target.costUsd += event.costUsd ?? 0;
    target.usageEvents += 1;
    if (event.costUsd === undefined) target.unpricedUsageEvents += 1;
  }
  totals.byProvider[provider] = providerTotals;
}

export async function runDiscussionSpeech(
  request: DiscussionSpeechRequest,
  onEvent?: (provider: Provider, event: AgentEvent) => void,
): Promise<string> {
  let deltas = '';
  let final = '';
  let failure = '';
  let succeeded = false;

  for await (const event of runAgent(
    getAdapter(request.provider),
    {
      prompt: request.prompt,
      mode: 'plan',
      cwd: request.cwd,
      isolate: true,
      ...(request.model ? { model: request.model } : {}),
    },
    {
      ...(request.signal ? { signal: request.signal } : {}),
      ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
    },
  )) {
    onEvent?.(request.provider, event);
    if (event.kind === 'message.delta') deltas += event.text;
    else if (event.kind === 'message.final') final = event.text;
    else if (event.kind === 'error') failure = event.message;
    else if (event.kind === 'session.finished') succeeded = event.status === 'success';
  }

  if (!succeeded) throw new DiscussionError(failure || `${request.provider} 발언 실행에 실패했습니다`);
  const text = (final || deltas).trim();
  if (!text) throw new DiscussionError(`${request.provider}가 빈 발언을 반환했습니다`);
  return text;
}

function emptyProviderUsage(): DiscussionProviderUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    thinkingTokens: 0,
    costUsd: 0,
    usageEvents: 0,
    unpricedUsageEvents: 0,
  };
}

function requireSpeech(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new DiscussionError('빈 발언을 반환했습니다');
  return trimmed;
}

function limitTurn(text: string): string {
  const trimmed = requireSpeech(text);
  return trimmed.length > MAX_TURN_CHARS
    ? `${trimmed.slice(0, MAX_TURN_CHARS)}\n…(화면 표시 길이 제한으로 생략 · 서기에는 원문 전달)`
    : trimmed;
}

function limitScribeTurn(text: string): string {
  const trimmed = requireSpeech(text);
  return trimmed.length > MAX_SCRIBE_TURN_CHARS
    ? `${trimmed.slice(0, MAX_SCRIBE_TURN_CHARS)}\n…(서기 입력 안전 한도로 생략)`
    : trimmed;
}

function limitRollingSummary(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_ROLLING_SUMMARY_CHARS) return trimmed;

  // 후보 레지스트리는 대개 앞쪽에, 최신 결정과 이견은 뒤쪽에 있다.
  // 한쪽만 자르면 조기 후보 또는 최신 결론 중 하나가 사라지므로 양끝을 보존한다.
  const separator = '\n…(누적 요약 중간 생략)…\n';
  const available = MAX_ROLLING_SUMMARY_CHARS - separator.length;
  const headLength = Math.ceil(available / 2);
  const tailLength = Math.floor(available / 2);
  return `${trimmed.slice(0, headLength)}${separator}${trimmed.slice(-tailLength)}`;
}

function appendFallbackSummary(summary: string, turn: DiscussionTurn): string {
  const body = turn.error ? `[발언 실패] ${turn.error}` : turn.text;
  return limitRollingSummary(
    `${summary}${summary ? '\n' : ''}[${turn.number}턴 ${turn.provider} · ${turn.role}] ${body.slice(0, 320)}`,
  );
}
