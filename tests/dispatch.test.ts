import { describe, expect, it } from 'vitest';
import { recoverVerifiedExit } from '../src/core/dispatch.js';

describe('verified completion recovery', () => {
  const base = {
    provider: 'antigravity' as const,
    mode: 'write' as const,
    status: 'success' as const,
    finalText: '',
    filesChanged: ['src/feature.ts'],
    errors: [],
  };

  it('continues to review after a clean Antigravity write with measured changes', () => {
    const recovered = recoverVerifiedExit(base);
    expect(recovered?.note).toContain('worker done 누락 자동 복구');
    expect(recovered?.report).toContain('1개 파일 변경');
  });

  it('does not recover a write with no changed files', () => {
    expect(recoverVerifiedExit({ ...base, filesChanged: [] })).toBeUndefined();
  });

  it('does not recover a provider error', () => {
    expect(recoverVerifiedExit({
      ...base,
      status: 'error',
      errors: [{ kind: 'error', code: 'timeout', message: 'timed out', retryable: true }],
    })).toBeUndefined();
  });

  it('does not weaken explicit completion for other providers', () => {
    expect(recoverVerifiedExit({ ...base, provider: 'claude' })).toBeUndefined();
  });

  it('requires a final response to recover a read-only Antigravity turn', () => {
    expect(recoverVerifiedExit({ ...base, mode: 'plan', filesChanged: [] })).toBeUndefined();
    expect(recoverVerifiedExit({
      ...base,
      mode: 'plan',
      filesChanged: [],
      finalText: '검토를 완료했습니다.',
    })).toBeDefined();
  });
});
