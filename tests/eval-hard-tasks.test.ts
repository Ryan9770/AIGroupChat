import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadTasks } from '../src/eval/load.js';
import type { Assertion, EvalTask } from '../src/eval/types.js';

/**
 * 어려운 과제의 채점표를 검증한다.
 *
 * 이 과제들의 존재 이유는 **기준선이 실제로 실패하는 것**이다. 그래서 두 가지를
 * 모두 확인해야 한다.
 *   1. 정답 구현이 전부 통과하는가 — 아니면 통과 불가능한 채점표를 재는 것이다.
 *   2. 함정에 빠진 구현이 **정확히 그 항목에서만** 걸리는가 — 아니면 어려운 게
 *      아니라 그냥 깨진 과제다.
 */
let tasks: Map<string, EvalTask>;

beforeAll(async () => {
  const loaded = await loadTasks(resolve('eval/tasks'));
  tasks = new Map(loaded.map((l) => [l.task.id, l.task]));
});

/** 과제의 원본 저장소에 패치를 얹어 채점표를 돌린다. */
async function grade(taskId: string, patch: Record<string, string>): Promise<Assertion> {
  const task = tasks.get(taskId);
  if (!task) throw new Error(`과제 없음: ${taskId}`);

  const dir = await mkdtemp(join(tmpdir(), `hard-${taskId}-`));
  try {
    for (const [path, content] of Object.entries({ ...task.repo, ...patch })) {
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

const failed = (a: Assertion) => a.checks.filter((c) => !c.ok).map((c) => c.name);

/** 참조 구현으로 채점할 때 쓸 최소 테스트. 과제의 '테스트가 통과' 항목용. */
const REF_TEST = [
  "import assert from 'node:assert/strict';",
  "import { isIgnored } from '../src/index.js';",
  '',
  "assert.equal(isIgnored('app.log', ['*.log']), true);",
  "assert.equal(isIgnored('app.txt', ['*.log']), false);",
  '',
  "console.log('ok');",
  '',
].join('\n');

// ─── rename-propagation ────────────────────────────────────────────────────

const RENAME_CLIENT = [
  "import { DEFAULTS } from './defaults.js';",
  '',
  'export function buildRequest(options = {}) {',
  '  const merged = { ...DEFAULTS, ...options };',
  '',
  "  if (typeof merged.timeoutMs !== 'number' || merged.timeoutMs <= 0) {",
  "    throw new Error('timeoutMs must be a positive number');",
  '  }',
  '  if (!Number.isInteger(merged.retries) || merged.retries < 0) {',
  "    throw new Error('retries must be a non-negative integer');",
  '  }',
  '',
  '  return {',
  "    url: '/v1/fetch',",
  '    body: {',
  '      // 업스트림 v1 계약상 필드명은 timeout이다. docs/upstream-api.md',
  '      timeout: merged.timeoutMs,',
  '      retries: merged.retries,',
  '    },',
  '  };',
  '}',
  '',
].join('\n');

const RENAME_TEST = [
  "import assert from 'node:assert/strict';",
  "import { buildRequest, DEFAULTS } from '../src/index.js';",
  '',
  'assert.equal(DEFAULTS.timeoutMs, 5000);',
  'assert.equal(buildRequest({ timeoutMs: 3000 }).body.timeout, 3000);',
  'assert.throws(() => buildRequest({ timeoutMs: 0 }));',
  '',
  "console.log('ok');",
  '',
].join('\n');

const RENAME_OK: Record<string, string> = {
  'src/defaults.js': 'export const DEFAULTS = {\n  timeoutMs: 5000,\n  retries: 2,\n};\n',
  'src/client.js': RENAME_CLIENT,
  'schema.json': JSON.stringify(
    {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'fetch-client options',
      type: 'object',
      properties: {
        timeoutMs: { type: 'number', description: '요청 제한 시간(밀리초)', default: 5000 },
        retries: { type: 'integer', description: '재시도 횟수', default: 2 },
      },
      additionalProperties: false,
    },
    null,
    2,
  ),
  'README.md': [
    '# fetch-client',
    '',
    '| 옵션 | 기본값 | 설명 |',
    '|------|--------|------|',
    '| timeoutMs | 5000 | 요청 제한 시간(밀리초) |',
    '| retries | 2 | 재시도 횟수 |',
    '',
  ].join('\n'),
  'test/client.test.mjs': RENAME_TEST,
};

describe('rename-propagation 채점표', () => {
  it('정답 구현은 전부 통과한다', async () => {
    expect(failed(await grade('rename-propagation', RENAME_OK))).toEqual([]);
  });

  it('일괄 치환으로 업스트림 필드까지 바꾸면 잡는다', async () => {
    // 이 과제의 함정. 오류가 나지 않고 요청 본문만 조용히 깨진다.
    const result = await grade('rename-propagation', {
      ...RENAME_OK,
      'src/client.js': RENAME_CLIENT.replace('timeout: merged.timeoutMs,', 'timeoutMs: merged.timeoutMs,'),
      'test/client.test.mjs': RENAME_TEST.replace('.body.timeout,', '.body.timeoutMs,'),
    });
    // 정확히 함정 항목에서만 걸려야 한다. 다른 데서도 걸리면 그냥 깨진 과제다.
    expect(failed(result)).toEqual(['업스트림 요청 필드명 timeout 유지']);
  });

  it('코드만 고치고 스키마·문서를 빠뜨리면 잡는다', async () => {
    const codeOnly = { ...RENAME_OK };
    delete codeOnly['schema.json'];
    delete codeOnly['README.md'];
    const result = await grade('rename-propagation', codeOnly);
    expect(failed(result)).toContain('schema.json에 timeoutMs 정의');
    expect(failed(result)).toContain('README에 옛 이름이 남지 않음');
  });

  it('테스트를 갱신하지 않으면 잡는다', async () => {
    const noTest = { ...RENAME_OK };
    delete noTest['test/client.test.mjs'];
    expect(failed(await grade('rename-propagation', noTest))).toContain('갱신된 테스트가 통과');
  });
});

// ─── format-migration ──────────────────────────────────────────────────────

const RECORD_OK = [
  'export const FORMAT_VERSION = 2;',
  'const SUPPORTED = [1, 2];',
  '',
  'export function serialize(record) {',
  "  if (typeof record?.name !== 'string' || record.name.length === 0) {",
  "    throw new Error('name is required');",
  '  }',
  "  if (typeof record?.owner !== 'string' || record.owner.length === 0) {",
  "    throw new Error('owner is required');",
  '  }',
  '  return JSON.stringify({',
  '    v: FORMAT_VERSION,',
  '    name: record.name,',
  '    owner: record.owner,',
  '    tags: record.tags ?? [],',
  '  });',
  '}',
  '',
  'export function parse(text) {',
  '  const raw = JSON.parse(text);',
  '  if (!SUPPORTED.includes(raw.v)) {',
  "    throw new Error('unsupported format version: ' + raw.v);",
  '  }',
  '  return {',
  '    name: raw.name,',
  "    owner: raw.v === 1 ? 'unknown' : raw.owner,",
  '    tags: raw.tags ?? [],',
  '  };',
  '}',
  '',
].join('\n');

const MIGRATION_TEST = [
  "import assert from 'node:assert/strict';",
  "import { parse, serialize } from '../src/index.js';",
  '',
  "const round = parse(serialize({ name: 'a', owner: 'h', tags: ['x'] }));",
  "assert.equal(round.owner, 'h');",
  "assert.deepEqual(round.tags, ['x']);",
  "assert.throws(() => serialize({ name: 'a' }));",
  '',
  "console.log('ok');",
  '',
].join('\n');

const MIGRATION_OK: Record<string, string> = {
  'src/record.js': RECORD_OK,
  'README.md': [
    '# record-store',
    '',
    '| 필드 | 타입 | 설명 |',
    '|------|------|------|',
    '| name | string | 필수. |',
    '| owner | string | 필수. 비어 있으면 안 된다. |',
    '| tags | string[] | 선택. 없으면 빈 배열. |',
    '',
    '## 포맷 버전',
    '',
    '현재 버전은 2다. v1로 저장된 데이터도 읽을 수 있으며 owner는 unknown이 된다.',
    '',
  ].join('\n'),
  'test/record.test.mjs': MIGRATION_TEST,
};

describe('format-migration 채점표', () => {
  it('정답 구현은 전부 통과한다', async () => {
    expect(failed(await grade('format-migration', MIGRATION_OK))).toEqual([]);
  });

  it('버전 가드를 그대로 두면 예전 데이터가 거부되는 걸 잡는다', async () => {
    // 상수만 2로 올린 경우. 신규 기능은 멀쩡히 동작하고 새 테스트도 통과한다.
    const result = await grade('format-migration', {
      ...MIGRATION_OK,
      'src/record.js': RECORD_OK.replace('const SUPPORTED = [1, 2];\n', '')
        .replace('!SUPPORTED.includes(raw.v)', 'raw.v !== FORMAT_VERSION')
        .replace("owner: raw.v === 1 ? 'unknown' : raw.owner,", 'owner: raw.owner,'),
    });
    expect(failed(result)).toContain('예전(v1) 데이터가 여전히 파싱됨');
    expect(failed(result)).toContain('예전 데이터의 owner는 unknown');
    // 신규 기능 쪽은 멀쩡해야 한다. 그래야 "조용히 깨진다"가 성립한다.
    expect(failed(result)).not.toContain('왕복 후 owner 보존');
    expect(failed(result)).not.toContain('FORMAT_VERSION === 2');
    expect(failed(result)).not.toContain('갱신된 테스트가 통과');
  });

  it('가드를 통째로 지워버리면 잡는다', async () => {
    // 하위 호환을 맞추려다 미래/손상된 버전까지 통과시키는 반대편 실수.
    const result = await grade('format-migration', {
      ...MIGRATION_OK,
      'src/record.js': RECORD_OK.replace(
        /  if \(!SUPPORTED\.includes\(raw\.v\)\) \{[\s\S]*?\n  \}\n/,
        '',
      ),
    });
    expect(failed(result)).toContain('알 수 없는 버전은 거부');
  });
});

// ─── duplicate-logic ───────────────────────────────────────────────────────

const LEDGER_WITH_REFUND = [
  'export function applyEvent(state, event) {',
  '  switch (event.type) {',
  "    case 'charge':",
  '      return { ...state, balance: state.balance + event.amount };',
  "    case 'payout':",
  '      return { ...state, balance: state.balance - event.amount };',
  "    case 'refund':",
  '      return { ...state, balance: state.balance - event.amount };',
  '    default:',
  '      return state;',
  '  }',
  '}',
  '',
  'export function reduce(events) {',
  '  return events.reduce(applyEvent, { balance: 0 });',
  '}',
  '',
].join('\n');

const REPORT_WITH_REFUND = [
  'export function monthlyTotals(events) {',
  '  const totals = {};',
  '  for (const event of events) {',
  '    const month = event.date.slice(0, 7);',
  '    totals[month] ??= { inflow: 0, outflow: 0 };',
  '',
  "    if (event.type === 'charge') {",
  '      totals[month].inflow += event.amount;',
  "    } else if (event.type === 'payout' || event.type === 'refund') {",
  '      totals[month].outflow += event.amount;',
  '    }',
  '  }',
  '  return totals;',
  '}',
  '',
].join('\n');

const README_WITH_REFUND = [
  '# ledger',
  '',
  '| 타입 | 잔액 영향 | 설명 |',
  '|------|-----------|------|',
  '| charge | +amount | 고객에게 청구한 금액 |',
  '| payout | -amount | 외부로 지급한 금액 |',
  '| refund | -amount | 고객에게 환불한 금액 |',
  '',
].join('\n');

const DUP_OK: Record<string, string> = {
  'src/ledger.js': LEDGER_WITH_REFUND,
  'src/report.js': REPORT_WITH_REFUND,
  'README.md': README_WITH_REFUND,
};

describe('duplicate-logic 채점표', () => {
  it('정답 구현은 전부 통과한다', async () => {
    expect(failed(await grade('duplicate-logic', DUP_OK))).toEqual([]);
  });

  it('ledger만 고치면 리포트가 조용히 틀리는 걸 잡는다', async () => {
    // 오류도 안 나고 기존 테스트도 통과한다. 숫자만 틀린다.
    const result = await grade('duplicate-logic', {
      'src/ledger.js': LEDGER_WITH_REFUND,
      'README.md': README_WITH_REFUND,
    });
    expect(failed(result)).toEqual([
      'monthlyTotals가 refund를 outflow로 반영 (1월)',
      'monthlyTotals가 refund를 outflow로 반영 (2월)',
    ]);
  });

  it('리포트에서 refund를 inflow로 넣으면 잡는다', async () => {
    const result = await grade('duplicate-logic', {
      ...DUP_OK,
      'src/report.js': REPORT_WITH_REFUND.replace(
        "    } else if (event.type === 'payout' || event.type === 'refund') {\n      totals[month].outflow += event.amount;\n",
        "    } else if (event.type === 'payout') {\n      totals[month].outflow += event.amount;\n" +
          "    } else if (event.type === 'refund') {\n      totals[month].inflow += event.amount;\n",
      ),
    });
    expect(failed(result)).toContain('monthlyTotals inflow 유지 (1월)');
  });

  it('refund 부호를 반대로 하면 잔액에서 잡는다', async () => {
    const result = await grade('duplicate-logic', {
      ...DUP_OK,
      'src/ledger.js': LEDGER_WITH_REFUND.replace(
        "    case 'refund':\n      return { ...state, balance: state.balance - event.amount };",
        "    case 'refund':\n      return { ...state, balance: state.balance + event.amount };",
      ),
    });
    expect(failed(result)).toContain('refund가 잔액을 줄임');
  });
});

// ─── gitignore-match ───────────────────────────────────────────────────────

describe('gitignore-match 채점표', () => {
  it('참조 구현은 전부 통과한다', async () => {
    // 케이스 표가 서로 모순되면 아무도 만점을 받을 수 없다. 그러면 평가는
    // 에이전트가 아니라 내 표의 오류를 재는 것이 된다.
    const reference = await readFile(
      resolve('tests/fixtures/gitignore-reference.mjs'),
      'utf8',
    );
    const result = await grade('gitignore-match', {
      'src/gitignore.js': reference,
      'test/gitignore.test.mjs': REF_TEST,
    });
    expect(failed(result)).toEqual([]);
  });

  it('규칙 하나만 빠뜨려도 그 항목에서 걸린다', async () => {
    // 상위 디렉토리 승계(규칙 11)만 제거한다. 나머지는 그대로다.
    const reference = await readFile(
      resolve('tests/fixtures/gitignore-reference.mjs'),
      'utf8',
    );
    const noAncestor = reference.replace(
      "if (decide(segments.slice(0, i).join('/'), compiled, true) === true) return true;",
      'void i;',
    );
    expect(noAncestor).not.toEqual(reference);
    const result = await grade('gitignore-match', {
      'src/gitignore.js': noAncestor,
      'test/gitignore.test.mjs': REF_TEST,
    });
    expect(failed(result)).toEqual([
      '무시된 디렉토리 아래는 전부 무시',
      '무시된 디렉토리는 깊이와 무관',
    ]);
  });

  it('구현하지 않으면 대부분 실패한다', async () => {
    const result = await grade('gitignore-match', {});
    expect(failed(result).length).toBeGreaterThan(20);
  });
});

// ─── unicode-text ──────────────────────────────────────────────────────────

const UNICODE_TEST = [
  "import assert from 'node:assert/strict';",
  "import { graphemeLength, padEnd, reverse, truncate } from '../src/index.js';",
  '',
  "assert.equal(graphemeLength('abc'), 3);",
  "assert.equal(truncate('abcdef', 4), 'abc\u2026');",
  "assert.equal(reverse('abc'), 'cba');",
  "assert.equal(padEnd('ab', 4), 'ab  ');",
  '',
  "console.log('ok');",
  '',
].join('\n');

const readFixture = (name: string) => readFile(resolve('tests/fixtures', name), 'utf8');

describe('unicode-text 채점표', () => {
  it('참조 구현은 전부 통과한다', async () => {
    const result = await grade('unicode-text', {
      'src/text.js': await readFixture('unicode-reference.mjs'),
      'test/text.test.mjs': UNICODE_TEST,
    });
    expect(failed(result)).toEqual([]);
  });

  it('코드 포인트 구현은 정확히 자소 클러스터 항목에서만 걸린다', async () => {
    // 이 과제의 존재 이유. `[...s]`는 그럴듯하고, ASCII·한글·기본 이모지에서
    // 전부 맞고, 자기가 짠 테스트도 통과한다. 여기서 갈리지 않으면 과제가
    // 아무것도 재지 못하는 것이다.
    const result = await grade('unicode-text', {
      'src/text.js': await readFixture('unicode-codepoint.mjs'),
      'test/text.test.mjs': UNICODE_TEST,
    });
    const names = failed(result);

    // 갈려야 하는 것들
    expect(names).toContain('길이: ZWJ 가족 이모지는 한 글자');
    expect(names).toContain('길이: 국기는 한 글자');
    expect(names).toContain('길이: 피부톤 결합은 한 글자');
    expect(names).toContain('길이: 결합 악센트는 한 글자');
    expect(names).toContain('뒤집기: ZWJ 가족 이모지를 깨지 않는다');
    expect(names).toContain('뒤집기: 결합 악센트가 문자에 붙어 있다');
    expect(names).toContain('자르기: 이모지를 쪼개지 않는다');
    expect(names).toContain('패딩: 이모지 폭을 글자 수로 센다');

    // 갈리면 안 되는 것들 — 여기서도 걸리면 그냥 깨진 과제다.
    expect(names).not.toContain('길이: ASCII');
    expect(names).not.toContain('길이: 한글');
    expect(names).not.toContain('길이: 기본 이모지');
    expect(names).not.toContain('자르기: ASCII');
    expect(names).not.toContain('뒤집기: ASCII');
    expect(names).not.toContain('패딩: ASCII');
    expect(names).not.toContain('테스트가 통과');
  });

  it('원래 코드 유닛 구현은 대부분 실패한다', async () => {
    expect(failed(await grade('unicode-text', {})).length).toBeGreaterThan(12);
  });
});
