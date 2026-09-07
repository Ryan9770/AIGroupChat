/**
 * .gitignore 패턴 매칭.
 *
 * @param {string} path    POSIX 상대 경로. 앞에 `/`가 없다. 예: "src/app.log"
 * @param {string[]} patterns .gitignore의 각 줄
 * @param {boolean} isDir  path가 디렉토리인가
 * @returns {boolean}      무시되는가
 */
export function isIgnored(path, patterns, isDir = false) {
  throw new Error('not implemented');
}
