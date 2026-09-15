// ============================================================================
// 영구 메타 진행 해금 12노드 (src/data/metaUnlocks.js)
// 12_roguelite_enhancement_plan.md §3.3 상한 (계정 레벨 10, 해금 노드 12개)
// ============================================================================

export const META_UNLOCKS_12 = [
  { id: 'iron_vitality', name: '육체 단련 I', cost: 100, desc: '최대 HP +10', effect: { maxHp: 10 } },
  { id: 'iron_vitality_2', name: '육체 단련 II', cost: 220, desc: '최대 HP +15 추가 상승', req: 'iron_vitality', effect: { maxHp: 15 } },
  { id: 'swift_feet', name: '기민한 보폭', cost: 150, desc: '기본 이동속도 +5%', effect: { moveSpeed: 0.05 } },
  { id: 'stamina_breathing', name: '심호흡법', cost: 150, desc: '스태미나 회복 속도 +15%', effect: { staminaRegen: 0.15 } },
  { id: 'starter_water', name: '원정 지원 I', cost: 200, desc: '던전 진입 시 성수병 1개 기본 지급', effect: { startItem: 'holyWater' } },
  { id: 'starter_potion', name: '원정 지원 II', cost: 200, desc: '던전 진입 시 치유 물약 1개 기본 지급', effect: { startItem: 'potion' } },
  { id: 'customs_favor', name: '세관 감면증', cost: 300, desc: '환전 세관 수수료 10% → 8%로 경감', effect: { customsRate: 0.08 } },
  { id: 'tolen_friendship', name: '톨렌의 배려', cost: 300, desc: '강화 +1~+3 성공률 +5%p', effect: { upgradeBonus: 0.05 } },
  { id: 'shadow_cloak', name: '그림자 외투', cost: 400, desc: '시선 자연 상승 속도 -10%', effect: { gazeReduction: 0.10 } },
  { id: 'hoarder_pouch', name: '찢긴 보루 주머니', cost: 350, desc: '가방 내 2칸 점유 무게추 감속 패널티 -50% 완화', effect: { heavyPenaltyReduction: 0.50 } },
  { id: 'tide_resilience', name: '침수 내성', cost: 450, desc: '심연 조수 독기 피해 -20% 경감', effect: { tideDamageReduction: 0.20 } },
  { id: 'gate_mastery', name: '역류 친화', cost: 500, desc: '탈출 게이트 충전 소요 시간 8초 → 7초 단축', effect: { gateChargeTime: 7 } },
];
