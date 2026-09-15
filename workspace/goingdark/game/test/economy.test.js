import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CONSUMABLES } from '../src/data/data.js';
import { addItem } from '../src/systems/inventory.js';
import { RunSettlement } from '../src/core/settlement.js';
import { HubScene } from '../src/scenes/hub.js';

describe('G1 & P1-03. Economy & Consumables Integration Tests (HubScene / RunEngine APIs)', () => {
  let saveState;

  beforeEach(() => {
    saveState = {
      gold: 200,
      accountXp: 0,
      inventory: [],
      storage: [],
      weaponLevel: 0,
      stats: { runs: 0, extractions: 0, deaths: 0 },
      deathHistory: [],
      deathStreak: 0,
      quests: { sergeant_ring: { state: 'not_started' } },
      unlockedNodes: [],
    };
  });

  test('P0 / P1-03: HubScene.buyItem correctly purchases consumables and retains effect/amount/id in saveState', () => {
    const hub = new HubScene(null, null, saveState);

    // Buy holy water (cost 40G)
    const initialGold = saveState.gold;
    hub.buyItem('holyWater');

    assert.equal(saveState.gold, initialGold - CONSUMABLES.holyWater.price);
    assert.equal(saveState.inventory.length, 1);

    const hwItem = saveState.inventory[0];
    assert.equal(hwItem.consumableId, 'holyWater');
    assert.equal(hwItem.effect, 'gaze');
    assert.equal(hwItem.amount, 30);

    // Buy potion (cost 35G)
    hub.buyItem('potion');
    assert.equal(saveState.gold, initialGold - CONSUMABLES.holyWater.price - CONSUMABLES.potion.price);
    assert.equal(saveState.inventory.length, 2);

    const potionItem = saveState.inventory[1];
    assert.equal(potionItem.consumableId, 'potion');
    assert.equal(potionItem.effect, 'heal');
    assert.equal(potionItem.amount, 40);
  });

  test('P0: Extracting with 100G loot preserves items and does NOT change gold directly', () => {
    const loot = { id: 'loot_100', tier: 'uncommon', name: '은제 촛대', value: 100, slot: 1 };
    addItem(saveState.inventory, loot);

    const initialGold = saveState.gold;
    const settlement = new RunSettlement(saveState, 's_test');

    const result = settlement.settleExtract({
      floor: 1,
      inventory: saveState.inventory,
      seed: 42,
      time: 300,
    });

    // Gold must not change on extract
    assert.equal(saveState.gold, initialGold, 'Gold must remain identical upon extraction');
    // Inventory items must be preserved
    assert.equal(saveState.inventory.length, 1);
    assert.equal(saveState.inventory[0].id, 'loot_100');

    // Expected values calculated in report
    assert.equal(result.grossValue, 100);
    assert.equal(result.customs, 10);
    assert.equal(result.payout, 90);
  });

  test('P0 / P1-03: HubScene.sellItem deducts unified customs fee and removes item (no double payout)', () => {
    const loot = { id: 'loot_100', tier: 'uncommon', name: '은제 촛대', value: 100, slot: 1 };
    addItem(saveState.inventory, loot);
    const initialGold = saveState.gold;

    const hub = new HubScene(null, null, saveState);

    // Call actual HubScene.sellItem API
    hub.sellItem('loot_100');

    // 10% customs fee = 10G, payout = 90G
    assert.equal(saveState.gold, initialGold + 90);
    assert.equal(saveState.inventory.length, 0, 'Item must be removed from inventory');

    // Attempting to sell again must not duplicate payout
    hub.sellItem('loot_100');
    assert.equal(saveState.gold, initialGold + 90, 'Selling non-existent item must not grant gold');
  });

  test('P1-03: HubScene.sellItem respects customs_favor meta unlock (8% fee)', () => {
    saveState.unlockedNodes.push('customs_favor');
    const loot = { id: 'loot_100', tier: 'uncommon', name: '은제 촛대', value: 100, slot: 1 };
    addItem(saveState.inventory, loot);
    const initialGold = saveState.gold;

    const hub = new HubScene(null, null, saveState);
    hub.sellItem('loot_100');

    // 8% customs fee = 8G, payout = 92G
    assert.equal(saveState.gold, initialGold + 92);
    assert.equal(saveState.inventory.length, 0);
  });
});
