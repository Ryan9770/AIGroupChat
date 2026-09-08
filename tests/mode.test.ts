import { describe, expect, it } from 'vitest';
import { ModeError } from '../src/core/mode-runner.js';
import {
  BUILTIN_MODES,
  buildBulkReaderPrompt,
  buildDraftWriterPrompt,
} from '../src/protocol/mode.js';
import { modeList } from '../src/commands/mode.js';

describe('AiKA 선언형 모드 정의', () => {
  it('기본 모드로 bulk-reader와 draft-writer가 등록되어 있다', () => {
    expect(BUILTIN_MODES['bulk-reader']).toBeDefined();
    expect(BUILTIN_MODES['draft-writer']).toBeDefined();
  });

  it('기본 provider로 antigravity를 우선 사용한다', () => {
    expect(BUILTIN_MODES['bulk-reader'].provider).toBe('antigravity');
    expect(BUILTIN_MODES['draft-writer'].provider).toBe('antigravity');
  });

  it('모드별 적절한 실행 모드(plan/write)가 지정되어 있다', () => {
    expect(BUILTIN_MODES['bulk-reader'].mode).toBe('plan');
    expect(BUILTIN_MODES['draft-writer'].mode).toBe('write');
  });

  it('대체 후보(fallbacks)에 codex와 claude가 포함되어 있다', () => {
    expect(BUILTIN_MODES['bulk-reader'].fallbacks).toContain('codex');
    expect(BUILTIN_MODES['bulk-reader'].fallbacks).toContain('claude');
    expect(BUILTIN_MODES['draft-writer'].fallbacks).toContain('codex');
    expect(BUILTIN_MODES['draft-writer'].fallbacks).toContain('claude');
  });

  it('bulk-reader 프롬프트는 토큰 절약 규칙과 파일 분석 지침을 포함한다', () => {
    const prompt = buildBulkReaderPrompt({
      files: 'src/core/*.ts',
      query: '라우터와 스케줄러 의존성',
    });
    expect(prompt).toContain('src/core/*.ts');
    expect(prompt).toContain('라우터와 스케줄러 의존성');
    expect(prompt).toContain('토큰 낭비 절대 금지');
    expect(prompt).toContain('Markdown으로 작성');
  });

  it('draft-writer 프롬프트는 작업 명세와 컨텍스트를 반영한다', () => {
    const prompt = buildDraftWriterPrompt({
      spec: '새로운 테스트 파일 추가',
      context: '기존 tests/plan.test.ts 참고',
      files: 'tests/mode.test.ts',
    });
    expect(prompt).toContain('새로운 테스트 파일 추가');
    expect(prompt).toContain('tests/plan.test.ts');
    expect(prompt).toContain('tests/mode.test.ts');
    expect(prompt).toContain('컨벤션, 네이밍, 코딩 스타일');
  });

  it('modeList는 0을 반환하며 정상 실행된다', () => {
    const code = modeList();
    expect(code).toBe(0);
  });

  it('팀장(isLeader: true)에게는 AiKA 모드 가이드라인이 프리앰블에 주입된다', async () => {
    const { buildDispatchPreamble } = await import('../src/protocol/preamble.js');
    const preamble = buildDispatchPreamble({
      taskId: 'design',
      dispatchId: 'disp-1',
      taskSpec: '아키텍처 설계',
      workerHandle: 'claude-1',
      cli: 'conductor',
      canAsk: true,
      isLeader: true,
    });

    expect(preamble).toContain('AiKA 모드: 토큰 절약 및 하위 워커 위임 수칙 (팀장 전용)');
    expect(preamble).toContain('conductor mode run bulk-reader');
    expect(preamble).toContain('conductor mode run draft-writer');
    expect(preamble).toContain('antigravity');
  });

  it('일반 워커(isLeader: false)에게는 AiKA 팀장 블록이 주입되지 않는다', async () => {
    const { buildDispatchPreamble } = await import('../src/protocol/preamble.js');
    const preamble = buildDispatchPreamble({
      taskId: 'implement',
      dispatchId: 'disp-2',
      taskSpec: '기능 구현',
      workerHandle: 'antigravity-1',
      cli: 'conductor',
      canAsk: true,
      isLeader: false,
    });

    expect(preamble).not.toContain('AiKA 모드: 토큰 절약 및 하위 워커 위임 수칙');
  });
});
