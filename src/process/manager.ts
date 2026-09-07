import { execa } from 'execa';
import { createInterface } from 'node:readline';
import type { AgentAdapter } from '../adapters/types.js';
import { AgentEvent, type ParseContext } from '../protocol/events.js';
import type { TaskRequest } from '../protocol/provider.js';

export const DEFAULT_TIMEOUT_MS = 15 * 60_000;

export interface RunOptions {
  timeoutMs?: number;
  /** 중단 신호. abort되면 자식 프로세스를 죽이고 cancelled로 끝낸다. */
  signal?: AbortSignal;
  /** 원시 stdout 라인 후크. 픽스처 덤프·디버깅용. */
  onRawLine?: (line: string) => void;
  /** stderr 라인 후크. 진단 출력은 stdout 이벤트 스트림과 섞지 않는다. */
  onStderr?: (chunk: string) => void;
}

/** stderr 보관 상한. 무한정 쌓지 않는다. */
const STDERR_CAP = 8_000;

/**
 * 워커 CLI를 헤드리스로 띄우고 정규화 이벤트를 실시간 스트리밍한다.
 *
 * 보장 사항:
 * - **`session.finished`가 정확히 한 번 나온다.** 워커가 죽든, 타임아웃이든,
 *   취소든 항상 나온다. 소비자가 종료를 놓칠 수 없게 하려는 것이다.
 * - 소비자가 루프를 중간에 벗어나면 자식 프로세스를 죽인다(고아 프로세스 방지).
 * - 파싱 실패는 이벤트를 만들지 않을 뿐 스트림을 끊지 않는다.
 */
export async function* runAgent(
  adapter: AgentAdapter,
  req: TaskRequest,
  opts: RunOptions = {},
): AsyncGenerator<AgentEvent> {
  const { bin, args, env } = adapter.buildArgv(req);
  const ctx: ParseContext = {};
  const startedAt = Date.now();

  // 🔴 Windows에서 npm이 깐 `.cmd` 심을 거치는 CLI는 **argv 안의 개행에서 잘린다.**
  // cmd.exe가 개행을 명령 종료로 보기 때문이고, exit 0으로 조용히 성공한 척한다.
  // 여러 줄 프롬프트(협약 프리앰블 포함)를 쓰려면 stdin으로 넘겨야 한다.
  const viaStdin = adapter.capability.promptDelivery === 'stdin';

  const sub = execa(bin, args, {
    cwd: req.cwd,
    env: { ...process.env, ...env, ...(req.env ?? {}) },
    reject: false,
    shell: false,
    windowsHide: true,
    // stdin을 쓰지 않을 때는 닫는다. 열어두면 claude가 파이프 입력을 3초 기다린다.
    ...(viaStdin ? { input: req.prompt } : { stdin: 'ignore' as const }),
    // 스트리밍이 목적이므로 버퍼링하지 않는다.
    buffer: false,
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(opts.signal ? { cancelSignal: opts.signal } : {}),
  });

  let stderr = '';
  sub.stderr?.on('data', (chunk: Buffer | string) => {
    const text = String(chunk);
    opts.onStderr?.(text);
    stderr = (stderr + text).slice(-STDERR_CAP);
  });

  let terminal: Extract<AgentEvent, { kind: 'session.finished' }> | undefined;
  let streamEnded = false;
  let spawnFailure: string | undefined;
  const completion = sub.catch((error: unknown) => {
    spawnFailure ??= error instanceof Error ? error.message : String(error);
    return undefined;
  });

  try {
    if (sub.stdout) {
      const lines = createInterface({ input: sub.stdout, crlfDelay: Infinity });
      for await (const line of lines) {
        opts.onRawLine?.(line);
        let parsed: AgentEvent[];
        try {
          parsed = adapter.parseLine(line, ctx);
        } catch {
          parsed = [{ kind: 'unknown', raw: line }];
        }
        for (const event of parsed) {
          const validated = AgentEvent.safeParse(event);
          if (!validated.success) {
            yield { kind: 'unknown', raw: event };
          } else if (event.kind === 'session.finished') {
            if (!terminal || event.status !== 'success') terminal = event;
          } else {
            yield event;
          }
        }
      }
    }
    streamEnded = true;
  } catch (err) {
    spawnFailure = err instanceof Error ? err.message : String(err);
  } finally {
    // 소비자가 break/return으로 빠져나갔을 수 있다. 살아 있으면 죽인다.
    if (!streamEnded && sub.exitCode === null && !sub.killed) sub.kill();
    await completion;
  }

  const result = await completion;

  // 워커가 result 이벤트를 내지 못하고 끝났다. 무슨 일이 있었는지 합성해서 알린다.
  const cancelled = opts.signal?.aborted === true || result?.isCanceled === true;
  const timedOut = result?.timedOut === true;
  const exitCode = result?.exitCode ?? null;

  if (cancelled) {
    yield {
      kind: 'session.finished',
      status: 'cancelled',
      durationMs: Date.now() - startedAt,
    };
    return;
  }

  if (terminal && exitCode === 0 && !timedOut && !spawnFailure) {
    yield terminal;
    return;
  }

  const message =
    spawnFailure ??
    (timedOut
      ? `타임아웃 (${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms)`
      : stderr.trim() || `${bin} 이(가) 코드 ${exitCode}로 종료`);

  yield {
    kind: 'error',
    code: timedOut ? 'timeout' : spawnFailure ? 'spawn_failed' : exitCode === 0 ? 'missing_terminal' : `exit_${exitCode}`,
    message,
    // 타임아웃은 재시도할 만하다. 인자가 틀려서 죽은 건 재시도해도 똑같이 죽는다.
    retryable: timedOut,
    ...(timedOut ? { retryOn: 'same-provider' as const } : {}),
  };
  yield {
    kind: 'session.finished',
    status: 'error',
    durationMs: Date.now() - startedAt,
  };
}
