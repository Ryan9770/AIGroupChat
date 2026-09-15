import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STATE_V2, getLastSaveFailure, clearSaveFailure } from '../src/systems/save.js';
import { RunSettlement } from '../src/core/settlement.js';
import { HubScene } from '../src/scenes/hub.js';
import { DungeonScene } from '../src/scenes/dungeon.js';
import { getCustomsRate } from '../src/core/economy.js';
import { isSaveFailureModalOpen } from '../src/systems/ui.js';
import { FIXED_STEP } from '../src/core/constants.js';

// Mock localStorage in Node
const mockStorage = new Map();
let shouldThrow = false;

globalThis.localStorage = {
  getItem: (k) => mockStorage.get(k) ?? null,
  setItem: (k, v) => {
    if (shouldThrow) {
      throw new Error('QuotaExceededError: storage is full');
    }
    mockStorage.set(k, String(v));
  },
  removeItem: (k) => mockStorage.delete(k),
  clear: () => mockStorage.clear(),
};

describe('P0-01. Atomic Commit & Save Failure Recovery Across 7 Paths', () => {
  beforeEach(() => {
    mockStorage.clear();
    shouldThrow = false;
    clearSaveFailure();
  });

  afterEach(() => {
    shouldThrow = false;
    clearSaveFailure();
  });

  test('Path 1: Extract settlement - save failure results in 0 state change and error UI', () => {
    const save = structuredClone(DEFAULT_STATE_V2);
    save.gold = 100;
    save.stats.runs = 2;
    save.stats.extractions = 1;
    save.inventory = [{ id: 'loot_1', tier: 'rare', name: '왕실 인장', value: 200, slot: 1 }];

    const playerInv = [{ id: 'loot_1', tier: 'rare', name: '왕실 인장', value: 200, slot: 1 }];
    const settlement = new RunSettlement(save, 'sess_test_1');

    shouldThrow = true;
    const result = settlement.settleExtract({
      floor: 1,
      inventory: playerInv,
      seed: 12345,
      time: 100,
    });

    assert.equal(result.success, false);
    assert.equal(save.stats.extractions, 1, 'Extractions count must not increment on save failure');
    assert.equal(save.stats.runs, 2, 'Runs count must not increment on save failure');
    assert.equal(save.gold, 100, 'Gold must remain unchanged');
    assert.equal(save.inventory.length, 1);
    assert.ok(getLastSaveFailure(), 'Last save failure must be recorded');
    assert.ok(isSaveFailureModalOpen(), 'Save failure modal must be open');
  });

  test('Path 2: Death settlement - save failure results in 0 state change and inventory preserved', () => {
    const save = structuredClone(DEFAULT_STATE_V2);
    save.gold = 100;
    save.stats.deaths = 1;
    save.inventory = [{ id: 'loot_2', tier: 'uncommon', name: '은제 촛대', value: 80, slot: 1 }];

    const playerInv = [{ id: 'loot_2', tier: 'uncommon', name: '은제 촛대', value: 80, slot: 1 }];
    const settlement = new RunSettlement(save, 'sess_test_2');

    shouldThrow = true;
    const result = settlement.settleDeath({
      floor: 2,
      cause: 'mob',
      inventory: playerInv,
      weaponLevel: 0,
      seed: 12345,
      time: 120,
    });

    assert.equal(result.success, false);
    assert.equal(save.stats.deaths, 1, 'Deaths count must not increment');
    assert.equal(save.inventory.length, 1, 'Save inventory must not be cleared on save failure');
    assert.equal(playerInv.length, 1, 'Player inventory must not be cleared on save failure');
    assert.ok(getLastSaveFailure());
    assert.ok(isSaveFailureModalOpen());
  });

  test('Path 3: Shop Buy - save failure results in 0 gold deducted and 0 item added', () => {
    const save = structuredClone(DEFAULT_STATE_V2);
    save.gold = 100;
    save.inventory = [];

    const hub = new HubScene(null, null, save, {});
    shouldThrow = true;
    hub.buyItem('holyWater');

    assert.equal(save.gold, 100, 'Gold must not be deducted');
    assert.equal(save.inventory.length, 0, 'Item must not be added to inventory');
    assert.ok(getLastSaveFailure());
    assert.ok(isSaveFailureModalOpen());
  });

  test('Path 4: Sell Item (Customs Exchange) - save failure results in 0 gold added and item retained', () => {
    const save = structuredClone(DEFAULT_STATE_V2);
    save.gold = 50;
    save.inventory = [{ id: 'loot_sell', tier: 'rare', name: '왕실 인장', value: 100, slot: 1 }];

    const hub = new HubScene(null, null, save, {});
    shouldThrow = true;
    hub.sellItem('loot_sell');

    assert.equal(save.gold, 50, 'Gold must not increase');
    assert.equal(save.inventory.length, 1, 'Item must remain in inventory');
    assert.ok(getLastSaveFailure());
    assert.ok(isSaveFailureModalOpen());
  });

  test('Path 5: Weapon Upgrade - save failure results in 0 gold deducted and 0 weapon level change', () => {
    const save = structuredClone(DEFAULT_STATE_V2);
    save.gold = 200;
    save.weaponLevel = 0;

    const hub = new HubScene(null, null, save, {});
    shouldThrow = true;
    hub.upgrade();

    assert.equal(save.gold, 200, 'Upgrade cost must not be deducted');
    assert.equal(save.weaponLevel, 0, 'Weapon level must not change');
    assert.ok(getLastSaveFailure());
    assert.ok(isSaveFailureModalOpen());
  });

  test('Path 6: Meta Unlock - save failure results in 0 account XP deducted and node not unlocked', () => {
    const save = structuredClone(DEFAULT_STATE_V2);
    save.accountXp = 300;
    save.unlockedNodes = [];

    const hub = new HubScene(null, null, save, {});
    shouldThrow = true;
    hub.unlockMetaNode('iron_vitality');

    assert.equal(save.accountXp, 300, 'Account XP must not be spent');
    assert.deepEqual(save.unlockedNodes, [], 'Unlocked nodes must remain empty');
    assert.ok(getLastSaveFailure());
    assert.ok(isSaveFailureModalOpen());
  });

  test('Path 7: Quest Turn In - save failure results in 0 quest state change and item retained', () => {
    const save = structuredClone(DEFAULT_STATE_V2);
    save.gold = 0;
    save.quests.sergeant_ring = { state: 'ready_to_turn_in' };
    save.inventory = [{ id: 'q_ring', tier: 'quest', name: '병장의 반지', questItem: 'sergeant_ring', slot: 1 }];

    const hub = new HubScene(null, null, save, {});
    shouldThrow = true;
    hub.turnInQuest('sergeant_ring');

    assert.equal(save.quests.sergeant_ring.state, 'ready_to_turn_in', 'Quest state must not advance to complete');
    assert.equal(save.gold, 0, 'Quest reward gold must not be awarded');
    assert.equal(save.inventory.length, 1, 'Quest item must remain in inventory');
    assert.ok(getLastSaveFailure());
    assert.ok(isSaveFailureModalOpen());
  });
});

describe('P0-02. Customs Rate Policy Unification', () => {
  beforeEach(() => {
    mockStorage.clear();
    shouldThrow = false;
  });

  test('customs_favor locked: extraction predicted payout matches hub actual payout (10% rate)', () => {
    const save = structuredClone(DEFAULT_STATE_V2);
    save.unlockedNodes = []; // locked

    const rate = getCustomsRate(save);
    assert.equal(rate, 0.10, 'Default rate should be 10%');

    const item = { id: 'loot_test', tier: 'rare', name: '유물 조각', value: 300, slot: 2 };
    save.inventory = [item];

    const settlement = new RunSettlement(save, 's_rate_1');
    const extractSummary = settlement.settleExtract({
      floor: 1,
      inventory: [item],
      seed: 999,
      time: 50,
    });

    assert.equal(extractSummary.customsRate, 0.10);
    assert.equal(extractSummary.customs, 30);
    assert.equal(extractSummary.payout, 270);

    // Now sell in hub and compare
    const initialGold = save.gold;
    const hub = new HubScene(null, null, save, {});
    hub.sellItem(item.id);

    const actualPayout = save.gold - initialGold;
    assert.equal(actualPayout, extractSummary.payout, 'Hub actual payout must equal settlement expected payout');
    assert.equal(actualPayout, 270);
  });

  test('customs_favor unlocked: extraction predicted payout matches hub actual payout (8% rate)', () => {
    const save = structuredClone(DEFAULT_STATE_V2);
    save.unlockedNodes = ['customs_favor']; // unlocked

    const rate = getCustomsRate(save);
    assert.equal(rate, 0.08, 'Customs favor rate should be 8%');

    const item = { id: 'loot_test_2', tier: 'rare', name: '왕실 금괴', value: 500, slot: 2 };
    save.inventory = [item];

    const settlement = new RunSettlement(save, 's_rate_2');
    const extractSummary = settlement.settleExtract({
      floor: 3,
      inventory: [item],
      seed: 999,
      time: 150,
    });

    assert.equal(extractSummary.customsRate, 0.08);
    assert.equal(extractSummary.customs, 40);
    assert.equal(extractSummary.payout, 460);

    // Now sell in hub and compare
    const initialGold = save.gold;
    const hub = new HubScene(null, null, save, {});
    hub.sellItem(item.id);

    const actualPayout = save.gold - initialGold;
    assert.equal(actualPayout, extractSummary.payout, 'Hub actual payout must equal settlement expected payout with favor');
    assert.equal(actualPayout, 460);
  });
});

describe('P0-03. Simulation Determinism & Snapshot Hash', () => {
  test('10 headless runs with same seed, rulesVersion, and input frame logs produce identical snapshot hashes', () => {
    const fixedSeed = 888777;
    const hashes = [];

    for (let run = 0; run < 10; run++) {
      const save = structuredClone(DEFAULT_STATE_V2);
      const scene = new DungeonScene(null, null, save, {
        seed: fixedSeed,
        speedMultiplier: 1,
      });

      // Execute 60 fixed step simulation ticks with scripted inputs
      for (let frame = 0; frame < 60; frame++) {
        scene.input.moveX = (frame % 20 < 10) ? 1 : -1;
        scene.input.moveY = (frame % 15 < 7) ? 1 : 0;
        if (frame === 30) {
          scene.player.hp = Math.max(1, scene.player.hp - 10);
        }
        scene.update(FIXED_STEP);
      }

      const hash = scene.snapshotHash();
      hashes.push(hash);
      scene.destroy();
    }

    assert.equal(hashes.length, 10);
    const firstHash = hashes[0];
    for (let i = 1; i < 10; i++) {
      assert.equal(hashes[i], firstHash, `Run ${i} snapshot hash (${hashes[i]}) must match Run 0 (${firstHash})`);
    }
  });
});
