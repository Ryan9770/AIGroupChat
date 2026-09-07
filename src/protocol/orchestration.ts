import type { Provider } from './provider.js';

/**
 * 워커 협약의 데이터 모델. SPEC §5.5
 *
 *   Run       하나의 목표. 사용자 요청 1건.
 *    └ Task   할 일 단위.
 *       └ Dispatch  그 Task를 특정 워커에게 맡긴 한 번의 시도.
 *
 * Task와 Dispatch를 나누는 이유는 재시도다. 쿼터가 소진돼 다른 벤더로 넘기면
 * 할 일은 그대로고 시도만 새로 생긴다. 붙여두면 재시도 이력이 사라지고,
 * 실패한 이전 시도의 늦은 보고가 현재 시도를 완료 처리해버릴 수 있다. ADR-8
 */

export interface Run {
  id: string;
  objective: string;
  createdAt: string;
}

export type TaskState = 'pending' | 'running' | 'succeeded' | 'failed';

export interface Task {
  id: string;
  runId: string;
  spec: string;
  state: TaskState;
  createdAt: string;
}

/** 워커의 주장(`worker_done`)이 아니라 오케스트레이터의 판정. ADR-9 */
export type Settlement = 'released' | 'retained';

export type DispatchOutcome =
  | 'succeeded'
  | 'failed'
  /** 워커가 worker_done 없이 그냥 끝났다. 성공으로 치지 않는다. */
  | 'no_completion'
  | 'cancelled';

export interface Dispatch {
  id: string;
  runId: string;
  taskId: string;
  provider: Provider;
  /** 같은 Task의 몇 번째 시도인가. 1부터. */
  attempt: number;
  workspaceId?: string;
  workerHandle: string;
  startedAt: string;
  settledAt?: string;
  settlement?: Settlement;
  outcome?: DispatchOutcome;
  /** 판정 근거. 워커의 말이 아니라 git이 알려준 것. */
  filesChanged?: string[];
}

export type MessageType = 'question' | 'worker_done' | 'escalation' | 'heartbeat';

/**
 * 워커 → 오케스트레이터 메시지.
 *
 * taskId와 dispatchId를 **둘 다** 싣는다. 실패한 이전 시도에서 늦게 도착한
 * worker_done이 현재 재시도를 완료 처리하는 걸 막기 위해서다. ADR-8
 */
export interface WorkerMessage {
  id: string;
  type: MessageType;
  runId: string;
  taskId: string;
  dispatchId: string;
  from: string;
  createdAt: string;
  subject?: string;
  body?: string;
  /** worker_done 전용. */
  outcome?: 'succeeded' | 'failed';
  filesModified?: string[];
  /** question 전용. 워커가 제시한 선택지. */
  options?: string[];
  /** heartbeat 전용. */
  phase?: string;
}

export interface Reply {
  messageId: string;
  body: string;
  createdAt: string;
  /** 사람이 답했는지, 자동 응답인지. 로그를 나중에 읽을 때 중요하다. */
  source: 'human' | 'auto';
}

/** 워커 프로세스가 env로 받는 자기 정체성. */
export interface WorkerIdentity {
  runDir: string;
  runId: string;
  taskId: string;
  dispatchId: string;
  workerHandle: string;
}

export const ENV = {
  runDir: 'CONDUCTOR_RUN_DIR',
  runId: 'CONDUCTOR_RUN_ID',
  taskId: 'CONDUCTOR_TASK_ID',
  dispatchId: 'CONDUCTOR_DISPATCH_ID',
  worker: 'CONDUCTOR_WORKER',
} as const;

export function readIdentityFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): WorkerIdentity | null {
  const runDir = env[ENV.runDir];
  const runId = env[ENV.runId];
  const taskId = env[ENV.taskId];
  const dispatchId = env[ENV.dispatchId];
  const workerHandle = env[ENV.worker];

  if (!runDir || !runId || !taskId || !dispatchId || !workerHandle) return null;
  return { runDir, runId, taskId, dispatchId, workerHandle };
}
