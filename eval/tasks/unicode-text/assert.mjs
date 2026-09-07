/**
 * unicode-text 판정.
 *
 * 이 과제를 만든 이유는 앞의 네 과제가 전부 만점이었기 때문이다. 그 과제들은
 * 에이전트가 코드를 실행해 스스로 확인할 수 있었고 — 그게 곧 검토다.
 * 여기서는 자기검증이 통하지 않는다. `[...s]`(코드 포인트)로 짜면
 * "유니코드를 제대로 처리했다"는 느낌이 들고, 같은 오해로 짠 자기 테스트도
 * 통과한다. ASCII·한글·기본 이모지에서는 아무 문제가 없다.
 * 갈리는 곳은 ZWJ 결합·국기·피부톤·결합 부호뿐이다.
 */
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// 한 글자로 세어야 하는 것들.
//
// 리터럴 대신 코드 포인트로 조립한다. 편집기·도구 체인이 유니코드를 정규화하면
// 결합 부호가 미리 조합된 형태로 바뀌어 코드 포인트 하나가 되고, 그러면
// 잘못된 구현도 통과해 버린다 — 변별력이 조용히 사라진다.
const ZWJ = String.fromCodePoint(0x200d);
const FAMILY = [0x1f468, 0x1f469, 0x1f467, 0x1f466].map((c) => String.fromCodePoint(c)).join(ZWJ); // 가족 이모지
const FLAG = String.fromCodePoint(0x1f1f0) + String.fromCodePoint(0x1f1f7); // 지역 표시 문자 2개
const THUMB = String.fromCodePoint(0x1f44d) + String.fromCodePoint(0x1f3fd); // 이모지 + 피부톤
const E_ACUTE = 'e' + String.fromCodePoint(0x301); // e + 결합 악센트
const SMILE = String.fromCodePoint(0x1f600);
const HANGUL = '한';

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
  const { graphemeLength, truncate, reverse, padEnd } = mod;
  const loaded = [graphemeLength, truncate, reverse, padEnd].every((f) => typeof f === 'function');
  add('모듈 로드', loaded);
  if (!loaded) return { checks };

  /** 기대값과 비교한다. 예외는 실패로 본다. */
  const eq = (name, fn, expected) => {
    let actual;
    try {
      actual = fn();
    } catch (err) {
      add(name, false, String(err?.message ?? err).slice(0, 60));
      return;
    }
    const ok = actual === expected;
    add(name, ok, ok ? '' : `${JSON.stringify(actual)} (기대 ${JSON.stringify(expected)})`);
  };

  // ── graphemeLength ──────────────────────────────────────────────
  eq('길이: ASCII', () => graphemeLength('abc'), 3);
  eq('길이: 빈 문자열', () => graphemeLength(''), 0);
  eq('길이: 한글', () => graphemeLength('한글'), 2);
  eq('길이: 결합 악센트는 한 글자', () => graphemeLength(E_ACUTE), 1);
  eq('길이: 결합 악센트 섞인 단어', () => graphemeLength(`h${E_ACUTE}llo`), 5);
  eq('길이: 기본 이모지', () => graphemeLength(SMILE), 1);
  eq('길이: 피부톤 결합은 한 글자', () => graphemeLength(THUMB), 1);
  eq('길이: 국기는 한 글자', () => graphemeLength(FLAG), 1);
  eq('길이: ZWJ 가족 이모지는 한 글자', () => graphemeLength(FAMILY), 1);
  eq('길이: 혼합 문자열', () => graphemeLength(`a${THUMB}${FLAG}b`), 4);

  // ── truncate ────────────────────────────────────────────────────
  eq('자르기: 짧으면 그대로', () => truncate('abc', 5), 'abc');
  eq('자르기: 딱 맞으면 그대로', () => truncate('abc', 3), 'abc');
  eq('자르기: ASCII', () => truncate('abcdef', 4), 'abc…');
  eq('자르기: suffix 포함 정확히 n글자', () => graphemeLength(truncate('abcdef', 4)), 4);
  eq('자르기: 사용자 지정 suffix', () => truncate('abcdef', 5, '..'), 'abc..');
  eq(
    '자르기: 이모지를 쪼개지 않는다',
    () => truncate(`${FAMILY}abc`, 2),
    `${FAMILY}…`,
  );
  eq(
    '자르기: 국기를 쪼개지 않는다',
    () => truncate(`${FLAG}${FLAG}${FLAG}`, 2),
    `${FLAG}…`,
  );
  eq('자르기: 결합 악센트를 쪼개지 않는다', () => truncate(`${E_ACUTE}bcdef`, 3), `${E_ACUTE}b…`);
  eq('자르기: n이 suffix보다 작으면 suffix를 자른다', () => truncate('abcdef', 1, '..'), '.');
  eq('자르기: n이 0이면 빈 문자열', () => truncate('abcdef', 0), '');
  eq('자르기: n이 음수면 빈 문자열', () => truncate('abcdef', -3), '');

  // ── reverse ─────────────────────────────────────────────────────
  eq('뒤집기: ASCII', () => reverse('abc'), 'cba');
  eq('뒤집기: 빈 문자열', () => reverse(''), '');
  eq('뒤집기: 한글', () => reverse(`ab${HANGUL}`), `${HANGUL}ba`);
  eq('뒤집기: 결합 악센트가 문자에 붙어 있다', () => reverse(`ab${E_ACUTE}`), `${E_ACUTE}ba`);
  eq('뒤집기: 피부톤 이모지를 깨지 않는다', () => reverse(`a${THUMB}b`), `b${THUMB}a`);
  eq('뒤집기: 국기를 깨지 않는다', () => reverse(`a${FLAG}b`), `b${FLAG}a`);
  eq('뒤집기: ZWJ 가족 이모지를 깨지 않는다', () => reverse(`a${FAMILY}b`), `b${FAMILY}a`);

  // ── padEnd ──────────────────────────────────────────────────────
  eq('패딩: ASCII', () => padEnd('ab', 4), 'ab  ');
  eq('패딩: 이미 길면 그대로', () => padEnd('abcd', 2), 'abcd');
  eq('패딩: 이모지 폭을 글자 수로 센다', () => padEnd(FLAG, 3), `${FLAG}  `);
  eq('패딩: ZWJ 이모지도 한 글자로 센다', () => padEnd(FAMILY, 3), `${FAMILY}  `);
  eq('패딩: 여러 글자 fill을 반복한다', () => padEnd('a', 6, 'xy'), 'axyxyx');
  eq('패딩: fill이 이모지여도 정확히 n글자', () => graphemeLength(padEnd('a', 4, FLAG)), 4);
  eq('패딩: 빈 fill이면 그대로', () => padEnd('a', 5, ''), 'a');

  let testOk = false;
  let detail = '';
  try {
    await exec(process.execPath, [join(dir, 'test/text.test.mjs')], { cwd: dir, timeout: 20_000 });
    testOk = true;
  } catch (err) {
    detail = String(err?.stderr ?? err?.message ?? err).split('\n')[0] ?? '';
  }
  add('테스트가 통과', testOk, detail.slice(0, 80));

  return { checks };
}
