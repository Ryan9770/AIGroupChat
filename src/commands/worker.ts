import { readIdentityFromEnv, type WorkerMessage } from '../protocol/orchestration.js';
import { appendMessage, waitForReply } from '../store/run-store.js';

/**
 * 워커 프로세스가 셸에서 호출하는 명령들.
 *
 * `conductor run` 쪽(오케스트레이터)과 **다른 프로세스**로 실행되며,
 * 자기 정체성은 env로 받는다. 상태는 run 디렉토리의 파일로 주고받는다.
 */

function requireIdentity(): ReturnType<typeof readIdentityFromEnv> {
  const identity = readIdentityFromEnv();
  if (!identity) {
    process.stderr.write(
      'conductor worker 명령은 배치된 워커 안에서만 쓸 수 있습니다.\n' +
        '(CONDUCTOR_RUN_DIR 등 환경변수가 없습니다. `conductor run --protocol`로 시작된 세션인지 확인하세요.)\n',
    );
    return null;
  }
  return identity;
}

/**
 * 프리앰블이 알려준 ID와 실제 env의 ID가 어긋나면 거부한다.
 *
 * 실패한 이전 시도에서 늦게 도착한 보고가 현재 재시도를 완료 처리하는 걸 막는다. ADR-8
 */
function idsMatch(
  identity: NonNullable<ReturnType<typeof readIdentityFromEnv>>,
  provided: { taskId?: string; dispatchId?: string },
): boolean {
  if (provided.taskId && provided.taskId !== identity.taskId) return false;
  if (provided.dispatchId && provided.dispatchId !== identity.dispatchId) return false;
  return true;
}

function rejectMismatch(): number {
  process.stderr.write(
    '전달된 task-id/dispatch-id가 현재 배치와 일치하지 않습니다. 보고를 기록하지 않았습니다.\n',
  );
  return 2;
}

export async function workerDone(opts: {
  outcome: 'succeeded' | 'failed';
  body: string;
  subject?: string;
  filesModified?: string[];
  taskId?: string;
  dispatchId?: string;
}): Promise<number> {
  const identity = requireIdentity();
  if (!identity) return 2;
  if (!idsMatch(identity, opts)) return rejectMismatch();

  if (!opts.body.trim()) {
    process.stderr.write('--body는 비울 수 없습니다. 3문장 요약을 넣으세요.\n');
    return 2;
  }

  await appendMessage(identity.runDir, {
    type: 'worker_done',
    runId: identity.runId,
    taskId: identity.taskId,
    dispatchId: identity.dispatchId,
    from: identity.workerHandle,
    outcome: opts.outcome,
    body: opts.body,
    ...(opts.subject ? { subject: opts.subject } : {}),
    ...(opts.filesModified?.length ? { filesModified: opts.filesModified } : {}),
  });

  process.stdout.write(`완료 보고를 기록했습니다 (${opts.outcome}). 이 작업에서 당신의 차례는 끝났습니다.\n`);
  return 0;
}

export async function workerAsk(opts: {
  question: string;
  options?: string[];
  timeoutMs: number;
}): Promise<number> {
  const identity = requireIdentity();
  if (!identity) return 2;

  const message = await appendMessage(identity.runDir, {
    type: 'question',
    runId: identity.runId,
    taskId: identity.taskId,
    dispatchId: identity.dispatchId,
    from: identity.workerHandle,
    body: opts.question,
    ...(opts.options?.length ? { options: opts.options } : {}),
  });

  const reply = await waitForReply(identity.runDir, message.id, { timeoutMs: opts.timeoutMs });

  if (!reply) {
    // 중복 질문을 만들지 않도록 메시지 ID를 알려준다.
    process.stderr.write(
      `질문에 대한 답을 ${Math.round(opts.timeoutMs / 1000)}초 안에 받지 못했습니다 (${message.id}).\n` +
        '같은 질문을 다시 만들지 말고, 가정을 세워 진행한 뒤 그 가정을 worker done 본문에 적으세요.\n',
    );
    return 1;
  }

  // 워커는 stdout으로 답만 받는다.
  process.stdout.write(`${reply.body}\n`);
  return 0;
}

export async function workerEscalate(opts: {
  subject: string;
  body: string;
  taskId?: string;
  dispatchId?: string;
}): Promise<number> {
  const identity = requireIdentity();
  if (!identity) return 2;
  if (!idsMatch(identity, opts)) return rejectMismatch();

  await appendMessage(identity.runDir, {
    type: 'escalation',
    runId: identity.runId,
    taskId: identity.taskId,
    dispatchId: identity.dispatchId,
    from: identity.workerHandle,
    subject: opts.subject,
    body: opts.body,
  });

  process.stdout.write('에스컬레이션을 기록했습니다.\n');
  return 0;
}

export async function workerHeartbeat(phase: string): Promise<number> {
  const identity = requireIdentity();
  if (!identity) return 2;

  await appendMessage(identity.runDir, {
    type: 'heartbeat',
    runId: identity.runId,
    taskId: identity.taskId,
    dispatchId: identity.dispatchId,
    from: identity.workerHandle,
    phase,
  });
  return 0;
}

/**
 * 코디네이터의 후속 지시를 확인한다.
 *
 * 워커를 인터럽트하지 않는 게 핵심이다. 지시는 워커가 들여다볼 때만 도착한다.
 */
export async function workerCheck(): Promise<number> {
  const identity = requireIdentity();
  if (!identity) return 2;

  // M3에서는 코디네이터 → 워커 지시가 질문에 대한 답변뿐이라
  // 확인할 미결 항목이 없으면 그렇다고 알린다.
  const { readNewMessages } = await import('../store/run-store.js');
  const pending: WorkerMessage[] = await readNewMessages(identity.runDir, new Set());
  const mine = pending.filter(
    (m) => m.dispatchId === identity.dispatchId && m.type === 'escalation',
  );

  if (mine.length === 0) {
    process.stdout.write('새 지시 없음. 계속 진행하세요.\n');
    return 0;
  }
  process.stdout.write(`미결 에스컬레이션 ${mine.length}건이 있습니다.\n`);
  return 0;
}
