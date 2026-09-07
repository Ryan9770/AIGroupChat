/**
 * duplicate-logic 판정.
 *
 * 같은 분기가 ledger.js와 report.js에 중복돼 있다. 프롬프트도 기존 테스트도
 * report를 언급하지 않고, report의 분기는 else 없이 조용히 무시하므로
 * ledger만 고쳐도 **아무 오류 없이** 리포트 숫자만 틀린다.
 * 갈리는 지점은 'monthlyTotals가 refund를 반영' 하나다.
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const EVENTS = [
  { type: 'charge', amount: 100, date: '2026-01-04' },
  { type: 'payout', amount: 30, date: '2026-01-20' },
  { type: 'refund', amount: 25, date: '2026-01-28' },
  { type: 'charge', amount: 200, date: '2026-02-02' },
  { type: 'refund', amount: 50, date: '2026-02-11' },
];

export default async function assess(dir) {
  const checks = [];
  const add = (name, ok, detail) => checks.push(detail ? { name, ok, detail } : { name, ok });

  let mod;
  try {
    const url = `${pathToFileURL(join(dir, 'src/index.js')).href}?t=${Date.now()}`;
    mod = await import(url);
  } catch (err) {
    add('모듈 로드', false, err.message);
    return { checks };
  }
  const { reduce, monthlyTotals } = mod;
  add('모듈 로드', typeof reduce === 'function' && typeof monthlyTotals === 'function');
  if (typeof reduce !== 'function' || typeof monthlyTotals !== 'function') return { checks };

  const attempt = (fn) => {
    try {
      return { ok: true, value: fn() };
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) };
    }
  };

  // 잔액
  const refundOnly = attempt(() => reduce([{ type: 'refund', amount: 25, date: '2026-01-01' }]));
  add(
    'refund가 잔액을 줄임',
    refundOnly.ok && refundOnly.value?.balance === -25,
    refundOnly.ok ? String(refundOnly.value?.balance) : refundOnly.error,
  );

  const mixed = attempt(() => reduce(EVENTS));
  // 100 - 30 - 25 + 200 - 50 = 195
  add(
    '혼합 시퀀스 잔액 정확',
    mixed.ok && mixed.value?.balance === 195,
    mixed.ok ? String(mixed.value?.balance) : mixed.error,
  );

  // 회귀
  add('charge 동작 유지', attempt(() => reduce([EVENTS[0]])).value?.balance === 100);
  add('payout 동작 유지', attempt(() => reduce([EVENTS[1]])).value?.balance === -30);
  add(
    '알 수 없는 타입은 여전히 무시',
    attempt(() => reduce([{ type: 'mystery', amount: 5, date: '2026-01-01' }])).value?.balance === 0,
  );

  // 🔴 함정. report.js에도 같은 분기가 있다.
  const totals = attempt(() => monthlyTotals(EVENTS));
  const jan = totals.value?.['2026-01'];
  const feb = totals.value?.['2026-02'];
  add(
    'monthlyTotals가 refund를 outflow로 반영 (1월)',
    jan?.outflow === 55,
    totals.ok ? JSON.stringify(jan) : totals.error,
  );
  add(
    'monthlyTotals가 refund를 outflow로 반영 (2월)',
    feb?.outflow === 50,
    totals.ok ? JSON.stringify(feb) : totals.error,
  );

  // 리포트 회귀
  add('monthlyTotals inflow 유지 (1월)', jan?.inflow === 100, JSON.stringify(jan));
  add('monthlyTotals inflow 유지 (2월)', feb?.inflow === 200, JSON.stringify(feb));
  add('월 그룹핑 유지', totals.ok && Object.keys(totals.value ?? {}).sort().join(',') === '2026-01,2026-02',
      Object.keys(totals.value ?? {}).join(','));
  add(
    '리포트도 알 수 없는 타입 무시',
    (() => {
      const r = attempt(() => monthlyTotals([{ type: 'mystery', amount: 9, date: '2026-03-01' }]));
      const m = r.value?.['2026-03'];
      return r.ok && m?.inflow === 0 && m?.outflow === 0;
    })(),
  );

  const readme = await readFile(join(dir, 'README.md'), 'utf8').catch(() => '');
  add('README 이벤트 표에 refund 추가', /refund/.test(readme));

  let testOk = false;
  let detail = '';
  try {
    await exec(process.execPath, [join(dir, 'test/ledger.test.mjs')], { cwd: dir, timeout: 15_000 });
    testOk = true;
  } catch (err) {
    detail = String(err?.stderr ?? err?.message ?? err).split('\n')[0] ?? '';
  }
  add('기존 테스트가 여전히 통과', testOk, detail.slice(0, 80));

  return { checks };
}
