import { z } from 'zod';
import { PROVIDERS } from './provider.js';

/**
 * 실행 계획(DAG). 하나의 목표를 여러 Task로 쪼개고 의존 관계를 정의한다.
 *
 * M4에서는 사람이 직접 쓴다. LLM 기반 Planner는 이 형식을 생성하는 문제로
 * 환원되므로, 형식이 먼저 안정되어야 한다. SPEC Q1
 *
 * 형식은 JSON이다. TS 설정 파일은 런타임에 TS를 불러와야 해서
 * `node dist/`로 돌 때 깨진다.
 */

export const TaskRole = z.enum(['design', 'implement', 'review', 'custom']);
export type TaskRole = z.infer<typeof TaskRole>;

/**
 * 이 Task가 어디서 실행되는가.
 *
 * - `none`   워크스페이스 없이 지정된 디렉토리에서(읽기 전용 조사에 적합)
 * - `new`    새 worktree를 판다
 * - `inherit:<taskId>` 그 Task가 만든 worktree에서 이어서 작업한다
 *
 * 리뷰가 구현 결과를 보려면 같은 worktree에 있어야 한다. 별도 worktree를 파면
 * 리뷰어에게는 변경이 보이지 않는다.
 */
export const WorkspaceSpec = z
  .string()
  .refine((v) => v === 'none' || v === 'new' || v.startsWith('inherit:'), {
    message: "workspace는 'none' | 'new' | 'inherit:<taskId>' 중 하나여야 합니다",
  });

export const PlanTask = z.object({
  id: z.string().min(1),
  role: TaskRole.default('custom'),
  /** 워커에게 줄 과제 서술. */
  spec: z.string().min(1),
  /** 이 Task들이 성공적으로 정산된 뒤에 실행된다. */
  dependsOn: z.array(z.string()).default([]),
  /**
   * 이 Task들의 산출물을 참고 자료로 주입한다.
   * dependsOn과 별개다 — 순서만 강제하고 자료는 안 줄 수도 있다.
   */
  context: z.array(z.string()).default([]),
  workspace: WorkspaceSpec.default('none'),
  mode: z.enum(['plan', 'write']).optional(),
  /** 라우팅 후보를 직접 지정한다. 비우면 role별 기본값. */
  providers: z.array(z.enum(PROVIDERS)).optional(),
  /**
   * provider별 모델. 모델 이름은 벤더마다 다르므로 반드시 provider로 묶는다.
   *
   * 하나의 문자열로 두면 페일오버할 때 그대로 따라가서, 예컨대 codex용
   * `gpt-5.4-mini`가 claude에 넘어가 즉시 실패한다(실측).
   */
  models: z.record(z.enum(PROVIDERS), z.string()).optional(),
});
export type PlanTask = z.infer<typeof PlanTask>;

export const Plan = z.object({
  objective: z.string().min(1),
  tasks: z.array(PlanTask).min(1),
});
export type Plan = z.infer<typeof Plan>;

export interface PlanIssue {
  taskId: string;
  message: string;
}

/**
 * DAG가 실행 가능한지 검사한다.
 *
 * 순환이나 없는 의존성을 실행 중에 발견하면 이미 워커를 몇 개 띄운 뒤다.
 * 시작 전에 전부 잡는다.
 */
export function validatePlan(plan: Plan): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const ids = new Set<string>();

  for (const task of plan.tasks) {
    if (ids.has(task.id)) issues.push({ taskId: task.id, message: '중복된 Task ID' });
    ids.add(task.id);
  }

  for (const task of plan.tasks) {
    for (const dep of task.dependsOn) {
      if (!ids.has(dep)) issues.push({ taskId: task.id, message: `없는 의존성: ${dep}` });
    }
    for (const ref of task.context) {
      if (!ids.has(ref)) issues.push({ taskId: task.id, message: `없는 참고 대상: ${ref}` });
    }

    if (task.workspace.startsWith('inherit:')) {
      const from = task.workspace.slice('inherit:'.length);
      if (!ids.has(from)) {
        issues.push({ taskId: task.id, message: `없는 워크스페이스 원본: ${from}` });
      } else if (!task.dependsOn.includes(from)) {
        // 원본이 아직 안 끝났는데 그 worktree에 들어가면 반쯤 만들어진 상태를 본다.
        issues.push({
          taskId: task.id,
          message: `workspace를 상속하려면 ${from}을 dependsOn에도 넣어야 합니다`,
        });
      }
    }
  }

  issues.push(...findCycles(plan));
  return issues;
}

function findCycles(plan: Plan): PlanIssue[] {
  const graph = new Map(plan.tasks.map((t) => [t.id, t.dependsOn]));
  const state = new Map<string, 'visiting' | 'done'>();
  const issues: PlanIssue[] = [];

  const visit = (id: string, trail: string[]): void => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      issues.push({ taskId: id, message: `순환 의존: ${[...trail, id].join(' → ')}` });
      return;
    }
    state.set(id, 'visiting');
    for (const dep of graph.get(id) ?? []) {
      if (graph.has(dep)) visit(dep, [...trail, id]);
    }
    state.set(id, 'done');
  };

  for (const task of plan.tasks) visit(task.id, []);
  return issues;
}

/** 위상 정렬. 검증을 통과한 계획에만 쓴다. */
export function topoOrder(plan: Plan): string[] {
  const order: string[] = [];
  const done = new Set<string>();
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));

  const visit = (id: string): void => {
    if (done.has(id)) return;
    done.add(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (byId.has(dep)) visit(dep);
    }
    order.push(id);
  };

  for (const task of plan.tasks) visit(task.id);
  return order;
}
