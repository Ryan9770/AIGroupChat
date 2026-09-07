import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildArmPlan, planArms } from '../src/eval/arms.js';
import { EvalTask, type Assertion } from '../src/eval/types.js';

/**
 * 채점표 자체를 검증한다.
 *
 * 판정 기준이 불가능하거나 버그가 있으면, 평가는 에이전트가 아니라 내 채점표를
 * 재게 된다. 각 과제마다 **정답 구현**과 **일부러 틀린 구현**을 넣어
 * 채점표가 둘을 구분하는지 확인한다.
 */
async function runRubric(taskId: string, files: Record<string, string>): Promise<Assertion> {
  const dir = await mkdtemp(join(tmpdir(), `rubric-${taskId}-`));
  try {
    for (const [path, content] of Object.entries(files)) {
      const full = join(dir, path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, content, 'utf8');
    }
    const assertPath = resolve('eval/tasks', taskId, 'assert.mjs');
    const module = (await import(pathToFileURL(assertPath).href)) as {
      default: (d: string) => Promise<Assertion>;
    };
    return await module.default(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const passed = (a: Assertion) => a.checks.filter((c) => c.ok).length;
const failedNames = (a: Assertion) => a.checks.filter((c) => !c.ok).map((c) => c.name);

async function loadTask(id: string): Promise<EvalTask> {
  return EvalTask.parse(JSON.parse(await readFile(join('eval/tasks', id, 'task.json'), 'utf8')));
}

describe('license-field 채점표', () => {
  const MIT = (holder: string, year: string) =>
    `MIT License\n\nCopyright (c) ${year} ${holder}\n\n` +
    'Permission is hereby granted, free of charge...\n\n' +
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.\n';

  const base = {
    'package.json': JSON.stringify(
      { name: 'widget-lib', version: '0.3.1', author: 'Hana Kim', main: 'src/index.js', license: 'MIT' },
      null,
      2,
    ),
    'src/index.js': 'export function widget(n) {\n  return n * 2;\n}\n',
  };

  it('정답 구현은 전부 통과한다', async () => {
    // 통과 불가능한 채점표면 평가가 아니라 내 버그를 재는 것이다.
    const result = await runRubric('license-field', {
      ...base,
      LICENSE: MIT('Hana Kim', '2026'),
    });
    expect(failedNames(result)).toEqual([]);
  });

  it('저작권자를 틀리면 잡는다', async () => {
    // 지시를 대충 읽으면 author 대신 일반적인 이름을 넣는다.
    const result = await runRubric('license-field', {
      ...base,
      LICENSE: MIT('Your Name', '2026'),
    });
    expect(failedNames(result)).toContain('저작권자가 author 값과 일치');
  });

  it('기존 필드를 지우면 잡는다', async () => {
    const result = await runRubric('license-field', {
      ...base,
      'package.json': JSON.stringify({ name: 'widget-lib', license: 'MIT' }, null, 2),
      LICENSE: MIT('Hana Kim', '2026'),
    });
    expect(failedNames(result)).toContain('기존 필드 보존');
  });

  it('LICENSE가 없으면 잡는다', async () => {
    const result = await runRubric('license-field', base);
    expect(failedNames(result)).toContain('LICENSE 파일 존재');
  });
});

describe('config-validation 채점표', () => {
  const GOOD = `export function loadConfig(raw) {
  if (typeof raw?.host !== 'string' || raw.host.length === 0) throw new Error('host must be a non-empty string');
  if (!Number.isInteger(raw?.port) || raw.port < 1 || raw.port > 65535) throw new Error('port must be an integer between 1 and 65535');
  const retries = raw.retries ?? 3;
  if (!Number.isInteger(retries) || retries < 0) throw new Error('retries must be a non-negative integer');
  return { host: raw.host, port: raw.port, retries };
}
`;

  it('정답 구현은 전부 통과한다', async () => {
    const result = await runRubric('config-validation', { 'src/config.js': GOOD });
    expect(failedNames(result)).toEqual([]);
  });

  it('검증을 안 하면 대부분 실패한다', async () => {
    const original = `export function loadConfig(raw) {
  return { host: raw.host, port: raw.port, retries: raw.retries ?? 3 };
}
`;
    const result = await runRubric('config-validation', { 'src/config.js': original });
    expect(failedNames(result)).toContain('port 범위 초과 거부');
    expect(failedNames(result)).toContain('host 빈 문자열 거부');
  });

  it('검증을 넣으면서 기본값을 깨뜨리면 잡는다', async () => {
    // 흔한 회귀. 검증에만 집중하다 기존 동작을 망친다.
    const broken = GOOD.replace('const retries = raw.retries ?? 3;', 'const retries = raw.retries;');
    const result = await runRubric('config-validation', { 'src/config.js': broken });
    expect(failedNames(result)).toContain('retries 기본값 3');
  });

  it('과하게 막아 정상 설정을 거부하면 잡는다', async () => {
    const tooStrict = GOOD.replace('raw.port > 65535', 'raw.port > 1024');
    const result = await runRubric('config-validation', { 'src/config.js': tooStrict });
    expect(failedNames(result)).toContain('정상 설정 통과');
  });
});

describe('조건 구성의 공정성', () => {
  it('조건 간 차이는 검토자뿐이다', async () => {
    const task = await loadTask('license-field');
    const self = buildArmPlan(task, { arm: 'self-review', implementer: 'claude', reviewer: 'claude' });
    const cross = buildArmPlan(task, { arm: 'cross-review', implementer: 'claude', reviewer: 'codex' });

    // 단계 수·지시·워크스페이스가 다르면 무엇 때문에 차이가 났는지 알 수 없다.
    expect(self.tasks.map((t) => t.id)).toEqual(cross.tasks.map((t) => t.id));
    expect(self.tasks.map((t) => t.spec)).toEqual(cross.tasks.map((t) => t.spec));
    expect(self.tasks.map((t) => t.workspace)).toEqual(cross.tasks.map((t) => t.workspace));

    // 검토자만 다르다.
    expect(self.tasks.find((t) => t.id === 'review')?.providers).toEqual(['claude']);
    expect(cross.tasks.find((t) => t.id === 'review')?.providers).toEqual(['codex']);
    // 수정은 항상 구현자가 한다.
    expect(cross.tasks.find((t) => t.id === 'revise')?.providers).toEqual(['claude']);
  });

  it('solo는 구현 한 단계뿐이다', async () => {
    const task = await loadTask('license-field');
    const solo = buildArmPlan(task, { arm: 'solo', implementer: 'claude', reviewer: 'claude' });
    expect(solo.tasks).toHaveLength(1);
  });

  it('다른 벤더가 없으면 cross-review를 만들지 않는다', () => {
    // 같은 벤더로 돌리면 self-review와 같아져 비교가 무의미해진다.
    expect(planArms(['claude'], 'claude').map((a) => a.arm)).toEqual(['solo', 'self-review']);
    expect(planArms(['claude', 'codex'], 'claude').map((a) => a.arm)).toContain('cross-review');
  });
});
