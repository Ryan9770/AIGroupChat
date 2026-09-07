/**
 * 지금 구현은 UTF-16 코드 유닛 기준이라 사용자가 보는 글자와 어긋난다.
 * 명세대로 다시 만들어야 한다.
 */

export function graphemeLength(s) {
  return s.length;
}

export function truncate(s, n, suffix = '…') {
  if (s.length <= n) return s;
  return s.slice(0, n - suffix.length) + suffix;
}

export function reverse(s) {
  return s.split('').reverse().join('');
}

export function padEnd(s, n, fill = ' ') {
  return s.padEnd(n, fill);
}
