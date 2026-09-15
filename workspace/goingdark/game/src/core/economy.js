// ============================================================================
// 경제 시스템 (Economy Core)
// 세관 수수료 단일화 및 환전/가치 산정 도메인 함수
// ============================================================================

import { ECONOMY } from '../data/data.js';

/**
 * 저장 상태에 따른 세관 수수료율 반환
 * 기본: 10% (0.10)
 * customs_favor 해금 시: 8% (0.08)
 */
export function getCustomsRate(save) {
  if (save?.unlockedNodes && Array.isArray(save.unlockedNodes) && save.unlockedNodes.includes('customs_favor')) {
    return 0.08;
  }
  return ECONOMY.customsRate;
}

/**
 * 총 가치에 대한 세관 공제액 산출
 */
export function calculateCustoms(grossValue, save) {
  const rate = getCustomsRate(save);
  return Math.round(grossValue * rate);
}

/**
 * 환전 지급액 산출 (총액 - 세관)
 */
export function calculatePayout(grossValue, save) {
  const customs = calculateCustoms(grossValue, save);
  return grossValue - customs;
}
