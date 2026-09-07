import { z } from 'zod';
import { PROVIDERS } from '../protocol/provider.js';

/**
 * 평가 하네스 — "여러 벤더에 배분하는 게 정말 나은가"에 수치로 답한다.
 *
 * 지금까지의 근거는 일화 하나뿐이다(agy가 쓴 설치 안내에서 claude가 오류 3건을 찾음).
 * 그게 **다중 벤더 덕인지, 그냥 검토를 했기 때문인지** 구분되지 않는다.
 * 조건을 나눠 그 교란을 제거하는 게 이 하네스의 존재 이유다.
 */

export const ArmName = z.enum(['solo', 'self-review', 'cross-review']);
export type ArmName = z.infer<typeof ArmName>;

/** 판정 항목 하나. 실행 **전에** 정해둔다. */
export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

/** 과제별 판정 스크립트가 돌려주는 것. */
export interface Assertion {
  checks: Check[];
}

export const EvalTask = z.object({
  id: z.string().min(1),
  /** 사람이 읽을 설명. */
  title: z.string().min(1),
  /** 워커에게 줄 지시. 모든 조건이 동일하게 받는다. */
  prompt: z.string().min(1),
  /**
   * 초기 저장소 내용. 파일 경로 → 내용.
   * 매 실행마다 새 저장소를 만들어 조건 간 출발점을 같게 한다.
   */
  repo: z.record(z.string(), z.string()),
});
export type EvalTask = z.infer<typeof EvalTask>;

export interface ArmResult {
  arm: ArmName;
  taskId: string;
  rep: number;
  /** 계획이 전부 성공 판정으로 끝났는가. */
  completed: boolean;
  checks: Check[];
  /** 통과한 판정 수 / 전체. */
  score: number;
  total: number;
  costUsd: number;
  /** 비용을 보고하지 않는 provider가 섞였는가. agy가 그렇다. */
  costPartial: boolean;
  durationMs: number;
  /** 참여한 provider (순서대로). */
  providers: string[];
  /**
   * 워커가 한 일보다 부풀려 보고했는가.
   * 성공이라 보고했는데 파일이 안 바뀐 경우를 센다.
   */
  overclaims: number;
  notes: string[];
}

export const PROVIDER_LIST = PROVIDERS;
