import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { EvalTask, EvalTaskFile } from './types.js';

export interface LoadedTask {
  task: EvalTask;
  /** 판정 스크립트 경로. worktree 경로를 받아 Check 목록을 돌려준다. */
  assertPath: string;
}

/**
 * `files/` 아래를 통째로 읽어 저장소 픽스처로 만든다.
 *
 * 경로는 항상 `/`로 정규화한다. 여기서 Windows의 `\`가 새어 나가면
 * 픽스처 파일이 `src\config.js`라는 이름의 **단일 파일**로 만들어져
 * 워커가 `src/config.js`를 못 찾는다.
 */
async function readFilesDir(dir: string): Promise<Record<string, string>> {
  const repo: Record<string, string> = {};

  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      repo[relative(dir, full).split(sep).join('/')] = await readFile(full, 'utf8');
    }
  };

  await walk(dir);
  return repo;
}

export async function loadTasks(dir: string, filter?: string[]): Promise<LoadedTask[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const loaded: LoadedTask[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (filter?.length && !filter.includes(entry.name)) continue;

    const raw = await readFile(join(dir, entry.name, 'task.json'), 'utf8');
    const parsed = EvalTaskFile.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(
        `${entry.name}/task.json 형식 오류: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
      );
    }

    const repo = parsed.data.repo ?? (await readFilesDir(join(dir, entry.name, 'files')));
    if (Object.keys(repo).length === 0) {
      throw new Error(`${entry.name}: 저장소 픽스처가 비어 있습니다 (repo 또는 files/ 필요).`);
    }

    loaded.push({
      task: EvalTask.parse({ ...parsed.data, repo }),
      assertPath: resolve(dir, entry.name, 'assert.mjs'),
    });
  }

  if (filter?.length) {
    const missing = filter.filter((f) => !loaded.some((l) => l.task.id === f));
    if (missing.length) throw new Error(`없는 과제: ${missing.join(', ')}`);
  }
  return loaded;
}
