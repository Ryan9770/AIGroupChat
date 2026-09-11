import { describe, expect, it } from 'vitest';
import {
  addDiscussionUsage,
  createDiscussionUsage,
  parseDiscussionContribution,
  runDiscussion,
} from '../src/core/discussion.js';
import { DiscussionSpec } from '../src/protocol/discussion.js';

const spec = DiscussionSpec.parse({
  topic: '현재 프로젝트의 기능과 역할, 장단점과 개선점을 분석한다.',
  participants: [
    { provider: 'claude', role: '제품 전략과 사용자 가치' },
    { provider: 'codex', role: '기술 구조와 실행 가능성' },
  ],
  turns: 10,
  scribe: { provider: 'gemini' },
  summaryInstructions: 'SMART 분석과 SWOT 분석을 포함한다.',
});

describe('구조화 모델 토론', () => {
  it('10~20턴과 두 명 이상의 토론자를 요구한다', () => {
    expect(() => DiscussionSpec.parse({ ...spec, turns: 9 })).toThrow();
    expect(() => DiscussionSpec.parse({ ...spec, turns: 21 })).toThrow();
    expect(() => DiscussionSpec.parse({ ...spec, participants: [spec.participants[0]] })).toThrow();
  });

  it('같은 provider의 서로 다른 모델이나 관점을 별도 발화자로 둘 수 있다', () => {
    const parsed = DiscussionSpec.parse({
      ...spec,
      participants: [
        { provider: 'claude', model: 'model-a', role: '찬성 관점' },
        { provider: 'claude', model: 'model-b', role: '반대 관점' },
      ],
    });
    expect(parsed.participants).toHaveLength(2);
  });

  it('지정한 순서대로 라운드로빈 발언 후 서기가 최종 정리한다', async () => {
    const calls: Array<{ provider: string; prompt: string }> = [];
    const result = await runDiscussion({
      spec,
      cwd: 'C:/repo',
      speak: async ({ provider, prompt }) => {
        calls.push({ provider, prompt });
        return provider === 'gemini' ? '최종 결론' : `${provider}의 ${calls.length}번째 발언`;
      },
    });

    expect(result.turns).toHaveLength(10);
    expect(calls.slice(0, 10).map((call) => call.provider)).toEqual([
      'claude', 'codex', 'claude', 'codex', 'claude',
      'codex', 'claude', 'codex', 'claude', 'codex',
    ]);
    expect(calls[1]?.prompt).toContain('claude의 1번째 발언');
    expect(calls[10]).toMatchObject({ provider: 'gemini' });
    expect(calls[10]?.prompt).toContain('SMART 분석과 SWOT 분석');
    expect(result.summary).toBe('최종 결론');
  });

  it('한 토론자의 발언이 실패해도 나머지 토론과 최종 정리를 계속한다', async () => {
    let call = 0;
    const result = await runDiscussion({
      spec,
      cwd: 'C:/repo',
      speak: async ({ provider }) => {
        call += 1;
        if (call === 1) throw new Error('일시적 실패');
        return provider === 'gemini' ? '실패를 반영한 결론' : '후속 발언';
      },
    });

    expect(result.failedTurns).toBe(1);
    expect(result.turns[0]?.error).toBe('일시적 실패');
    expect(result.summary).toBe('실패를 반영한 결론');
  });

  it('발언자는 압축 문맥을 받고 최종 서기는 전체 토론 기록을 받는다', async () => {
    const prompts: string[] = [];
    let call = 0;
    await runDiscussion({
      spec,
      cwd: 'C:/repo',
      speak: async ({ provider, prompt }) => {
        prompts.push(prompt);
        call += 1;
        if (provider === 'gemini') return '최종 결론';
        return `<speech>발언 ${call}</speech><rolling-summary>누적 요약 ${call}</rolling-summary>`;
      },
    });

    expect(prompts[4]).toContain('누적 요약 4');
    expect(prompts[4]).toContain('발언 2');
    expect(prompts[4]).toContain('발언 3');
    expect(prompts[4]).toContain('발언 4');
    expect(prompts[4]).not.toContain('발언 1');
    expect(prompts[10]).toContain('누적 요약 10');
    expect(prompts[10]).toContain('발언 1');
    expect(prompts[10]).toContain('발언 7');
    expect(prompts[10]).toContain('발언 8');
    expect(prompts[10]).toContain('발언 9');
    expect(prompts[10]).toContain('발언 10');
  });

  it('마지막 한 바퀴에서 모든 역할에 구조화된 최종 입장을 요구한다', async () => {
    const prompts: string[] = [];
    await runDiscussion({
      spec,
      cwd: 'C:/repo',
      speak: async ({ provider, prompt }) => {
        prompts.push(prompt);
        return provider === 'gemini' ? '최종 정리' : '짧은 발언';
      },
    });

    expect(prompts[7]).not.toContain('최종 입장 라운드');
    expect(prompts[8]).toContain('최종 입장 라운드 1/2');
    expect(prompts[9]).toContain('[최종 선택]');
    expect(prompts[9]).toContain('[남은 이견]');
  });

  it('UI 발언은 짧게 표시하지만 최종 서기에는 더 긴 원문을 전달한다', async () => {
    const longSpeech = `원문-시작-${'가'.repeat(1_100)}-원문-끝`;
    const displayed: string[] = [];
    let summaryPrompt = '';
    let turnCall = 0;

    const result = await runDiscussion({
      spec,
      cwd: 'C:/repo',
      onTurnEnd: (turn) => displayed.push(turn.text),
      speak: async ({ provider, prompt }) => {
        if (provider === 'gemini') {
          summaryPrompt = prompt;
          return '최종 정리';
        }
        turnCall += 1;
        return turnCall === 1 ? longSpeech : '짧은 발언';
      },
    });

    expect(result.turns[0]).toMatchObject({ truncated: true, originalChars: longSpeech.length });
    expect(displayed[0]).toContain('화면 표시 길이 제한');
    expect(displayed[0]).not.toContain('원문-끝');
    expect(summaryPrompt).toContain('원문-끝');
  });

  it('긴 누적 요약의 후보 레지스트리와 최신 결정을 모두 보존한다', async () => {
    const prompts: string[] = [];
    let turnCall = 0;
    await runDiscussion({
      spec,
      cwd: 'C:/repo',
      speak: async ({ provider, prompt }) => {
        prompts.push(prompt);
        if (provider === 'gemini') return '최종 정리';
        turnCall += 1;
        if (turnCall === 1) {
          return `<speech>첫 발언</speech><rolling-summary>[후보 레지스트리] 최초 후보\n${'중간'.repeat(900)}\n[합의·이견] 최신 결정</rolling-summary>`;
        }
        return '후속 발언';
      },
    });

    expect(prompts[1]).toContain('[후보 레지스트리] 최초 후보');
    expect(prompts[1]).toContain('[합의·이견] 최신 결정');
    expect(prompts[1]).toContain('누적 요약 중간 생략');
  });

  it('구조화 발언을 분리하고 provider별 실제 사용량을 누적한다', () => {
    expect(parseDiscussionContribution(
      '<speech>검토 의견</speech><rolling-summary>합의와 이견</rolling-summary>',
    )).toEqual({ speech: '검토 의견', rollingSummary: '합의와 이견' });

    const usage = createDiscussionUsage();
    addDiscussionUsage(usage, 'claude', {
      kind: 'usage',
      inputTokens: 100,
      outputTokens: 20,
      cacheCreationTokens: 30,
      cacheReadTokens: 40,
      costUsd: 0.012,
    });
    addDiscussionUsage(usage, 'codex', {
      kind: 'usage',
      inputTokens: 200,
      outputTokens: 50,
      cacheReadTokens: 80,
      thinkingTokens: 10,
    });

    expect(usage).toMatchObject({
      inputTokens: 300,
      outputTokens: 70,
      cacheCreationTokens: 30,
      cacheReadTokens: 120,
      thinkingTokens: 10,
      costUsd: 0.012,
      usageEvents: 2,
      unpricedUsageEvents: 1,
    });
    expect(usage.byProvider.claude?.costUsd).toBe(0.012);
    expect(usage.byProvider.codex?.unpricedUsageEvents).toBe(1);
  });

  it('recovers a closed rolling summary when speech tags are missing', () => {
    expect(parseDiscussionContribution(
      'Final choice is candidate A.\n<rolling-summary>Candidate A leads</rolling-summary>',
    )).toEqual({
      speech: 'Final choice is candidate A.',
      rollingSummary: 'Candidate A leads',
    });
  });

  it('recovers an unclosed rolling summary without leaking it into speech', () => {
    expect(parseDiscussionContribution(
      '<speech>Final choice is candidate A.\n<rolling-summary>Candidate A leads',
    )).toEqual({
      speech: 'Final choice is candidate A.',
      rollingSummary: 'Candidate A leads',
    });
  });
});
