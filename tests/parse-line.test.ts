import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AntigravityAdapter } from '../src/adapters/antigravity.js';
import { ClaudeAdapter } from '../src/adapters/claude.js';
import type { AgentAdapter } from '../src/adapters/types.js';
import { AgentEvent, type ParseContext } from '../src/protocol/events.js';

/**
 * 골든 테스트 — 실측 픽스처를 정규화 이벤트로 변환하는 계약을 고정한다.
 *
 * 픽스처는 `pnpm tsx tools/capture-fixture.ts <provider>`로 실제 CLI를 돌려 얻은
 * 원시 출력이다. 벤더가 출력 스키마를 바꾸면 여기서 먼저 깨진다. SPEC R3
 */
function parseFixture(adapter: AgentAdapter, path: string) {
  const ctx: ParseContext = {};
  const events = readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .flatMap((line) => adapter.parseLine(line, ctx));
  return { events, ctx };
}

const kinds = (events: AgentEvent[]) => events.map((e) => e.kind);

describe('ClaudeAdapter.parseLine', () => {
  const { events, ctx } = parseFixture(new ClaudeAdapter(), 'fixtures/claude.smoke.jsonl');

  it('모든 이벤트가 AgentEvent 스키마를 만족한다', () => {
    for (const event of events) {
      expect(() => AgentEvent.parse(event)).not.toThrow();
    }
  });

  it('세션 시작에서 session_id를 잡아 컨텍스트에 넣는다', () => {
    const started = events.find((e) => e.kind === 'session.started');
    expect(started).toBeDefined();
    expect(started).toMatchObject({ provider: 'claude', model: expect.any(String) });
    expect(ctx.sessionId).toBe('343ac0bf-f100-496d-b4fa-f04f9e24341e');
  });

  it('assistant 텍스트 블록을 델타로 낸다', () => {
    expect(events).toContainEqual({ kind: 'message.delta', text: 'PONG' });
  });

  it('result 한 줄에서 message.final + usage + session.finished가 나온다', () => {
    expect(kinds(events).slice(-3)).toEqual(['message.final', 'usage', 'session.finished']);
  });

  it('usage에 비용과 캐시 토큰이 담긴다', () => {
    const usage = events.find((e) => e.kind === 'usage');
    expect(usage).toMatchObject({
      inputTokens: 2,
      outputTokens: 5,
      cacheCreationTokens: 46277,
      cacheReadTokens: 0,
      costUsd: 0.462905,
    });
  });

  it('rate_limit_event에서 가장 압박이 큰 창을 고른다', () => {
    // five_hour 0.32 vs seven_day 0.13 → 먼저 막힐 five_hour를 골라야 한다.
    const limit = events.find((e) => e.kind === 'rate_limit');
    expect(limit).toEqual({
      kind: 'rate_limit',
      status: 'allowed',
      limitType: 'five_hour',
      utilization: 0.32,
      resetsAt: 1788749400,
    });
  });

  it('성공으로 끝난다', () => {
    expect(events.at(-1)).toMatchObject({ kind: 'session.finished', status: 'success' });
  });

  it('훅 이벤트는 버리지 않고 unknown으로 통과시킨다', () => {
    expect(events.filter((e) => e.kind === 'unknown').length).toBeGreaterThan(0);
  });
});

describe('AntigravityAdapter.parseLine', () => {
  const { events, ctx } = parseFixture(
    new AntigravityAdapter(),
    'fixtures/antigravity.smoke.jsonl',
  );

  it('모든 이벤트가 AgentEvent 스키마를 만족한다', () => {
    for (const event of events) {
      expect(() => AgentEvent.parse(event)).not.toThrow();
    }
  });

  it('conversation_id를 세션 ID로 정규화한다', () => {
    // claude는 session_id, agy는 conversation_id — 어댑터가 흡수해야 할 차이다.
    expect(ctx.sessionId).toBe('9fa3c4c3-21f8-43d7-911b-64ad6cc70781');
    expect(events[0]).toMatchObject({ kind: 'session.started', provider: 'antigravity' });
  });

  it('step_update의 text_delta를 델타로 낸다', () => {
    expect(events).toContainEqual({ kind: 'message.delta', text: 'PONG\n' });
  });

  it('usage를 result에서 한 번만 집계한다', () => {
    // step_update(DONE)에도 같은 usage가 실려 오므로 이중 계상되면 안 된다.
    const usages = events.filter((e) => e.kind === 'usage');
    expect(usages).toHaveLength(1);
    expect(usages[0]).toMatchObject({
      inputTokens: 5089,
      outputTokens: 27,
      thinkingTokens: 25,
      cacheReadTokens: 8128,
    });
  });

  it('비용을 주지 않으므로 costUsd는 비어 있다', () => {
    const usage = events.find((e) => e.kind === 'usage');
    expect(usage && 'costUsd' in usage ? usage.costUsd : undefined).toBeUndefined();
  });

  it('duration_seconds를 밀리초로 환산한다', () => {
    expect(events.at(-1)).toEqual({
      kind: 'session.finished',
      status: 'success',
      durationMs: 1460,
      numTurns: 1,
    });
  });
});

describe('AntigravityAdapter: 권한 거부로 인한 조용한 실패', () => {
  // agy는 도구가 전부 거부돼 아무것도 못 했을 때조차 status=SUCCESS를 낸다.
  // 이 픽스처는 그 상황을 실제로 재현한 출력이다.
  const { events } = parseFixture(
    new AntigravityAdapter(),
    'fixtures/antigravity.denied.jsonl',
  );

  it('도구 호출과 실패한 결과를 짝지어 낸다', () => {
    const call = events.find((e) => e.kind === 'tool.call');
    expect(call).toMatchObject({ kind: 'tool.call', name: 'run_command' });

    const result = events.find((e) => e.kind === 'tool.result');
    expect(result).toMatchObject({ ok: false });
    expect(result && 'summary' in result ? result.summary : '').toContain('denied permission');
  });

  it('호출과 결과의 callId가 같다 (step_index로 짝짓기)', () => {
    const call = events.find((e) => e.kind === 'tool.call');
    const result = events.find((e) => e.kind === 'tool.result');
    const callId = call && 'callId' in call ? call.callId : undefined;
    const resultId = result && 'callId' in result ? result.callId : undefined;
    expect(callId).toBeDefined();
    expect(resultId).toBe(callId);
  });

  it('denied_actions를 error 이벤트로 표면화한다', () => {
    const error = events.find((e) => e.kind === 'error');
    expect(error).toMatchObject({ code: 'permission_denied', retryable: false });
  });

  it('벤더가 SUCCESS라 해도 error로 끝낸다', () => {
    // 이걸 안 하면 오케스트레이터가 빈 작업을 완료로 받는다.
    expect(events.at(-1)).toMatchObject({ kind: 'session.finished', status: 'error' });
  });
});

describe('parseLine 견고성', () => {
  const adapters: AgentAdapter[] = [new ClaudeAdapter(), new AntigravityAdapter()];

  it.each(adapters.map((a) => [a.provider, a] as const))(
    '%s: 쓰레기 입력에 예외를 던지지 않는다',
    (_name, adapter) => {
      const ctx: ParseContext = {};
      for (const junk of ['', '   ', 'not json', '{"broken":', 'null', '[1,2]', '{}']) {
        expect(() => adapter.parseLine(junk, ctx)).not.toThrow();
      }
    },
  );

  it.each(adapters.map((a) => [a.provider, a] as const))(
    '%s: 미지의 이벤트 타입을 unknown으로 통과시킨다',
    (_name, adapter) => {
      const ctx: ParseContext = {};
      const out = adapter.parseLine('{"type":"brand_new","event":"brand_new"}', ctx);
      expect(out).toEqual([{ kind: 'unknown', raw: { type: 'brand_new', event: 'brand_new' } }]);
    },
  );
});
