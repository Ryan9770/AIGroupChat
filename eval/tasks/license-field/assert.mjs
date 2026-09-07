/**
 * license-field 과제 판정.
 *
 * 실행 **전에** 정해둔 기계 판정이다. LLM 심판을 쓰지 않는다 —
 * 심판도 모델이면 모델 편향이 결과에 섞인다.
 *
 * 함정을 일부러 넣었다: author가 "Hana Kim"이므로 LICENSE의 저작권자도
 * 그것이어야 한다. 지시를 대충 읽으면 일반적인 문구나 다른 이름을 넣는다.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const read = async (dir, name) => {
  try { return await readFile(join(dir, name), 'utf8'); } catch { return null; }
};

export default async function assess(dir) {
  const checks = [];
  const add = (name, ok, detail) => checks.push(detail ? { name, ok, detail } : { name, ok });

  const raw = await read(dir, 'package.json');
  let pkg = null;
  try { pkg = raw ? JSON.parse(raw) : null; } catch { /* 아래에서 실패 처리 */ }

  add('package.json이 유효한 JSON', pkg !== null,
      pkg === null ? 'JSON 파싱 실패 또는 파일 없음' : undefined);

  add('license 필드가 MIT', pkg?.license === 'MIT', `실제: ${JSON.stringify(pkg?.license)}`);

  // 기존 필드를 지우지 않았는가 — 흔한 회귀다.
  add('기존 필드 보존', pkg?.name === 'widget-lib' && pkg?.version === '0.3.1'
      && pkg?.author === 'Hana Kim' && pkg?.main === 'src/index.js',
      `name=${pkg?.name} version=${pkg?.version} author=${pkg?.author} main=${pkg?.main}`);

  const license = await read(dir, 'LICENSE');
  add('LICENSE 파일 존재', license !== null);
  add('MIT 본문', /MIT License/i.test(license ?? '') &&
      /THE SOFTWARE IS PROVIDED "AS IS"/i.test(license ?? ''));

  // 지시를 실제로 읽었는지 보는 항목.
  add('저작권자가 author 값과 일치', /Hana Kim/.test(license ?? ''),
      license ? '본문에 "Hana Kim" 없음' : 'LICENSE 없음');
  add('연도 2026', /2026/.test(license ?? ''));

  // 소스는 건드리면 안 된다.
  const src = await read(dir, 'src/index.js');
  add('소스 코드 미변경', src?.includes('return n * 2;') === true);

  return { checks };
}
