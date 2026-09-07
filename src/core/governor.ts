import type { AgentEvent } from '../protocol/events.js';
import type { Provider } from '../protocol/provider.js';

/**
 * 쿼터·비용을 추적하고 페일오버를 판단한다.
 *
 * 신호가 두 종류다.
 *
 * - **예측형**: claude는 매 턴 `rate_limit` 이벤트로 사용률과 리셋 시각을 준다.
 *   실패하기 **전에** 압박을 알 수 있다.
 * - **반응형**: codex는 한도에 닿아야 에러로 알려준다("You've hit your usage limit").
 *
 * 둘 다 받아서, 다음 Task를 어디로 보낼지 정한다.
 */

/** 사용률이 이 이상이면 대안이 있을 때 피한다. 하드 차단은 아니다. */
export const PRESSURE_THRESHOLD = 0.9;

/** 리셋 시각을 모를 때 쿼터 소진으로 간주하는 기간. */
const DEFAULT_COOLDOWN_MS = 60 * 60_000;

export interface ProviderState {
  provider: Provider;
  /** 쿼터 소진으로 차단된 해제 시각(epoch ms). */
  blockedUntil?: number;
  /** 마지막으로 관측한 사용률 0..1. */
  utilization?: number;
  limitType?: string;
  dispatches: number;
  costUsd: number;
  lastError?: string;
}

export interface GovernorOptions {
  /** 실행 전체의 비용 상한(USD). 넘으면 새 배치를 막는다. */
  budgetUsd?: number;
  /** provider별 배치 수 상한. 구독 사용량 보호용. */
  maxDispatchesPerProvider?: number;
  /** 현재 시각. 테스트에서 주입한다. */
  now?: () => number;
}

export interface Availability {
  usable: boolean;
  /** 쓸 수는 있지만 압박이 커서 대안이 있으면 피하는 게 낫다. */
  strained: boolean;
  reason?: string;
}

export class Governor {
  private readonly states = new Map<Provider, ProviderState>();
  private readonly now: () => number;

  constructor(private readonly opts: GovernorOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
  }

  state(provider: Provider): ProviderState {
    let state = this.states.get(provider);
    if (!state) {
      state = { provider, dispatches: 0, costUsd: 0 };
      this.states.set(provider, state);
    }
    return state;
  }

  snapshot(): ProviderState[] {
    return [...this.states.values()];
  }

  get totalCostUsd(): number {
    return this.snapshot().reduce((sum, s) => sum + s.costUsd, 0);
  }

  /** 실행 중 흘러나온 이벤트를 관측한다. */
  observeEvent(provider: Provider, event: AgentEvent): void {
    const state = this.state(provider);

    if (event.kind === 'rate_limit') {
      if (event.utilization !== undefined) state.utilization = event.utilization;
      if (event.limitType) state.limitType = event.limitType;

      // 사용률이 1에 닿았으면 실패를 기다리지 않고 미리 차단한다.
      if (event.utilization !== undefined && event.utilization >= 1) {
        state.blockedUntil = resetToMs(event.resetsAt) ?? this.now() + DEFAULT_COOLDOWN_MS;
        state.lastError = '쿼터 소진 (사용률 100%)';
      }
      return;
    }

    if (event.kind === 'usage' && event.costUsd !== undefined) {
      state.costUsd += event.costUsd;
      return;
    }

    if (event.kind === 'error' && event.code === 'rate_limited') {
      // 반응형 신호. 리셋 시각을 모르면 기본 대기 시간을 쓴다.
      state.blockedUntil = this.now() + DEFAULT_COOLDOWN_MS;
      state.lastError = event.message.slice(0, 200);
    }
  }

  /** 배치가 하나 끝났다. */
  observeDispatch(provider: Provider): void {
    this.state(provider).dispatches += 1;
  }

  /**
   * 지금 이 provider에 맡길 수 있는가.
   *
   * `strained`는 차단이 아니다. 대안이 있으면 뒤로 미루라는 뜻이고,
   * 대안이 없으면 그냥 쓴다 — 아직 막히지 않았는데 미리 포기할 이유가 없다.
   */
  availability(provider: Provider): Availability {
    const state = this.state(provider);

    if (state.blockedUntil !== undefined && state.blockedUntil > this.now()) {
      const minutes = Math.ceil((state.blockedUntil - this.now()) / 60_000);
      return {
        usable: false,
        strained: true,
        reason: `쿼터 소진 — 약 ${minutes}분 뒤 해제${state.lastError ? ` (${state.lastError})` : ''}`,
      };
    }

    const cap = this.opts.maxDispatchesPerProvider;
    if (cap !== undefined && state.dispatches >= cap) {
      return { usable: false, strained: true, reason: `배치 상한 ${cap}회 도달` };
    }

    if (state.utilization !== undefined && state.utilization >= PRESSURE_THRESHOLD) {
      return {
        usable: true,
        strained: true,
        reason: `사용률 ${(state.utilization * 100).toFixed(0)}%${state.limitType ? ` (${state.limitType})` : ''}`,
      };
    }

    return { usable: true, strained: false };
  }

  /** 예산을 넘었으면 더 이상 배치하지 않는다. */
  budgetExceeded(): boolean {
    return this.opts.budgetUsd !== undefined && this.totalCostUsd >= this.opts.budgetUsd;
  }

  /**
   * 후보를 우선순위대로 정렬한다.
   *
   * 차단된 것은 빼고, 압박이 큰 것은 뒤로 민다. 원래 순서는 유지한다 —
   * 라우터가 정한 선호(교차 검증 등)를 압박 하나로 뒤집지 않는다.
   */
  order(candidates: Provider[]): { provider: Provider; note?: string }[] {
    const usable: { provider: Provider; note?: string }[] = [];
    const strained: { provider: Provider; note?: string }[] = [];

    for (const provider of candidates) {
      const availability = this.availability(provider);
      if (!availability.usable) continue;
      const entry = availability.reason
        ? { provider, note: availability.reason }
        : { provider };
      (availability.strained ? strained : usable).push(entry);
    }

    return [...usable, ...strained];
  }
}

function resetToMs(resetsAt: number | undefined): number | undefined {
  if (resetsAt === undefined) return undefined;
  // claude는 unix 초로 준다. 밀리초로 온 값도 그대로 통과시킨다.
  return resetsAt > 1e11 ? resetsAt : resetsAt * 1000;
}

/**
 * 이 실패를 다른 provider에 다시 맡겨야 하는가.
 *
 * 재시도할 수 없는 실패(모델 미지원, 인증)에 다른 벤더를 태우면 쿼터만 태운다.
 * 워커가 "실패"라고 보고한 경우도 마찬가지다 — 과제 자체의 문제일 수 있으므로
 * 자동으로 다른 벤더에 넘기지 않는다.
 */
export function shouldFailover(errors: readonly Extract<AgentEvent, { kind: 'error' }>[]): boolean {
  return errors.some((e) => e.retryable && e.retryOn === 'other-provider');
}

/** 같은 provider에 다시 던져볼 만한가(일시적 장애·타임아웃). */
export function shouldRetrySame(
  errors: readonly Extract<AgentEvent, { kind: 'error' }>[],
): boolean {
  return errors.some((e) => e.retryable && e.retryOn === 'same-provider');
}
