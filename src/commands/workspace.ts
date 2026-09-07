import { relative } from 'node:path';
import { bold, cyan, dim, green, red, table } from '../ui/format.js';
import {
  collectChanges,
  listWorkspaces,
  removeWorkspace,
  WorkspaceError,
} from '../workspace/worktree.js';

export async function workspaceList(cwd: string, asJson: boolean): Promise<number> {
  const workspaces = await listWorkspaces(cwd);

  const detailed = await Promise.all(
    workspaces.map(async (ws) => ({ ws, changes: await collectChanges(ws) })),
  );

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify(
        detailed.map(({ ws, changes }) => ({ ...ws, filesChanged: changes.files })),
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  if (detailed.length === 0) {
    process.stdout.write(`\n${dim('conductor가 만든 작업 공간이 없습니다.')}\n\n`);
    return 0;
  }

  process.stdout.write(`\n${bold('작업 공간')}\n\n`);
  process.stdout.write(
    `${table(
      ['ID', 'BRANCH', 'FILES', 'PATH'],
      // 절대 경로는 표를 터뜨린다. 저장소 기준 상대 경로로 줄인다.
      detailed.map(({ ws, changes }) => [
        ws.id,
        ws.branch,
        changes.files.length > 0 ? green(String(changes.files.length)) : dim('0'),
        relative(ws.repoRoot, ws.path).split('\\').join('/'),
      ]),
    )}\n\n`,
  );
  return 0;
}

export async function workspaceRemove(
  cwd: string,
  id: string,
  force: boolean,
): Promise<number> {
  const workspaces = await listWorkspaces(cwd);
  const target = workspaces.find((ws) => ws.id === id);

  if (!target) {
    process.stderr.write(`${red(`작업 공간을 찾을 수 없습니다: ${id}`)}\n`);
    if (workspaces.length > 0) {
      process.stderr.write(`${dim(`사용 가능: ${workspaces.map((w) => w.id).join(', ')}`)}\n`);
    }
    return 2;
  }

  // 워커의 작업물을 말없이 날리지 않는다. 무엇을 지우는지 먼저 보여준다.
  const changes = await collectChanges(target);
  if (changes.files.length > 0 && !force) {
    process.stderr.write(
      `${red(`커밋되지 않은 변경 ${changes.files.length}개가 남아 있습니다.`)}\n`,
    );
    for (const file of changes.files.slice(0, 10)) {
      process.stderr.write(`  ${dim('·')} ${file}\n`);
    }
    process.stderr.write(
      `\n${dim(`확인: git -C "${target.path}" diff HEAD`)}\n` +
        `${dim(`그래도 지우려면: conductor workspace rm ${id} --force`)}\n`,
    );
    return 1;
  }

  try {
    await removeWorkspace(target, { force });
  } catch (err) {
    if (err instanceof WorkspaceError) {
      process.stderr.write(`${red(err.message)}\n`);
      if (err.hint) process.stderr.write(`${dim(err.hint)}\n`);
      return 1;
    }
    throw err;
  }

  process.stdout.write(`${green('제거됨')} ${cyan(id)}\n`);
  return 0;
}
