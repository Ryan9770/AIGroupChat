import { describe, expect, it } from 'vitest';
import { Governor, shouldFailover, shouldRetrySame } from '../src/core/governor.js';
import type { DispatchRequest, DispatchResult } from '../src/core/dispatch.js';
import { runPlan } from '../src/core/scheduler.js';
import type { AgentEvent } from '../src/protocol/events.js';
import { Plan } from '../src/protocol/plan.js';
import type { Provider } from '../src/protocol/provider.js';

const rateLimited = (message = "You've hit your usage limit"): Extract<AgentEvent, { kind: 'error' }> => ({
  kind: 'error',
  code: 'rate_limited',
  message,
  retryable: true,
  retryOn: 'other-provider',
});

const notSupported: Extract<AgentEvent, { kind: 'error' }> = {
  kind: 'error',
  code: 'codex_error',
  message: "The 'gpt-5.2-codex' model is not supported",
  retryable: false,
};

describe('Governor 쿼터 추적', () => {
  it('사용률 100%면 실패를 기다리지 않고 미리 차단한다', () => {
    // claude는 실패 전에 사용률을 알려준다. 그걸 쓰지 않을 이유가 없다.
    let now = 1_000_000;
    const governor = new Governor({ now: () => now });

    governor.observeEvent('claude', {
      kind: 'rate_limit',
      status: 'allowed',
      limitType: 'five_hour',
      utilization: 1,
      resetsAt: Math.floor((now + 30 * 60_000) / 1000),
    });

    expect(governor.availability('claude').usable).toBe(false);
    expect(governor.availability('claude').reason).toContain('쿼터 소진');
  });

  it('리셋 시각이 지나면 다시 쓸 수 있다', () => {
    let now = 1_000_000;
    const governor = new Governor({ now: () => now });

    governor.observeEvent('claude', {
      kind: 'rate_limit',
      status: 'allowed',
      utilization: 1,
      resetsAt: Math.floor((now + 10 * 60_000) / 1000),
    });
    expect(governor.availability('claude').usable).toBe(false);

    now += 11 * 60_000;
    expect(governor.availability('claude').usable).toBe(true);
  });

  it('쿼터 소진 오류를 받으면 차단한다', () => {
    const governor = new Governor();
    governor.observeEvent('codex', rateLimited());
    expect(governor.availability('codex').usable).toBe(false);
  });

  it('사용률이 높으면 쓸 수는 있되 뒤로 민다', () => {
    // 아직 막히지 않았는데 미리 포기할 이유는 없다. 대안이 있으면 뒤로.
    const governor = new Governor();
    governor.observeEvent('claude', { kind: 'rate_limit', status: 'allowed', utilization: 0.95 });

    const availability = governor.availability('claude');
    expect(availability.usable).toBe(true);
    expect(availability.strained).toBe(true);

    expect(governor.order(['claude', 'codex']).map((c) => c.provider)).toEqual(['codex', 'claude']);
  });

  it('차단된 provider는 후보에서 아예 뺀다', () => {
    const governor = new Governor();
    governor.observeEvent('codex', rateLimited());
    expect(governor.order(['codex', 'claude']).map((c) => c.provider)).toEqual(['claude']);
  });

  it('provider별 배치 상한을 지킨다', () => {
    const governor = new Governor({ maxDispatchesPerProvider: 2 });
    governor.observeDispatch('antigravity');
    expect(governor.availability('antigravity').usable).toBe(true);
    governor.observeDispatch('antigravity');
    expect(governor.availability('antigravity').usable).toBe(false);
  });

  it('비용을 합산하고 예산 초과를 알린다', () => {
    const governor = new Governor({ budgetUsd: 0.1 });
    governor.observeEvent('claude', { kind: 'usage', inputTokens: 1, outputTokens: 1, costUsd: 0.06 });
    expect(governor.budgetExceeded()).toBe(false);
    governor.observeEvent('claude', { kind: 'usage', inputTokens: 1, outputTokens: 1, costUsd: 0.06 });
    expect(governor.budgetExceeded()).toBe(true);
  });
});

describe('페일오버 판단', () => {
  it('쿼터 소진은 다른 provider로 넘긴다', () => {
    expect(shouldFailover([rateLimited()])).toBe(true);
  });

  it('모델 미지원은 다른 벤더를 태우지 않는다', () => {
    // 재시도할 수 없는 실패에 다른 벤더를 태우면 쿼터만 태운다.
    expect(shouldFailover([notSupported])).toBe(false);
  });

  it('타임아웃은 같은 provider 재시도 대상이다', () => {
    const timeout: Extract<AgentEvent, { kind: 'error' }> = {
      kind: 'error',
      code: 'timeout',
      message: '타임아웃',
      retryable: true,
      retryOn: 'same-provider',
    };
    expect(shouldRetrySame([timeout])).toBe(true);
    expect(shouldFailover([timeout])).toBe(false);
  });
});

/**
 * 스케줄러 페일오버 — 실제 AI 호출 없이 증명한다.
 *
 * 배치 실행기를 주입해 "첫 provider는 쿼터 소진, 다음은 성공" 상황을 만든다.
 * 구독 사용량을 태우지 않고도 재배치 로직을 반복 검증할 수 있다.
 */
describe('스케줄러 페일오버', () => {
  const plan = Plan.parse({
    objective: 'failover test',
    tasks: [{ id: 'work', role: 'implement', spec: 'do it', workspace: 'none' }],
  });

  const makeResult = (
    request: DispatchRequest,
    overrides: Partial<DispatchResult> = {},
  ): DispatchResult => ({
    dispatchId: `dsp_${request.provider}_${request.attempt}`,
    provider: request.provider,
    taskId: request.taskId,
    status: 'error',
    outcome: 'failed',
    report: '',
    filesChanged: [],
    errors: [],
    durationMs: 1,
    ...overrides,
  });

  const base = {
    plan,
    runDir: 'C:/tmp/run',
    cwd: 'C:/tmp/repo',
    isolate: true,
    autoApprove: false,
    protocol: false,
    answerMode: 'auto' as const,
    timeoutMs: 1000,
  };

  it('쿼터가 소진되면 다음 provider가 이어받는다', async () => {
    const tried: Provider[] = [];
    const failovers: string[] = [];

    const outcomes = await runPlan({
      ...base,
      available: ['antigravity', 'claude', 'codex'],
      onFailover: (_task, from, to) => failovers.push(`${from}→${to}`),
      execute: async (request) => {
        tried.push(request.provider);
        // 첫 후보(antigravity)는 쿼터 소진, 두 번째는 성공.
        return request.provider === 'antigravity'
          ? makeResult(request, { errors: [rateLimited()] })
          : makeResult(request, { status: 'success', outcome: 'succeeded', report: '했다' });
      },
    });

    expect(tried).toEqual(['antigravity', 'claude']);
    expect(failovers).toEqual(['antigravity→claude']);
    expect(outcomes[0]).toMatchObject({ state: 'succeeded', provider: 'claude' });
  });

  it('재배치 이력을 남긴다', async () => {
    // 어느 벤더가 왜 실패하고 누가 해냈는지 남지 않으면 나중에 알 수 없다. ADR-8
    const outcomes = await runPlan({
      ...base,
      available: ['antigravity', 'claude'],
      execute: async (request) =>
        request.provider === 'antigravity'
          ? makeResult(request, { errors: [rateLimited()] })
          : makeResult(request, { status: 'success', outcome: 'succeeded' }),
    });

    expect(outcomes[0]?.attempts).toEqual([
      { provider: 'antigravity', attempt: 1, outcome: 'failed', failoverReason: 'rate_limited' },
      { provider: 'claude', attempt: 2, outcome: 'succeeded' },
    ]);
  });

  it('재시도 불가 실패는 다른 벤더를 태우지 않는다', async () => {
    const tried: Provider[] = [];
    const outcomes = await runPlan({
      ...base,
      available: ['antigravity', 'claude', 'codex'],
      execute: async (request) => {
        tried.push(request.provider);
        return makeResult(request, { errors: [notSupported] });
      },
    });

    expect(tried).toEqual(['antigravity']);
    expect(outcomes[0]?.state).toBe('failed');
  });

  it('maxAttempts를 넘기지 않는다', async () => {
    const tried: Provider[] = [];
    await runPlan({
      ...base,
      available: ['antigravity', 'claude', 'codex'],
      maxAttempts: 2,
      execute: async (request) => {
        tried.push(request.provider);
        return makeResult(request, { errors: [rateLimited()] });
      },
    });
    expect(tried).toHaveLength(2);
  });

  it('Governor가 차단한 provider는 아예 시도하지 않는다', async () => {
    const governor = new Governor();
    governor.observeEvent('antigravity', rateLimited());

    const tried: Provider[] = [];
    await runPlan({
      ...base,
      available: ['antigravity', 'claude'],
      governor,
      execute: async (request) => {
        tried.push(request.provider);
        return makeResult(request, { status: 'success', outcome: 'succeeded' });
      },
    });

    expect(tried).toEqual(['claude']);
  });

  it('후보가 전부 소진되면 Task를 건너뛴다', async () => {
    const governor = new Governor();
    for (const provider of ['antigravity', 'claude', 'codex'] as const) {
      governor.observeEvent(provider, rateLimited());
    }

    const outcomes = await runPlan({
      ...base,
      available: ['antigravity', 'claude', 'codex'],
      governor,
      execute: async () => {
        throw new Error('실행되면 안 된다');
      },
    });

    expect(outcomes[0]).toMatchObject({ state: 'skipped' });
    expect(outcomes[0]?.note).toContain('쿼터 소진');
  });

  it('예산을 넘으면 남은 Task를 건너뛴다', async () => {
    const twoTasks = Plan.parse({
      objective: 'budget test',
      tasks: [
        { id: 'a', spec: 'x', workspace: 'none' },
        { id: 'b', spec: 'y', workspace: 'none' },
      ],
    });
    const governor = new Governor({ budgetUsd: 0.05 });

    const outcomes = await runPlan({
      ...base,
      plan: twoTasks,
      available: ['claude'],
      governor,
      execute: async (request) =>
        makeResult(request, {
          status: 'success',
          outcome: 'succeeded',
          usage: { kind: 'usage', inputTokens: 1, outputTokens: 1, costUsd: 0.06 },
        }),
    });

    expect(outcomes[0]?.state).toBe('succeeded');
    expect(outcomes[1]?.state).toBe('skipped');
    expect(outcomes[1]?.note).toContain('예산 초과');
  });
});
