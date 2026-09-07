import { execa } from 'execa';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pathWithShim, writeConductorShim } from '../src/orchestration/shim.js';
import { ENV } from '../src/protocol/orchestration.js';
import {
  appendMessage,
  createRun,
  readNewMessages,
  runPaths,
  waitForReply,
  writeReply,
} from '../src/store/run-store.js';

describe('run-store', () => {
  let stateRoot: string;

  beforeAll(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), 'conductor-store-'));
  });
  afterAll(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it('메시지를 시간순으로 돌려준다', async () => {
    const { runDir } = await createRun({ stateRoot, objective: 'test' });
    const base = { runId: runDir, taskId: 't1', dispatchId: 'd1', from: 'w' } as const;

    await appendMessage(runDir, { ...base, type: 'heartbeat', phase: 'a' });
    await appendMessage(runDir, { ...base, type: 'heartbeat', phase: 'b' });

    const seen = new Set<string>();
    const messages = await readNewMessages(runDir, seen);
    expect(messages.map((m) => m.phase)).toEqual(['a', 'b']);
  });

  it('이미 읽은 메시지를 다시 주지 않는다', async () => {
    const { runDir } = await createRun({ stateRoot, objective: 'test' });
    const seen = new Set<string>();

    await appendMessage(runDir, {
      type: 'heartbeat',
      runId: runDir,
      taskId: 't1',
      dispatchId: 'd1',
      from: 'w',
    });

    expect(await readNewMessages(runDir, seen)).toHaveLength(1);
    expect(await readNewMessages(runDir, seen)).toHaveLength(0);
  });

  it('답변을 기다리다 받으면 즉시 돌려준다', async () => {
    const { runDir } = await createRun({ stateRoot, objective: 'test' });
    const message = await appendMessage(runDir, {
      type: 'question',
      runId: runDir,
      taskId: 't1',
      dispatchId: 'd1',
      from: 'w',
      body: '어느 쪽?',
    });

    // 워커가 기다리는 동안 코디네이터가 답을 쓰는 상황.
    setTimeout(() => {
      void writeReply(runDir, {
        messageId: message.id,
        body: '왼쪽',
        source: 'human',
        createdAt: new Date().toISOString(),
      });
    }, 120);

    const reply = await waitForReply(runDir, message.id, {
      timeoutMs: 5_000,
      intervalMs: 50,
    });
    expect(reply?.body).toBe('왼쪽');
  });

  it('답이 없으면 타임아웃으로 null을 준다', async () => {
    const { runDir } = await createRun({ stateRoot, objective: 'test' });
    const reply = await waitForReply(runDir, 'msg_nonexistent', {
      timeoutMs: 200,
      intervalMs: 50,
    });
    expect(reply).toBeNull();
  });
});

/**
 * 셸 심 통합 테스트.
 *
 * 워커는 별개 프로세스에서 셸을 통해 conductor를 호출한다. Windows 경로에 공백이
 * 흔하고 개발/빌드 진입점이 달라서, 여기가 가장 조용히 깨지기 쉬운 지점이다.
 * 실제로 프로세스를 띄워 확인한다.
 */
describe('worker CLI (실제 프로세스)', () => {
  let stateRoot: string;
  let runDir: string;
  let binDir: string;
  let command: string;

  beforeAll(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), 'conductor-shim-'));
    const created = await createRun({ stateRoot, objective: 'shim test' });
    runDir = created.runDir;
    const shim = await writeConductorShim(runPaths(runDir).bin);
    binDir = shim.binDir;
    command = shim.command;
  });
  afterAll(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  const workerEnv = () => ({
    ...process.env,
    // 운영과 같은 방식: 심 디렉토리를 PATH 앞에 얹어 짧은 이름으로 부른다.
    PATH: pathWithShim(binDir),
    [ENV.runDir]: runDir,
    [ENV.runId]: runDir,
    [ENV.taskId]: 'task_x',
    [ENV.dispatchId]: 'dsp_x',
    [ENV.worker]: 'claude-1',
  });

  // PATH에 얹힌 심을 짧은 이름으로 부른다. 권한을 좁게 허용하려면 이 형태여야 한다.
  const runShim = (args: string) =>
    execa(`${command} ${args}`, {
      shell: true,
      reject: false,
      env: workerEnv(),
      stdin: 'ignore',
      timeout: 60_000,
    });

  it('worker done이 완료 보고를 기록한다', async () => {
    const result = await runShim(
      'worker done --outcome succeeded --body "했다. 찾았다. 남았다."',
    );
    expect(result.exitCode).toBe(0);

    const messages = await readNewMessages(runDir, new Set());
    const done = messages.find((m) => m.type === 'worker_done');
    expect(done).toMatchObject({ outcome: 'succeeded', dispatchId: 'dsp_x' });
  }, 60_000);

  it('빈 본문을 거부한다', async () => {
    // 빈 요약은 코디네이터가 판단할 재료가 없다는 뜻이다.
    const result = await runShim('worker done --outcome succeeded --body ""');
    expect(result.exitCode).toBe(2);
  }, 60_000);

  it('다른 dispatch의 ID로 보고하면 거부한다', async () => {
    // 실패한 이전 시도의 늦은 보고가 현재 재시도를 완료 처리하는 걸 막는다. ADR-8
    const result = await runShim(
      'worker done --outcome succeeded --body "x" --dispatch-id dsp_STALE',
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('일치하지 않습니다');
  }, 60_000);

  it('정체성 환경변수가 없으면 명확히 거부한다', async () => {
    const result = await execa(`${command} worker heartbeat`, {
      shell: true,
      reject: false,
      env: { ...process.env, PATH: pathWithShim(binDir), [ENV.runDir]: '', [ENV.dispatchId]: '' },
      stdin: 'ignore',
      timeout: 60_000,
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('워커 안에서만');
  }, 60_000);
});
