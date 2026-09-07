import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  Dispatch,
  Reply,
  Run,
  Task,
  WorkerMessage,
} from '../protocol/orchestration.js';

/**
 * 파일 기반 Run 저장소.
 *
 * SQLite가 아니라 파일을 쓴 이유:
 * - 오케스트레이터와 워커는 **서로 다른 프로세스**다. 파일 + 원자적 rename이면
 *   락 없이 안전하게 주고받을 수 있다. Windows에서도 같은 볼륨의 rename은 원자적이다.
 * - 실행당 메시지가 몇 건 수준이라 쿼리 엔진이 필요 없다.
 * - 에이전트 프로토콜은 디버깅이 어렵다. `cat`으로 바로 들여다볼 수 있는 게 크다.
 * - node:sqlite는 아직 실험적이고 native 의존성(better-sqlite3)은 Windows 빌드가 번거롭다.
 *
 * 이벤트 로그·집계처럼 질의가 필요해지면 그때 SQLite를 얹는다.
 */

export interface RunPaths {
  root: string;
  messages: string;
  replies: string;
  tasks: string;
  dispatches: string;
  bin: string;
}

export function runPaths(runDir: string): RunPaths {
  return {
    root: runDir,
    messages: join(runDir, 'messages'),
    replies: join(runDir, 'replies'),
    tasks: join(runDir, 'tasks'),
    dispatches: join(runDir, 'dispatches'),
    bin: join(runDir, 'bin'),
  };
}

/** 부분적으로 쓰인 파일을 남기지 않는다. 상대편이 그걸 읽을 수 있기 때문이다. */
async function writeAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, path);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function createRun(opts: {
  stateRoot: string;
  objective: string;
}): Promise<{ run: Run; paths: RunPaths; runDir: string }> {
  const id = `run_${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
  const runDir = join(opts.stateRoot, '.conductor', 'runs', id);
  const paths = runPaths(runDir);

  for (const dir of [paths.messages, paths.replies, paths.tasks, paths.dispatches, paths.bin]) {
    await mkdir(dir, { recursive: true });
  }

  const run: Run = { id, objective: opts.objective, createdAt: new Date().toISOString() };
  await writeAtomic(join(runDir, 'run.json'), JSON.stringify(run, null, 2));
  return { run, paths, runDir };
}

export async function saveTask(runDir: string, task: Task): Promise<void> {
  await writeAtomic(
    join(runPaths(runDir).tasks, `${task.id}.json`),
    JSON.stringify(task, null, 2),
  );
}

export async function saveDispatch(runDir: string, dispatch: Dispatch): Promise<void> {
  await writeAtomic(
    join(runPaths(runDir).dispatches, `${dispatch.id}.json`),
    JSON.stringify(dispatch, null, 2),
  );
}

export function newTaskId(): string {
  return `task_${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
}

export function newDispatchId(): string {
  return `dsp_${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
}

/**
 * 워커가 메시지를 남긴다.
 *
 * 파일명 앞에 시각을 붙여 정렬만으로 순서가 나오게 한다.
 */
export async function appendMessage(
  runDir: string,
  message: Omit<WorkerMessage, 'id' | 'createdAt'>,
): Promise<WorkerMessage> {
  const paths = runPaths(runDir);
  await mkdir(paths.messages, { recursive: true });

  const id = `msg_${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
  const full: WorkerMessage = { ...message, id, createdAt: new Date().toISOString() };

  await writeAtomic(join(paths.messages, `${id}.json`), JSON.stringify(full, null, 2));
  return full;
}

/**
 * 아직 읽지 않은 메시지를 시간순으로 가져온다.
 *
 * @param seen 이미 처리한 메시지 ID 집합. 호출자가 소유한다.
 */
export async function readNewMessages(
  runDir: string,
  seen: Set<string>,
): Promise<WorkerMessage[]> {
  const paths = runPaths(runDir);
  let files: string[];
  try {
    files = await readdir(paths.messages);
  } catch {
    return [];
  }

  const fresh: WorkerMessage[] = [];
  for (const file of files) {
    if (!file.endsWith('.json') || file.endsWith('.tmp')) continue;
    const id = file.slice(0, -'.json'.length);
    if (seen.has(id)) continue;

    const message = await readJson<WorkerMessage>(join(paths.messages, file));
    // 읽기 실패는 쓰기 중일 수 있다는 뜻이다. seen에 넣지 않고 다음 폴링에 다시 본다.
    if (!message) continue;

    seen.add(id);
    fresh.push(message);
  }

  return fresh.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function writeReply(runDir: string, reply: Reply): Promise<void> {
  const paths = runPaths(runDir);
  await mkdir(paths.replies, { recursive: true });
  await writeAtomic(
    join(paths.replies, `${reply.messageId}.json`),
    JSON.stringify(reply, null, 2),
  );
}

export async function readReply(runDir: string, messageId: string): Promise<Reply | null> {
  return readJson<Reply>(join(runPaths(runDir).replies, `${messageId}.json`));
}

/**
 * 답이 올 때까지 기다린다. 워커의 `ask`가 여기서 블록한다.
 *
 * 폴링을 쓴 이유: 소켓이나 포트를 열면 Windows 방화벽·포트 충돌·정리 실패가 따라온다.
 * 이 규모에서는 파일 폴링이 훨씬 적은 실패 모드를 갖는다.
 */
export async function waitForReply(
  runDir: string,
  messageId: string,
  opts: { timeoutMs: number; intervalMs?: number; signal?: AbortSignal },
): Promise<Reply | null> {
  const interval = opts.intervalMs ?? 500;
  const deadline = Date.now() + opts.timeoutMs;

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) return null;
    const reply = await readReply(runDir, messageId);
    if (reply) return reply;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return null;
}
