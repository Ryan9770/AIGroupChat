/**
 * config-validation 과제 판정.
 *
 * 실제로 모듈을 불러와 동작을 확인한다. "코드가 그럴듯해 보이는가"가 아니라
 * "실제로 그렇게 동작하는가"를 본다.
 *
 * 회귀 항목이 핵심이다: 검증을 넣으면서 정상 설정을 깨뜨리거나
 * retries 기본값(3)을 없애는 실수가 흔하다.
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

export default async function assess(dir) {
  const checks = [];
  const add = (name, ok, detail) => checks.push(detail ? { name, ok, detail } : { name, ok });

  let loadConfig;
  try {
    // 캐시를 피하려고 쿼리를 붙인다. 같은 경로를 여러 번 불러오기 때문이다.
    const url = `${pathToFileURL(join(dir, 'src/config.js')).href}?t=${Date.now()}`;
    ({ loadConfig } = await import(url));
  } catch (err) {
    add('모듈 로드', false, err.message);
    return { checks };
  }
  add('모듈 로드', typeof loadConfig === 'function');
  if (typeof loadConfig !== 'function') return { checks };

  const ok = (fn) => { try { fn(); return true; } catch { return false; } };
  const throws = (fn) => { try { fn(); return false; } catch { return true; } };
  const message = (fn) => { try { fn(); return ''; } catch (e) { return String(e?.message ?? e); } };

  // 회귀: 정상 설정은 그대로 동작해야 한다.
  const good = { host: 'localhost', port: 8080, retries: 5 };
  add('정상 설정 통과', ok(() => loadConfig(good)));
  add('정상 설정 값 보존',
      ok(() => loadConfig(good)) &&
      JSON.stringify(loadConfig(good)) === JSON.stringify({ host: 'localhost', port: 8080, retries: 5 }),
      ok(() => loadConfig(good)) ? JSON.stringify(loadConfig(good)) : '예외 발생');

  // 회귀: retries 기본값 3이 유지되는가.
  add('retries 기본값 3',
      ok(() => loadConfig({ host: 'h', port: 1 })) && loadConfig({ host: 'h', port: 1 }).retries === 3,
      ok(() => loadConfig({ host: 'h', port: 1 })) ? String(loadConfig({ host: 'h', port: 1 }).retries) : '예외 발생');

  // 검증
  add('port 범위 초과 거부', throws(() => loadConfig({ host: 'h', port: 70000 })));
  add('port 0 거부', throws(() => loadConfig({ host: 'h', port: 0 })));
  add('port 소수 거부', throws(() => loadConfig({ host: 'h', port: 80.5 })));
  add('port 문자열 거부', throws(() => loadConfig({ host: 'h', port: '8080' })));
  add('host 빈 문자열 거부', throws(() => loadConfig({ host: '', port: 80 })));
  add('host 누락 거부', throws(() => loadConfig({ port: 80 })));
  add('retries 음수 거부', throws(() => loadConfig({ host: 'h', port: 80, retries: -1 })));

  // 메시지가 무엇이 잘못됐는지 알려주는가.
  add('오류 메시지가 원인을 지목', /port/i.test(message(() => loadConfig({ host: 'h', port: 70000 }))),
      message(() => loadConfig({ host: 'h', port: 70000 })).slice(0, 60));

  return { checks };
}
