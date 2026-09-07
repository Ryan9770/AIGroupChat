import { isProvider } from '../adapters/registry.js';
import { DispatchConfigError, executeDispatch, type WorkspacePlan } from '../core/dispatch.js';
import type { AgentEvent } from '../protocol/events.js';
import type { ExecutionMode, Provider } from '../protocol/provider.js';
import { createRun, newTaskId } from '../store/run-store.js';
import { bold, cyan, dim, green, red, yellow } from '../ui/format.js';
import { findRepoRoot } from '../workspace/git.js';
import { WorkspaceError } from '../workspace/worktree.js';

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
  /** 도구 승인 프롬프트를 자동 승인한다. 워크스페이스 격리 없이는 위험하다. */
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

const renderNumber = (n: number) => n.toLocaleString('en-US');

/**
 * 워커 하나에게 프롬프트를 위임한다.
 *
 * 실행 자체는 `executeDispatch`가 한다. 여기는 사람이 읽을 출력만 담당한다.
 * 계획 실행(스케줄러)과 같은 경로를 쓰게 하려는 것이다.
 */
export async function run(prompt: string, opts: RunCommandOptions): Promise<number> {
  if (!isProvider(opts.agent)) {
    process.stderr.write(`알 수 없는 provider: ${opts.agent}\n`);
    return 2;
  }
  const provider: Provider = opts.agent;
  const write = (s: string) => process.stdout.write(s);
  const human = !opts.json;

  // Ctrl+C로 워커를 확실히 정리한다. 안 그러면 고아 프로세스가 남는다.
  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.once('SIGINT', onSigint);

  // 협약을 쓰려면 메시지를 주고받을 run 디렉토리가 필요하다.
  let runDir: string | undefined;
  if (opts.protocol) {
    const stateRoot = (await findRepoRoot(opts.cwd)) ?? opts.cwd;
    runDir = (await createRun({ stateRoot, objective: prompt })).runDir;
  }

  const workspacePlan: WorkspacePlan = opts.workspace
    ? { kind: 'new', label: `${provider}-${opts.mode}` }
    : { kind: 'none' };

  if (human) {
    write(`${dim('provider')} ${cyan(provider)}  ${dim('mode')} ${opts.mode}`);
    if (opts.workspace) write(`  ${dim('workspace')} on`);
    if (opts.protocol) write(`  ${dim('protocol')} on`);
    write('\n');
  }

  let inMessage = false;
  let unknownCount = 0;

  const onEvent = (event: AgentEvent): void => {
    if (opts.json) {
      write(`${JSON.stringify(event)}\n`);
      return;
    }
    switch (event.kind) {
      case 'session.started':
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
          write(`\n${yellow(`  ! 쿼터 ${event.limitType ?? ''} ${(event.utilization * 100).toFixed(0)}% 사용`)}\n`);
        }
        break;
      case 'error':
        write(`\n${red(`  ✗ [${event.code}] ${event.message}`)}\n`);
        break;
      case 'unknown':
        unknownCount += 1;
        break;
      default:
        break;
    }
  };

  let result;
  try {
    result = await executeDispatch({
      provider,
      spec: prompt,
      mode: opts.mode,
      cwd: opts.cwd,
      workspace: workspacePlan,
      isolate: !opts.noIsolate,
      autoApprove: opts.autoApprove,
      protocol: opts.protocol,
      answerMode: opts.answerMode,
      timeoutMs: opts.timeoutMs,
      taskId: newTaskId(),
      attempt: 1,
      cleanEmpty: opts.cleanEmpty,
      signal: controller.signal,
      ...(runDir ? { runDir } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.resume ? { resumeId: opts.resume } : {}),
      observer: {
        onEvent,
        onNotice: (text) => human && write(`\n${yellow(`  ${text}`)}\n`),
      },
    });
  } catch (err) {
    if (err instanceof DispatchConfigError) {
      process.stderr.write(`${red(err.message)}
${dim(err.hint)}
`);
      return 2;
    }
    if (err instanceof WorkspaceError) {
      process.stderr.write(`${red(err.message)}\n`);
      if (err.hint) process.stderr.write(`${dim(err.hint)}\n`);
      return 2;
    }
    throw err;
  } finally {
    process.removeListener('SIGINT', onSigint);
  }

  if (opts.json) {
    // stdout은 순수 이벤트 스트림으로 유지한다. 진단은 stderr로.
    process.stderr.write(
      `${JSON.stringify({
        outcome: result.outcome,
        workspace: result.workspace
          ? { id: result.workspace.id, path: result.workspace.path, branch: result.workspace.branch }
          : null,
        filesChanged: result.filesChanged,
        report: result.report,
      })}\n`,
    );
    return result.status === 'success' ? 0 : 1;
  }

  const badge =
    result.status === 'success'
      ? green('success')
      : result.status === 'cancelled'
        ? yellow('cancelled')
        : red('error');

  write(`\n\n${dim('─'.repeat(60))}\n`);
  write(`${badge}  ${dim('elapsed')} ${(result.durationMs / 1000).toFixed(1)}s`);

  const usage = result.usage;
  if (usage) {
    write(`  ${dim('in')} ${renderNumber(usage.inputTokens)}  ${dim('out')} ${renderNumber(usage.outputTokens)}`);
    if (usage.cacheCreationTokens !== undefined) {
      write(`  ${dim('cache_w')} ${renderNumber(usage.cacheCreationTokens)}`);
    }
    if (usage.cacheReadTokens !== undefined) {
      write(`  ${dim('cache_r')} ${renderNumber(usage.cacheReadTokens)}`);
    }
    // agy는 비용을 주지 않는다. 없으면 표시하지 않는다 — 0으로 찍으면 거짓말이 된다.
    if (usage.costUsd !== undefined) write(`  ${dim('cost')} $${usage.costUsd.toFixed(4)}`);
  }

  if (result.note) write(`\n${dim('report')} ${result.note}`);
  if (result.filesChanged.length > 0) {
    write(`\n${dim('files')} ${result.filesChanged.length}개 변경`);
    for (const file of result.filesChanged.slice(0, 10)) write(`\n  ${dim('·')} ${file}`);
    if (result.filesChanged.length > 10) {
      write(`\n  ${dim(`… 외 ${result.filesChanged.length - 10}개`)}`);
    }
  }
  if (result.sessionId) {
    write(`\n${dim('resume')} conductor run --agent ${provider} --resume ${result.sessionId} "..."`);
  }
  if (unknownCount > 0) write(`\n${dim(`unmapped events: ${unknownCount}`)}`);

  if (result.workspace) {
    write(`\n${dim('workspace')} ${result.workspace.path}`);
    write(`\n${dim('review')}    git -C "${result.workspace.path}" diff HEAD`);
    write(`\n${dim('cleanup')}   conductor workspace rm ${result.workspace.id}`);
  } else if (opts.workspace) {
    write(`\n${dim('workspace')} 변경 없음 — 정리했습니다`);
  }
  write('\n\n');

  return result.status === 'success' ? 0 : 1;
}
