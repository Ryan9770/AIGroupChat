import { access, chmod, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 워커가 호출할 `conductor` 실행 심을 만든다.
 *
 * 왜 심이 필요한가: 개발 중에는 `tsx src/index.ts`로, 빌드 후에는 `node dist/index.js`로
 * 돌아간다. 프리앰블에 명령 문자열을 박으면 셸마다 인용 규칙이 달라 조용히 깨진다.
 * 심 하나를 만들어 PATH에 얹으면 그 문제가 사라진다.
 *
 * worktree 밖(run 디렉토리)에 쓴다. 안에 쓰면 워커의 diff에 섞여 들어간다.
 */

const here = dirname(fileURLToPath(import.meta.url));
/** src/orchestration → src, 또는 dist/orchestration → dist */
const outDir = dirname(here);
/** 패키지 루트. node_modules를 찾을 때 쓴다. */
const packageRoot = dirname(outDir);

/**
 * 워커가 셸에서 칠 명령 이름.
 *
 * 절대 경로가 아니라 짧은 이름인 게 중요하다. 권한을 좁게 허용하려면
 * `Bash(conductor *)` 같은 패턴으로 매칭해야 하는데, 공백과 백슬래시가 든
 * 절대 경로로는 그 패턴이 안정적으로 맞지 않는다.
 */
export const SHIM_COMMAND = 'conductor';

export interface Shim {
  /** 프리앰블에 넣을 명령. PATH를 통해 해석된다. */
  command: string;
  /** 워커의 PATH 앞에 붙일 디렉토리. */
  binDir: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * CLI 진입점을 찾는다.
 *
 * `process.argv[1]`을 쓰면 안 된다. vitest 안에서는 vitest의 워커 스크립트를,
 * 다른 스크립트에서 import하면 그 스크립트를 가리킨다. 후자는 심이 자기 자신을
 * 다시 실행하는 무한 재귀가 된다(실제로 겪음). 이 모듈의 위치를 기준으로 삼는다.
 */
async function resolveEntry(): Promise<{ entry: string; needsTsx: boolean }> {
  const compiled = join(outDir, 'index.js');
  if (await exists(compiled)) return { entry: compiled, needsTsx: false };

  const source = join(outDir, 'index.ts');
  if (await exists(source)) return { entry: source, needsTsx: true };

  throw new Error(`conductor 진입점을 찾을 수 없습니다: ${compiled} / ${source}`);
}

export async function writeConductorShim(binDir: string): Promise<Shim> {
  const { entry, needsTsx } = await resolveEntry();

  const argv = [process.execPath];
  if (needsTsx) {
    const tsxCli = join(packageRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    if (!(await exists(tsxCli))) {
      throw new Error(
        `TypeScript 진입점을 쓰려면 tsx가 필요합니다: ${tsxCli}\n` +
          '`pnpm build` 후 다시 시도하거나 의존성을 설치하세요.',
      );
    }
    argv.push(tsxCli);
  }
  argv.push(entry);

  const quotedCmd = argv.map((a) => `"${a}"`).join(' ');

  // Windows: cmd.exe가 이걸 찾는다. %*로 인자를 그대로 넘긴다.
  await writeFile(join(binDir, `${SHIM_COMMAND}.cmd`), `@echo off\r\n${quotedCmd} %*\r\n`, 'utf8');

  // POSIX 셸(워커가 bash/sh를 쓰는 경우)용.
  const shPath = join(binDir, SHIM_COMMAND);
  await writeFile(shPath, `#!/bin/sh\nexec ${quotedCmd} "$@"\n`, 'utf8');
  await chmod(shPath, 0o755).catch(() => undefined);

  return { command: SHIM_COMMAND, binDir };
}

/** 워커의 PATH 앞에 심 디렉토리를 붙인다. */
export function pathWithShim(binDir: string, currentPath = process.env['PATH'] ?? ''): string {
  return `${binDir}${process.platform === 'win32' ? ';' : ':'}${currentPath}`;
}
