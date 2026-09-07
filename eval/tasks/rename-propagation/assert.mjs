/**
 * rename-propagation 판정.
 *
 * 핵심은 8번 항목이다. `timeout`이라는 이름이 두 가지를 가리키고 있고,
 * 그중 하나(업스트림 요청 필드)는 바꾸면 안 된다. 일괄 치환은 통과하지 못한다.
 * 나머지는 "여러 파일에 빠짐없이 반영했는가"를 본다 — 코드만 고치고
 * 스키마나 문서를 빠뜨리는 게 가장 흔한 실패다.
 */
import { execFile } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const read = async (dir, p) => {
  try {
    return await readFile(join(dir, p), 'utf8');
  } catch {
    return null;
  }
};

/** timeoutMs가 아닌 맨 timeout. 업스트림을 설명하는 줄은 정당하므로 제외한다. */
function staleMentions(text) {
  return text
    .split('\n')
    .filter((line) => !/업스트림|upstream|\/v1\/fetch/i.test(line))
    .filter((line) => /\btimeout\b(?!Ms)/.test(line));
}

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
  add('모듈 로드', typeof mod.buildRequest === 'function' && !!mod.DEFAULTS);
  if (typeof mod.buildRequest !== 'function' || !mod.DEFAULTS) return { checks };

  const { buildRequest, DEFAULTS } = mod;
  const call = (opts) => {
    try {
      return { ok: true, value: buildRequest(opts) };
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) };
    }
  };

  add('DEFAULTS.timeoutMs === 5000', DEFAULTS.timeoutMs === 5000, String(DEFAULTS.timeoutMs));
  add('DEFAULTS에 옛 이름이 남지 않음', !('timeout' in DEFAULTS), Object.keys(DEFAULTS).join(', '));
  add('retries 기본값 보존', DEFAULTS.retries === 2, String(DEFAULTS.retries));

  const explicit = call({ timeoutMs: 3000 });
  const body = explicit.ok ? (explicit.value?.body ?? {}) : {};
  // 값이 어느 키로 나가든 "옵션이 배선됐는가"는 따로 본다.
  add(
    'timeoutMs 옵션이 요청에 반영됨',
    Object.values(body).includes(3000),
    explicit.ok ? JSON.stringify(body) : explicit.error,
  );

  // 🔴 함정. 업스트림 v1이 정한 필드명은 그대로여야 한다.
  add(
    '업스트림 요청 필드명 timeout 유지',
    body.timeout === 3000,
    explicit.ok ? JSON.stringify(body) : explicit.error,
  );

  const fallback = call({});
  add(
    '기본값 경로 동작 (5000)',
    fallback.ok && Object.values(fallback.value?.body ?? {}).includes(5000),
    fallback.ok ? JSON.stringify(fallback.value?.body) : fallback.error,
  );
  add('retries가 요청에 그대로 전달됨', fallback.ok && fallback.value?.body?.retries === 2);

  add('0 이하 거부 유지', !call({ timeoutMs: 0 }).ok);
  add('숫자 아닌 값 거부 유지', !call({ timeoutMs: 'fast' }).ok);
  add('retries 검증 유지', !call({ timeoutMs: 1000, retries: -1 }).ok);

  // 스키마
  const schemaRaw = await read(dir, 'schema.json');
  let schema = null;
  try {
    schema = schemaRaw ? JSON.parse(schemaRaw) : null;
  } catch {
    /* 아래 항목에서 실패로 잡힌다 */
  }
  const props = schema?.properties ?? {};
  add('schema.json에 timeoutMs 정의', 'timeoutMs' in props, Object.keys(props).join(', '));
  add('schema.json에 옛 이름 없음', !('timeout' in props), Object.keys(props).join(', '));

  // 문서
  const readme = (await read(dir, 'README.md')) ?? '';
  add('README가 새 이름을 안내', /timeoutMs/.test(readme));
  const stale = staleMentions(readme);
  add('README에 옛 이름이 남지 않음', stale.length === 0, stale.slice(0, 2).join(' / '));

  // 테스트가 갱신되어 실제로 통과하는가.
  const testPath = join(dir, 'test/client.test.mjs');
  let testExists = true;
  try {
    await access(testPath);
  } catch {
    testExists = false;
  }
  if (!testExists) {
    add('테스트 파일 유지', false, '삭제되었습니다');
  } else {
    add('테스트 파일 유지', true);
    let testOk = false;
    let detail = '';
    try {
      await exec(process.execPath, [testPath], { cwd: dir, timeout: 15_000 });
      testOk = true;
    } catch (err) {
      detail = String(err?.stderr ?? err?.message ?? err).split('\n')[0] ?? '';
    }
    add('갱신된 테스트가 통과', testOk, detail.slice(0, 80));
  }

  return { checks };
}
