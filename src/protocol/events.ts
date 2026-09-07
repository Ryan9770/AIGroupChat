import { z } from 'zod';
import { PROVIDERS } from './provider.js';

const Provider = z.enum(PROVIDERS);

/**
 * 정규화 이벤트 — 프로젝트의 계약.
 *
 * 모든 어댑터는 벤더 고유 출력을 이 타입으로 변환한다.
 * 어댑터 추가는 "이 스키마를 만족시키는 작업"으로 환원된다.
 *
 * 미지의 벤더 이벤트는 버리지 않고 `unknown`으로 통과시킨다(fail-open).
 * 벤더가 출력 스키마를 바꿔도 파이프라인이 죽지 않게 하려는 것이다. SPEC R3
 */
export const AgentEvent = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('session.started'),
    sessionId: z.string(),
    provider: Provider,
    model: z.string().optional(),
  }),
  z.object({ kind: z.literal('thinking'), text: z.string() }),
  z.object({ kind: z.literal('message.delta'), text: z.string() }),
  z.object({ kind: z.literal('message.final'), text: z.string() }),
  z.object({
    kind: z.literal('tool.call'),
    callId: z.string(),
    name: z.string(),
    input: z.unknown(),
  }),
  z.object({
    kind: z.literal('tool.result'),
    callId: z.string(),
    ok: z.boolean(),
    summary: z.string(),
  }),
  z.object({
    kind: z.literal('file.changed'),
    path: z.string(),
    op: z.enum(['create', 'modify', 'delete']),
  }),
  z.object({
    kind: z.literal('permission.request'),
    requestId: z.string(),
    description: z.string(),
  }),
  z.object({
    kind: z.literal('usage'),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheCreationTokens: z.number().optional(),
    cacheReadTokens: z.number().optional(),
    thinkingTokens: z.number().optional(),
    /** 벤더가 비용을 주지 않으면 undefined. agy는 주지 않는다. */
    costUsd: z.number().optional(),
  }),
  /**
   * 쿼터 상태. Governor가 이걸 구독해 **한도에 부딪히기 전에** 재라우팅한다.
   * claude의 rate_limit_event는 utilization과 resetsAt을 실패 전에 미리 준다.
   */
  z.object({
    kind: z.literal('rate_limit'),
    status: z.string(),
    limitType: z.string().optional(),
    /** 0..1 사용률. */
    utilization: z.number().optional(),
    /** 한도 리셋 시각 (unix seconds). */
    resetsAt: z.number().optional(),
  }),
  z.object({
    kind: z.literal('error'),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
  z.object({
    kind: z.literal('session.finished'),
    status: z.enum(['success', 'error', 'cancelled']),
    durationMs: z.number(),
    numTurns: z.number().optional(),
  }),
  z.object({ kind: z.literal('unknown'), raw: z.unknown() }),
]);

export type AgentEvent = z.infer<typeof AgentEvent>;

/** parseLine이 줄 사이에 들고 가는 상태. Process Manager가 소유한다. */
export interface ParseContext {
  sessionId?: string;
}
