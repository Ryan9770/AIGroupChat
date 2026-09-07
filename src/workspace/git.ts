import { execa } from 'execa';

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * git을 셸 없이 직접 호출한다.
 *
 * `shell: false`가 중요하다. Windows 경로에 공백이 흔한데 셸을 거치면
 * 인용 규칙 때문에 조용히 다른 경로를 건드리게 된다.
 */
export async function git(args: string[], cwd: string, timeoutMs = 60_000): Promise<GitResult> {
  const result = await execa('git', args, {
    cwd,
    reject: false,
    shell: false,
    windowsHide: true,
    stdin: 'ignore',
    stripFinalNewline: true,
    timeout: timeoutMs,
  });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.exitCode ?? null,
  };
}

/** cwd가 속한 저장소의 최상위 경로. git 저장소가 아니면 null. */
export async function findRepoRoot(cwd: string): Promise<string | null> {
  const result = await git(['rev-parse', '--show-toplevel'], cwd);
  return result.ok && result.stdout ? result.stdout.trim() : null;
}

/** 커밋이 하나라도 있는가. 갓 init한 저장소는 worktree를 만들 수 없다. */
export async function hasCommits(repoRoot: string): Promise<boolean> {
  return (await git(['rev-parse', '--verify', 'HEAD'], repoRoot)).ok;
}

export async function currentBranch(repoRoot: string): Promise<string | null> {
  const result = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
  return result.ok && result.stdout !== 'HEAD' ? result.stdout.trim() : null;
}

/**
 * `git worktree list --porcelain` 출력을 파싱한다.
 *
 * 형식은 빈 줄로 구분된 레코드이고, 각 줄은 `키 값` 또는 키 단독이다.
 * 경로에 공백이 들어갈 수 있으므로 첫 스페이스에서만 자른다.
 */
export interface WorktreeEntry {
  path: string;
  head?: string;
  branch?: string;
  detached: boolean;
  locked: boolean;
}

export function parseWorktreeList(porcelain: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: Partial<WorktreeEntry> & { detached?: boolean; locked?: boolean } = {};

  const flush = () => {
    if (current.path) {
      entries.push({
        path: current.path,
        ...(current.head ? { head: current.head } : {}),
        ...(current.branch ? { branch: current.branch } : {}),
        detached: current.detached === true,
        locked: current.locked === true,
      });
    }
    current = {};
  };

  for (const raw of porcelain.split('\n')) {
    const line = raw.trimEnd();
    if (!line) {
      flush();
      continue;
    }
    const spaceAt = line.indexOf(' ');
    const key = spaceAt === -1 ? line : line.slice(0, spaceAt);
    const value = spaceAt === -1 ? '' : line.slice(spaceAt + 1);

    switch (key) {
      case 'worktree':
        flush();
        current.path = value;
        break;
      case 'HEAD':
        current.head = value;
        break;
      case 'branch':
        // refs/heads/foo → foo
        current.branch = value.replace(/^refs\/heads\//, '');
        break;
      case 'detached':
        current.detached = true;
        break;
      case 'locked':
        current.locked = true;
        break;
      default:
        break;
    }
  }
  flush();
  return entries;
}

/**
 * `git status --porcelain=v1` 출력에서 변경된 경로를 뽑는다.
 *
 * 이름 변경(R)은 `old -> new` 형태라 새 경로만 취한다.
 * 따옴표로 감싼 경로(비ASCII·공백)는 core.quotepath 설정에 따라 나오므로
 * 호출부에서 `-c core.quotepath=false`를 붙여 방지한다.
 */
export function parseStatusPaths(porcelain: string): string[] {
  const paths: string[] = [];
  for (const line of porcelain.split('\n')) {
    if (line.length < 4) continue;
    const rest = line.slice(3);
    const arrow = rest.indexOf(' -> ');
    paths.push(arrow === -1 ? rest : rest.slice(arrow + 4));
  }
  return paths;
}
