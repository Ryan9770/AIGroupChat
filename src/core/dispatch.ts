import { getAdapter } from '../adapters/registry.js';
import { Coordinator, type PendingQuestion } from '../orchestration/coordinator.js';
import { pathWithShim, writeConductorShim } from '../orchestration/shim.js';
import type { AgentEvent } from '../protocol/events.js';
import {
  ENV,
  type CompletionSource,
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
  collectChangesSince,
  captureWorkingTreeSnapshot,
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
  /** 질문에 답하는 경로를 갈아끼운다(웹 UI 등). 없으면 터미널에서 묻는다. */
  askHuman?: (question: PendingQuestion) => Promise<string | null>;
  timeoutMs: number;
  /** 계획 실행 시 여러 Task가 같은 run 디렉토리를 공유한다. */
  runDir?: string;
  taskId: string;
  attempt: number;
  signal?: AbortSignal;
  observer?: DispatchObserver;
  /** 변경이 없으면 worktree를 정리한다. */
  cleanEmpty?: boolean;
  /** 팀장(Leader / Design) 역할 여부. AiKA 모드 안내를 주입한다. */
  isLeader?: boolean;
}

export interface DispatchResult {
  dispatchId: string;
  provider: Provider;
  taskId: string;
  status: 'success' | 'error' | 'cancelled';
  outcome: DispatchOutcome;
  /** Present when protocol completion was explicit or safely recovered. */
  completionSource?: CompletionSource;
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

export interface VerifiedExitEvidence {
  provider: Provider;
  mode: ExecutionMode;
  status: DispatchResult['status'];
  finalText: string;
  filesChanged: string[];
  errors: DispatchResult['errors'];
}

export interface VerifiedExitCompletion {
  report: string;
  note: string;
}

/**
 * Recover Antigravity's missing handshake only when provider and artifact evidence
 * agree that the turn completed. Antigravity can finish a long clean turn without
 * executing the final shell command; blocking the review in that case discards
 * the strongest independent evidence we have: a successful provider result and
 * a measured working-tree delta.
 */
export function recoverVerifiedExit(
  evidence: VerifiedExitEvidence,
): VerifiedExitCompletion | undefined {
  if (
    evidence.provider !== 'antigravity' ||
    evidence.status !== 'success' ||
    evidence.errors.length > 0
  ) {
    return undefined;
  }

  const finalText = evidence.finalText.trim();
  if (evidence.mode === 'write' && evidence.filesChanged.length === 0) return undefined;
  if (evidence.mode === 'plan' && !finalText) return undefined;

  const artifactSummary = `${evidence.filesChanged.length}개 파일 변경`;
  return {
    report:
      finalText ||
      `Antigravity가 정상 종료했고 Git에서 ${artifactSummary}을 확인했습니다. ` +
        'worker done 보고는 누락되어 Conductor가 검증 가능한 실행 결과로 완료를 복구했습니다. ' +
        '후속 리뷰에서 구현 내용과 테스트 결과를 검증해야 합니다.',
    note:
      `worker done 누락 자동 복구: Antigravity 정상 종료` +
      (evidence.filesChanged.length > 0 ? ` + ${artifactSummary} 확인` : ' + 최종 응답 확인') +
      '. 다음 리뷰를 계속합니다.',
  };
}

/**
 * Task 하나를 워커에게 맡기고 정산까지 마친다.
 *
 * `conductor run`(단일 실행)과 스케줄러(계획 실행)가 **같은 경로**를 쓴다.
 * 두 곳에 복제하면 한쪽만 고쳐지는 사고가 난다.
 */
export class DispatchConfigError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = 'DispatchConfigError';
  }
}

export async function executeDispatch(request: DispatchRequest): Promise<DispatchResult> {
  const adapter = getAdapter(request.provider);
  const notice = (text: string) => request.observer?.onNotice?.(text);
  const startedAt = Date.now();

  // 🔴 협약은 워커가 셸로 보고하게 만든다. 명령을 골라 허용할 수 없는 provider는
  // 전면 승인(autoApprove) 없이는 보고를 못 하고, 무조건 no_completion으로 끝난다.
  // 실행해봐야 결과가 정해져 있으므로 쿼터를 태우기 전에 막는다. (실측으로 확인된 조합)
  if (
    request.protocol &&
    !request.autoApprove &&
    adapter.capability.commandPermission === 'all-or-nothing'
  ) {
    throw new DispatchConfigError(
      `${request.provider}는 협약 보고에 필요한 셸 명령만 골라 허용할 수 없습니다.`,
      '도구 자동 승인(--yolo)을 켜거나, 협약(--protocol)을 끄세요. ' +
        '자동 승인을 켤 때는 작업 공간 격리(--workspace)를 함께 쓰는 것이 안전합니다.',
    );
  }

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
  const directBaseline = workspace ? undefined : await captureWorkingTreeSnapshot(workerCwd);

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
  let shimCommand: string | undefined;

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

    const shim = await writeConductorShim(paths.bin);
    shimCommand = shim.command;
    workerPrompt = buildDispatchPreamble({
      taskId: request.taskId,
      dispatchId,
      taskSpec: taskWithContext,
      workerHandle,
      cli: shim.command,
      canAsk: request.answerMode === 'human',
      ...(request.isLeader !== undefined ? { isLeader: request.isLeader } : {}),
      ...(drift ? { baseDrift: drift } : {}),
    });

    workerEnv = {
      // 심을 PATH에 얹어 워커가 `conductor`만 쳐도 되게 한다.
      // 절대 경로를 쓰면 권한을 좁게 허용하는 패턴이 안정적으로 안 맞는다.
      PATH: pathWithShim(shim.binDir),
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
      ...(request.askHuman ? { askHuman: request.askHuman } : {}),
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
        // 협약을 쓰면 워커가 이 명령으로 보고해야 한다. 막히면 완료를 알릴 방법이 없다.
        ...(shimCommand ? { allowCommands: [shimCommand] } : {}),
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
  const changes = workspace
    ? await collectChanges(workspace)
    : directBaseline
      ? await collectChangesSince(directBaseline)
      : undefined;
  const filesChanged = changes?.files ?? [];

  let outcome: DispatchOutcome;
  let completionSource: CompletionSource | undefined;
  let note: string | undefined;
  let report = finalText;

  if (status === 'cancelled') {
    outcome = 'cancelled';
  } else if (request.protocol) {
    const completion = coordinator?.completion;
    if (!completion) {
      const recovered = recoverVerifiedExit({
        provider: request.provider,
        mode: request.mode,
        status,
        finalText,
        filesChanged,
        errors,
      });
      if (recovered) {
        outcome = 'succeeded';
        completionSource = 'verified_exit';
        report = recovered.report;
        note = recovered.note;
      } else {
        outcome = 'no_completion';
        const executionError = errors.at(-1);
        note = executionError
          ? `워커 실행 오류(${executionError.code}) 뒤 worker done도 수신하지 못했습니다: ${executionError.message}`
          : '워커가 worker done 없이 종료했습니다 — 완료로 인정하지 않습니다.';
        status = 'error';
      }
    } else {
      outcome = completion.outcome;
      completionSource = 'worker_done';
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
      ...(completionSource ? { completionSource } : {}),
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
    ...(completionSource ? { completionSource } : {}),
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
