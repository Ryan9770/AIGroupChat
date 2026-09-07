import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { allAdapters } from '../adapters/registry.js';
import { loadConfig } from '../core/config.js';
import { Governor } from '../core/governor.js';
import { runPlan, SchedulerError, type TaskOutcome } from '../core/scheduler.js';
import { DEFAULT_ROUTES, route } from '../core/router.js';
import { Plan, topoOrder, validatePlan, type Routes } from '../protocol/plan.js';
import type { Provider } from '../protocol/provider.js';
import { createRun } from '../store/run-store.js';
import { bold, cyan, dim, green, red, table, yellow } from '../ui/format.js';
import { findRepoRoot } from '../workspace/git.js';

async function loadPlan(path: string): Promise<Plan> {
  const raw = await readFile(resolve(path), 'utf8');
  const parsed = Plan.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new SchedulerError(`계획 파일 형식이 올바르지 않습니다:\n${detail}`);
  }
  return parsed.data;
}

/** 로그인까지 확인된 provider만 라우팅 후보로 삼는다. */
async function availableProviders(offline: boolean): Promise<Provider[]> {
  const results = await Promise.all(allAdapters().map((a) => a.preflight(offline)));
  return results
    .filter((r) => r.installed && (offline ? true : r.authed === true))
    .map((r) => r.provider);
}

/** 실행하지 않고 DAG와 라우팅 결과만 보여준다. */
export async function planShow(path: string, offline: boolean, cwd: string): Promise<number> {
  const plan = await loadPlan(path);
  const loaded = await loadConfig(cwd);
  const routes = mergeRoutes(loaded.config.routes, plan.routes);
  const issues = validatePlan(plan);

  process.stdout.write(`\n${bold(plan.objective)}\n\n`);

  if (issues.length > 0) {
    process.stdout.write(`${red('계획에 문제가 있습니다')}\n`);
    for (const issue of issues) {
      process.stdout.write(`  ${dim('·')} ${cyan(issue.taskId)} ${issue.message}\n`);
    }
    process.stdout.write('\n');
    return 1;
  }

  const available = await availableProviders(offline);
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));
  const assigned = new Map<string, Provider>();

  const rows = topoOrder(plan).map((id) => {
    const task = byId.get(id)!;
    const avoid = task.context
      .map((ref) => assigned.get(ref))
      .filter((p): p is Provider => p !== undefined);

    const explicit = Boolean(task.providers ?? routes?.[task.role]);
    const routed = route({
      role: task.role,
      available,
      explicit,
      ...(routes ? { routes } : {}),
      ...(task.providers ? { preferred: task.providers } : {}),
      ...(!explicit && avoid.length > 0 && task.role === 'review' ? { avoid } : {}),
    });
    if (routed) assigned.set(id, routed.provider);

    return [
      task.id,
      task.role,
      task.dependsOn.join(',') || dim('-'),
      task.workspace,
      routed ? cyan(routed.provider) : red('없음'),
      routed?.fallbacks.join(',') || dim('-'),
    ];
  });

  process.stdout.write(
    `${table(['TASK', 'ROLE', 'DEPENDS', 'WORKSPACE', 'PROVIDER', 'FALLBACK'], rows)}\n`,
  );

  const unassigned = rows.filter((r) => r[4]?.includes('없음')).length;

  if (loaded.problem) {
    process.stdout.write(`\n${red(`설정 파일 문제 (${loaded.path}): ${loaded.problem}`)}\n`);
  } else if (loaded.path) {
    process.stdout.write(`\n${dim('설정')} ${loaded.path}\n`);
  }

  process.stdout.write(`\n${dim('사용 가능')} ${available.join(', ') || red('없음')}\n`);

  // 담당이 지정됐으면 기본값 대신 그걸 보여준다. 둘 다 보여주면 뭐가 적용됐는지 헷갈린다.
  const effective = routes ?? DEFAULT_ROUTES;
  process.stdout.write(
    `${dim(routes ? '역할별 담당 (지정됨)' : '역할별 담당 (기본값)')} ${Object.entries(effective)
      .map(([role, providers]) => `${role}=${(providers ?? []).join('>') || '-'}`)
      .join('  ')}\n\n`,
  );

  // 설정이 무시되고 있는데 exit 0이면 스크립트가 눈치채지 못한다.
  return unassigned > 0 || loaded.problem ? 1 : 0;
}

export interface PlanRunOptions {
  cwd: string;
  isolate: boolean;
  autoApprove: boolean;
  protocol: boolean;
  answerMode: 'human' | 'auto';
  timeoutMs: number;
  verbose: boolean;
  /** 실행 전체 비용 상한(USD). */
  budgetUsd?: number;
  /** Task 하나당 최대 시도 횟수(페일오버 포함). 없으면 설정 파일 → 기본 3. */
  maxAttempts?: number;
  /** provider별 배치 수 상한. 구독 사용량 보호용. */
  maxPerProvider?: number;
}

export async function planRun(path: string, opts: PlanRunOptions): Promise<number> {
  const plan = await loadPlan(path);
  const loaded = await loadConfig(opts.cwd);
  if (loaded.problem) {
    process.stderr.write(`${red(`설정 파일 문제 (${loaded.path}): ${loaded.problem}`)}
`);
    return 2;
  }
  const routes = mergeRoutes(loaded.config.routes, plan.routes);
  const available = await availableProviders(false);

  if (available.length === 0) {
    process.stderr.write(`${red('로그인된 provider가 없습니다.')} conductor doctor로 확인하세요.\n`);
    return 2;
  }

  const stateRoot = (await findRepoRoot(opts.cwd)) ?? opts.cwd;
  const { runDir } = await createRun({ stateRoot, objective: plan.objective });

  process.stdout.write(`\n${bold(plan.objective)}\n`);
  process.stdout.write(`${dim('run')} ${relative(stateRoot, runDir).split('\\').join('/')}\n\n`);

  const governor = new Governor({
    ...(opts.budgetUsd ?? loaded.config.budgetUsd) !== undefined
      ? { budgetUsd: (opts.budgetUsd ?? loaded.config.budgetUsd)! }
      : {},
    ...(opts.maxPerProvider !== undefined
      ? { maxDispatchesPerProvider: opts.maxPerProvider }
      : {}),
  });

  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.once('SIGINT', onSigint);

  let outcomes: TaskOutcome[];
  try {
    outcomes = await runPlan({
      plan,
      runDir,
      cwd: opts.cwd,
      available,
      ...(routes ? { routes } : {}),
      isolate: opts.isolate,
      autoApprove: opts.autoApprove,
      protocol: opts.protocol,
      answerMode: opts.answerMode,
      timeoutMs: opts.timeoutMs,
      signal: controller.signal,
      governor,
      maxAttempts: opts.maxAttempts ?? loaded.config.maxAttempts ?? 3,
      onFailover: (taskId, from, to, reason) => {
        process.stdout.write(
          `  ${yellow(`↻ ${from} → ${to}`)} ${dim(`(${reason}) — 같은 Task의 새 시도`)}
`,
        );
      },
      onTaskStart: (task, provider, reason) => {
        process.stdout.write(`${dim('▶')} ${bold(task.id)} ${dim('→')} ${cyan(provider)}\n`);
        if (reason.includes('⚠')) process.stdout.write(`  ${yellow(reason)}\n`);
      },
      onTaskEnd: (outcome) => {
        const badge =
          outcome.state === 'succeeded'
            ? green('✓')
            : outcome.state === 'blocked'
              ? yellow('⊘')
              : red('✗');
        const files = outcome.result?.filesChanged.length ?? 0;
        process.stdout.write(
          `  ${badge} ${outcome.state}` +
            (files > 0 ? `  ${dim('files')} ${files}` : '') +
            (outcome.result ? `  ${dim(`${(outcome.result.durationMs / 1000).toFixed(1)}s`)}` : '') +
            '\n',
        );
        if (outcome.note) process.stdout.write(`  ${dim(outcome.note)}\n`);
        process.stdout.write('\n');
      },
      observerFor: opts.verbose
        ? () => ({
            onEvent: (event) => {
              if (event.kind === 'message.delta') process.stdout.write(dim(event.text));
              else if (event.kind === 'tool.call') process.stdout.write(dim(`\n  ⚙ ${event.name}\n`));
            },
            onNotice: (text) => process.stdout.write(`  ${yellow(text)}\n`),
          })
        : () => ({
            onNotice: (text) => process.stdout.write(`  ${yellow(text)}\n`),
          }),
    });
  } catch (err) {
    process.removeListener('SIGINT', onSigint);
    if (err instanceof SchedulerError) {
      process.stderr.write(`${red(err.message)}\n`);
      return 2;
    }
    throw err;
  }
  process.removeListener('SIGINT', onSigint);

  // ── 요약 ───────────────────────────────────────────────────────────────
  process.stdout.write(`${dim('─'.repeat(60))}\n`);
  process.stdout.write(
    `${table(
      ['TASK', 'PROVIDER', 'STATE', 'FILES', 'WORKSPACE'],
      outcomes.map((o) => [
        o.taskId,
        o.provider ?? dim('-'),
        o.state === 'succeeded' ? green(o.state) : o.state === 'failed' ? red(o.state) : yellow(o.state),
        String(o.result?.filesChanged.length ?? 0),
        o.result?.workspace?.id ?? dim('-'),
      ]),
    )}\n`,
  );

  const retried = outcomes.filter((o) => o.attempts.length > 1);
  if (retried.length > 0) {
    process.stdout.write(`
${dim('재배치')}
`);
    for (const outcome of retried) {
      const trail = outcome.attempts
        .map((a) => `${a.provider}${a.outcome === 'succeeded' ? '' : `(${a.failoverReason ?? a.outcome})`}`)
        .join(' → ');
      process.stdout.write(`  ${cyan(outcome.taskId)} ${trail}
`);
    }
  }

  const strained = governor.snapshot().filter((s) => s.blockedUntil !== undefined || (s.utilization ?? 0) >= 0.8);
  if (strained.length > 0) {
    process.stdout.write(`
${dim('쿼터')}
`);
    for (const state of strained) {
      const availability = governor.availability(state.provider);
      process.stdout.write(
        `  ${cyan(state.provider)} ${availability.usable ? yellow(availability.reason ?? '') : red(availability.reason ?? '')}
`,
      );
    }
  }

  const totalCost = governor.totalCostUsd;
  const failed = outcomes.filter((o) => o.state !== 'succeeded');

  if (totalCost > 0) process.stdout.write(`\n${dim('cost')} $${totalCost.toFixed(4)}`);
  process.stdout.write(
    `\n${failed.length === 0 ? green('모든 Task 성공') : red(`${failed.length}개 Task 미완료`)}\n`,
  );

  const withWorkspace = outcomes.filter((o) => o.result?.workspace);
  if (withWorkspace.length > 0) {
    process.stdout.write(`\n${dim('결과 확인')}\n`);
    for (const outcome of withWorkspace) {
      process.stdout.write(
        `  git -C "${outcome.result!.workspace!.path}" diff HEAD   ${dim(`# ${outcome.taskId}`)}\n`,
      );
    }
  }
  process.stdout.write('\n');

  return failed.length === 0 ? 0 : 1;
}

/** 설정 파일 담당 위에 계획 파일 담당을 덮어쓴다. 둘 다 없으면 undefined. */
function mergeRoutes(base?: Routes, override?: Routes): Routes | undefined {
  if (!base && !override) return undefined;
  return { ...(base ?? {}), ...(override ?? {}) };
}
