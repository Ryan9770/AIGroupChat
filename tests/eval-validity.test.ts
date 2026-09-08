import { describe, expect, it } from 'vitest';
import { judgeValidity } from '../src/eval/harness.js';

/**
 * 무효 실행 판별.
 *
 * 🔴 이 구분이 없어서 실제로 한 번 망했다. 쿼터가 마른 상태로 18회를 돌렸더니
 * 15회가 2초 만에 아무것도 안 하고 끝났는데, 하네스가 그걸 점수로 세서
 * "self-review 26%, cross-review 26%"라는 표를 뱉었다. 결과처럼 생겼지만
 * 데이터가 아니다 — 조건을 비교한 게 아니라 벤더가 죽은 걸 본 것이다.
 *
 * 에이전트가 **시도해서 틀린 것**은 유효한 0점이고, **애초에 돌지 않은 것**은
 * 표에서 빠져야 한다.
 */
const outcome = (files: string[], durationMs: number, taskId = 'implement') => ({
  taskId,
  result: { filesChanged: files, durationMs },
});

describe('무효 실행 판별', () => {
  it('쿼터 소진 오류는 무효다', () => {
    const reason = judgeValidity(
      [outcome(['src/a.js'], 120_000)],
      [{ code: 'rate_limited', message: "You've hit your usage limit." }],
    );
    expect(reason).toContain('쿼터 소진');
  });

  it('즉시 종료하고 아무것도 안 만들었으면 무효다', () => {
    // 벤더가 쿼터 오류를 구조화해 알려주지 않아도 이 신호는 남는다.
    // 실측: 2~3초, 변경 파일 0개, 비용 $0.000.
    expect(judgeValidity([outcome([], 2_400)], [])).toContain('아무것도 만들지 않고');
  });

  it('오래 걸렸는데 아무것도 안 만들었으면 유효한 실패다', () => {
    // 에이전트가 진짜로 시도했다가 실패한 것. 이건 0점짜리 데이터지 무효가 아니다.
    // 여기서 무효 처리하면 "구현을 못 하는 과제"가 표에서 조용히 사라진다.
    expect(judgeValidity([outcome([], 180_000)], [])).toBeUndefined();
  });

  it('파일을 만들었으면 짧게 끝났어도 유효하다', () => {
    expect(judgeValidity([outcome(['src/a.js'], 4_000)], [])).toBeUndefined();
  });

  it('판단 기준은 구현 단계다', () => {
    // 검토 단계가 빨리 끝나는 건 정상이다(문제 없으면 몇 초면 된다).
    // 구현이 제대로 돌았는지만 본다.
    const reason = judgeValidity(
      [outcome(['src/a.js'], 150_000), outcome([], 1_000, 'review')],
      [],
    );
    expect(reason).toBeUndefined();
  });

  it('구현 단계가 아예 없으면 무효다', () => {
    expect(judgeValidity([], [])).toContain('아무것도 만들지 않고');
  });

  it('쿼터 오류가 다른 오류보다 우선한다', () => {
    // 쿼터가 마르면 뒤따르는 오류가 줄줄이 생긴다. 근본 원인을 보고해야
    // 사용자가 "복구된 뒤 다시 돌려라"를 알 수 있다.
    const reason = judgeValidity(
      [outcome([], 2_000)],
      [
        { code: 'parse_error', message: 'unexpected end of stream' },
        { code: 'rate_limited', message: 'usage limit reached' },
      ],
    );
    expect(reason).toContain('쿼터 소진');
  });
});
