import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { git, parseStatusPaths, parseWorktreeList } from '../src/workspace/git.js';
import {
  captureWorkingTreeSnapshot,
  collectChangesSince,
  makeWorkspaceId,
  WORKSPACE_PREFIX,
} from '../src/workspace/worktree.js';

describe('parseWorktreeList', () => {
  // `git worktree list --porcelain` 실제 형식.
  const sample = [
    'worktree C:/repo',
    'HEAD abc123',
    'branch refs/heads/main',
    '',
    'worktree C:/repo/.conductor/worktrees/claude-plan-x9k2p',
    'HEAD def456',
    'branch refs/heads/conductor/claude-plan-x9k2p',
    '',
    'worktree C:/repo/.conductor/worktrees/detached-one',
    'HEAD 999aaa',
    'detached',
    '',
  ].join('\n');

  it('레코드를 빈 줄 기준으로 나눈다', () => {
    expect(parseWorktreeList(sample)).toHaveLength(3);
  });

  it('refs/heads/ 접두사를 벗긴다', () => {
    const entries = parseWorktreeList(sample);
    expect(entries[1]?.branch).toBe('conductor/claude-plan-x9k2p');
  });

  it('detached 상태를 표시한다', () => {
    const entries = parseWorktreeList(sample);
    expect(entries[2]).toMatchObject({ detached: true });
    expect(entries[2]?.branch).toBeUndefined();
  });

  it('경로에 공백이 있어도 첫 스페이스에서만 자른다', () => {
    const entries = parseWorktreeList('worktree C:/My Projects/repo\nHEAD abc\n');
    expect(entries[0]?.path).toBe('C:/My Projects/repo');
  });

  it('빈 입력에 빈 배열을 준다', () => {
    expect(parseWorktreeList('')).toEqual([]);
  });
});

describe('parseStatusPaths', () => {
  it('상태 코드를 떼고 경로만 남긴다', () => {
    const out = parseStatusPaths([' M src/a.ts', '?? new.txt', 'A  src/b.ts'].join('\n'));
    expect(out).toEqual(['src/a.ts', 'new.txt', 'src/b.ts']);
  });

  it('이름 변경은 새 경로를 취한다', () => {
    // 워커가 파일을 옮겼을 때 옛 경로를 보고하면 리뷰가 엉킨다.
    expect(parseStatusPaths('R  old/path.ts -> new/path.ts')).toEqual(['new/path.ts']);
  });

  it('빈 줄과 짧은 줄을 걸러낸다', () => {
    expect(parseStatusPaths('\n \n M x.ts\n')).toEqual(['x.ts']);
  });
});

describe('makeWorkspaceId', () => {
  it('브랜치 이름으로 안전한 형태를 만든다', () => {
    const id = makeWorkspaceId('claude-plan');
    expect(id).toMatch(/^[a-z0-9가-힣-]+$/);
    expect(`${WORKSPACE_PREFIX}${id}`).toMatch(/^conductor\//);
  });

  it('같은 라벨에도 서로 다른 ID를 준다', () => {
    // 같은 provider로 여러 워커를 동시에 띄우면 충돌하면 안 된다.
    const ids = new Set(Array.from({ length: 3 }, () => makeWorkspaceId('claude-plan')));
    expect(ids.size).toBeGreaterThan(0);
    for (const id of ids) expect(id.startsWith('claude-plan-')).toBe(true);
  });

  it('특수문자를 제거한다', () => {
    expect(makeWorkspaceId('a/b\\c:d*e')).toMatch(/^a-b-c-d-e-/);
  });
});

describe('direct working-tree change detection', () => {
  const made: string[] = [];

  afterEach(async () => {
    await Promise.all(made.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function repo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'conductor-direct-'));
    made.push(dir);
    expect((await git(['init'], dir)).ok).toBe(true);
    await git(['config', 'user.email', 'tests@example.invalid'], dir);
    await git(['config', 'user.name', 'Conductor Tests'], dir);
    await writeFile(join(dir, 'tracked.txt'), 'base\n', 'utf8');
    await git(['add', 'tracked.txt'], dir);
    expect((await git(['commit', '-m', 'base'], dir)).ok).toBe(true);
    return dir;
  }

  it('reports task edits but excludes unchanged pre-existing dirt', async () => {
    const dir = await repo();
    await writeFile(join(dir, 'tracked.txt'), 'user edit\n', 'utf8');
    await writeFile(join(dir, 'untouched.txt'), 'pre-existing\n', 'utf8');
    await writeFile(join(dir, 'edited-untracked.txt'), 'before\n', 'utf8');

    const baseline = await captureWorkingTreeSnapshot(dir);
    expect(baseline).not.toBeNull();

    await writeFile(join(dir, 'tracked.txt'), 'worker edit\n', 'utf8');
    await writeFile(join(dir, 'edited-untracked.txt'), 'after\n', 'utf8');
    await writeFile(join(dir, 'created.txt'), 'new\n', 'utf8');

    const changes = await collectChangesSince(baseline!);
    expect(changes.files).toEqual(['created.txt', 'edited-untracked.txt', 'tracked.txt']);
  });

  it('reports a worker-created commit even when the checkout ends clean', async () => {
    const dir = await repo();
    const baseline = await captureWorkingTreeSnapshot(dir);
    expect(baseline).not.toBeNull();

    await writeFile(join(dir, 'tracked.txt'), 'committed by worker\n', 'utf8');
    await git(['add', 'tracked.txt'], dir);
    expect((await git(['commit', '-m', 'worker'], dir)).ok).toBe(true);

    expect((await collectChangesSince(baseline!)).files).toEqual(['tracked.txt']);
  });
});
