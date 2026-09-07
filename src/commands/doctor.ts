import { allAdapters } from '../adapters/registry.js';
import type { AgentAdapter, PreflightResult } from '../adapters/types.js';
import { bold, cyan, dim, green, mark, red, table, yellow } from '../ui/format.js';

export interface DoctorOptions {
  /** 네트워크를 타는 인증 프로브를 건너뛴다. */
  offline: boolean;
  /** 사람이 읽는 표 대신 JSON을 출력한다. */
  json: boolean;
  /** 각 provider에 대해 conductor가 실제로 실행할 커맨드를 보여준다. */
  showArgv: boolean;
}

/**
 * 라우팅 후보 자격: 설치 + 로그인 확인.
 *
 * 'unknown'은 후보로 치지 않는다 — 단, --offline은 확인을 **생략**한 것이지
 * 실패한 게 아니므로 설치 여부만 본다. 둘을 구분하지 않으면
 * 오프라인 점검이 매번 거짓 실패를 낸다.
 */
function isReady(r: PreflightResult, offline: boolean): boolean {
  if (!r.installed) return false;
  return offline ? true : r.authed === true;
}

function argvPreview(adapter: AgentAdapter): string {
  const { bin, args } = adapter.buildArgv({
    prompt: '<PROMPT>',
    mode: 'plan',
    cwd: process.cwd(),
  });
  // 표시 전용. 실제 spawn은 셸을 거치지 않으므로 인용이 필요 없다.
  return [bin, ...args.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(' ');
}

export async function doctor(opts: DoctorOptions): Promise<number> {
  const adapters = allAdapters();

  // 프로브는 서로 독립적이므로 병렬로 돌린다.
  const results = await Promise.all(adapters.map((a) => a.preflight(opts.offline)));

  if (opts.json) {
    const ready = results.filter((r) => isReady(r, opts.offline)).map((r) => r.provider);
    process.stdout.write(
      `${JSON.stringify({ results, ready, readyCount: ready.length }, null, 2)}\n`,
    );
    return ready.length > 0 ? 0 : 1;
  }

  process.stdout.write(`\n${bold('conductor doctor')} ${dim('— 에이전트 사전 점검')}\n\n`);

  const rows = results.map((r, i) => {
    const cap = adapters[i]!.capability;
    return [
      r.provider,
      r.bin,
      mark(r.installed),
      r.version ?? dim('-'),
      mark(r.authed),
      r.authSummary ?? dim('-'),
      r.installed ? (cap.streamJson ? green('stream-json') : yellow('json only')) : dim('-'),
      r.installed ? cap.mcpInjection : dim('-'),
    ];
  });

  process.stdout.write(
    `${table(
      ['PROVIDER', 'BIN', 'INST', 'VERSION', 'AUTH', 'PLAN/INFO', 'OUTPUT', 'MCP'],
      rows,
    )}\n`,
  );

  // 한글 안내는 정렬이 깨지므로 표 밖으로 뺀다.
  const withNotes = results.filter((r) => r.notes.length > 0);
  if (withNotes.length > 0) {
    process.stdout.write(`\n${bold('참고')}\n`);
    for (const r of withNotes) {
      for (const note of r.notes) {
        process.stdout.write(`  ${dim('·')} ${cyan(r.provider)} ${note}\n`);
      }
    }
  }

  if (opts.showArgv) {
    process.stdout.write(`\n${bold('실행 커맨드 미리보기')} ${dim('(mode=plan)')}\n`);
    for (const [i, r] of results.entries()) {
      if (!r.installed) continue;
      process.stdout.write(`  ${cyan(r.provider)}\n    ${dim(argvPreview(adapters[i]!))}\n`);
    }
  }

  const ready = results.filter((r) => isReady(r, opts.offline));
  const readyNames = ready.map((r) => r.provider).join(', ');

  process.stdout.write('\n');
  if (ready.length === 0) {
    const msg = opts.offline
      ? '설치된 provider가 없습니다.'
      : '준비된 provider가 없습니다. 위 안내에 따라 최소 1개를 로그인하세요.';
    process.stdout.write(`${red(msg)}\n\n`);
    return 1;
  }

  const label = opts.offline
    ? `${ready.length}/${results.length} providers installed (인증 미확인)`
    : `${ready.length}/${results.length} providers ready`;

  process.stdout.write(`${green(label)} ${dim('·')} 라우팅 후보: ${bold(readyNames)}\n\n`);
  return 0;
}
