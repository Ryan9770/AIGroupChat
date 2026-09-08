import { getAdapter } from '../adapters/registry.js';
import type { AgentEvent } from '../protocol/events.js';
import type { DiscussionParticipant, DiscussionSpec } from '../protocol/discussion.js';
import type { Provider } from '../protocol/provider.js';
import { runAgent } from '../process/manager.js';

const MAX_TURN_CHARS = 900;
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

규칙:
1. 필요한 경우 현재 프로젝트를 읽고 근거를 확인하되 토론과 관련된 작업만 수행하세요.
2. 앞선 발언을 단순 반복하지 말고 동의, 반론, 보완 중 자신의 관점을 분명히 하세요.
3. 추상적인 평가보다 구체적인 근거, 위험, 실행 방안을 제시하세요.
4. 이번 발언 뒤에도 다른 모델이 맥락을 이어갈 수 있도록 누적 요약을 갱신하세요.
5. 발언은 800자 이내, 누적 요약은 1,200자 이내의 한국어로 작성하세요.
6. 반드시 아래 형식만 사용하세요. 누적 요약에는 지금까지의 핵심 주장과 아래 다섯 항목을 보존하세요.
7. 이전 요약에 있던 후보명, 채택·탈락 이유, 출처와 이견을 임의로 삭제하지 말고 짧게 압축하세요.

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
  const rollingSummary = text
    .match(/<rolling-summary>\s*([\s\S]*?)\s*<\/rolling-summary>/i)?.[1]
    ?.trim();

  if (!speech) return { speech: text };
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
  let rollingSummary = '';

  for (let index = 0; index < spec.turns; index += 1) {
    if (options.signal?.aborted) throw new DiscussionError('토론이 취소되었습니다');

    const participant = spec.participants[index % spec.participants.length]!;
    const number = index + 1;
    options.onTurnStart?.(number, spec.turns, participant);

    let turn: DiscussionTurn;
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
      const text = limitTurn(contribution.speech);
      turn = { number, provider: participant.provider, role: participant.role, text };
      rollingSummary = contribution.rollingSummary
        ? limitRollingSummary(contribution.rollingSummary)
        : appendFallbackSummary(rollingSummary, turn);
    } catch (error) {
      if (options.signal?.aborted) throw new DiscussionError('토론이 취소되었습니다');
      const message = error instanceof Error ? error.message : String(error);
      turn = { number, provider: participant.provider, role: participant.role, text: '', error: message };
      rollingSummary = appendFallbackSummary(rollingSummary, turn);
    }

    turns.push(turn);
    options.onTurnEnd?.(turn);
  }

  if (options.signal?.aborted) throw new DiscussionError('토론이 취소되었습니다');
  options.onSummaryStart?.(spec.scribe.provider);
  const summary = (await speak({
    provider: spec.scribe.provider,
    prompt: buildDiscussionSummaryPrompt(spec, turns, rollingSummary),
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

function limitTurn(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new DiscussionError('빈 발언을 반환했습니다');
  return trimmed.length > MAX_TURN_CHARS
    ? `${trimmed.slice(0, MAX_TURN_CHARS)}\n…(발언 길이 제한으로 생략)`
    : trimmed;
}

function limitRollingSummary(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_ROLLING_SUMMARY_CHARS
    ? `…${trimmed.slice(-MAX_ROLLING_SUMMARY_CHARS)}`
    : trimmed;
}

function appendFallbackSummary(summary: string, turn: DiscussionTurn): string {
  const body = turn.error ? `[발언 실패] ${turn.error}` : turn.text;
  return limitRollingSummary(
    `${summary}${summary ? '\n' : ''}[${turn.number}턴 ${turn.provider} · ${turn.role}] ${body.slice(0, 320)}`,
  );
}
