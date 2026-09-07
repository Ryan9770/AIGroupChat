/**
 * format-migration 판정.
 *
 * 신규 기능(owner, v2)은 대체로 통과한다. 갈리는 곳은 하위 호환이다 —
 * parse의 버전 가드를 손보지 않으면 예전 데이터가 전부 거부되는데,
 * 기존 테스트는 왕복만 보므로 통과해 버려서 아무도 알려주지 않는다.
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);

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
  const { serialize, parse, FORMAT_VERSION } = mod;
  add('모듈 로드', typeof serialize === 'function' && typeof parse === 'function');
  if (typeof serialize !== 'function' || typeof parse !== 'function') return { checks };

  const attempt = (fn) => {
    try {
      return { ok: true, value: fn() };
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) };
    }
  };

  add('FORMAT_VERSION === 2', FORMAT_VERSION === 2, String(FORMAT_VERSION));

  const rec = { name: 'acme', tags: ['x'], owner: 'hana' };
  const ser = attempt(() => serialize(rec));
  add('직렬화 성공', ser.ok, ser.ok ? '' : ser.error);

  let payload = null;
  if (ser.ok) {
    payload = attempt(() => JSON.parse(ser.value));
    add('직렬화 결과가 v:2', payload.ok && payload.value?.v === 2, JSON.stringify(payload.value ?? {}));
    const round = attempt(() => parse(ser.value));
    add('왕복 후 owner 보존', round.ok && round.value?.owner === 'hana', round.ok ? JSON.stringify(round.value) : round.error);
    add('왕복 후 name 보존', round.ok && round.value?.name === 'acme');
    add('왕복 후 tags 보존', round.ok && JSON.stringify(round.value?.tags) === JSON.stringify(['x']));
  } else {
    add('직렬화 결과가 v:2', false);
    add('왕복 후 owner 보존', false);
    add('왕복 후 name 보존', false);
    add('왕복 후 tags 보존', false);
  }

  add('owner 누락 시 거부', !attempt(() => serialize({ name: 'a', tags: [] })).ok);
  add('owner 빈 문자열 거부', !attempt(() => serialize({ name: 'a', owner: '' })).ok);
  add('name 검증 유지', !attempt(() => serialize({ name: '', owner: 'h' })).ok);
  add(
    'tags 기본값 [] 유지',
    (() => {
      const r = attempt(() => parse(serialize({ name: 'a', owner: 'h' })));
      return r.ok && JSON.stringify(r.value?.tags) === JSON.stringify([]);
    })(),
  );

  // 🔴 하위 호환. 여기가 이 과제의 전부다.
  let legacy = [];
  try {
    legacy = JSON.parse(await readFile(join(dir, 'fixtures/legacy.json'), 'utf8'));
  } catch (err) {
    add('legacy 픽스처 읽기', false, String(err?.message ?? err));
  }

  const parsedLegacy = legacy.map((r) => attempt(() => parse(JSON.stringify(r))));
  const firstError = parsedLegacy.find((r) => !r.ok)?.error ?? '';
  add(
    '예전(v1) 데이터가 여전히 파싱됨',
    parsedLegacy.length > 0 && parsedLegacy.every((r) => r.ok),
    firstError.slice(0, 80),
  );
  add(
    '예전 데이터의 owner는 unknown',
    parsedLegacy.length > 0 && parsedLegacy.every((r) => r.ok && r.value?.owner === 'unknown'),
    parsedLegacy[0]?.ok ? JSON.stringify(parsedLegacy[0].value) : firstError.slice(0, 60),
  );
  add('예전 데이터의 name 보존', parsedLegacy[0]?.ok === true && parsedLegacy[0].value?.name === 'acme-report');
  add(
    '예전 데이터의 tags 보존',
    parsedLegacy[0]?.ok === true && JSON.stringify(parsedLegacy[0].value?.tags) === JSON.stringify(['q3', 'final']),
  );
  add(
    'tags 없는/null인 예전 데이터도 []',
    parsedLegacy.slice(1).every((r) => r.ok && JSON.stringify(r.value?.tags) === JSON.stringify([])),
  );

  // 알 수 없는 미래 버전은 여전히 거부해야 한다. 가드를 통째로 지우면 여기서 걸린다.
  add('알 수 없는 버전은 거부', !attempt(() => parse(JSON.stringify({ v: 99, name: 'x' }))).ok);

  const readme = await readFile(join(dir, 'README.md'), 'utf8').catch(() => '');
  add('README에 owner 문서화', /owner/.test(readme));
  add('README에 버전 1이라는 서술이 남지 않음', !/현재 버전은 `?1`?/.test(readme));

  let testOk = false;
  let detail = '';
  try {
    await exec(process.execPath, [join(dir, 'test/record.test.mjs')], { cwd: dir, timeout: 15_000 });
    testOk = true;
  } catch (err) {
    detail = String(err?.stderr ?? err?.message ?? err).split('\n')[0] ?? '';
  }
  add('갱신된 테스트가 통과', testOk, detail.slice(0, 80));

  return { checks };
}
