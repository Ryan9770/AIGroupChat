/**
 * unicode-text 과제의 참조 구현.
 *
 * 채점표가 통과 가능한지 확인하려고 직접 쓴 것이다. 평가 대상 저장소에는
 * 들어가지 않는다 — 에이전트는 이 파일을 볼 수 없다.
 */
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const clusters = (s) => Array.from(segmenter.segment(s), (part) => part.segment);

export function graphemeLength(s) {
  return clusters(s).length;
}

export function truncate(s, n, suffix = '…') {
  if (n <= 0) return '';
  const cs = clusters(s);
  if (cs.length <= n) return s;

  const sc = clusters(suffix);
  if (n < sc.length) return sc.slice(0, n).join('');
  return cs.slice(0, n - sc.length).join('') + suffix;
}

export function reverse(s) {
  return clusters(s).reverse().join('');
}

export function padEnd(s, n, fill = ' ') {
  const cs = clusters(s);
  if (cs.length >= n) return s;

  const fc = clusters(fill);
  if (fc.length === 0) return s;

  const pad = [];
  while (cs.length + pad.length < n) pad.push(fc[pad.length % fc.length]);
  return s + pad.join('');
}
