/**
 * gitignore-match 판정.
 *
 * 앞의 세 과제와 성격이 다르다. 숨은 함정이 아니라 **분량**이다.
 * 규칙 12개가 서로 간섭하고(앵커링 × 디렉토리 전용 × 부정 순서 × 상위 승계),
 * 하나를 빠뜨려도 나머지는 멀쩡히 동작하므로 스스로 알아채기 어렵다.
 *
 * 케이스는 지시문에 준 명세에서 기계적으로 유도했다. 명세에 없는 동작은 묻지 않는다.
 */
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** 한 벌의 패턴으로 모든 케이스를 본다. 순서 규칙(마지막 일치 우선)까지 걸린다. */
const PATTERNS = [
  '# 주석 줄',
  '',
  '*.log',
  '!important.log',
  'build/',
  '/root-only.txt',
  'docs/*.md',
  '**/temp',
  'a/**/z',
  '*.tmp',
  '!keep/*.tmp',
  'q?.txt',
  '\\#literal.txt',
  'trailing   ',
];

/** [이름, 경로, isDir, 기대값, 근거 규칙] */
const CASES = [
  ['확장자 패턴 기본', 'app.log', false, true],
  ['슬래시 없는 패턴은 어느 깊이든', 'src/app.log', false, true],
  ['뒤의 부정이 앞의 무시를 이긴다', 'important.log', false, false],
  ['부정도 어느 깊이든 적용', 'src/important.log', false, false],
  ['디렉토리 전용 패턴이 디렉토리에 일치', 'build', true, true],
  ['디렉토리 전용 패턴은 파일에 불일치', 'build', false, false],
  ['무시된 디렉토리 아래는 전부 무시', 'build/out.js', false, true],
  ['무시된 디렉토리는 깊이와 무관', 'logs/build/out.js', false, true],
  ['맨 앞 슬래시는 루트 앵커', 'root-only.txt', false, true],
  ['앵커된 패턴은 하위에서 불일치', 'sub/root-only.txt', false, false],
  ['슬래시 포함 패턴은 루트 앵커', 'docs/guide.md', false, true],
  ['별표는 슬래시를 넘지 않는다', 'docs/deep/guide.md', false, false],
  ['맨 앞 **/ 는 깊이 0에도 일치', 'temp', false, true],
  ['맨 앞 **/ 는 임의 깊이에 일치', 'x/y/temp', false, true],
  ['중간 /**/ 는 디렉토리 0개에 일치', 'a/z', false, true],
  ['중간 /**/ 는 디렉토리 1개에 일치', 'a/b/z', false, true],
  ['중간 /**/ 는 디렉토리 2개에 일치', 'a/b/c/z', false, true],
  ['중간 /**/ 패턴도 앵커된다', 'b/z', false, false],
  ['중간 /**/ 는 디렉토리에도 일치', 'a/b/z', true, true],
  ['tmp 기본 무시', 'note.tmp', false, true],
  ['뒤의 부정이 이긴다 (경로 포함 패턴)', 'keep/note.tmp', false, false],
  ['부정 패턴의 별표도 슬래시를 안 넘는다', 'keep/deep/note.tmp', false, true],
  ['물음표는 정확히 한 글자', 'q1.txt', false, true],
  ['물음표는 두 글자에 불일치', 'q12.txt', false, false],
  ['이스케이프된 #은 주석이 아니다', '#literal.txt', false, true],
  ['줄 끝 공백은 무시한다', 'trailing', false, true],
  ['일치하는 패턴이 없으면 무시 안 함', 'README.md', false, false],
  ['디렉토리라도 패턴이 없으면 무시 안 함', 'docs', true, false],
  ['다른 부정에 휩쓸리지 않는다', 'keep/note.log', false, true],
];

export default async function assess(dir) {
  const checks = [];
  const add = (name, ok, detail) => checks.push(detail ? { name, ok, detail } : { name, ok });

  let isIgnored;
  try {
    const url = `${pathToFileURL(join(dir, 'src/index.js')).href}?t=${Date.now()}`;
    ({ isIgnored } = await import(url));
  } catch (err) {
    add('모듈 로드', false, err.message);
    return { checks };
  }
  add('모듈 로드', typeof isIgnored === 'function');
  if (typeof isIgnored !== 'function') return { checks };

  for (const [name, path, isDir, expected] of CASES) {
    let actual;
    let detail = '';
    try {
      actual = isIgnored(path, [...PATTERNS], isDir);
    } catch (err) {
      detail = String(err?.message ?? err).slice(0, 60);
    }
    add(
      name,
      actual === expected,
      actual === expected ? '' : `${path}${isDir ? '/' : ''} → ${actual} (기대 ${expected})`
        + (detail ? ` ${detail}` : ''),
    );
  }

  // 패턴 배열을 훼손하면 두 번째 호출부터 결과가 달라진다.
  let stable = true;
  try {
    const shared = [...PATTERNS];
    const first = isIgnored('src/app.log', shared, false);
    const second = isIgnored('src/app.log', shared, false);
    stable = first === second && shared.length === PATTERNS.length;
  } catch {
    stable = false;
  }
  add('입력 patterns를 훼손하지 않음', stable);

  let testOk = false;
  let detail = '';
  try {
    await exec(process.execPath, [join(dir, 'test/gitignore.test.mjs')], { cwd: dir, timeout: 20_000 });
    testOk = true;
  } catch (err) {
    detail = String(err?.stderr ?? err?.message ?? err).split('\n')[0] ?? '';
  }
  add('테스트가 통과', testOk, detail.slice(0, 80));

  return { checks };
}
