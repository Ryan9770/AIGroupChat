import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Governor } from '../core/governor.js';
import { runPlan } from '../core/scheduler.js';
import type { Provider } from '../protocol/provider.js';
import { createRun } from '../store/run-store.js';
import { git } from '../workspace/git.js';
import { buildArmPlan, type ArmSpec } from './arms.js';
import type { ArmResult, Assertion, Check, EvalTask } from './types.js';

export interface RunArmOptions {
  task: EvalTask;
  spec: ArmSpec;
  rep: number;
  /** 판정 스크립트 경로. worktree 경로를 받아 Check 목록을 돌려준다. */
  assertPath: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onProgress?: (text: string) => void;
}

/**
 * 매 실행마다 **새 저장소**를 만든다.
 *
 * 조건 간 출발점이 다르면 비교가 성립하지 않는다. 앞 실행이 남긴 파일이나
 * 커밋이 다음 실행에 영향을 주지 않도록 통째로 새로 만든다.
 */
async function createFixtureRepo(task: EvalTask): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `conductor-eval-${task.id}-`));

  for (const [path, content] of Object.entries(task.repo)) {
    const full = join(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
  }

  await git(['init', '-q', '-b', 'main'], root);
  await git(['config', 'user.email', 'eval@conductor.local'], root);
  await git(['config', 'user.name', 'conductor-eval'], root);
  await git(['add', '-A'], root);
  await git(['commit', '-q', '-m', 'fixture'], root);
  return root;
}

/** 판정 스크립트를 불러와 실행한다. 실패해도 전체를 죽이지 않는다. */
async function assess(assertPath: string, worktree: string): Promise<Check[]> {
  try {
    const module = (await import(pathToFileURL(assertPath).href)) as {
      default: (dir: string) => Promise<Assertion> | Assertion;
    };
    const result = await module.default(worktree);
    return result.checks;
  } catch (err) {
    return [
      {
        name: '판정 스크립트 실행',
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      },
    ];
  }
}

/**
 * 조건 하나를 한 번 실행하고 채점한다.
 *
 * 판정은 **실행 전에 정해둔 기계 판정**이다. LLM 심판을 쓰지 않는다 —
 * 심판도 모델이면 모델 편향이 결과에 섞여 들어간다.
 */
export async function runArm(opts: RunArmOptions): Promise<ArmResult> {
  const startedAt = Date.now();
  const repoRoot = await createFixtureRepo(opts.task);
  const notes: string[] = [];
  const providers: Provider[] = [];
  let overclaims = 0;

  try {
    const plan = buildArmPlan(opts.task, opts.spec);
    const { runDir } = await createRun({ stateRoot: repoRoot, objective: plan.objective });
    const governor = new Governor();

    const outcomes = await runPlan({
      plan,
      runDir,
      cwd: repoRoot,
      available: [opts.spec.implementer, opts.spec.reviewer],
      isolate: true,
      // 협약을 쓰려면 워커가 보고 명령을 실행할 수 있어야 한다. §5.7.4a
      autoApprove: true,
      protocol: true,
      answerMode: 'auto',
      timeoutMs: opts.timeoutMs,
      governor,
      // 평가에서는 페일오버를 끈다. 다른 벤더가 끼어들면 무엇을 재는지 흐려진다.
      maxAttempts: 1,
      ...(opts.signal ? { signal: opts.signal } : {}),
      onTaskStart: (task, provider) => {
        providers.push(provider);
        opts.onProgress?.(`${task.id}→${provider}`);
      },
      onTaskEnd: (outcome) => {
        if (outcome.note?.includes('변경된 파일이 없습니다')) overclaims += 1;
        if (outcome.state !== 'succeeded') {
          notes.push(`${outcome.taskId}: ${outcome.state}${outcome.note ? ` — ${outcome.note}` : ''}`);
        }
      },
    });

    const completed = outcomes.every((o) => o.state === 'succeeded');
    // 판정은 구현 worktree에서 한다. 검토·수정도 같은 곳에서 돌았다.
    const worktree = outcomes.find((o) => o.result?.workspace)?.result?.workspace?.path;

    const checks = worktree
      ? await assess(opts.assertPath, worktree)
      : [{ name: '작업 공간 생성', ok: false, detail: 'worktree가 만들어지지 않았습니다' }];

    // agy는 비용을 보고하지 않는다. 0으로 합산하면 싸 보이는 착시가 생긴다.
    const costPartial = providers.includes('antigravity');

    return {
      arm: opts.spec.arm,
      taskId: opts.task.id,
      rep: opts.rep,
      completed,
      checks,
      score: checks.filter((c) => c.ok).length,
      total: checks.length,
      costUsd: governor.totalCostUsd,
      costPartial,
      durationMs: Date.now() - startedAt,
      providers,
      overclaims,
      notes,
    };
  } finally {
    // 임시 저장소는 매번 지운다. worktree가 남아 있으면 삭제가 막히므로 강제로 지운다.
    await rm(repoRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
