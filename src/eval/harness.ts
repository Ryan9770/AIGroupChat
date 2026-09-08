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

/** 실제 시도라면 이보다는 오래 걸린다. 그보다 짧으면 CLI가 즉시 튕긴 것이다. */
const MIN_REAL_ATTEMPT_MS = 15_000;

/**
 * 이 실행을 품질 측정으로 인정할 수 있는지 판단한다. 인정 못 하면 그 이유.
 *
 * 🔴 에이전트가 **시도해서 틀린 것**(0점, 유효한 데이터)과 **애초에 돌지 않은
 * 것**(무효)은 전혀 다르다. 쿼터가 마르면 워커는 2초 만에 아무것도 안 하고
 * 끝나는데, 그걸 0점으로 세면 요약표가 "self-review 26%"라고 말한다.
 * 그건 결과가 아니라 쓰레기다. 실제로 18회 중 15회가 그렇게 기록된 적이 있다.
 */
export function judgeValidity(
  outcomes: { taskId: string; result?: { filesChanged: string[]; durationMs: number } }[],
  errors: { code: string; message: string }[],
): string | undefined {
  const rateLimited = errors.find((e) => e.code === 'rate_limited');
  if (rateLimited) return `쿼터 소진: ${rateLimited.message.slice(0, 80)}`;

  // 구현 단계가 파일을 하나도 안 건드리고 즉시 끝났으면 아무 일도 없었던 것이다.
  // 벤더가 쿼터 오류를 구조화해 알려주지 않아도 이 신호는 남는다.
  const implement = outcomes.find((o) => o.taskId === 'implement');
  const changed = implement?.result?.filesChanged.length ?? 0;
  const duration = implement?.result?.durationMs ?? 0;
  if (changed === 0 && duration < MIN_REAL_ATTEMPT_MS) {
    return `구현 워커가 ${(duration / 1000).toFixed(1)}초 만에 아무것도 만들지 않고 종료했습니다`;
  }
  return undefined;
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
  const providerErrors: { code: string; message: string }[] = [];
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
        for (const error of outcome.result?.errors ?? []) {
          providerErrors.push({ code: error.code, message: error.message });
        }
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
    const invalidReason = judgeValidity(outcomes, providerErrors);

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
      valid: invalidReason === undefined,
      ...(invalidReason ? { invalidReason } : {}),
    };
  } finally {
    // 임시 저장소는 매번 지운다. worktree가 남아 있으면 삭제가 막히므로 강제로 지운다.
    await rm(repoRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
