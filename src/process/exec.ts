import { execa } from 'execa';
import { access, constants } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

/**
 * PATH에서 실행 파일을 찾는다.
 *
 * Windows에서는 실제 파일이 `claude.cmd`, `agy.exe`처럼 확장자를 갖기 때문에
 * PATHEXT를 순회해야 한다. `command -v`에 의존하지 않으려고 직접 구현했다.
 * (셸을 거치지 않아야 인자 이스케이프 문제도 같이 사라진다.)
 */
export async function whichBin(name: string): Promise<string | null> {
  const pathVar = process.env['PATH'] ?? process.env['Path'] ?? '';
  const dirs = pathVar.split(delimiter).filter(Boolean);

  // Windows는 확장자 있는 실행 파일을 **먼저** 봐야 한다.
  // npm은 `claude`(sh 스크립트)와 `claude.cmd`를 같이 깔아두는데,
  // 확장자 없는 쪽을 먼저 집으면 Windows에서 실행할 수 없는 sh 스크립트를 잡게 된다.
  const exts =
    process.platform === 'win32'
      ? [...(process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean), '']
      : [''];

  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // 다음 후보로
      }
    }
  }
  return null;
}

export interface ProbeResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** spawn 자체가 실패한 경우(파일 없음, 권한 등). */
  spawnError?: string;
}

/**
 * 짧은 확인용 명령을 실행한다. 출력은 호출자가 반드시 필터링해서 쓸 것.
 *
 * `shell: false`가 핵심이다. 셸을 태우면 Windows 경로의 공백과 인용 규칙 때문에
 * 조용히 깨진다. execa가 Windows의 `.cmd` 심을 알아서 처리한다.
 */
export async function runProbe(opts: {
  bin: string;
  args: string[];
  timeoutMs?: number;
  cwd?: string;
}): Promise<ProbeResult> {
  try {
    const result = await execa(opts.bin, opts.args, {
      timeout: opts.timeoutMs ?? 20_000,
      reject: false,
      shell: false,
      windowsHide: true,
      stripFinalNewline: true,
      // claude는 stdin이 열려 있으면 파이프 입력을 3초간 기다린다.
      // 'ignore'로 닫아주면 그 3초가 사라진다. (실측 확인)
      stdin: 'ignore',
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
    });

    return {
      ok: result.exitCode === 0 && !result.timedOut,
      exitCode: result.exitCode ?? null,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      timedOut: result.timedOut === true,
    };
  } catch (err) {
    return {
      ok: false,
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      spawnError: err instanceof Error ? err.message : String(err),
    };
  }
}

/** 버전 출력에서 첫 semver 비슷한 토큰만 뽑는다. CLI마다 앞뒤 장식이 달라서 필요하다. */
export function extractVersion(raw: string): string | undefined {
  const match = raw.match(/\d+\.\d+\.\d+(?:[-+][\w.]+)?/);
  return match?.[0];
}
