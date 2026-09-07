import type { Plan, PlanTask, Routes } from '../protocol/plan.js';
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
import type { PendingQuestion } from '../orchestration/coordinator.js';
import { Governor, shouldFailover } from './governor.js';
import { route } from './router.js';

export type TaskState = 'pending' | 'running' | 'succeeded' | 'failed' | 'blocked' | 'skipped';

export interface AttemptRecord {
  provider: Provider;
  attempt: number;
  outcome: DispatchResult['outcome'];
  /** 다음 provider로 넘어간 이유. */
  failoverReason?: string;
}

export interface TaskOutcome {
  taskId: string;
  state: TaskState;
  provider?: Provider;
  result?: DispatchResult;
  /** 라우팅 근거나 차단 사유. */
  note?: string;
  /** 시도 이력. 페일오버가 있었으면 여러 건. */
  attempts: AttemptRecord[];
}

/** 스케줄러가 배치를 실행하는 방법. 테스트에서 갈아끼운다. */
export type DispatchExecutor = (request: DispatchRequest) => Promise<DispatchResult>;

export interface SchedulerOptions {
  plan: Plan;
  runDir: string;
  cwd: string;
  available: Provider[];
  /** 역할별 담당 오버라이드. 계획 파일 > 설정 파일 순으로 합쳐서 넘긴다. */
  routes?: Routes;
  isolate: boolean;
  autoApprove: boolean;
  protocol: boolean;
  answerMode: 'human' | 'auto';
  /** 질문에 답하는 경로를 갈아끼운다(웹 UI 등). */
  askHuman?: (question: PendingQuestion) => Promise<string | null>;
  timeoutMs: number;
  signal?: AbortSignal;
  governor?: Governor;
  /** Task 하나당 최대 시도 횟수(페일오버 포함). */
  maxAttempts?: number;
  execute?: DispatchExecutor;
  onTaskStart?: (task: PlanTask, provider: Provider, reason: string) => void;
  onTaskEnd?: (outcome: TaskOutcome) => void;
  /** 페일오버가 일어났을 때. */
  onFailover?: (taskId: string, from: Provider, to: Provider, reason: string) => void;
  observerFor?: (task: PlanTask) => DispatchObserver;
}

export class SchedulerError extends Error {}

const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * 계획(DAG)을 실행한다.
 *
 * 규칙:
 * - Task는 **의존 대상이 정산에서 succeeded로 판정된 뒤에만** 시작한다. ADR-9
 * - 의존 대상이 실패하면 그 후손은 blocked로 두고 실행하지 않는다.
 * - 리뷰는 구현자와 다른 provider로 보낸다(가능한 경우).
 * - **쿼터 소진처럼 다른 벤더에서 풀릴 실패는 자동으로 넘긴다.** 같은 Task의
 *   새 Dispatch가 된다(ADR-8). 과제 자체의 문제인 실패는 넘기지 않는다.
 *
 * M5에서도 **순차 실행**이다. 병렬은 worktree 충돌·쿼터·출력 뒤섞임을
 * 한꺼번에 다루게 되므로 뒤로 미룬다.
 */
export async function runPlan(opts: SchedulerOptions): Promise<TaskOutcome[]> {
  const issues = validatePlan(opts.plan);
  if (issues.length > 0) {
    throw new SchedulerError(
      `계획이 유효하지 않습니다:\n${issues.map((i) => `  - ${i.taskId}: ${i.message}`).join('\n')}`,
    );
  }

  const execute = opts.execute ?? executeDispatch;
  const governor = opts.governor ?? new Governor();
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  const byId = new Map(opts.plan.tasks.map((t) => [t.id, t]));
  const outcomes = new Map<string, TaskOutcome>();
  const workspaces = new Map<string, Workspace>();

  for (const taskId of topoOrder(opts.plan)) {
    const task = byId.get(taskId);
    if (!task) continue;

    if (opts.signal?.aborted) {
      finish(outcomes, opts, { taskId, state: 'skipped', note: '사용자 중단', attempts: [] });
      continue;
    }

    if (governor.budgetExceeded()) {
      finish(outcomes, opts, {
        taskId,
        state: 'skipped',
        note: `예산 초과 ($${governor.totalCostUsd.toFixed(4)})`,
        attempts: [],
      });
      continue;
    }

    // 선행 작업이 정산에 성공하지 못했으면 시작하지 않는다.
    const failedDep = task.dependsOn.find((dep) => outcomes.get(dep)?.state !== 'succeeded');
    if (failedDep) {
      finish(outcomes, opts, {
        taskId,
        state: 'blocked',
        note: `선행 작업 ${failedDep}이(가) 성공하지 못했습니다`,
        attempts: [],
      });
      continue;
    }

    // 리뷰는 검토 대상을 만든 provider를 피한다.
    const avoid = task.context
      .map((ref) => outcomes.get(ref)?.provider)
      .filter((p): p is Provider => p !== undefined);

    // 계획이나 설정이 담당을 못박아 뒀으면 교차 검증 휴리스틱을 적용하지 않는다.
    const explicit = Boolean(task.providers ?? opts.routes?.[task.role]);
    const routed = route({
      role: task.role,
      available: opts.available,
      explicit,
      ...(opts.routes ? { routes: opts.routes } : {}),
      ...(task.providers ? { preferred: task.providers } : {}),
      ...(!explicit && avoid.length > 0 && task.role === 'review' ? { avoid } : {}),
    });

    if (!routed) {
      finish(outcomes, opts, {
        taskId,
        state: 'skipped',
        note: '쓸 수 있는 provider가 없습니다',
        attempts: [],
      });
      continue;
    }

    // Governor가 쿼터 상태를 반영해 후보를 거르고 재정렬한다.
    const ordered = governor.order([routed.provider, ...routed.fallbacks]);
    if (ordered.length === 0) {
      finish(outcomes, opts, {
        taskId,
        state: 'skipped',
        note: '후보 provider가 전부 쿼터 소진 또는 상한 도달',
        attempts: [],
      });
      continue;
    }

    const workspacePlan = resolveWorkspace(task, workspaces);
    const contextBlock = buildContextBlock(collectArtifacts(task, outcomes));
    const attempts: AttemptRecord[] = [];
    let final: DispatchResult | undefined;

    for (const [index, candidate] of ordered.slice(0, maxAttempts).entries()) {
      const attempt = index + 1;
      const reason = candidate.note
        ? `${routed.reason} — ${candidate.note}`
        : attempt > 1
          ? `${routed.reason} (재배치 #${attempt})`
          : routed.reason;
      opts.onTaskStart?.(task, candidate.provider, reason);

      const request: DispatchRequest = {
        provider: candidate.provider,
        spec: task.spec,
        mode: task.mode ?? (task.role === 'design' || task.role === 'review' ? 'plan' : 'write'),
        cwd: opts.cwd,
        workspace: workspacePlan,
        isolate: opts.isolate,
        autoApprove: opts.autoApprove,
        protocol: opts.protocol,
        answerMode: opts.answerMode,
        ...(opts.askHuman ? { askHuman: opts.askHuman } : {}),
        timeoutMs: opts.timeoutMs,
        runDir: opts.runDir,
        taskId: task.id,
        attempt,
        ...(contextBlock ? { contextBlock } : {}),
        ...(task.models?.[candidate.provider]
          ? { model: task.models[candidate.provider]! }
          : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.observerFor ? { observer: wrapObserver(opts, task, governor, candidate.provider) } : {}),
      };

      const result = await execute(request);
      governor.observeDispatch(candidate.provider);
      for (const error of result.errors) governor.observeEvent(candidate.provider, error);
      if (result.usage) governor.observeEvent(candidate.provider, result.usage);

      if (result.workspace) workspaces.set(task.id, result.workspace);
      final = result;

      if (result.outcome === 'succeeded') {
        attempts.push({ provider: candidate.provider, attempt, outcome: result.outcome });
        break;
      }

      // 다른 벤더에서 풀릴 실패인가? 아니면 여기서 멈춘다.
      const failover = shouldFailover(result.errors);
      const next = ordered[index + 1];
      const failoverReason = failover
        ? (result.errors.find((e) => e.retryOn === 'other-provider')?.code ?? 'retryable')
        : undefined;

      attempts.push({
        provider: candidate.provider,
        attempt,
        outcome: result.outcome,
        ...(failoverReason ? { failoverReason } : {}),
      });

      if (!failover || !next || attempt >= maxAttempts) break;

      opts.onFailover?.(task.id, candidate.provider, next.provider, failoverReason ?? '');
    }

    const succeeded = final?.outcome === 'succeeded';
    finish(outcomes, opts, {
      taskId,
      state: succeeded ? 'succeeded' : 'failed',
      attempts,
      ...(final ? { provider: final.provider, result: final } : {}),
      ...(final?.note ? { note: final.note } : { note: routed.reason }),
    });
  }

  return opts.plan.tasks.map(
    (t) => outcomes.get(t.id) ?? { taskId: t.id, state: 'pending' as TaskState, attempts: [] },
  );
}

function finish(
  outcomes: Map<string, TaskOutcome>,
  opts: SchedulerOptions,
  outcome: TaskOutcome,
): void {
  outcomes.set(outcome.taskId, outcome);
  opts.onTaskEnd?.(outcome);
}

/** 이벤트를 Governor에도 흘려 예측형 쿼터 신호를 놓치지 않게 한다. */
function wrapObserver(
  opts: SchedulerOptions,
  task: PlanTask,
  governor: Governor,
  provider: Provider,
): DispatchObserver {
  const inner = opts.observerFor?.(task) ?? {};
  return {
    ...inner,
    onEvent: (event) => {
      governor.observeEvent(provider, event);
      inner.onEvent?.(event);
    },
  };
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
