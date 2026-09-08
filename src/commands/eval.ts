import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { allAdapters } from '../adapters/registry.js';
import { planArms } from '../eval/arms.js';
import { runArm } from '../eval/harness.js';
import { loadTasks } from '../eval/load.js';
import type { ArmName, ArmResult } from '../eval/types.js';
import type { Provider } from '../protocol/provider.js';
import { bold, cyan, dim, green, red, table, yellow } from '../ui/format.js';

export interface EvalOptions {
  tasksDir: string;
  /** 조건당·과제당 반복 횟수. 모델은 비결정적이라 1회로는 아무것도 알 수 없다. */
  reps: number;
  /** 구현을 맡을 provider. 모든 조건에서 동일해야 공정하다. */
  implementer?: Provider;
  taskFilter?: string[];
  armFilter?: ArmName[];
  timeoutMs: number;
  outDir: string;
  /** 실행하지 않고 무엇을 돌릴지, 비용이 얼마나 들지만 보여준다. */
  dryRun: boolean;
}

async function availableProviders(): Promise<Provider[]> {
  const results = await Promise.all(allAdapters().map((a) => a.preflight(false)));
  return results.filter((r) => r.installed && r.authed === true).map((r) => r.provider);
}

/** 평균. 표본이 없으면 0. */
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export async function evaluate(opts: EvalOptions): Promise<number> {
  const tasks = await loadTasks(opts.tasksDir, opts.taskFilter);
  if (tasks.length === 0) {
    process.stderr.write(`${red('실행할 과제가 없습니다.')} ${opts.tasksDir}\n`);
    return 2;
  }

  const available = await availableProviders();
  const implementer = opts.implementer ?? available[0];
  if (!implementer || !available.includes(implementer)) {
    process.stderr.write(`${red('구현을 맡을 provider가 없습니다.')} conductor doctor로 확인하세요.\n`);
    return 2;
  }

  const allArms = planArms(available, implementer);
  const arms = opts.armFilter?.length
    ? allArms.filter((a) => opts.armFilter!.includes(a.arm))
    : allArms;

  // 🔴 필터로 뺀 것과 애초에 못 만든 것을 구분한다. 필터링 뒤에 확인하면
  //    --arm solo 로 돌릴 때마다 "다른 벤더가 없다"는 거짓 경고가 뜬다.
  const crossPossible = allArms.some((a) => a.arm === 'cross-review');
  const totalRuns = tasks.length * arms.length * opts.reps;

  process.stdout.write(`\n${bold('평가 하네스')}\n\n`);
  process.stdout.write(`  ${dim('과제')} ${tasks.map((t) => t.task.id).join(', ')}\n`);
  process.stdout.write(`  ${dim('구현자')} ${cyan(implementer)} ${dim('(모든 조건 동일)')}\n`);
  process.stdout.write(
    `  ${dim('조건')} ${arms.map((a) => `${a.arm}(검토=${a.reviewer})`).join('  ')}\n`,
  );
  process.stdout.write(`  ${dim('반복')} ${opts.reps}회  ${dim('총 실행')} ${totalRuns}회\n`);

  if (!crossPossible) {
    process.stdout.write(
      `\n  ${yellow('⚠ 다른 벤더가 없어 cross-review를 건너뜁니다.')}\n` +
        `  ${dim('그러면 "여러 벤더가 나은가"에는 답할 수 없습니다 — 그게 이 평가의 요점입니다.')}\n`,
    );
  }
  if (opts.reps < 3) {
    process.stdout.write(
      `\n  ${yellow(`⚠ 반복 ${opts.reps}회는 결론을 내기에 부족합니다.`)}\n` +
        `  ${dim('모델은 같은 입력에도 다르게 답합니다. 경향만 참고하세요.')}\n`,
    );
  }

  if (opts.dryRun) {
    process.stdout.write(`\n${dim('--dry-run: 실행하지 않았습니다.')}\n\n`);
    return 0;
  }

  process.stdout.write('\n');

  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.once('SIGINT', onSigint);

  const results: ArmResult[] = [];
  let index = 0;

  // 🔴 실행마다 곧바로 append한다. 전부 끝난 뒤에 한 번만 쓰면 18회 중
  //    15회째에 죽었을 때 이미 태운 쿼터가 통째로 사라진다. 두 시간짜리
  //    실행에서 그건 받아들일 수 없는 실패 방식이다.
  await mkdir(opts.outDir, { recursive: true });
  const stamp = Date.now();
  const livePath = join(opts.outDir, `eval-${stamp}.jsonl`);
  const appendLine = (value: unknown) =>
    appendFile(livePath, `${JSON.stringify(value)}\n`, 'utf8');
  await appendLine({ kind: 'meta', implementer, arms, totalRuns, startedAt: stamp });

  let consecutiveInvalid = 0;

  // 🔴 반복을 바깥 루프로 둔다. 과제→조건→반복 순으로 돌면 중간에 죽었을 때
  //    뒤쪽 조건이 통째로 비어 비교 자체가 성립하지 않는다. 실제로 그렇게
  //    잘려서 solo 3회만 남은 적이 있다. 이 순서면 잘려도 조건 간 균형이 유지된다.
  const schedule = [];
  for (let rep = 1; rep <= opts.reps; rep += 1) {
    for (const entry of tasks) {
      for (const spec of arms) schedule.push({ ...entry, spec, rep });
    }
  }

  try {
    runs: for (const { task, assertPath, spec, rep } of schedule) {
      if (controller.signal.aborted) break;
      index += 1;
      process.stdout.write(
        `${dim(`[${index}/${totalRuns}]`)} ${task.id} ${cyan(spec.arm)} ${dim(`#${rep}`)} `,
      );

      // 실행 하나가 죽어도 나머지를 계속한다. 여기서 멈추면 이미 태운
      // 쿼터가 버려지고, 무엇이 왜 실패했는지도 표에 안 남는다.
      let result: ArmResult;
      try {
        result = await runArm({
          task,
          spec,
          rep,
          assertPath,
          timeoutMs: opts.timeoutMs,
          signal: controller.signal,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stdout.write(`${red('실행 실패')} ${dim(message.split('\n')[0] ?? '')}\n`);
        result = {
          arm: spec.arm, taskId: task.id, rep,
          completed: false, checks: [], score: 0, total: 0,
          costUsd: 0, costPartial: false, durationMs: 0,
          providers: [], overclaims: 0, notes: [message],
          valid: false, invalidReason: `실행 실패: ${message.split('\n')[0] ?? ''}`,
        };
      }
      results.push(result);
      await appendLine(result);

      if (!result.valid) {
        process.stdout.write(`${red('무효')} ${dim(result.invalidReason ?? '')}\n`);
        // 🔴 연달아 무효면 벤더가 죽은 것이다. 계속 돌려봐야 쓰레기 행만
        //    쌓이고, 그 표를 나중에 결과로 착각한다. 앞서 실제로 그랬다.
        consecutiveInvalid += 1;
        if (consecutiveInvalid >= 2) {
          process.stdout.write(
            `\n${red('연속 2회 무효 — 평가를 중단합니다.')}\n` +
              `${dim('쿼터가 소진됐거나 벤더가 응답하지 않습니다. 복구된 뒤 다시 돌리세요.')}\n`,
          );
          break runs;
        }
        continue;
      }
      consecutiveInvalid = 0;

      const pass = `${result.score}/${result.total}`;
      process.stdout.write(
        `${result.score === result.total ? green(pass) : yellow(pass)}` +
          `  ${dim(`${(result.durationMs / 1000).toFixed(0)}s`)}` +
          `${result.costUsd > 0 ? dim(`  $${result.costUsd.toFixed(3)}`) : ''}\n`,
      );
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
  }

  const outPath = join(opts.outDir, `eval-${stamp}.json`);
  await writeFile(outPath, JSON.stringify({ implementer, arms, results }, null, 2), 'utf8');

  renderSummary(results, outPath);
  const valid = results.filter((r) => r.valid);
  if (valid.length === 0) return 2;
  return valid.some((r) => r.score < r.total) ? 1 : 0;
}

function renderSummary(all: ArmResult[], outPath: string): void {
  process.stdout.write(`\n${dim('─'.repeat(64))}\n`);

  // 🔴 무효 실행은 절대 평균에 넣지 않는다. 돌지도 않은 실행을 0점으로 세면
  //    표가 결과처럼 생긴 거짓말을 한다.
  const results = all.filter((r) => r.valid);
  const invalid = all.filter((r) => !r.valid);

  if (invalid.length > 0) {
    process.stdout.write(
      `${yellow(`⚠ 무효 ${invalid.length}회 — 아래 집계에서 제외했습니다.`)}\n`,
    );
    for (const r of invalid.slice(0, 5)) {
      process.stdout.write(
        `  ${dim(`${r.taskId} ${r.arm} #${r.rep}`)} ${r.invalidReason ?? ''}\n`,
      );
    }
    if (invalid.length > 5) process.stdout.write(`  ${dim(`… 외 ${invalid.length - 5}회`)}\n`);
    process.stdout.write('\n');
  }

  if (results.length === 0) {
    process.stdout.write(`${red('유효한 실행이 없습니다. 비교할 것이 없습니다.')}\n`);
    process.stdout.write(`${dim('결과')} ${outPath}\n\n`);
    return;
  }

  const byArm = new Map<string, ArmResult[]>();
  for (const r of results) {
    byArm.set(r.arm, [...(byArm.get(r.arm) ?? []), r]);
  }

  const rows = [...byArm.entries()].map(([arm, rs]) => {
    const rates = rs.map((r) => (r.total ? r.score / r.total : 0));
    const perfect = rs.filter((r) => r.score === r.total).length;
    const partial = rs.some((r) => r.costPartial);
    return [
      arm,
      String(rs.length),
      `${(mean(rates) * 100).toFixed(0)}%`,
      `${perfect}/${rs.length}`,
      `${(mean(rs.map((r) => r.durationMs)) / 1000).toFixed(0)}s`,
      `$${mean(rs.map((r) => r.costUsd)).toFixed(3)}${partial ? '+' : ''}`,
      String(rs.reduce((a, r) => a + r.overclaims, 0)),
    ];
  });

  process.stdout.write(
    `${table(['조건', 'N', '판정 통과율', '완전 통과', '평균 시간', '평균 비용', '과장보고'], rows)}\n`,
  );

  // 어느 항목에서 갈렸는지가 평균보다 유용하다.
  const checkNames = [...new Set(results.flatMap((r) => r.checks.map((c) => c.name)))];
  const diffRows: string[][] = [];
  for (const name of checkNames) {
    const cells = [...byArm.keys()].map((arm) => {
      const rs = byArm.get(arm)!;
      const passed = rs.filter((r) => r.checks.find((c) => c.name === name)?.ok).length;
      return `${passed}/${rs.length}`;
    });
    // 조건 간 결과가 같은 항목은 정보가 없다.
    if (new Set(cells).size > 1) diffRows.push([name, ...cells]);
  }

  if (diffRows.length > 0) {
    process.stdout.write(`\n${bold('조건에 따라 갈린 판정 항목')}\n`);
    process.stdout.write(`${table(['항목', ...byArm.keys()], diffRows)}\n`);
  } else {
    process.stdout.write(`\n${dim('조건 간 판정 결과 차이 없음.')}\n`);
  }

  const partial = results.some((r) => r.costPartial);
  if (partial) {
    process.stdout.write(
      `\n${dim('* 비용에 + 표시: antigravity는 비용을 보고하지 않아 실제로는 더 듭니다.')}\n`,
    );
  }
  process.stdout.write(`${dim('결과')} ${outPath}\n\n`);
}
