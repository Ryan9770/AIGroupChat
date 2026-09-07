import type { Routes, TaskRole } from '../protocol/plan.js';
import type { Provider } from '../protocol/provider.js';

/**
 * 역할별 라우팅 기본값.
 *
 * gemini는 기본 후보에서 제외한다. 파서는 있지만 **합성 픽스처 기반이고
 * 실제 로그인 검증이 보류 상태**라, 실측된 provider만 기본 경로에 둔다.
 * 계획에서 `providers`로 직접 지정하면 여전히 쓸 수 있다.
 */
export const DEFAULT_ROUTES: Record<TaskRole, Provider[]> = {
  // 읽기 전용을 CLI로 강제할 수 있는 provider만. agy는 그 플래그가 없다(§5.2.3).
  design: ['claude', 'codex'],
  implement: ['antigravity', 'claude', 'codex'],
  review: ['codex', 'claude', 'antigravity'],
  custom: ['claude', 'antigravity', 'codex'],
};

export interface RouteRequest {
  role: TaskRole;
  /** 계획이 Task에 직접 지정한 후보. 가장 우선한다. */
  preferred?: Provider[];
  /**
   * 역할별 담당 오버라이드(계획 파일 또는 설정 파일).
   * 우선순위: task.providers > routes > DEFAULT_ROUTES
   */
  routes?: Routes;
  /** 실제로 쓸 수 있는 provider (doctor 결과). */
  available: Provider[];
  /**
   * 담당이 명시적으로 지정됐는가(계획의 task.providers 또는 routes).
   *
   * 명시 지정은 휴리스틱을 이긴다. "claude가 검토한다"고 못박아 뒀는데
   * 교차 검증 규칙이 끼어들어 경고를 띄우면, 의도한 구성인데도 문제처럼 보인다.
   */
  explicit?: boolean;
  /**
   * 이 Task가 검토하는 산출물을 만든 provider.
   * 교차 검증을 위해 같은 provider를 피한다.
   */
  avoid?: Provider[];
}

export interface RouteResult {
  provider: Provider;
  /** 페일오버 순서. 앞에서부터 시도한다. */
  fallbacks: Provider[];
  /** 사람이 읽을 선택 근거. */
  reason: string;
}

/**
 * Task에 provider를 배정한다.
 *
 * 교차 검증(`avoid`)은 **선호이지 강제가 아니다.** 쓸 수 있는 provider가 하나뿐인데
 * 그게 구현자와 같다고 리뷰를 통째로 건너뛰면, 검증 없이 넘어가는 것보다
 * 같은 벤더의 자기 검토라도 하는 편이 낫다. 대신 그 사실을 reason에 남긴다.
 */
export function route(request: RouteRequest): RouteResult | null {
  const table =
    request.preferred ?? request.routes?.[request.role] ?? DEFAULT_ROUTES[request.role];
  const candidates = table.filter((p) => request.available.includes(p));

  if (candidates.length === 0) return null;

  // 사람이 직접 정한 담당이면 그대로 따른다.
  if (request.explicit) {
    const [provider, ...fallbacks] = candidates;
    return { provider: provider!, fallbacks, reason: `${request.role}: ${provider} (지정됨)` };
  }

  const avoid = new Set(request.avoid ?? []);
  const preferred = candidates.filter((p) => !avoid.has(p));

  if (preferred.length > 0) {
    const [provider, ...fallbacks] = preferred;
    return {
      provider: provider!,
      // 교차 검증 대상도 마지막 수단으로는 남겨둔다.
      fallbacks: [...fallbacks, ...candidates.filter((p) => avoid.has(p))],
      reason:
        avoid.size > 0
          ? `${request.role}: ${provider} (${[...avoid].join(',')} 회피 — 교차 검증)`
          : `${request.role}: ${provider}`,
    };
  }

  const [provider, ...fallbacks] = candidates;
  return {
    provider: provider!,
    fallbacks,
    reason: `${request.role}: ${provider} ⚠ 교차 검증 불가 — 산출물을 만든 provider와 동일`,
  };
}
