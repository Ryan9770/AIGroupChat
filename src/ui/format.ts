const ESC = '';
const useColor = process.stdout.isTTY === true && !process.env['NO_COLOR'];

const wrap = (code: string) => (s: string) =>
  useColor ? `${ESC}[${code}m${s}${ESC}[0m` : s;

export const green = wrap('32');
export const red = wrap('31');
export const yellow = wrap('33');
export const dim = wrap('2');
export const bold = wrap('1');
export const cyan = wrap('36');

const ANSI_RE = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const strip = (s: string) => s.replace(ANSI_RE, '');

/**
 * 고정폭 테이블 렌더러.
 *
 * 셀 값은 ASCII만 넣을 것. 한글은 터미널에서 2칸을 차지해서 정렬이 깨진다.
 * 한글 설명은 테이블이 아니라 아래 notes 섹션으로 보낸다.
 */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(strip(h).length, ...rows.map((r) => strip(r[i] ?? '').length)),
  );

  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - strip(s).length));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => pad(c, widths[i] ?? 0))
      .join('  ')
      .trimEnd();

  return [
    dim(line(headers)),
    dim(widths.map((w) => '-'.repeat(w)).join('  ')),
    ...rows.map(line),
  ].join('\n');
}

export function mark(value: boolean | 'unknown'): string {
  if (value === true) return green('OK');
  if (value === false) return red('NO');
  return yellow('??');
}
