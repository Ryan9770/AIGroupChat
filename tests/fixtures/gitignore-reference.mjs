/**
 * gitignore-match 과제의 참조 구현.
 *
 * 채점표가 **통과 가능한지** 확인하려고 직접 쓴 것이다. 케이스 표가 서로
 * 모순되면 어떤 에이전트도 만점을 받을 수 없고, 그러면 평가는 에이전트가
 * 아니라 내 표의 오류를 재게 된다.
 *
 * 평가 대상 저장소에는 들어가지 않는다 — 에이전트는 이 파일을 볼 수 없다.
 */

const escapeRe = (ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function translate(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];

    if (ch === '\\') {
      i += 1;
      out += escapeRe(pattern[i] ?? '\\');
      continue;
    }
    if (ch === '?') {
      out += '[^/]';
      continue;
    }
    if (ch !== '*') {
      out += escapeRe(ch);
      continue;
    }

    if (pattern[i + 1] === '*') {
      const atSegmentStart = i === 0 || pattern[i - 1] === '/';
      if (atSegmentStart && pattern[i + 2] === '/') {
        // `**/` — 디렉토리 0개 이상. 뒤따르는 `/`까지 소비한다.
        out += '(?:[^/]+/)*';
        i += 2;
        continue;
      }
      if (atSegmentStart && i + 2 === pattern.length) {
        // 끝의 `/**` — 그 안의 모든 것.
        out += '.+';
        i += 1;
        continue;
      }
      out += '[^/]*';
      i += 1;
      continue;
    }
    out += '[^/]*';
  }
  return out;
}

function compile(raw) {
  // 이스케이프되지 않은 줄 끝 공백만 버린다.
  let line = raw.replace(/(?<!\\)\s+$/, '');
  if (line === '' || line.startsWith('#')) return null;

  let negate = false;
  if (line.startsWith('!')) {
    negate = true;
    line = line.slice(1);
  }

  let dirOnly = false;
  if (line.endsWith('/')) {
    dirOnly = true;
    line = line.slice(0, -1);
  }
  if (line === '') return null;

  // 끝의 `/`를 뗀 뒤에도 `/`가 남아 있으면 루트 앵커.
  const anchored = line.includes('/');
  if (line.startsWith('/')) line = line.slice(1);

  return {
    re: new RegExp(`^${anchored ? '' : '(?:.*/)?'}${translate(line)}$`),
    negate,
    dirOnly,
  };
}

/** 이 경로 하나에 대한 결정. 일치하는 게 없으면 undefined. */
function decide(path, compiled, isDir) {
  let result;
  for (const c of compiled) {
    if (c.dirOnly && !isDir) continue;
    if (c.re.test(path)) result = !c.negate;
  }
  return result;
}

export function isIgnored(path, patterns, isDir = false) {
  const compiled = patterns.map(compile).filter(Boolean);

  // 상위 디렉토리가 무시되면 그 아래는 전부 무시된다. `!`로 되살릴 수 없다.
  const segments = path.split('/');
  for (let i = 1; i < segments.length; i += 1) {
    if (decide(segments.slice(0, i).join('/'), compiled, true) === true) return true;
  }

  return decide(path, compiled, isDir) === true;
}
