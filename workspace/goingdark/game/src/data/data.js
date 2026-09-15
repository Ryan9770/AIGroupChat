// ============================================================================
// 기획서 수치 원본 데이터 테이블
// 출처: 00b_core_mechanics.md(코어 원본), 04_enemies.md, 08_economy_balance.md
// 하드코딩 금지 원칙(04 §7 체크리스트) — 모든 수치는 이 파일에서만 정의한다.
import { createMulberry32 } from '../core/rng.js';

export const PLAYER_BASE = {
  hp: 100,
  stamina: 100,
  staminaDrainPerSec: 22, // 전력질주
  walkSpeed: 4.5,     // m/s
  guardSpeed: 4.5 * 0.6, // 가드 -40%
  sprintSpeed: 7.8,
  heavyItemSpeedPenalty: 0.10, // 2슬롯 아이템 보유 시 -10%
  invOpenSpeedPenalty: 0.60,   // Tab 인벤토리 -60%
  attack: { cooldown: 0.55, range: 1.6, dmgMin: 18, dmgMax: 24 },
  guard: { dmgReduction: 0.70 },
  roll: { invuln: 0.3, cooldown: 1.2, noiseRadius: 20 },
  interactRadius: 2.2,
  gateChargeTime: 8,
  gateAlarmRadius: 40,
  lampSkill: { duration: 5, cooldown: 14, detectReduction: 0.35, radius: 6 },
};

// 시선(저주) 시스템 — 01 §1.4, 00b, 04 §4
export const GAZE = {
  max: 100,
  riseRatePerSec: 0.14,       // 어둠 체류 기본 상승
  relicHoldBonusPerSec: 0.10, // 레어/에픽 유물 미장착 소지 시 추가 상승 (1개당)
  thresholds: { safe: 30, detect: 60, whisper: 90, hunt: 100 },
  holyWaterReduce: 30,
  altarReduce: 40,
  searchPartyRegroupInterval: 30, // 91+: 최후 목격지 집결
  searchPartySpawnInterval: 60,   // 91+: 추격 조 스폰
};

// 시선 구간 × 몹 AI 매트릭스 (04 §4) — 데이터화(하드코딩 금지 체크리스트 항목)
export const GAZE_MATRIX = [
  { min: 0, max: 30, label: '안전', skeletonDetectMul: 1.0, miteAlertRadius: 20, golemTelegraphMul: 1.0, bossReinforceInterval: 15 },
  { min: 31, max: 60, label: '탐지 상승', skeletonDetectMul: 1.3, miteAlertRadius: 20, golemTelegraphMul: 1.0, bossReinforceInterval: 15 },
  { min: 61, max: 90, label: '속삭임', skeletonDetectMul: 1.3, miteAlertRadius: 26, golemTelegraphMul: 0.9 / 1.1, bossReinforceInterval: 10 },
  { min: 91, max: 100, label: '수색대', skeletonDetectMul: 1.3, miteAlertRadius: 999, golemTelegraphMul: 0.9 / 1.1, bossReinforceInterval: 10, hunt: true },
];

export function gazeBand(gaze) {
  return GAZE_MATRIX.find(b => gaze >= b.min && gaze <= b.max) ?? GAZE_MATRIX[0];
}

// 심연 조수(Tide) — 3단계 램프업 (00b, 10_pve_revision B-1)
export const TIDE_STAGES = [
  { atSec: 22 * 60, label: '1차 — 독기 안개', dmgPerTick: 3, tickSec: 10 },
  { atSec: 27 * 60, label: '2차 — 독기 파도', dmgPerTick: 3, tickSec: 1 },
  { atSec: 30 * 60, label: '3차 — 하드 컷', dmgPerTick: 10, tickSec: 1 },
];
export const GATE_OPEN_AT_SEC = 18 * 60;
export const SESSION_HARD_CUT_SEC = 30 * 60;

// 몹 데이터 (04 §2 및 컨텐츠 고도화)
export const ENEMY_DEFS = {
  skeleton: {
    id: 'skeleton', name: '해골병정', hp: 60, moveSpeed: 2.8,
    detectRange: 12, attackRange: 14,
    dmg: 12, magazine: 3, reloadSec: 2.4, shotIntervalSec: 0.5, telegraphSec: 0.7,
    retreatDist: 4,
    noiseOnHit: true,
    drop: { commonChance: 1.0, uncommonChance: 0.08 },
    voiceOnSpot: '전방… 확인…', voiceOnDeath: '보고를… 왕에게…',
  },
  skeletonCaptain: { // 1막 퀘스트용 병장(엘리트 변형)
    id: 'skeletonCaptain', name: '해골 병장', hp: 110, moveSpeed: 2.6,
    detectRange: 13, attackRange: 14,
    dmg: 14, magazine: 4, reloadSec: 2.2, shotIntervalSec: 0.5, telegraphSec: 0.65,
    retreatDist: 4, noiseOnHit: true,
    drop: { commonChance: 1.0, uncommonChance: 0.2 },
    questDrop: 'sergeant_ring',
    voiceOnSpot: '침입자… 확인.', voiceOnDeath: '전투 보고를… 왕에게…',
  },
  royalGuard: { // 04 §2.4 — MVP는 해골병정 강화 스킨
    id: 'royalGuard', name: '왕실 호위 잔재', hp: 90, moveSpeed: 3.0,
    detectRange: 10, attackRange: 1.8, meleeInterval: 0.7,
    dmg: 16, guardReduction: 0.40, soundImmune: true,
    drop: { uncommonChance: 1.0, rareChance: 0.06 },
    voiceOnSpot: '…!', voiceOnDeath: '폐하…',
  },
  mite: {
    id: 'mite', name: '심연충', hp: 30, moveSpeed: 3.2, frenzySpeed: 5.0,
    detectRange: 8, attackRange: 1.4, biteDmg: 8, biteInterval: 1.1,
    leapTelegraphSec: 0.4, packSize: 3,
    drop: { commonChance: 0.6, uncommonChance: 0.04 },
  },
  golem: {
    id: 'golem', name: '수호 골렘', hp: 220, moveSpeed: 2.0, armorReduction: 0.15,
    detectRange: 8, leashRadius: 8,
    slamDmg: 30, slamRadius: 2.2, slamTelegraph: 1.1,
    sweepDmg: 22, sweepTelegraph: 1.4,
    drop: { uncommonChance: 1.0, rareChance: 0.12 },
  },
  cultist: { // 신규 적 1: 원거리 암흑 주술사
    id: 'cultist', name: '어둠 광신도', hp: 70, moveSpeed: 2.5,
    detectRange: 12, attackRange: 13,
    dmg: 15, shotIntervalSec: 1.8, telegraphSec: 0.6,
    retreatDist: 3.5,
    noiseOnHit: true,
    drop: { commonChance: 0.8, uncommonChance: 0.25 },
    voiceOnSpot: '심연의 뜻대로…', voiceOnDeath: '어둠이… 삼킨다…',
  },
  wraith: { // 신규 적 2: 부유형 냉기 망령
    id: 'wraith', name: '심연 망령', hp: 55, moveSpeed: 3.6,
    detectRange: 9, attackRange: 1.6, meleeInterval: 0.9,
    dmg: 18, slowDuration: 1.5,
    drop: { commonChance: 0.5, uncommonChance: 0.35, rareChance: 0.08 },
    voiceOnSpot: '흐으으…', voiceOnDeath: '안식으로…',
  },
  mimic: { // 기믹 몬스터: 미믹 상자
    id: 'mimic', name: '식인 궤 (미믹)', hp: 120, moveSpeed: 3.4,
    detectRange: 10, attackRange: 1.6, meleeInterval: 0.8,
    dmg: 22, armorReduction: 0.1,
    drop: { uncommonChance: 1.0, rareChance: 0.4, epicChance: 0.1 },
    voiceOnSpot: '크르르르…!', voiceOnDeath: '끼에엑…',
  },
};

// 엘리트 몬스터 변형 modifier (기믹)
export const ELITE_MODIFIERS = {
  frenzied: { id: 'frenzied', name: '광폭화', prefix: '[광폭화] ', speedMul: 1.30, dmgMul: 1.25, hpMul: 1.20, color: '#e04040' },
  regenerating: { id: 'regenerating', name: '재생', prefix: '[재생] ', hpMul: 1.25, regenPerSec: 4, color: '#40e060' },
  explosive: { id: 'explosive', name: '파열', prefix: '[파열] ', hpMul: 1.15, explodeDmg: 18, explodeRadius: 2.5, color: '#e0a030' },
};

// 층별 스폰 구성 (04 §5 및 신규 적 반영)
export const FLOOR_DEFS = [
  { floor: 1, name: '주화 해안', spawns: [{ type: 'skeleton', n: 3 }], chests: 2, altars: 0, gate: true },
  { floor: 2, name: '골격 막사', spawns: [{ type: 'skeleton', n: 1 }, { type: 'skeletonCaptain', n: 1 }, { type: 'mite', n: 3 }, { type: 'cultist', n: 1 }], chests: 2, altars: 1, gate: false, quest: 'sergeant_ring' },
  { floor: 3, name: '속삭이는 전당', spawns: [{ type: 'skeleton', n: 2 }, { type: 'mite', n: 3 }, { type: 'golem', n: 1 }, { type: 'cultist', n: 1 }, { type: 'wraith', n: 1 }], chests: 3, altars: 1, gate: true, boss: false },
  { floor: 4, name: '왕가의 복도', spawns: [{ type: 'royalGuard', n: 2 }, { type: 'skeleton', n: 2 }, { type: 'mite', n: 3 }, { type: 'golem', n: 1 }, { type: 'wraith', n: 1 }], chests: 3, altars: 0, gate: false, sideBoss: 'hart' },
  { floor: 5, name: '위장 & 집행의 방', spawns: [{ type: 'royalGuard', n: 2 }, { type: 'mite', n: 5 }, { type: 'skeleton', n: 2 }, { type: 'golem', n: 1 }, { type: 'cultist', n: 1 }, { type: 'wraith', n: 1 }], chests: 2, altars: 0, gate: false, boss: true },
];

// 저주 유물 8종 (고가치 & 대가)
export const CURSED_RELICS = [
  { id: 'blood_chalice', name: '피의 잔', tier: 'rare', value: 260, slot: 1, effect: { weaponDmgAdd: 6, maxHpSub: 20 }, desc: '무기 피해 +6 / 최대 체력 -20' },
  { id: 'blind_greed', name: '맹목의 탐욕', tier: 'rare', value: 320, slot: 1, effect: { lootValueMul: 1.40, gazeRateMul: 1.35 }, desc: '전리품 가치 +40% / 시선 상승 +35%' },
  { id: 'hasty_boots', name: '조급한 장화', tier: 'uncommon', value: 160, slot: 1, effect: { moveSpeedMul: 1.25, guardReductionSub: 0.30 }, desc: '이동속도 +25% / 방어 피해경감 30%p 감소' },
  { id: 'berserker_brand', name: '광전사의 낙인', tier: 'rare', value: 280, slot: 1, effect: { critChanceAdd: 0.25, dmgTakenMul: 1.20 }, desc: '치명타율 +25% / 피격 피해 +20%' },
  { id: 'soul_anchor', name: '영혼 닻', tier: 'rare', value: 240, slot: 1, effect: { damageTakenMul: 0.75, rollStaminaMul: 2.0 }, desc: '받는 피해 25% 경감 / 구르기 스태미나 2배' },
  { id: 'whispering_skull', name: '속삭이는 두개골', tier: 'uncommon', value: 180, slot: 1, effect: { xpMul: 1.50, extraGazePerTick: 1 }, desc: '런 XP 획득 +50% / 시선 틱당 +1 추가' },
  { id: 'vampire_fang', name: '흡혈귀의 송곳니', tier: 'rare', value: 300, slot: 1, effect: { killHeal: 5, potionMul: 0.50 }, desc: '적 처치 시 HP +5 회복 / 치유 물약 효과 -50%' },
  { id: 'abyssal_pact', name: '심연의 계약', tier: 'epic', value: 650, slot: 2, effect: { epicDropBonus: 0.20, deathLossGoldRate: 0.20 }, desc: '에픽 드롭률 대폭 상승 / 사망 시 저장고 골드 20% 유실' },
];

// 방 이벤트 8종 (이벤트 방 상호작용)
export const ROOM_EVENTS = [
  { id: 'shrine_of_sacrifice', name: '희생의 제단', costHp: 25, rewardTier: 'rare', desc: 'HP 25를 바쳐 희귀 전리품을 획득합니다.' },
  { id: 'wandering_merchant', name: '방랑 상인', desc: '던전 내에서 긴급 소모품이나 축복을 교환합니다.' },
  { id: 'ancient_library', name: '고대 서고', xpReward: 120, desc: '지식을 탐독하여 대량의 런 XP(+120)를 얻습니다.' },
  { id: 'cursed_tomb', name: '저주받은 묘지', goldReward: 150, ambushCount: 2, desc: '도굴하여 대량 골드를 얻지만 정예 해골이 깨어납니다.' },
  { id: 'holy_fountain', name: '정화의 샘', gazeReduce: 40, healHp: 50, desc: '시선을 40 낮추고 체력을 50 회복합니다.' },
  { id: 'forge_anvil', name: '버려진 모루', desc: '던전 내에서 무기를 즉시 1회 무료 강화 시도합니다.' },
  { id: 'gambler_chest', name: '도박사의 궤', trapDamage: 20, desc: '열면 50% 확률로 에픽 전리품, 50% 확률로 가시 함정 발동!' },
  { id: 'prisoner_cage', name: '포로의 철장', buffDmg: 4, desc: '포로를 구출하여 남은 층 동안 공격력 +4 지원 버프를 받습니다.' },
];

export const RESPAWN_SEC = 90;
export const RESPAWN_SEC_HUNT = 60; // 시선 91+ 구간

// 드롭 등급 및 가치 (00b 약탈 시스템, 04 §6)
export const LOOT_TIERS = {
  common: { label: '일반', color: '#b3a077', min: 10, max: 30, slot: 1 },
  uncommon: { label: '언코먼', color: '#6fbf6f', min: 50, max: 120, slot: 1 },
  rare: { label: '레어', color: '#6f9dbf', min: 200, max: 500, slot: 2 },
  epic: { label: '에픽', color: '#c76fbf', min: 1000, max: 2500, slot: 2 },
};
export const LOOT_NAMES = {
  common: ['녹슨 고철', '삭은 은화 더미', '석궁재', '키틴 조각'],
  uncommon: ['강화 부속', '치유 포션 원액', '은제 촛대'],
  rare: ['유물 조각', '왕실 인장'],
  epic: ["심연의 심장"],
};

const defaultLootRng = createMulberry32(1337);

export function rollLootTier(rng = defaultLootRng) {
  const r = typeof rng === 'function' ? rng() : rng.next();
  if (r < 0.60) return 'common';
  if (r < 0.88) return 'uncommon';
  if (r < 0.98) return 'rare';
  return 'epic';
}
export function rollLootValue(tier, rng = defaultLootRng) {
  const t = LOOT_TIERS[tier];
  const r = typeof rng === 'function' ? rng() : rng.next();
  return Math.round(t.min + r * (t.max - t.min));
}
export function makeLootItem(tier, rng = defaultLootRng) {
  const names = LOOT_NAMES[tier];
  const r1 = typeof rng === 'function' ? rng() : rng.next();
  const name = names[Math.floor(r1 * names.length)];
  const r2 = typeof rng === 'function' ? rng() : rng.next();
  return {
    id: `${tier}_${name}_${Math.floor(r2 * 1e9)}`,
    tier, name, value: rollLootValue(tier, rng), slot: LOOT_TIERS[tier].slot,
  };
}

// 보스 감시자 (04 §3)
export const BOSS_WARDEN = {
  name: '감시자 (The Warden)',
  hp: 1600,
  phases: [
    { name: 'P1 — 집행관', from: 1600, to: 1100, moveSpeed: 3.2, slashDmg: 24, slashTelegraph: 0.8, thrustDmg: 30, thrustTelegraph: 1.0, thrustRange: 6 },
    { name: 'P2 — 융합', from: 1100, to: 550, moveSpeed: 2.6, spearDmg: 34, spearTelegraph: 0.9, poolDps: 6, poolDur: 5, waveDmg: 20, waveIntervalSec: 15 },
    { name: 'P3 — 시선', from: 550, to: 0, moveSpeed: 0, aoeDmg: 28, aoeRadius: 4, aoeTelegraph: 1.2, gazeBeamDmg: 35, gazeBeamMarkSec: 2, reinforceCap: 6 },
  ],
  epicDropChance: 0.45,
  guaranteedRareDrops: 3,
  respawnHoursRealtime: 12,
};

// 보스 E1 '보고하는 자 병정장 하르트' (07_extension_pack.md §B) — 4층 사이드 보스
// SQ-02(실종 신고)를 완료해야 활성화된다는 원문 조건은 이 솔로 프로토타입에 '막' 구조가 없어
// 단순화했다(다른 조건부 단순화와 동일 원칙 — README 참조). 4층 진입 시 상시 조우 가능한 선택형 보스.
export const BOSS_HART = {
  name: '보고하는 자, 병정장 하르트',
  hp: 1000,
  phases: [
    { name: 'P1 — 소집', from: 1000, to: 620, moveSpeed: 2.8, spearDmg: 20, spearRange: 18, spearTelegraph: 0.9, spinDmg: 26, spinRange: 2.6, spinTelegraph: 0.8 },
    { name: 'P2 — 공유된 시야', from: 620, to: 240, moveSpeed: 2.8, spearDmg: 20, spearRange: 18, spearTelegraph: 0.85, spinDmg: 26, spinRange: 2.6, spinTelegraph: 0.75, alertPulseRadius: 14 },
    { name: 'P3 — 최후의 방어', from: 240, to: 0, moveSpeed: 0, spearDmg: 20, spearRange: 18, spearTelegraph: 0.6, volleyCount: 3, volleyIntervalSec: 0.5 },
  ],
  rareDrops: 2,
  uncommonDrops: 2,
  respawnHoursRealtime: 12,
};

// 하르트 고유 드롭 — '장군의 보고서'(레어, 1슬롯): 시선 상승 억제 -50% (07 §B)
export const HART_UNIQUE_ITEM = {
  tier: 'rare', name: '장군의 보고서', value: 300, slot: 1,
  effect: 'gazeSuppress', amount: 0.50,
  desc: '시선 상승 -50%',
};

// 거점 상점 소모품 (00b §거점: 램프 기름·성수·붕대, 08: 성수 40 고정가)
export const CONSUMABLES = {
  holyWater: { id: 'holyWater', name: '성수병', price: 40, slot: 1, effect: 'gaze', amount: 30, desc: '시선 -30 (즉시)' },
  potion: { id: 'potion', name: '치유 물약', price: 35, slot: 1, effect: 'heal', amount: 40, desc: 'HP +40 (즉시)' },
  bandage: { id: 'bandage', name: '붕대', price: 15, slot: 1, effect: 'healOverTime', amount: 20, desc: 'HP +20 (서서히)' },
  lampOil: { id: 'lampOil', name: '등불 기름', price: 10, slot: 1, effect: 'lampCdReset', amount: 0, desc: '성수 등불(Q) 쿨다운 즉시 초기화' },
};

// 거점 경제 (00b, 08)
export const ECONOMY = {
  customsRate: 0.10, // 세관 10% (환전 매입가 공제)
  holyWaterPrice: 40, // 종단 공급 고정가
  potionPrice: 35,
  bandagePrice: 15,
  lampOilPrice: 10,
  upgradeDestroyRareRefundHint: 0.70, // 08: 에픽 환전 상한(시세 70%) — 참고용 표기
};

// 강화 확률표 (00b, 08에서 +4/+5 파괴율 상향 반영)
export const UPGRADE_TABLE = [
  { level: 1, success: 0.90, onFail: 'none' },
  { level: 2, success: 0.75, onFail: 'downgrade' },
  { level: 3, success: 0.55, onFail: 'downgrade' },
  { level: 4, success: 0.35, onFail: 'destroy', destroyChance: 0.55 }, // 08: 45%→55% 상향
  { level: 5, success: 0.20, onFail: 'destroy', destroyChance: 0.70 },
];
export const UPGRADE_DMG_BONUS_PER_LEVEL = 3; // 강화도 비례 피해 증가 (00b "무기 강화도 비례 증가" 구체화)

// 원정 기록 스키마 (08 §5)
export function makeDeathHistoryEntry({ sessionId, floor, loadoutHash, lootSnapshot, cause }) {
  return {
    session_id: sessionId,
    floor,
    timestamp: new Date().toISOString(),
    loadout_hash: loadoutHash,
    loot_snapshot: lootSnapshot,
    cause, // 'mob' | 'tide' | 'boss'
  };
}

// 대사집 발췌 (02_dialogues.md) — trigger 키로 접근
export const DIALOGUE = {
  hub_enter_first: [
    { speaker: '브로카', text: '왔나. 오늘 1층 주화 시세는 내림세다. 3층 성물 조각은 오름세이고. …할 일은 네가 정해.' },
  ],
  shop_open: [
    { speaker: '브로카', text: '필요한 게 뭐냐. 램프 기름, 성수, 붕대. 사지 않을 거면 비키고.' },
  ],
  item_sell: [
    { speaker: '브로카', text: '그거 어디서 났는진 안 묻는다. 묻는 건 하나다 — 탈출했나. 했으니 팔리는 거고.' },
  ],
  extraction_success: [
    { speaker: '브로카', text: '살아서 나왔군. 그게 첫 계산이다. 나머지는 내가 하지.' },
  ],
  quest_board_open: [
    { speaker: '브로카', text: '의뢰는 한 번에 세 개까지. 욕심부리다 위액이 된다.' },
  ],
  quest_complete_ring: [
    { speaker: '브로카', text: '이거 왕실 직인이다. …의뢰는 없던 일로 하고, 값은 쳐준다. 오늘 본 건 수첩에 안 적어.' },
  ],
  player_respawn: [
    { speaker: '브로카', text: '없어졌다. 청구할 곳이 없으니 나도 적을 데가 없다. 짐은 돌아오지 않는다.' },
  ],
  altar_interact: [
    { speaker: '세레나', text: '빛을 받으십시오. 대가는 없습니다. 대가를 요구하는 것은 이미 빛이 아닙니다.' },
  ],
  holy_water_buy: [
    { speaker: '세레나', text: '성수입니다. 하나에 40골드라고 하더군요. 저는 값을 모릅니다. 브로카에게 물으십시오.' },
  ],
  gaze_61: [
    { speaker: '세레나', text: '당신의 등에 시선이 내려앉았습니다. 예순하나. …속삭임을 듣기 전에 나오십시오.' },
  ],
  gaze_91: [
    { speaker: '세레나', text: '달아나십시오. 지금 당신은, 그것이 가장 먹고 싶은 순서입니다.' },
  ],
  boss_engage: [
    { speaker: '세레나', text: '기억은 남았습니까.' },
  ],
  boss_p2: [
    { speaker: '세레나', text: '기억은 남지 않았군요. 그렇다면 남긴 것은 제가 거두겠습니다.' },
  ],
  boss_p3: [
    { speaker: '세레나', text: '이것이 당신의 기도였습니까. 그렇다면 제 답은 검입니다.' },
  ],
  boss_dead: [
    { speaker: '세레나', text: '평안하십시오.' },
  ],
  tide_1: [
    { speaker: '???', text: '조수 1분 전이다. 못 나오면 장부에 빨간 줄이야.' },
  ],
  tide_2: [
    { speaker: '???', text: '다음 종이 울리면 초당 셋이다. 계산은 네가 해.' },
  ],
  gate_open: [
    { speaker: '???', text: '18분 지났다. 게이트 열려. 트림은 두 번 안 한다.' },
  ],
  hart_engage: [
    { speaker: '하르트', text: '침입자 확인. …보고한다. 즉시 처리하겠다.' },
  ],
  hart_p2: [
    { speaker: '하르트', text: '시야를 공유한다. 전원, 위치를 보고하라.' },
  ],
  hart_p3: [
    { speaker: '하르트', text: '문을 잠근다. …후퇴는 패배가 아니다. 재정비다.' },
  ],
  hart_dead: [
    { speaker: '하르트', text: '…보고를, 마칩니다.' },
  ],
  sq01_deliver: [
    { speaker: '톨렌', text: '이게… 그 검날이군. 다음 강화가 부서질 뻔하면, 내가 대신 잡아주지. 한 번뿐이다.' },
  ],
  sq01_sell: [
    { speaker: '브로카', text: '기억 파편이라… 녹여 팔면 이 값이다. 나쁘지 않은 장사였다.' },
  ],
};
