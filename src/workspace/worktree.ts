import { createHash } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  currentBranch,
  findRepoRoot,
  git,
  hasCommits,
  parseStatusPaths,
  parseWorktreeList,
} from './git.js';

/** conductor가 만든 worktree/브랜치를 알아보기 위한 접두사. */
export const WORKSPACE_PREFIX = 'conductor/';

/** worktree들이 사는 곳. 저장소 안에 두되 git이 무시하도록 안내한다. */
export const WORKSPACE_DIR = join('.conductor', 'worktrees');

export interface Workspace {
  /** 짧은 식별자. 브랜치·디렉토리 이름에 쓰인다. */
  id: string;
  /** 워커가 실제로 실행될 절대 경로. */
  path: string;
  branch: string;
  repoRoot: string;
  /** 분기 기준. */
  baseRef: string;
}

export interface WorkspaceChanges {
  files: string[];
  /** `git diff --stat` 요약. 전체 diff는 크므로 요약만 들고 온다. */
  stat: string;
}

/** Baseline used to report only edits made by a direct (non-worktree) dispatch. */
export interface WorkingTreeSnapshot {
  repoRoot: string;
  head?: string;
  /** Fingerprints only for paths that were already dirty when the dispatch began. */
  fingerprints: Record<string, string>;
}

/**
 * 기준 브랜치 대비 얼마나 뒤처졌는지.
 *
 * Orca에서 빌려온 개념이다. 워커가 낡은 코드 위에서 작업하면 줄 번호가 어긋난
 * 산출물을 내놓고, 그걸 나중에야 발견하게 된다. 시작 전에 알려주는 게 싸다.
 */
export interface BaseDrift {
  base: string;
  behind: number;
  recentSubjects: string[];
}

export class WorkspaceError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

/** 브랜치·디렉토리 이름에 쓸 수 있게 정리한다. */
function slugify(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return cleaned || 'task';
}

export function makeWorkspaceId(label: string): string {
  // 사람이 알아볼 라벨 + 충돌 방지용 시각 접미사.
  const stamp = Date.now().toString(36).slice(-5);
  return `${slugify(label)}-${stamp}`;
}

/**
 * 워커 전용 git worktree를 만든다.
 *
 * 이게 이 프로젝트의 안전 경계다. 워커에게 "묻지 말고 해"라고 허락하려면
 * 망가져도 되는 자기 사본이 먼저 있어야 한다. SPEC ADR-4
 */
export async function createWorkspace(opts: {
  cwd: string;
  label: string;
  baseRef?: string;
}): Promise<Workspace> {
  const repoRoot = await findRepoRoot(opts.cwd);
  if (!repoRoot) {
    throw new WorkspaceError(
      `git 저장소가 아닙니다: ${opts.cwd}`,
      'worktree 격리는 git 저장소를 요구합니다. `git init` 후 커밋을 하나 만들거나, --workspace 없이 실행하세요.',
    );
  }
  if (!(await hasCommits(repoRoot))) {
    throw new WorkspaceError(
      '저장소에 커밋이 없습니다.',
      'worktree는 기준 커밋이 있어야 만들 수 있습니다. 먼저 커밋을 하나 만드세요.',
    );
  }

  const baseRef = opts.baseRef ?? (await currentBranch(repoRoot)) ?? 'HEAD';
  const id = makeWorkspaceId(opts.label);
  const branch = `${WORKSPACE_PREFIX}${id}`;
  const path = join(repoRoot, WORKSPACE_DIR, id);

  await mkdir(join(repoRoot, WORKSPACE_DIR), { recursive: true });

  const created = await git(['worktree', 'add', '-b', branch, path, baseRef], repoRoot, 120_000);
  if (!created.ok) {
    throw new WorkspaceError(
      `worktree 생성 실패: ${created.stderr || created.stdout}`,
      `기준: ${baseRef}`,
    );
  }

  return { id, path, branch, repoRoot, baseRef };
}

/**
 * 기준 대비 뒤처진 정도를 잰다. 뒤처지지 않았으면 undefined.
 *
 * 뒤처지지 않았는데도 경고를 내면 워커가 그 경고를 무시하도록 학습한다.
 * 실제로 문제일 때만 낸다.
 */
export async function checkBaseDrift(ws: Workspace): Promise<BaseDrift | undefined> {
  const counted = await git(['rev-list', '--count', `HEAD..${ws.baseRef}`], ws.path);
  if (!counted.ok) return undefined;

  const behind = Number.parseInt(counted.stdout.trim(), 10);
  if (!Number.isFinite(behind) || behind <= 0) return undefined;

  const log = await git(
    ['log', '--format=%s', '-5', `HEAD..${ws.baseRef}`],
    ws.path,
  );
  return {
    base: ws.baseRef,
    behind,
    recentSubjects: log.ok ? log.stdout.split('\n').filter(Boolean) : [],
  };
}

/** worktree 안에서 무엇이 바뀌었는지 수집한다. */
export async function collectChanges(ws: Workspace): Promise<WorkspaceChanges> {
  // core.quotepath=false: 한글·공백 경로가 \xxx 이스케이프로 나오는 걸 막는다.
  const status = await git(
    ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '--untracked-files=all'],
    ws.path,
  );
  const files = status.ok ? parseStatusPaths(status.stdout) : [];

  const stat = await git(['-c', 'core.quotepath=false', 'diff', '--stat', 'HEAD'], ws.path);

  return { files, stat: stat.ok ? stat.stdout : '' };
}

const CLEAN_PATH = '<clean>';
const MISSING_PATH = '<missing>';

async function fingerprintFile(repoRoot: string, relativePath: string): Promise<string> {
  try {
    const content = await readFile(join(repoRoot, relativePath));
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return MISSING_PATH;
  }
}

/**
 * Capture pre-existing dirt before a task writes directly in the user's checkout.
 *
 * A plain post-run `git status` cannot distinguish the task's edits from the
 * user's existing changes. Hashing just the paths that are already dirty keeps
 * the baseline cheap while still detecting a task editing an already-modified or
 * untracked file.
 */
export async function captureWorkingTreeSnapshot(
  cwd: string,
): Promise<WorkingTreeSnapshot | null> {
  const repoRoot = await findRepoRoot(cwd);
  if (!repoRoot) return null;

  const status = await git(
    ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '--untracked-files=all'],
    repoRoot,
  );
  if (!status.ok) return null;

  const paths = [...new Set(parseStatusPaths(status.stdout))];
  const fingerprints: Record<string, string> = {};
  for (const path of paths) fingerprints[path] = await fingerprintFile(repoRoot, path);

  const head = await git(['rev-parse', '--verify', 'HEAD'], repoRoot);
  return {
    repoRoot,
    fingerprints,
    ...(head.ok && head.stdout.trim() ? { head: head.stdout.trim() } : {}),
  };
}

/** Return only files whose working content/state changed after the baseline. */
export async function collectChangesSince(
  snapshot: WorkingTreeSnapshot,
): Promise<WorkspaceChanges> {
  const status = await git(
    ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '--untracked-files=all'],
    snapshot.repoRoot,
  );
  if (!status.ok) return { files: [], stat: '' };

  const currentPaths = new Set(parseStatusPaths(status.stdout));
  const candidates = new Set([...Object.keys(snapshot.fingerprints), ...currentPaths]);
  const committedPaths = new Set<string>();

  // A worker can legitimately commit its work. Include committed paths even when
  // the checkout is clean at the end of the dispatch.
  if (snapshot.head) {
    const committed = await git(
      ['-c', 'core.quotepath=false', 'diff', '--name-only', snapshot.head, 'HEAD'],
      snapshot.repoRoot,
    );
    if (committed.ok) {
      for (const path of committed.stdout.split('\n').map((item) => item.trim()).filter(Boolean)) {
        candidates.add(path);
        committedPaths.add(path);
      }
    }
  }

  const files: string[] = [];
  for (const path of candidates) {
    const existedBefore = Object.hasOwn(snapshot.fingerprints, path);
    const before = existedBefore ? snapshot.fingerprints[path]! : CLEAN_PATH;
    const after = currentPaths.has(path)
      ? await fingerprintFile(snapshot.repoRoot, path)
      : CLEAN_PATH;
    if (before !== after || committedPaths.has(path)) {
      files.push(path);
    }
  }

  const stat = snapshot.head
    ? await git(['-c', 'core.quotepath=false', 'diff', '--stat', snapshot.head], snapshot.repoRoot)
    : undefined;
  return { files: files.sort(), stat: stat?.ok ? stat.stdout : '' };
}

/** conductor가 만든 worktree 목록. 남의 worktree는 건드리지 않는다. */
export async function listWorkspaces(cwd: string): Promise<Workspace[]> {
  const repoRoot = await findRepoRoot(cwd);
  if (!repoRoot) return [];

  const listed = await git(['worktree', 'list', '--porcelain'], repoRoot);
  if (!listed.ok) return [];

  return parseWorktreeList(listed.stdout)
    .filter((entry) => entry.branch?.startsWith(WORKSPACE_PREFIX))
    .map((entry) => ({
      id: entry.branch!.slice(WORKSPACE_PREFIX.length),
      path: entry.path,
      branch: entry.branch!,
      repoRoot,
      baseRef: 'HEAD',
    }));
}

/**
 * worktree와 그 브랜치를 제거한다.
 *
 * 커밋 안 된 변경이 있으면 기본적으로 거부한다. 워커의 작업물을 말없이
 * 날리는 것보다, 사용자가 보고 결정하게 하는 편이 낫다.
 */
export async function removeWorkspace(
  ws: Workspace,
  opts: { force?: boolean } = {},
): Promise<void> {
  const args = ['worktree', 'remove', ws.path];
  if (opts.force) args.push('--force');

  const removed = await git(args, ws.repoRoot, 60_000);
  if (!removed.ok) {
    throw new WorkspaceError(
      `worktree 제거 실패: ${removed.stderr || removed.stdout}`,
      '커밋되지 않은 변경이 남아 있을 수 있습니다. 내용을 확인한 뒤 --force로 제거하세요.',
    );
  }

  // 브랜치는 별도로 지운다. 병합 안 된 브랜치라 -D가 필요하다.
  await git(['branch', '-D', ws.branch], ws.repoRoot);

  // git이 남긴 빈 디렉토리 정리. 실패해도 치명적이지 않다.
  await rm(ws.path, { recursive: true, force: true }).catch(() => undefined);
}
