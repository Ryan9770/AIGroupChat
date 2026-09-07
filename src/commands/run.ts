import { getAdapter, isProvider } from '../adapters/registry.js';
import type { AgentEvent } from '../protocol/events.js';
import type { ExecutionMode, Provider } from '../protocol/provider.js';
import { runAgent } from '../process/manager.js';
import { bold, cyan, dim, green, red, yellow } from '../ui/format.js';
import { Coordinator } from '../orchestration/coordinator.js';
import { writeConductorShim } from '../orchestration/shim.js';
import { ENV, type Dispatch, type DispatchOutcome } from '../protocol/orchestration.js';
import { buildDispatchPreamble } from '../protocol/preamble.js';
import {
  createRun,
  newDispatchId,
  newTaskId,
  runPaths,
  saveDispatch,
  saveTask,
} from '../store/run-store.js';
import {
  checkBaseDrift,
  collectChanges,
  createWorkspace,
  removeWorkspace,
  WorkspaceError,
  type Workspace,
} from '../workspace/worktree.js';

export interface RunCommandOptions {
  agent: string;
  mode: ExecutionMode;
  model?: string;
  cwd: string;
  resume?: string;
  timeoutMs: number;
  /** 정규화 이벤트를 JSONL로 그대로 흘린다. 파이프라인 연결용. */
  json: boolean;
  /** 호스트 프로젝트 컨텍스트 상속 격리를 끈다. */
  noIsolate: boolean;
  /** 도구 승인 프롬프트를 자동 승인한다. 워크스페이스 격리 전에는 위험하다. */
  autoApprove: boolean;
  /** 전용 git worktree를 만들어 그 안에서 워커를 돌린다. */
  workspace: boolean;
  /** 변경이 없으면 실행 후 worktree를 자동 정리한다. */
  cleanEmpty: boolean;
  /** 워커 협약을 켠다: 프리앰블 주입 + ask/done 수신 + 정산. */
  protocol: boolean;
  /** 협약 사용 시 질문에 사람이 답할지, 자동 응답할지. */
  answerMode: 'human' | 'auto';
}

/** 사용률이 이 이상이면 경고를 띄운다. Governor가 재라우팅을 고민해야 할 지점. */
const RATE_LIMIT_WARN = 0.8;

function renderNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export async function run(prompt: string, opts: RunCommandOptions): Promise<number> {
  if (!isProvider(opts.agent)) {
    process.stderr.write(`알 수 없는 provider: ${opts.agent}\n`);
    return 2;
  }
  const provider: Provider = opts.agent;
  const adapter = getAdapter(provider);

  // Ctrl+C로 워커를 확실히 정리한다. 안 그러면 고아 프로세스가 남는다.
  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.once('SIGINT', onSigint);

  const startedAt = Date.now();
  let status: 'success' | 'error' | 'cancelled' = 'error';
  let usage: Extract<AgentEvent, { kind: 'usage' }> | undefined;
  let sessionId: string | undefined;
  let unknownCount = 0;
  let inMessage = false;

  const write = (s: string) => process.stdout.write(s);
  const human = !opts.json;

  // 워커가 실제로 일할 곳. --workspace면 전용 worktree, 아니면 지정된 cwd.
  let workspace: Workspace | undefined;
  let workerCwd = opts.cwd;

  if (opts.workspace) {
    try {
      workspace = await createWorkspace({ cwd: opts.cwd, label: `${provider}-${opts.mode}` });
      workerCwd = workspace.path;
    } catch (err) {
      if (err instanceof WorkspaceError) {
        process.stderr.write(`${red(err.message)}\n`);
        if (err.hint) process.stderr.write(`${dim(err.hint)}\n`);
        return 2;
      }
      throw err;
    }
  }

  if (human) {
    write(`${dim('provider')} ${cyan(provider)}  ${dim('mode')} ${opts.mode}`);
    if (workspace) write(`  ${dim('workspace')} ${workspace.id}`);
    write('\n');

    if (workspace) {
      // 뒤처진 경우에만 알린다. 매번 띄우면 워커도 사람도 무시하게 된다.
      const drift = await checkBaseDrift(workspace);
      if (drift) {
        write(
          `${yellow(`  ! 기준(${drift.base})보다 ${drift.behind}개 커밋 뒤처짐`)}\n` +
            drift.recentSubjects.map((s) => `${dim(`      - ${s}`)}\n`).join(''),
        );
      }
    }
  }

  // 워커 협약: 프리앰블을 프롬프트 앞에 붙이고, 워커가 보낼 메시지를 받을 준비를 한다.
  let coordinator: Coordinator | undefined;
  let dispatch: Dispatch | undefined;
  let workerPrompt = prompt;
  let workerEnv: Record<string, string> = {};

  if (opts.protocol) {
    const stateRoot = workspace?.repoRoot ?? opts.cwd;
    const { runDir } = await createRun({ stateRoot, objective: prompt });
    const paths = runPaths(runDir);

    const taskId = newTaskId();
    const dispatchId = newDispatchId();
    const workerHandle = `${provider}-1`;

    await saveTask(runDir, {
      id: taskId,
      runId: runDir,
      spec: prompt,
      state: 'running',
      createdAt: new Date().toISOString(),
    });

    dispatch = {
      id: dispatchId,
      runId: runDir,
      taskId,
      provider,
      attempt: 1,
      workerHandle,
      startedAt: new Date().toISOString(),
      ...(workspace ? { workspaceId: workspace.id } : {}),
    };
    await saveDispatch(runDir, dispatch);

    const cli = await writeConductorShim(paths.bin);
    const drift = workspace ? await checkBaseDrift(workspace) : undefined;

    workerPrompt = buildDispatchPreamble({
      taskId,
      dispatchId,
      taskSpec: prompt,
      workerHandle,
      cli,
      canAsk: opts.answerMode === 'human',
      ...(drift ? { baseDrift: drift } : {}),
    });

    workerEnv = {
      [ENV.runDir]: runDir,
      [ENV.runId]: runDir,
      [ENV.taskId]: taskId,
      [ENV.dispatchId]: dispatchId,
      [ENV.worker]: workerHandle,
    };

    coordinator = new Coordinator({
      runDir,
      dispatchId,
      render: write,
      answerMode: opts.answerMode,
    });
    coordinator.start();

    if (human) write(`${dim('protocol')} on  ${dim('dispatch')} ${dispatchId}\n`);
  }

  try {
    const events = runAgent(
      adapter,
      {
        prompt: workerPrompt,
        mode: opts.mode,
        cwd: workerCwd,
        isolate: !opts.noIsolate,
        autoApprove: opts.autoApprove,
        env: workerEnv,
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.resume ? { resumeId: opts.resume } : {}),
      },
      { timeoutMs: opts.timeoutMs, signal: controller.signal },
    );

    for await (const event of events) {
      if (opts.json) {
        write(`${JSON.stringify(event)}\n`);
        if (event.kind === 'session.finished') status = event.status;
        continue;
      }

      // 사람이 읽는 모드. 본문 텍스트는 그대로 이어붙이고,
      // 부가 정보는 줄을 바꿔 구분한다.
      switch (event.kind) {
        case 'session.started':
          sessionId = event.sessionId;
          write(
            `${dim('session')} ${event.sessionId.slice(0, 8)}` +
              `${event.model ? `  ${dim('model')} ${event.model}` : ''}\n\n`,
          );
          break;

        case 'thinking':
          write(dim(event.text));
          break;

        case 'message.delta':
          inMessage = true;
          write(event.text);
          break;

        case 'message.final':
          // 델타가 이미 흘렀으면 같은 내용을 두 번 찍지 않는다.
          if (!inMessage) write(event.text);
          break;

        case 'tool.call':
          write(`\n${dim('  ⚙')} ${bold(event.name)}\n`);
          break;

        case 'tool.result':
          write(`${dim(`  ${event.ok ? '✓' : '✗'} ${event.summary.split('\n')[0] ?? ''}`)}\n`);
          break;

        case 'rate_limit':
          if (event.utilization !== undefined && event.utilization >= RATE_LIMIT_WARN) {
            const pct = (event.utilization * 100).toFixed(0);
            write(`\n${yellow(`  ! 쿼터 ${event.limitType ?? ''} ${pct}% 사용`)}\n`);
          }
          break;

        case 'usage':
          usage = event;
          break;

        case 'error':
          write(`\n${red(`  ✗ [${event.code}] ${event.message}`)}\n`);
          break;

        case 'session.finished':
          status = event.status;
          break;

        case 'unknown':
          unknownCount += 1;
          break;

        default:
          break;
      }
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
    // 워커가 종료 직전에 남긴 worker_done을 놓치지 않도록 마지막으로 훑는다.
    await coordinator?.stop();
  }

  // worktree에서 무엇이 바뀌었는지는 워커의 말이 아니라 git으로 확인한다.
  // 워커가 "다 했다"고 해도 파일이 안 바뀌었으면 안 바뀐 것이다.
  const changes = workspace ? await collectChanges(workspace) : undefined;

  if (workspace && changes && changes.files.length === 0 && opts.cleanEmpty) {
    await removeWorkspace(workspace).catch(() => undefined);
    workspace = undefined;
  }

  // ── 정산 ───────────────────────────────────────────────────────────────
  // 워커의 `worker_done`은 *주장*이고, 여기가 *판정*이다. 둘을 분리하는 이유는
  // agy가 아무 일도 안 하고 SUCCESS를 냈던 실측 사례다. ADR-9
  let settlementNote: string | undefined;

  if (opts.protocol && dispatch && coordinator) {
    const completion = coordinator.completion;

    let outcome: DispatchOutcome;
    if (status === 'cancelled') {
      outcome = 'cancelled';
    } else if (!completion) {
      // 프로세스가 0으로 끝났어도 완료 보고가 없으면 성공으로 치지 않는다.
      outcome = 'no_completion';
      settlementNote = '워커가 worker done 없이 종료했습니다 — 완료로 인정하지 않습니다.';
      status = 'error';
    } else {
      outcome = completion.outcome;
      if (completion.outcome === 'failed') {
        status = 'error';
        settlementNote = `워커가 실패로 보고: ${completion.body}`;
      } else {
        settlementNote = completion.body;
        // 성공이라고 보고했는데 아무것도 안 바뀐 경우를 잡는다.
        if (changes && changes.files.length === 0 && opts.mode === 'write') {
          settlementNote += ' (⚠ 성공 보고와 달리 변경된 파일이 없습니다)';
        }
      }
    }

    await saveDispatch(dispatch.runId, {
      ...dispatch,
      outcome,
      settlement: outcome === 'succeeded' ? 'released' : 'retained',
      settledAt: new Date().toISOString(),
      ...(changes ? { filesChanged: changes.files } : {}),
    });
  }

  if (opts.json) {
    // stdout은 순수 이벤트 스트림으로 유지한다. 진단은 stderr로.
    process.stderr.write(
      `${JSON.stringify({
        workspace: workspace
          ? { id: workspace.id, path: workspace.path, branch: workspace.branch }
          : null,
        filesChanged: changes?.files ?? null,
        completion: coordinator?.completion ?? null,
        escalations: coordinator?.escalations.length ?? 0,
      })}\n`,
    );
    return status === 'success' ? 0 : 1;
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const badge =
    status === 'success' ? green('success') : status === 'cancelled' ? yellow('cancelled') : red('error');

  write(`\n\n${dim('─'.repeat(60))}\n`);
  write(`${badge}  ${dim('elapsed')} ${elapsed}s`);

  if (usage) {
    write(
      `  ${dim('in')} ${renderNumber(usage.inputTokens)}` +
        `  ${dim('out')} ${renderNumber(usage.outputTokens)}`,
    );
    if (usage.cacheCreationTokens !== undefined) {
      write(`  ${dim('cache_w')} ${renderNumber(usage.cacheCreationTokens)}`);
    }
    if (usage.cacheReadTokens !== undefined) {
      write(`  ${dim('cache_r')} ${renderNumber(usage.cacheReadTokens)}`);
    }
    // agy는 비용을 주지 않는다. 없으면 표시하지 않는다 — 0으로 찍으면 거짓말이 된다.
    if (usage.costUsd !== undefined) write(`  ${dim('cost')} $${usage.costUsd.toFixed(4)}`);
  }

  if (settlementNote) write(`\n${dim('report')} ${settlementNote}`);
  if (coordinator && coordinator.questionsAnswered > 0) {
    write(`\n${dim('asked')} 질문 ${coordinator.questionsAnswered}건 처리`);
  }

  if (changes) {
    write(`\n${dim('files')} ${changes.files.length}개 변경`);
    for (const file of changes.files.slice(0, 10)) write(`\n  ${dim('·')} ${file}`);
    if (changes.files.length > 10) write(`\n  ${dim(`… 외 ${changes.files.length - 10}개`)}`);
  }

  if (sessionId) write(`\n${dim('resume')} conductor run --agent ${provider} --resume ${sessionId} "..."`);
  if (unknownCount > 0) write(`\n${dim(`unmapped events: ${unknownCount}`)}`);

  if (workspace) {
    write(`\n${dim('workspace')} ${workspace.path}`);
    write(`\n${dim('review')}    git -C "${workspace.path}" diff HEAD`);
    write(`\n${dim('cleanup')}   conductor workspace rm ${workspace.id}`);
  } else if (opts.workspace) {
    write(`\n${dim('workspace')} 변경 없음 — 정리했습니다`);
  }

  write('\n\n');

  return status === 'success' ? 0 : 1;
}
