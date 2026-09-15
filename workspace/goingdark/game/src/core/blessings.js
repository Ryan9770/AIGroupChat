// ============================================================================
// 런 내 빌드 선택 시스템 (18개 축복: 집행 / 생존 / 등불)
// 최소 6개 이상의 명확한 대가(Trade-off) 포함
// ============================================================================

export const BLESSING_CATEGORIES = {
  execution: { id: 'execution', name: '집행', color: '#c74d4d', desc: '공격력 및 치명타, 공격 연계 강화' },
  survival: { id: 'survival', name: '생존', color: '#4d8fc7', desc: '가드, 회피 무적, 최대 체력 및 회복력 강화' },
  lantern: { id: 'lantern', name: '등불', color: '#d8b45c', desc: '성수 등불, 시선 억제, 소음 감소 및 은밀함' },
};

export const BLESSINGS = [
  // ---------- 집행 (Execution) ----------
  {
    id: 'heavy_strike',
    name: '묵직한 일격',
    category: 'execution',
    tier: 'common',
    maxStacks: 3,
    tradeOff: true,
    desc: '근접 피해 +25%, 공격 쿨다운 +15%',
    positive: '근접 피해 +25%',
    penalty: '공격 쿨다운 +15%',
    apply(player) {
      player.dmgMul = (player.dmgMul ?? 1) * 1.25;
      player.atkCdMul = (player.atkCdMul ?? 1) * 1.15;
    },
  },
  {
    id: 'frenzy_blade',
    name: '광란의 칼날',
    category: 'execution',
    tier: 'uncommon',
    maxStacks: 2,
    tradeOff: false,
    desc: '적 처치 시 4초간 공격속도 +30%',
    apply(player) {
      player.onKillAtkSpeedBuff = true;
    },
  },
  {
    id: 'glass_edge',
    name: '유리 칼날',
    category: 'execution',
    tier: 'rare',
    maxStacks: 1,
    tradeOff: true,
    desc: '근접 피해 +45%, 최대 HP -20',
    positive: '근접 피해 +45%',
    penalty: '최대 HP -20',
    apply(player) {
      player.dmgMul = (player.dmgMul ?? 1) * 1.45;
      player.maxHp = Math.max(20, player.maxHp - 20);
      player.hp = Math.min(player.hp, player.maxHp);
    },
  },
  {
    id: 'bleed_wound',
    name: '출혈상',
    category: 'execution',
    tier: 'common',
    maxStacks: 2,
    tradeOff: false,
    desc: '공격 적중 시 3초간 출혈 (초당 4 피해)',
    apply(player) {
      player.bleedDps = (player.bleedDps ?? 0) + 4;
      player.bleedDur = 3;
    },
  },
  {
    id: 'reaper_vigor',
    name: '사신의 갈증',
    category: 'execution',
    tier: 'uncommon',
    maxStacks: 2,
    tradeOff: true,
    desc: '적 처치 시 스태미나 30 회복, 전력질주 스태미나 소모 +25%',
    positive: '적 처치 시 스태미나 30 회복',
    penalty: '전력질주 스태미나 소모 +25%',
    apply(player) {
      player.onKillStamina = (player.onKillStamina ?? 0) + 30;
      player.sprintDrainMul = (player.sprintDrainMul ?? 1) * 1.25;
    },
  },
  {
    id: 'fatal_thrust',
    name: '치명적 찌르기',
    category: 'execution',
    tier: 'rare',
    maxStacks: 2,
    tradeOff: false,
    desc: '치명타 확률 20% (피해 1.8배)',
    apply(player) {
      player.critChance = (player.critChance ?? 0) + 0.20;
      player.critMul = 1.8;
    },
  },

  // ---------- 생존 (Survival) ----------
  {
    id: 'iron_bulwark',
    name: '철벽 방진',
    category: 'survival',
    tier: 'common',
    maxStacks: 2,
    tradeOff: true,
    desc: '가드 피해 감소율 70% → 85%, 가드 이동속도 페널티 -20%p 추가',
    positive: '가드 피해 감소율 70% → 85%',
    penalty: '가드 이동속도 페널티 -20%p 추가',
    apply(player) {
      player.guardReductionOverride = 0.85;
      player.guardSpeedPenalty = (player.guardSpeedPenalty ?? 0) + 0.20;
    },
  },
  {
    id: 'swift_roll',
    name: '유연한 도약',
    category: 'survival',
    tier: 'common',
    maxStacks: 2,
    tradeOff: false,
    desc: '구르기 무적 시간 +0.15초 (0.30s → 0.45s)',
    apply(player) {
      player.rollInvulnBonus = (player.rollInvulnBonus ?? 0) + 0.15;
    },
  },
  {
    id: 'vitality_surge',
    name: '거인의 활력',
    category: 'survival',
    tier: 'uncommon',
    maxStacks: 2,
    tradeOff: true,
    desc: '최대 HP +35, 이동속도 -8%',
    positive: '최대 HP +35',
    penalty: '이동속도 -8%',
    apply(player) {
      player.maxHp += 35;
      player.hp += 35;
      player.moveSpeedMul = (player.moveSpeedMul ?? 1) * 0.92;
    },
  },
  {
    id: 'second_breath',
    name: '재기의 숨결',
    category: 'survival',
    tier: 'rare',
    maxStacks: 1,
    tradeOff: false,
    desc: 'HP 25% 이하 시 즉시 HP 30 회복 (런당 1회 한정)',
    apply(player) {
      player.hasSecondBreath = true;
      player.secondBreathUsed = false;
    },
  },
  {
    id: 'enduring_stance',
    name: '인내의 자세',
    category: 'survival',
    tier: 'common',
    maxStacks: 2,
    tradeOff: false,
    desc: '스태미나 회복 속도 +35%',
    apply(player) {
      player.staminaRegenMul = (player.staminaRegenMul ?? 1) * 1.35;
    },
  },
  {
    id: 'blood_tithe',
    name: '피의 십일조',
    category: 'survival',
    tier: 'uncommon',
    maxStacks: 2,
    tradeOff: true,
    desc: '적 처치 시 HP 6 회복, 최대 스태미나 -15',
    positive: '적 처치 시 HP 6 회복',
    penalty: '최대 스태미나 -15',
    apply(player) {
      player.onKillHeal = (player.onKillHeal ?? 0) + 6;
      player.maxStamina = Math.max(30, player.maxStamina - 15);
      player.stamina = Math.min(player.stamina, player.maxStamina);
    },
  },

  // ---------- 등불 (Lantern) ----------
  {
    id: 'extended_lamp',
    name: '장수명 심지',
    category: 'lantern',
    tier: 'common',
    maxStacks: 2,
    tradeOff: false,
    desc: '성수 등불 지속시간 +2초 (3s → 5s)',
    apply(player) {
      player.lampDurBonus = (player.lampDurBonus ?? 0) + 2;
    },
  },
  {
    id: 'hushed_steps',
    name: '침묵의 보폭',
    category: 'lantern',
    tier: 'common',
    maxStacks: 2,
    tradeOff: false,
    desc: '이동 및 구르기 소음 반경 -40%',
    apply(player) {
      player.noiseRadiusMul = (player.noiseRadiusMul ?? 1) * 0.60;
    },
  },
  {
    id: 'gaze_bargain',
    name: '시선과의 거래',
    category: 'lantern',
    tier: 'rare',
    maxStacks: 1,
    tradeOff: true,
    desc: '근접 피해 +35%, 시선 자연 상승 속도 +25%',
    positive: '근접 피해 +35%',
    penalty: '시선 자연 상승 속도 +25%',
    apply(player) {
      player.dmgMul = (player.dmgMul ?? 1) * 1.35;
      player.gazeRateMul = (player.gazeRateMul ?? 1) * 1.25;
    },
  },
  {
    id: 'calm_aura',
    name: '정화의 잔광',
    category: 'lantern',
    tier: 'uncommon',
    maxStacks: 2,
    tradeOff: false,
    desc: '시선 자연 상승 속도 -30%',
    apply(player) {
      player.gazeRateMul = (player.gazeRateMul ?? 1) * 0.70;
    },
  },
  {
    id: 'stunning_flash',
    name: '눈부신 섬광',
    category: 'lantern',
    tier: 'uncommon',
    maxStacks: 1,
    tradeOff: false,
    desc: '등불(Q) 발동 시 주변 6m 적 2.0초간 경직',
    apply(player) {
      player.lampStunRadius = 6;
      player.lampStunDur = 2.0;
    },
  },
  {
    id: 'abyssal_shroud',
    name: '심연의 장막',
    category: 'lantern',
    tier: 'rare',
    maxStacks: 1,
    tradeOff: true,
    desc: '시선 상승 속도 -20%, 치유 물약/붕대 효과 -20%',
    positive: '시선 상승 속도 -20%',
    penalty: '치유 물약/붕대 효과 -20%',
    apply(player) {
      player.gazeRateMul = (player.gazeRateMul ?? 1) * 0.80;
      player.healMul = (player.healMul ?? 1) * 0.80;
    },
  },
];

export function getBlessingById(id) {
  return BLESSINGS.find(b => b.id === id) ?? null;
}

export function rollBlessingOptions(rng, currentBlessings = {}, count = 3) {
  const available = BLESSINGS.filter(b => {
    const stacks = currentBlessings[b.id] ?? 0;
    return stacks < (b.maxStacks ?? 1);
  });

  if (available.length <= count) return available;

  const shuffled = rng.shuffle ? rng.shuffle(available) : [...available].sort(() => rng.next() - 0.5);
  return shuffled.slice(0, count);
}
