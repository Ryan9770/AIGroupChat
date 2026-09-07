import type { Plan, PlanTask } from '../protocol/plan.js';
import { topoOrder, validatePlan } from '../protocol/plan.js';
import type { Provider } from '../protocol/provider.js';
import type { Workspace } from '../workspace/worktree.js';
import { buildContextBlock, type UpstreamArtifact } from './context.js';
import {
  executeDispatch,
  type DispatchObserver,
  type DispatchRequest,
  type DispatchResult,
  type WorkspacePlan,
} from './dispatch.js';
import { route } from './router.js';

export type TaskState = 'pending' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'skipped';

export interface TaskOutcome {
  taskId: string;
  state: TaskState;
  provider?: Provider;
  result?: DispatchResult;
  /** 라우팅 근거나 차단 사유. */
  note?: string;
}

export interface SchedulerOptions {
  plan: Plan;
  runDir: string;
  cwd: string;
  available: Provider[];
  isolate: boolean;
  autoApprove: boolean;
  protocol: boolean;
  answerMode: 'human' | 'auto';
  timeoutMs: number;
  signal?: AbortSignal;
  /** Task 시작·종료 알림. */
  onTaskStart?: (task: PlanTask, provider: Provider, reason: string) => void;
  onTaskEnd?: (outcome: TaskOutcome) => void;
  observerFor?: (task: PlanTask) => DispatchObserver;
}

export class SchedulerError extends Error {}

/**
 * 계획(DAG)을 실행한다.
 *
 * 규칙:
 * - Task는 **의존 대상이 정산에서 succeeded로 판정된 뒤에만** 시작한다.
 *   워커가 "다 했다"고 말한 것만으로는 부족하다. ADR-9
 * - 의존 대상이 실패하면 그 후손은 blocked로 두고 실행하지 않는다.
 *   반쯤 만들어진 결과 위에 다음 단계를 쌓지 않는다.
 * - 리뷰는 구현자와 다른 provider로 보낸다(가능한 경우).
 *
 * M4에서는 **순차 실행**이다. 병렬은 worktree 충돌·쿼터·출력 뒤섞임을
 * 한꺼번에 다루게 되므로, DAG 의미가 검증된 뒤에 붙인다.
 */
export async function runPlan(opts: SchedulerOptions): Promise<TaskOutcome[]> {
  const issues = validatePlan(opts.plan);
  if (issues.length > 0) {
    throw new SchedulerError(
      `계획이 유효하지 않습니다:\n${issues.map((i) => `  - ${i.taskId}: ${i.message}`).join('\n')}`,
    );
  }

  const byId = new Map(opts.plan.tasks.map((t) => [t.id, t]));
  const outcomes = new Map<string, TaskOutcome>();
  const workspaces = new Map<string, Workspace>();

  for (const taskId of topoOrder(opts.plan)) {
    const task = byId.get(taskId);
    if (!task) continue;

    if (opts.signal?.aborted) {
      outcomes.set(taskId, { taskId, state: 'skipped', note: '사용자 중단' });
      continue;
    }

    // 선행 작업이 정산에 성공하지 못했으면 시작하지 않는다.
    const failedDep = task.dependsOn.find((dep) => outcomes.get(dep)?.state !== 'succeeded');
    if (failedDep) {
      const outcome: TaskOutcome = {
        taskId,
        state: 'blocked',
        note: `선행 작업 ${failedDep}이(가) 성공하지 못했습니다`,
      };
      outcomes.set(taskId, outcome);
      opts.onTaskEnd?.(outcome);
      continue;
    }

    // 리뷰는 검토 대상을 만든 provider를 피한다.
    const avoid = task.context
      .map((ref) => outcomes.get(ref)?.provider)
      .filter((p): p is Provider => p !== undefined);

    const routed = route({
      role: task.role,
      available: opts.available,
      ...(task.providers ? { preferred: task.providers } : {}),
      ...(avoid.length > 0 && task.role === 'review' ? { avoid } : {}),
    });

    if (!routed) {
      const outcome: TaskOutcome = {
        taskId,
        state: 'skipped',
        note: '쓸 수 있는 provider가 없습니다',
      };
      outcomes.set(taskId, outcome);
      opts.onTaskEnd?.(outcome);
      continue;
    }

    opts.onTaskStart?.(task, routed.provider, routed.reason);

    const workspacePlan = resolveWorkspace(task, workspaces);
    const contextBlock = buildContextBlock(collectArtifacts(task, outcomes));

    const request: DispatchRequest = {
      provider: routed.provider,
      spec: task.spec,
      mode: task.mode ?? (task.role === 'design' || task.role === 'review' ? 'plan' : 'write'),
      cwd: opts.cwd,
      workspace: workspacePlan,
      isolate: opts.isolate,
      autoApprove: opts.autoApprove,
      protocol: opts.protocol,
      answerMode: opts.answerMode,
      timeoutMs: opts.timeoutMs,
      runDir: opts.runDir,
      taskId: task.id,
      attempt: 1,
      ...(contextBlock ? { contextBlock } : {}),
      ...(task.model ? { model: task.model } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.observerFor ? { observer: opts.observerFor(task) } : {}),
    };

    const result = await executeDispatch(request);
    if (result.workspace) workspaces.set(task.id, result.workspace);

    const outcome: TaskOutcome = {
      taskId,
      state: result.outcome === 'succeeded' ? 'succeeded' : 'failed',
      provider: routed.provider,
      result,
      note: result.note ?? routed.reason,
    };
    outcomes.set(taskId, outcome);
    opts.onTaskEnd?.(outcome);
  }

  return opts.plan.tasks.map(
    (t) => outcomes.get(t.id) ?? { taskId: t.id, state: 'pending' as TaskState },
  );
}

function resolveWorkspace(task: PlanTask, made: Map<string, Workspace>): WorkspacePlan {
  if (task.workspace === 'none') return { kind: 'none' };
  if (task.workspace === 'new') return { kind: 'new', label: task.id };

  const from = task.workspace.slice('inherit:'.length);
  const workspace = made.get(from);
  if (!workspace) {
    // 원본이 worktree를 만들지 않았다(예: workspace:'none'이었거나 변경이 없어 정리됨).
    // 새로 파지 않는다 — 상속을 요청한 Task는 그 결과를 보려던 것이므로,
    // 빈 worktree를 주면 조용히 잘못된 검토를 하게 된다.
    return { kind: 'none' };
  }
  return { kind: 'reuse', workspace };
}

function collectArtifacts(
  task: PlanTask,
  outcomes: Map<string, TaskOutcome>,
): UpstreamArtifact[] {
  const artifacts: UpstreamArtifact[] = [];
  for (const ref of task.context) {
    const outcome = outcomes.get(ref);
    if (!outcome?.result || !outcome.provider) continue;
    artifacts.push({
      taskId: ref,
      provider: outcome.provider,
      report: outcome.result.report,
      filesChanged: outcome.result.filesChanged,
    });
  }
  return artifacts;
}
