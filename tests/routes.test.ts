import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG_FILE, loadConfig } from '../src/core/config.js';
import { getAdapter } from '../src/adapters/registry.js';
import { DispatchConfigError, executeDispatch } from '../src/core/dispatch.js';
import { route } from '../src/core/router.js';
import { runPlan } from '../src/core/scheduler.js';
import type { DispatchRequest, DispatchResult } from '../src/core/dispatch.js';
import { Plan } from '../src/protocol/plan.js';
import type { Provider } from '../src/protocol/provider.js';

/**
 * "claude를 팀장으로, agy를 수행원으로" — 역할별 담당 지정.
 */
const TEAM = {
  design: ['claude', 'codex'] as Provider[],
  implement: ['antigravity', 'claude'] as Provider[],
  review: ['claude', 'codex'] as Provider[],
};

describe('역할별 담당 지정', () => {
  const available: Provider[] = ['claude', 'antigravity', 'codex'];

  it('지정한 담당이 기본 라우팅을 이긴다', () => {
    // 기본값은 review=codex다.
    expect(route({ role: 'review', available })?.provider).toBe('codex');
    expect(route({ role: 'review', available, routes: TEAM, explicit: true })?.provider).toBe(
      'claude',
    );
  });

  it('나머지 후보를 페일오버용으로 남긴다', () => {
    // 1순위만 두면 쿼터가 차는 순간 실행이 멈춘다.
    const result = route({ role: 'implement', available, routes: TEAM, explicit: true });
    expect(result?.provider).toBe('antigravity');
    expect(result?.fallbacks).toEqual(['claude']);
  });

  it('명시 지정은 교차 검증 휴리스틱을 이긴다', () => {
    // claude가 설계하고 claude가 검토하도록 못박은 구성이라면,
    // "리뷰어는 산출물 만든 사람을 피하라"는 규칙이 끼어들면 안 된다.
    const result = route({
      role: 'review',
      available,
      routes: TEAM,
      explicit: true,
      avoid: ['claude'],
    });
    expect(result?.provider).toBe('claude');
    expect(result?.reason).not.toContain('⚠');
    expect(result?.reason).toContain('지정됨');
  });

  it('지정하지 않은 역할은 기본값을 쓴다', () => {
    const partial = { implement: ['antigravity'] as Provider[] };
    expect(route({ role: 'design', available, routes: partial })?.provider).toBe('claude');
  });

  it('로그인 안 된 provider는 지정해도 후보에서 빠진다', () => {
    const result = route({
      role: 'implement',
      available: ['claude'],
      routes: TEAM,
      explicit: true,
    });
    expect(result?.provider).toBe('claude');
  });
});

describe('설정 파일', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const write = async (content: string) => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-cfg-'));
    await writeFile(join(dir, CONFIG_FILE), content, 'utf8');
    return dir;
  };

  it('없으면 조용히 기본값을 쓴다', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'conductor-none-'));
    dir = empty;
    const loaded = await loadConfig(empty);
    expect(loaded.config).toEqual({});
    expect(loaded.problem).toBeUndefined();
  });

  it('담당과 예산을 읽는다', async () => {
    const at = await write(JSON.stringify({ routes: TEAM, budgetUsd: 2 }));
    const loaded = await loadConfig(at);
    expect(loaded.config.routes?.review).toEqual(['claude', 'codex']);
    expect(loaded.config.budgetUsd).toBe(2);
  });

  it('형식이 틀리면 조용히 넘기지 않는다', async () => {
    // 설정을 썼는데 무시되면 왜 안 먹는지 알 수 없다.
    const at = await write(JSON.stringify({ routes: { implement: 'agy' } }));
    const loaded = await loadConfig(at);
    expect(loaded.problem).toContain('Expected array');
    expect(loaded.path).toBeDefined();
  });

  it('JSON이 깨져도 알려준다', async () => {
    const at = await write('{ "routes": ');
    expect((await loadConfig(at)).problem).toContain('JSON 파싱 실패');
  });
});

describe('스케줄러가 담당 지정을 따른다', () => {
  const plan = Plan.parse({
    objective: 'team test',
    routes: TEAM,
    tasks: [
      { id: 'design', role: 'design', spec: 'x', workspace: 'none' },
      { id: 'impl', role: 'implement', spec: 'y', dependsOn: ['design'], context: ['design'], workspace: 'none' },
      { id: 'review', role: 'review', spec: 'z', dependsOn: ['impl'], context: ['impl'], workspace: 'none' },
    ],
  });

  it('설계·검토는 claude, 구현은 antigravity에 간다', async () => {
    const assigned: Record<string, Provider> = {};
    const outcomes = await runPlan({
      plan,
      routes: plan.routes!,
      runDir: 'C:/tmp/run',
      cwd: 'C:/tmp/repo',
      available: ['claude', 'antigravity', 'codex'],
      isolate: true,
      autoApprove: false,
      protocol: false,
      answerMode: 'auto',
      timeoutMs: 1000,
      execute: async (request: DispatchRequest): Promise<DispatchResult> => {
        assigned[request.taskId] = request.provider;
        return {
          dispatchId: 'd', provider: request.provider, taskId: request.taskId,
          status: 'success', outcome: 'succeeded', report: '', filesChanged: [],
          errors: [], durationMs: 1,
        };
      },
    });

    expect(assigned).toEqual({ design: 'claude', impl: 'antigravity', review: 'claude' });
    expect(outcomes.every((o) => o.state === 'succeeded')).toBe(true);
  });
});

describe('협약과 명령 권한', () => {
  it('claude는 보고 명령만 콕 집어 허용한다', () => {
    // 전면 승인 없이도 협약이 돌아가야 한다.
    const { args } = getAdapter('claude').buildArgv({
      prompt: 'x', mode: 'write', cwd: '.', autoApprove: false, allowCommands: ['conductor'],
    });
    expect(args).toContain('--allowed-tools');
    expect(args).toContain('Bash(conductor *)');
    // 전면 승인으로 올리지 않는다.
    expect(args).toContain('acceptEdits');
    expect(args).not.toContain('bypassPermissions');
  });

  it('명령을 골라 허용 못 하는 provider는 실행 전에 막는다', async () => {
    // 실행해봐야 no_completion이 확정이다. 쿼터를 태우기 전에 막는다.
    await expect(
      executeDispatch({
        provider: 'antigravity',
        spec: 'x',
        mode: 'write',
        cwd: '.',
        workspace: { kind: 'none' },
        isolate: true,
        autoApprove: false,
        protocol: true,
        answerMode: 'auto',
        timeoutMs: 1000,
        runDir: 'C:/tmp/run',
        taskId: 't',
        attempt: 1,
      }),
    ).rejects.toThrow(DispatchConfigError);
  });

  it('자동 승인을 켜면 막지 않는다', () => {
    const { args } = getAdapter('antigravity').buildArgv({
      prompt: 'x', mode: 'write', cwd: '.', autoApprove: true, timeoutMs: 15 * 60_000,
    });
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).toContain('--print-timeout');
    expect(args).toContain('930s');
  });

  it('provider별 명령 권한 방식이 정의돼 있다', () => {
    // 이 값으로 "실행하면 반드시 실패하는 조합"을 판단한다.
    expect(getAdapter('claude').capability.commandPermission).toBe('granular');
    expect(getAdapter('antigravity').capability.commandPermission).toBe('all-or-nothing');
    expect(getAdapter('codex').capability.commandPermission).toBe('sandbox');
  });
});
