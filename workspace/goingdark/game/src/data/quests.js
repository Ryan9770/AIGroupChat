// ============================================================================
// 퀘스트 데이터 정의 (src/data/quests.js)
// 조건 → 진행 이벤트 → 보상 → 완료 구조
// 12_roguelite_enhancement_plan.md §3.3 및 14_antigravity_production_brief.md 준수
// ============================================================================

export const QUEST_DEFS = {
  // --- 튜토리얼 의뢰 3개 (TQ-01, TQ-02, TQ-03) ---
  tq_first_step: {
    id: 'tq_first_step',
    category: 'tutorial',
    title: '[튜토리얼] 첫 번째 약탈',
    giver: 'broca',
    desc: '1층 주화 해안에서 상자 1개를 개방하고 무사히 게이트로 생환하십시오.',
    condition: { floorMin: 1 },
    progressCheck: (engine, session) => (session?.chestsOpened >= 1 && session?.extracted) || false,
    rewards: { gold: 50, accountXp: 30 },
  },
  tq_gaze_cleanse: {
    id: 'tq_gaze_cleanse',
    category: 'tutorial',
    title: '[튜토리얼] 빛을 두려워 말라',
    giver: 'serena',
    desc: '던전 안 빛의 제단을 사용하거나 성수병으로 시선을 1회 이상 정화하십시오.',
    condition: { prevQuest: 'tq_first_step' },
    progressCheck: (engine, session) => (session?.altarsUsed >= 1 || session?.holyWaterUsed >= 1) || false,
    rewards: { gold: 70, accountXp: 40, item: 'holyWater' },
  },
  tq_tide_escape: {
    id: 'tq_tide_escape',
    category: 'tutorial',
    title: '[튜토리얼] 조수가 차오르기 전에',
    giver: 'broca',
    desc: '심연 조수 2차(27분)가 도래하기 전에 18분 게이트 충전을 완료하고 생환하십시오.',
    condition: { prevQuest: 'tq_gaze_cleanse' },
    progressCheck: (engine, session) => (session?.extracted && (session?.timeElapsed ?? 0) < 27 * 60) || false,
    rewards: { gold: 100, accountXp: 60 },
  },

  // --- 메인 퀘스트 1~2막 ---
  sergeant_ring: {
    id: 'sergeant_ring',
    category: 'main',
    act: 1,
    title: '[1막] 검은 줄, 빨간 줄 (병장의 반지)',
    giver: 'broca',
    desc: '2층 골격 막사에서 해골 병장을 처치하고 삼켜진 병장의 반지를 회수하십시오.',
    condition: { floorMin: 2 },
    targetItem: 'sergeant_ring',
    progressCheck: (engine, session) => session?.inventory?.some(i => i.questItem === 'sergeant_ring' || i.id?.startsWith('sergeant_ring')) || false,
    rewards: { gold: 120, accountXp: 50 },
  },
  act2_sixty_one: {
    id: 'act2_sixty_one',
    category: 'main',
    act: 2,
    title: '[2막] 예순하나 (속삭이는 성물)',
    giver: 'serena',
    desc: '3층 전당에 도달하여 시선 61의 첫 속삭임을 경험하고 전당의 왕실 성물을 회수하십시오.',
    condition: { prevQuest: 'sergeant_ring', floorMin: 3 },
    targetItem: 'royal_relic_ch3',
    progressCheck: (engine, session) => (session?.maxGaze >= 61 && session?.inventory?.some(i => i.questItem === 'royal_relic_ch3' || i.id?.startsWith('royal_relic_ch3'))) || false,
    rewards: { gold: 180, accountXp: 80 },
  },

  // --- 사이드 퀘스트 SQ-01 & SQ-02 ---
  blade_fragment: {
    id: 'blade_fragment',
    category: 'side',
    code: 'SQ-01',
    title: '[SQ-01] 톨렌의 첫 주문',
    giver: 'tollen',
    desc: '2~3층 상자에서 왕실 검날을 회수하여 톨렌에게 인도하거나 브로카에게 즉시 환전하십시오.',
    condition: { floorMin: 2 },
    targetItem: 'blade_fragment',
    progressCheck: (engine, session) => session?.inventory?.some(i => i.questItem === 'blade_fragment' || i.id?.startsWith('blade_fragment')) || false,
    rewards: {
      choiceTollen: { destroyProtection: true, accountXp: 60 },
      choiceBroca: { gold: 180, accountXp: 30 },
    },
  },
  sq02_missing_watcher: {
    id: 'sq02_missing_watcher',
    category: 'side',
    code: 'SQ-02',
    title: '[SQ-02] 세레나의 실종 신고',
    giver: 'serena',
    desc: '3층 속삭이는 복도에서 시선 61 이상을 감수하고 실종된 감시자의 보고서를 회수하십시오.',
    condition: { floorMin: 3, prevQuest: 'sergeant_ring' },
    targetItem: 'watcher_report',
    progressCheck: (engine, session) => session?.inventory?.some(i => i.questItem === 'watcher_report' || i.id?.startsWith('watcher_report')) || false,
    rewards: {
      reportTurnIn: { holyWaterCount: 2, accountXp: 100 },
      willSold: { gold: 120, accountXp: 40 },
    },
  },
};
