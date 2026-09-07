import { describe, expect, it } from 'vitest';
import { parseStatusPaths, parseWorktreeList } from '../src/workspace/git.js';
import { makeWorkspaceId, WORKSPACE_PREFIX } from '../src/workspace/worktree.js';

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
