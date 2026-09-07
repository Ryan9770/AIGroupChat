import { DEFAULTS } from './defaults.js';

/**
 * 사용자 옵션을 업스트림 요청으로 바꾼다.
 * 업스트림이 받는 필드는 docs/upstream-api.md 참고.
 */
export function buildRequest(options = {}) {
  const merged = { ...DEFAULTS, ...options };

  if (typeof merged.timeout !== 'number' || merged.timeout <= 0) {
    throw new Error('timeout must be a positive number');
  }
  if (!Number.isInteger(merged.retries) || merged.retries < 0) {
    throw new Error('retries must be a non-negative integer');
  }

  return {
    url: '/v1/fetch',
    body: {
      timeout: merged.timeout,
      retries: merged.retries,
    },
  };
}
