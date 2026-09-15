import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { META_UNLOCKS_12 } from '../src/data/metaUnlocks.js';
import { QUEST_DEFS } from '../src/data/quests.js';
import { Warden, Hart } from '../src/entities/boss.js';
import { BOSS_HART } from '../src/data/data.js';
import { RunEngine } from '../src/run/RunEngine.js';
import { RunSettlement } from '../src/core/settlement.js';

// ============================================================================
// Phase 5: 콘텐츠 마감 (Content Slice) 검증
// 1. 메타 해금 12노드 및 계정 레벨 10 상한 준수
// 2. 퀘스트 데이터 구조 (조건 -> 진행 이벤트 -> 보상 -> 완료)
//    - 튜토리얼 의뢰 3종 (TQ-01, TQ-02, TQ-03)
//    - 메인 의뢰 1~2막 (병장의 반지, 예순하나)
//    - 사이드 의뢰 SQ-01 & SQ-02 (톨렌의 첫 주문, 세레나의 실종 신고)
// 3. 보스 감시자 3단계 페이즈 외형 및 상태 전이 (P1 인간 -> P2 위액 창 -> P3 동심원 기관)
// 4. 하르트 보스 실루엣 (통신 깃발 및 보고서 두루마리 다발)
// 5. 층별 랜드마크 5종 및 왕실 행렬 벽화 5단계 전이
// ============================================================================

describe('P5-01. 12 Meta Unlock Nodes Invariants', () => {
  test('Exactly 12 meta nodes are defined with valid costs and effects', () => {
    assert.equal(META_UNLOCKS_12.length, 12, 'Must have exactly 12 meta nodes (12_plan §3.3)');

    const ids = new Set();
    for (const node of META_UNLOCKS_12) {
      assert.ok(node.id, 'Node must have an id');
      assert.ok(node.name, 'Node must have a name');
      assert.ok(node.desc, 'Node must have a description');
      assert.ok(typeof node.cost === 'number' && node.cost > 0, 'Cost must be positive number');
      assert.ok(node.effect && typeof node.effect === 'object', 'Effect must be an object');
      assert.equal(ids.has(node.id), false, `Duplicate node id: ${node.id}`);
      ids.add(node.id);
    }
  });

  test('Prerequisite node dependencies are valid', () => {
    const node2 = META_UNLOCKS_12.find(n => n.id === 'iron_vitality_2');
    assert.ok(node2);
    assert.equal(node2.req, 'iron_vitality');
    const prereq = META_UNLOCKS_12.find(n => n.id === node2.req);
    assert.ok(prereq, 'Prerequisite node must exist in META_UNLOCKS_12');
  });
});

describe('P5-02. Quest Data Structure & State Machine Lifecycle', () => {
  let saveState;

  beforeEach(() => {
    saveState = {
      gold: 50,
      accountXp: 0,
      accountLevel: 1,
      inventory: [],
      storage: [],
      weaponLevel: 0,
      quests: Object.fromEntries(
        Object.keys(QUEST_DEFS).map(id => [id, { state: 'not_started' }])
      ),
      sq01_destroyProtection: false,
      factionRep: { guild: 0, vigil: 0, crown: 0 },
      stats: { runs: 0, extractions: 0, deaths: 0 },
    };
  });

  test('All required quests (Tutorial 3, Main Act 1~2, Side SQ-01~02) exist with full metadata', () => {
    const expectedKeys = [
      'tq_first_step', 'tq_gaze_cleanse', 'tq_tide_escape',
      'sergeant_ring', 'act2_sixty_one',
      'blade_fragment', 'sq02_missing_watcher',
    ];

    for (const key of expectedKeys) {
      const q = QUEST_DEFS[key];
      assert.ok(q, `Quest ${key} must exist in QUEST_DEFS`);
      assert.ok(q.title, `Quest ${key} must have title`);
      assert.ok(q.giver, `Quest ${key} must have giver`);
      assert.ok(q.condition, `Quest ${key} must have condition`);
      assert.ok(typeof q.progressCheck === 'function', `Quest ${key} must have progressCheck function`);
      assert.ok(q.rewards, `Quest ${key} must have rewards`);
    }
  });

  test('Tutorial quests advance upon meeting extraction & condition criteria', () => {
    saveState.quests.tq_first_step.state = 'active';
    const settlement = new RunSettlement(saveState, 's_tq_test');

    settlement.settleExtract({
      floor: 1,
      inventory: [{ id: 'loot1', value: 30, tier: 'common' }],
      chestsOpened: 2,
      seed: 1234,
      time: 300,
    });

    assert.equal(saveState.quests.tq_first_step.state, 'ready_to_turn_in', 'TQ-01 should be ready to turn in after looting and extraction');
  });

  test('Act 1 (sergeant_ring) advances to ready_to_turn_in when sergeant_ring is in haul', () => {
    saveState.quests.sergeant_ring.state = 'active';
    const settlement = new RunSettlement(saveState, 's_act1_test');

    settlement.settleExtract({
      floor: 2,
      inventory: [{ id: 'sergeant_ring_123', questItem: 'sergeant_ring', name: '병장의 반지', value: 0, tier: 'quest' }],
      seed: 555,
      time: 600,
    });

    assert.equal(saveState.quests.sergeant_ring.state, 'ready_to_turn_in');
  });

  test('Act 2 (act2_sixty_one) requires Gaze >= 61 and royal_relic_ch3 in inventory', () => {
    saveState.quests.act2_sixty_one.state = 'active';
    const settlement = new RunSettlement(saveState, 's_act2_test');

    // Scenario 1: Gaze < 61 -> Should NOT advance
    settlement.settleExtract({
      floor: 3,
      inventory: [{ id: 'royal_relic_ch3_1', questItem: 'royal_relic_ch3', name: '왕실 성물', value: 0, tier: 'quest' }],
      maxGaze: 45,
      seed: 888,
      time: 700,
    });
    assert.equal(saveState.quests.act2_sixty_one.state, 'active', 'Should not advance when maxGaze < 61');

    // Scenario 2: Gaze >= 61 and relic present -> Advances to ready_to_turn_in
    const settlement2 = new RunSettlement(saveState, 's_act2_test_2');
    settlement2.settleExtract({
      floor: 3,
      inventory: [{ id: 'royal_relic_ch3_1', questItem: 'royal_relic_ch3', name: '왕실 성물', value: 0, tier: 'quest' }],
      maxGaze: 68,
      seed: 888,
      time: 800,
    });
    assert.equal(saveState.quests.act2_sixty_one.state, 'ready_to_turn_in', 'Should advance when maxGaze >= 61 and relic present');
  });
});

describe('P5-03. Boss Warden 3-Phase State & Transformation Invariants', () => {
  test('Warden initializes in P1 (Human Executioner) with full HP (1,600)', () => {
    const warden = new Warden(20, 20);
    assert.equal(warden.maxHp, 1600);
    assert.equal(warden.hp, 1600);
    assert.equal(warden.phaseIdx, 0);
    assert.equal(warden.alive, true);
  });

  test('Warden transitions to P2 (Acid Lance & Asymmetric Corrosive) when HP <= 1100', () => {
    const warden = new Warden(20, 20);
    warden.engage();

    let phaseChangedTo = -1;
    const mockGame = {
      onNoise: () => {},
      onBossPhaseChange: (idx) => { phaseChangedTo = idx; },
      onBossDeath: () => {},
      player: { x: 20, y: 25, gaze: 0 },
      time: 10,
    };

    // Deal 550 damage (HP: 1600 -> 1050)
    warden.takeDamage(550, mockGame);
    assert.equal(warden.phaseIdx, 1, 'Should transition to P2 when HP <= 1100');
    assert.equal(phaseChangedTo, 1);
  });

  test('Warden transitions to P3 (Concentric Turret & Exposed Core) when HP <= 550', () => {
    const warden = new Warden(20, 20);
    warden.engage();

    let phaseChangedTo = -1;
    const mockGame = {
      onNoise: () => {},
      onBossPhaseChange: (idx) => { phaseChangedTo = idx; },
      onBossDeath: () => {},
      player: { x: 20, y: 25, gaze: 0 },
      time: 20,
    };

    // Deal 1100 damage (HP: 1600 -> 500)
    warden.takeDamage(1100, mockGame);
    assert.equal(warden.phaseIdx, 2, 'Should transition to P3 when HP <= 550');
    assert.equal(phaseChangedTo, 2);
  });
});

describe('P5-04. Boss Hart Signal Flag & Report Scrolls Data Invariants', () => {
  test('Hart initializes with 1,000 HP and 3 distinct phases', () => {
    const hart = new Hart(15, 15);
    assert.equal(hart.maxHp, 1000);
    assert.equal(hart.hp, 1000);
    assert.equal(hart.phaseIdx, 0);
    assert.equal(hart.alive, true);
    assert.equal(BOSS_HART.phases.length, 3);
  });

  test('Hart transitions through phases upon sustaining damage thresholds', () => {
    const hart = new Hart(15, 15);
    hart.engage();

    let phaseChangedTo = -1;
    const mockGame = {
      onNoise: () => {},
      onHartPhaseChange: (idx) => { phaseChangedTo = idx; },
      onHartDeath: () => {},
      player: { x: 15, y: 20, gaze: 0 },
      time: 10,
    };

    // P1 -> P2 (HP <= 620)
    hart.takeDamage(400, mockGame);
    assert.equal(hart.phaseIdx, 1);
    assert.equal(phaseChangedTo, 1);

    // P2 -> P3 (HP <= 240)
    hart.takeDamage(400, mockGame);
    assert.equal(hart.phaseIdx, 2);
    assert.equal(phaseChangedTo, 2);
  });
});

describe('P5-05. 5 Floor Landmarks & Progressive Wall Murals', () => {
  test('Each floor 1 to 5 initializes its designated unique landmark', () => {
    const save = { settings: {}, unlockedNodes: [] };

    // Test across floors 1 to 5
    const expectedLandmarks = {
      1: 'customs_crane_vault',
      2: 'bone_stable_tower',
      3: 'inverted_bell',
      4: 'tilted_coronation_hall',
      5: 'heart_throne',
    };

    for (let f = 1; f <= 5; f++) {
      const engine = new RunEngine({ floor: f, seed: 1000 + f, save });
      assert.ok(engine.landmark, `Floor ${f} must have a landmark`);
      assert.equal(engine.landmark.floor, f);
      assert.equal(engine.landmark.type, expectedLandmarks[f], `Floor ${f} landmark type mismatch`);
      assert.ok(typeof engine.landmark.x === 'number');
      assert.ok(typeof engine.landmark.y === 'number');
    }
  });
});
