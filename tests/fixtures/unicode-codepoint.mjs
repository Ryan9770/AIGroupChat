/**
 * unicode-text 과제의 **그럴듯하지만 틀린** 구현.
 *
 * 코드 유닛(`.length`) 대신 코드 포인트(`[...s]`)를 쓴다. 이게 이 과제의
 * 요점이다 — 이 구현은 "유니코드를 제대로 처리했다"는 느낌을 주고, ASCII·한글·
 * 기본 이모지에서 전부 옳게 동작한다. 스스로 짠 테스트가 같은 오해에서 나오면
 * 통과해 버린다. ZWJ 결합·국기·피부톤·결합 부호에서만 갈린다.
 *
 * 채점표가 이 차이를 실제로 잡아내는지 확인하는 데 쓴다.
 */
const cp = (s) => [...s];

export function graphemeLength(s) {
  return cp(s).length;
}

export function truncate(s, n, suffix = '…') {
  if (n <= 0) return '';
  const cs = cp(s);
  if (cs.length <= n) return s;

  const sc = cp(suffix);
  if (n < sc.length) return sc.slice(0, n).join('');
  return cs.slice(0, n - sc.length).join('') + suffix;
}

export function reverse(s) {
  return cp(s).reverse().join('');
}

export function padEnd(s, n, fill = ' ') {
  const cs = cp(s);
  if (cs.length >= n) return s;

  const fc = cp(fill);
  if (fc.length === 0) return s;

  const pad = [];
  while (cs.length + pad.length < n) pad.push(fc[pad.length % fc.length]);
  return s + pad.join('');
}
