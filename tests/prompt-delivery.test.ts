import { execa } from 'execa';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allAdapters, getAdapter } from '../src/adapters/registry.js';
import type { TaskRequest } from '../src/protocol/provider.js';

const MULTILINE = 'LINE-ONE\nLINE-TWO\nLINE-THREE';

const request = (prompt: string): TaskRequest => ({
  prompt,
  mode: 'plan',
  cwd: process.cwd(),
});

describe('프롬프트 전달 방식', () => {
  it('stdin으로 넘기는 어댑터는 argv에 프롬프트를 넣지 않는다', () => {
    // 하나라도 argv에 남으면 Windows에서 조용히 잘린다.
    for (const adapter of allAdapters()) {
      if (adapter.capability.promptDelivery !== 'stdin') continue;
      const { args } = adapter.buildArgv(request(MULTILINE));
      const leaked = args.filter((a) => a.includes('LINE-ONE'));
      expect(leaked, `${adapter.provider}가 argv로 프롬프트를 넘기고 있다`).toEqual([]);
    }
  });

  it('npm .cmd 심을 쓰는 provider는 반드시 stdin이어야 한다', () => {
    // claude·gemini·codex는 npm이 깐 .cmd 심을 거친다.
    for (const provider of ['claude', 'gemini', 'codex'] as const) {
      expect(getAdapter(provider).capability.promptDelivery).toBe('stdin');
    }
  });

  it('네이티브 실행 파일인 agy는 argv로 넘겨도 된다', () => {
    const adapter = getAdapter('antigravity');
    expect(adapter.capability.promptDelivery).toBe('argv');
    const { args } = adapter.buildArgv(request(MULTILINE));
    expect(args.some((a) => a === `--print=${MULTILINE}`)).toBe(true);
  });
});

/**
 * 플랫폼 동작 카나리아.
 *
 * Windows에서 `.cmd` 배치 파일로 인자를 넘기면 **개행에서 잘린다.** cmd.exe가
 * 개행을 명령 종료로 보기 때문이고, 종료 코드는 0이라 조용히 지나간다.
 * 이 테스트가 실패하면 플랫폼 동작이 바뀐 것이니 promptDelivery 결정을 재검토한다.
 */
describe.runIf(process.platform === 'win32')('Windows .cmd 인자 잘림 (카나리아)', () => {
  let dir: string;
  let cmdPath: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-argv-'));
    cmdPath = join(dir, 'echoargs.cmd');
    await writeFile(
      cmdPath,
      '@echo off\r\nnode -e "console.log(JSON.stringify(process.argv.slice(1)))" %*\r\n',
      'utf8',
    );
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('.cmd 경유는 첫 줄만 도착한다', async () => {
    const result = await execa(cmdPath, [MULTILINE], {
      reject: false,
      shell: false,
      windowsHide: true,
      stdin: 'ignore',
    });
    expect(result.exitCode).toBe(0); // 실패하지 않는다는 게 이 버그의 위험한 점이다
    expect(JSON.parse(result.stdout)).toEqual(['LINE-ONE']);
  }, 60_000);

  it('네이티브 .exe 경유는 전부 도착한다', async () => {
    const result = await execa(
      process.execPath,
      ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', '--', MULTILINE],
      { reject: false, shell: false, windowsHide: true, stdin: 'ignore' },
    );
    expect(JSON.parse(result.stdout)).toEqual([MULTILINE]);
  }, 60_000);
});
