import type { Plan } from '../protocol/plan.js';
import type { Provider } from '../protocol/provider.js';
import type { ArmName } from './types.js';

/**
 * 조건별 계획을 만든다.
 *
 * 🔴 공정성이 이 함수의 전부다. 조건 간 차이는 **누가 검토하는가** 하나뿐이어야 한다.
 * 단계 수, 프롬프트, 워크스페이스, 컨텍스트 전달이 다르면 무엇 때문에 차이가 났는지
 * 알 수 없게 된다.
 *
 * - `solo`        구현만 (기준선)
 * - `self-review` 구현 → **같은 벤더** 검토 → 수정
 * - `cross-review` 구현 → **다른 벤더** 검토 → 수정
 *
 * self-review와 cross-review의 차이만이 "여러 벤더"의 순수 효과다.
 * 이 둘을 나누지 않으면 개선이 다중 벤더 덕인지 그냥 검토 덕인지 구분되지 않는다.
 */

const REVIEW_SPEC =
  '이 작업 트리의 변경(git diff HEAD)을 검토하라. ' +
  '요청받은 것이 실제로 됐는지, 저장소의 실제 내용과 어긋나는 곳은 없는지, ' +
  '빠뜨리거나 잘못한 것은 없는지 구체적으로 나열하라. ' +
  '문제가 없으면 "문제 없음"이라고만 답하라. 파일은 수정하지 마라.';

const REVISE_SPEC =
  '참고 자료의 검토 의견을 읽고, 지적된 문제를 고쳐라. ' +
  '검토 의견이 "문제 없음"이면 아무것도 바꾸지 마라. ' +
  '검토 의견이 저장소의 실제 내용과 어긋나면 저장소를 기준으로 삼아라.';

export interface ArmSpec {
  arm: ArmName;
  /** 구현을 맡을 provider. 모든 조건에서 동일해야 공정하다. */
  implementer: Provider;
  /** 검토를 맡을 provider. cross-review에서만 implementer와 다르다. */
  reviewer: Provider;
}

export function buildArmPlan(task: { id: string; prompt: string }, spec: ArmSpec): Plan {
  const implement = {
    id: 'implement',
    role: 'implement' as const,
    spec: task.prompt,
    dependsOn: [],
    context: [],
    workspace: 'new',
    providers: [spec.implementer],
  };

  if (spec.arm === 'solo') {
    return { objective: `${task.id} / solo`, tasks: [implement] };
  }

  return {
    objective: `${task.id} / ${spec.arm}`,
    tasks: [
      implement,
      {
        id: 'review',
        role: 'review' as const,
        spec: REVIEW_SPEC,
        dependsOn: ['implement'],
        context: ['implement'],
        // 검토자가 구현 결과를 보려면 같은 worktree에 있어야 한다.
        workspace: 'inherit:implement',
        providers: [spec.reviewer],
      },
      {
        id: 'revise',
        role: 'implement' as const,
        spec: REVISE_SPEC,
        // implement에도 명시적으로 의존한다. 그 worktree를 상속하기 때문이다.
        dependsOn: ['review', 'implement'],
        context: ['review'],
        workspace: 'inherit:implement',
        // 수정은 항상 구현자가 한다. 조건 간 차이를 검토자 하나로 좁힌다.
        providers: [spec.implementer],
      },
    ],
  };
}

/**
 * 쓸 수 있는 provider로 조건을 구성한다.
 *
 * cross-review는 구현자와 다른 벤더가 있어야 성립한다. 없으면 그 조건은 건너뛴다 —
 * 같은 벤더로 돌리면 self-review와 같아져서 비교가 무의미해진다.
 */
export function planArms(available: Provider[], implementer: Provider): ArmSpec[] {
  const other = available.find((p) => p !== implementer);
  const arms: ArmSpec[] = [
    { arm: 'solo', implementer, reviewer: implementer },
    { arm: 'self-review', implementer, reviewer: implementer },
  ];
  if (other) arms.push({ arm: 'cross-review', implementer, reviewer: other });
  return arms;
}
