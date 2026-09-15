import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { RunSettlement } from '../src/core/settlement.js';

describe('G1 & G4. Run Settlement Idempotency & Lifecycle', () => {
  let saveState;

  beforeEach(() => {
    saveState = {
      gold: 100,
      inventory: [{ id: 'loot_1', tier: 'rare', name: '유물 조각', value: 300, slot: 2 }],
      storage: [{ id: 'stored_item', tier: 'common', name: '은화 더미', value: 20, slot: 1 }],
      weaponLevel: 2,
      quests: {
        sergeant_ring: { state: 'active' },
        blade_fragment: { state: 'active' },
      },
      stats: { runs: 2, extractions: 1, deaths: 1 },
      deathHistory: [],
      deathStreak: 0,
    };
  });

  test('settleExtract is idempotent: calling multiple times produces single save update', () => {
    const settlement = new RunSettlement(saveState, 's_extract_test');

    const result1 = settlement.settleExtract({
      floor: 3,
      inventory: saveState.inventory,
      seed: 777,
      time: 600,
    });

    assert.equal(saveState.stats.runs, 3);
    assert.equal(saveState.stats.extractions, 2);
    assert.equal(saveState.inventory.length, 1);
    assert.equal(saveState.gold, 100, 'Gold must not change directly on extract');

    // Second call to settleExtract must be a no-op
    const result2 = settlement.settleExtract({
      floor: 3,
      inventory: saveState.inventory,
      seed: 777,
      time: 600,
    });

    assert.equal(saveState.stats.runs, 3, 'Runs count must not increment again');
    assert.equal(saveState.stats.extractions, 2, 'Extractions count must not increment again');
    assert.deepEqual(result1, result2);
  });

  test('settleDeath clears inventory but preserves storage and weapon level', () => {
    const settlement = new RunSettlement(saveState, 's_death_test');

    settlement.settleDeath({
      floor: 4,
      cause: 'mob',
      inventory: saveState.inventory,
      weaponLevel: saveState.weaponLevel,
      seed: 888,
      time: 450,
    });

    // Run inventory is lost
    assert.equal(saveState.inventory.length, 0);

    // Storage and permanent weapon level are preserved
    assert.equal(saveState.storage.length, 1);
    assert.equal(saveState.storage[0].id, 'stored_item');
    assert.equal(saveState.weaponLevel, 2);

    // Stats updated
    assert.equal(saveState.stats.runs, 3);
    assert.equal(saveState.stats.deaths, 2);
    assert.equal(saveState.deathStreak, 1);
    assert.equal(saveState.deathHistory.length, 1);
    assert.equal(saveState.deathHistory[0].cause, 'mob');

    // Calling settleDeath again is idempotent
    settlement.settleDeath({
      floor: 4,
      cause: 'mob',
      inventory: saveState.inventory,
      weaponLevel: saveState.weaponLevel,
      seed: 888,
      time: 450,
    });

    assert.equal(saveState.stats.runs, 3);
    assert.equal(saveState.stats.deaths, 2);
  });
});
