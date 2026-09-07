import { getAdapter } from '../adapters/registry.js';
import { Coordinator } from '../orchestration/coordinator.js';
import { writeConductorShim } from '../orchestration/shim.js';
import type { AgentEvent } from '../protocol/events.js';
import {
  ENV,
  type Dispatch,
  type DispatchOutcome,
} from '../protocol/orchestration.js';
import { buildDispatchPreamble } from '../protocol/preamble.js';
import type { ExecutionMode, Provider } from '../protocol/provider.js';
import { runAgent } from '../process/manager.js';
import {
  newDispatchId,
  runPaths,
  saveDispatch,
} from '../store/run-store.js';
import {
  checkBaseDrift,
  collectChanges,
  createWorkspace,
  removeWorkspace,
  type Workspace,
} from '../workspace/worktree.js';

/** 이 배치가 어디서 일할지. */
export type WorkspacePlan =
  | { kind: 'none' }
  | { kind: 'new'; label: string }
  /** 이미 만들어진 worktree에서 이어서 작업한다. 리뷰가 구현 결과를 보려면 필요하다. */
  | { kind: 'reuse'; workspace: Workspace };

export interface DispatchObserver {
  /** 정규화 이벤트. 상세 출력이 필요한 쪽만 구현한다. */
  onEvent?: (event: AgentEvent) => void;
  /** 사람에게 알릴 부가 정보(드리프트 경고, 워커 질문, 에스컬레이션). */
  onNotice?: (text: string) => void;
}

export interface DispatchRequest {
  provider: Provider;
  /** 과제 서술. 프리앰블·참고자료는 여기서 조립한다. */
  spec: string;
  /** 앞선 Task의 산출물 블록. 이미 데이터로 프레이밍된 문자열. */
  contextBlock?: string;
  mode: ExecutionMode;
  model?: string;
  /** 이어갈 세션/대화 ID. */
  resumeId?: string;
  /** 저장소 루트 또는 작업 디렉토리. */
  cwd: string;
  workspace: WorkspacePlan;
  isolate: boolean;
  autoApprove: boolean;
  protocol: boolean;
  answerMode: 'human' | 'auto';
  timeoutMs: number;
  /** 계획 실행 시 여러 Task가 같은 run 디렉토리를 공유한다. */
  runDir?: string;
  taskId: string;
  attempt: number;
  signal?: AbortSignal;
  observer?: DispatchObserver;
  /** 변경이 없으면 worktree를 정리한다. */
  cleanEmpty?: boolean;
}

export interface DispatchResult {
  dispatchId: string;
  provider: Provider;
  taskId: string;
  status: 'success' | 'error' | 'cancelled';
  outcome: DispatchOutcome;
  /** 워커의 worker_done 본문. 협약을 안 쓰면 마지막 응답 텍스트. */
  report: string;
  filesChanged: string[];
  workspace?: Workspace;
  sessionId?: string;
  usage?: Extract<AgentEvent, { kind: 'usage' }>;
  durationMs: number;
  /** 사람에게 보여줄 판정 근거. */
  note?: string;
  /**
   * 실행 중 나온 오류들. Governor가 페일오버를 판단하는 재료다.
   * 결과에 담아 넘기지 않으면 스케줄러가 "왜 실패했는지" 알 수 없다.
   */
  errors: Extract<AgentEvent, { kind: 'error' }>[];
}

/**
 * Task 하나를 워커에게 맡기고 정산까지 마친다.
 *
 * `conductor run`(단일 실행)과 스케줄러(계획 실행)가 **같은 경로**를 쓴다.
 * 두 곳에 복제하면 한쪽만 고쳐지는 사고가 난다.
 */
export async function executeDispatch(request: DispatchRequest): Promise<DispatchResult> {
  const adapter = getAdapter(request.provider);
  const notice = (text: string) => request.observer?.onNotice?.(text);
  const startedAt = Date.now();

  // ── 워크스페이스 ────────────────────────────────────────────────────────
  let workspace: Workspace | undefined;
  let ownsWorkspace = false;

  if (request.workspace.kind === 'new') {
    workspace = await createWorkspace({ cwd: request.cwd, label: request.workspace.label });
    ownsWorkspace = true;
  } else if (request.workspace.kind === 'reuse') {
    workspace = request.workspace.workspace;
  }

  const workerCwd = workspace?.path ?? request.cwd;

  // 뒤처진 경우에만 알린다. 매번 띄우면 워커도 사람도 무시하게 된다.
  const drift = workspace && ownsWorkspace ? await checkBaseDrift(workspace) : undefined;
  if (drift) {
    notice(`기준(${drift.base})보다 ${drift.behind}개 커밋 뒤처짐`);
  }

  // ── 워커 협약 ──────────────────────────────────────────────────────────
  const dispatchId = newDispatchId();
  const workerHandle = `${request.provider}-${request.attempt}`;
  let coordinator: Coordinator | undefined;
  let dispatchRecord: Dispatch | undefined;

  const taskWithContext = request.contextBlock
    ? `${request.spec}\n${request.contextBlock}`
    : request.spec;

  let workerPrompt = taskWithContext;
  let workerEnv: Record<string, string> = {};

  if (request.protocol && request.runDir) {
    const paths = runPaths(request.runDir);

    dispatchRecord = {
      id: dispatchId,
      runId: request.runDir,
      taskId: request.taskId,
      provider: request.provider,
      attempt: request.attempt,
      workerHandle,
      startedAt: new Date().toISOString(),
      ...(workspace ? { workspaceId: workspace.id } : {}),
    };
    await saveDispatch(request.runDir, dispatchRecord);

    const cli = await writeConductorShim(paths.bin);
    workerPrompt = buildDispatchPreamble({
      taskId: request.taskId,
      dispatchId,
      taskSpec: taskWithContext,
      workerHandle,
      cli,
      canAsk: request.answerMode === 'human',
      ...(drift ? { baseDrift: drift } : {}),
    });

    workerEnv = {
      [ENV.runDir]: request.runDir,
      [ENV.runId]: request.runDir,
      [ENV.taskId]: request.taskId,
      [ENV.dispatchId]: dispatchId,
      [ENV.worker]: workerHandle,
    };

    coordinator = new Coordinator({
      runDir: request.runDir,
      dispatchId,
      render: (text) => notice(text.trim()),
      answerMode: request.answerMode,
    });
    coordinator.start();
  }

  // ── 실행 ───────────────────────────────────────────────────────────────
  let status: 'success' | 'error' | 'cancelled' = 'error';
  let sessionId: string | undefined;
  let usage: Extract<AgentEvent, { kind: 'usage' }> | undefined;
  let finalText = '';
  const errors: Extract<AgentEvent, { kind: 'error' }>[] = [];

  try {
    const events = runAgent(
      adapter,
      {
        prompt: workerPrompt,
        mode: request.mode,
        cwd: workerCwd,
        isolate: request.isolate,
        autoApprove: request.autoApprove,
        env: workerEnv,
        // 협약을 쓰면 워커가 run 디렉토리에 보고 파일을 써야 한다.
        // 샌드박스가 있는 provider는 이 경로가 열려 있어야 완료를 알릴 수 있다.
        ...(request.protocol && request.runDir ? { writableDirs: [request.runDir] } : {}),
        ...(request.model ? { model: request.model } : {}),
        ...(request.resumeId ? { resumeId: request.resumeId } : {}),
      },
      {
        timeoutMs: request.timeoutMs,
        ...(request.signal ? { signal: request.signal } : {}),
      },
    );

    for await (const event of events) {
      request.observer?.onEvent?.(event);
      if (event.kind === 'session.started') sessionId = event.sessionId;
      else if (event.kind === 'error') errors.push(event);
      else if (event.kind === 'usage') usage = event;
      else if (event.kind === 'message.final') finalText = event.text;
      else if (event.kind === 'session.finished') status = event.status;
    }
  } finally {
    // 워커가 종료 직전에 남긴 worker_done을 놓치지 않도록 마지막으로 훑는다.
    await coordinator?.stop();
  }

  // ── 정산 ───────────────────────────────────────────────────────────────
  // 무엇이 바뀌었는지는 워커의 말이 아니라 git에게 묻는다.
  const changes = workspace ? await collectChanges(workspace) : undefined;
  const filesChanged = changes?.files ?? [];

  let outcome: DispatchOutcome;
  let note: string | undefined;
  let report = finalText;

  if (status === 'cancelled') {
    outcome = 'cancelled';
  } else if (request.protocol) {
    const completion = coordinator?.completion;
    if (!completion) {
      // 프로세스가 0으로 끝났어도 완료 보고가 없으면 성공으로 치지 않는다. ADR-9
      outcome = 'no_completion';
      note = '워커가 worker done 없이 종료했습니다 — 완료로 인정하지 않습니다.';
      status = 'error';
    } else {
      outcome = completion.outcome;
      report = completion.body;
      if (completion.outcome === 'failed') {
        status = 'error';
        note = `워커가 실패로 보고: ${completion.body}`;
      } else {
        note = completion.body;
        if (request.mode === 'write' && filesChanged.length === 0) {
          note += ' (⚠ 성공 보고와 달리 변경된 파일이 없습니다)';
        }
      }
    }
  } else {
    outcome = status === 'success' ? 'succeeded' : 'failed';
  }

  if (dispatchRecord && request.runDir) {
    await saveDispatch(request.runDir, {
      ...dispatchRecord,
      outcome,
      settlement: outcome === 'succeeded' ? 'released' : 'retained',
      settledAt: new Date().toISOString(),
      filesChanged,
    });
  }

  // 우리가 만든 worktree이고 아무것도 안 바뀌었으면 치운다.
  // 남의 worktree(reuse)는 건드리지 않는다.
  if (workspace && ownsWorkspace && filesChanged.length === 0 && request.cleanEmpty) {
    await removeWorkspace(workspace).catch(() => undefined);
    workspace = undefined;
  }

  return {
    dispatchId,
    provider: request.provider,
    taskId: request.taskId,
    status,
    outcome,
    report,
    filesChanged,
    errors,
    durationMs: Date.now() - startedAt,
    ...(workspace ? { workspace } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(usage ? { usage } : {}),
    ...(note ? { note } : {}),
  };
}
