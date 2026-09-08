import { ModeError, runMode } from '../core/mode-runner.js';
import { BUILTIN_MODES, type ModeParams } from '../protocol/mode.js';
import { bold, cyan, dim, green, red, table, yellow } from '../ui/format.js';

export function modeList(): number {
  process.stdout.write(`\n${bold('AiKA 선언형 모드 목록')}\n\n`);

  const rows = Object.values(BUILTIN_MODES).map((m) => [
    cyan(m.name),
    m.provider,
    m.mode,
    m.fallbacks.join(', ') || dim('-'),
    m.description,
  ]);

  process.stdout.write(
    `${table(['MODE', 'PROVIDER', 'TYPE', 'FALLBACK', 'DESCRIPTION'], rows)}\n\n`,
  );

  process.stdout.write(
    `${dim('사용법:')} conductor mode run <mode-name> --files "<경로>" --query "<질의>"\n\n`,
  );
  return 0;
}

export interface ModeRunCliOptions {
  files?: string;
  query?: string;
  spec?: string;
  context?: string;
  target?: string;
  agent?: string;
  model?: string;
  cwd?: string;
  timeout?: string;
  json?: boolean;
  isolate?: boolean;
  yolo?: boolean;
}

export async function modeRunCli(
  modeName: string,
  opts: ModeRunCliOptions,
): Promise<number> {
  const params: ModeParams = {
    ...(opts.files ? { files: opts.files } : {}),
    ...(opts.query ? { query: opts.query } : {}),
    ...(opts.spec ? { spec: opts.spec } : {}),
    ...(opts.context ? { context: opts.context } : {}),
    ...(opts.target ? { target: opts.target } : {}),
  };

  const cwd = opts.cwd || process.cwd();
  const timeoutMs = opts.timeout ? Number(opts.timeout) : undefined;

  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.once('SIGINT', onSigint);

  try {
    const result = await runMode({
      modeName,
      params,
      cwd,
      ...(opts.agent ? { agent: opts.agent } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
      isolate: opts.isolate ?? true,
      ...(opts.yolo !== undefined ? { autoApprove: opts.yolo } : {}),
      signal: controller.signal,
    });

    if (opts.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.status === 'success' ? 0 : 1;
    }

    // 팀장 모델이나 파이프라인이 바로 읽을 수 있도록 요약 텍스트를 출력한다.
    if (result.status === 'success') {
      process.stdout.write(result.text ? `${result.text}\n` : `\n`);
      if (process.stderr.isTTY) {
        process.stderr.write(
          `\n${dim('─'.repeat(50))}\n` +
            `${green('✓')} ${dim('mode')} ${cyan(result.mode)}  ` +
            `${dim('provider')} ${result.provider}  ` +
            `${dim('duration')} ${(result.durationMs / 1000).toFixed(1)}s\n`,
        );
      }
      return 0;
    } else {
      process.stderr.write(
        `\n${red('✗ 모드 실행 실패')} (${result.status}): ${result.mode} (${result.provider})\n`,
      );
      if (result.errors.length > 0) {
        for (const err of result.errors) {
          process.stderr.write(`  ${red(`[${err.code}]`)} ${err.message}\n`);
        }
      }
      return 1;
    }
  } catch (err) {
    if (err instanceof ModeError) {
      process.stderr.write(`${red(err.message)}\n`);
      if (err.hint) process.stderr.write(`${dim(err.hint)}\n`);
      return 2;
    }
    process.stderr.write(`${red(`오류: ${(err as Error).message}`)}\n`);
    return 2;
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}
