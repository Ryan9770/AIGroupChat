import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAndSanitize,
  SAVE_KEY_V2,
  SAVE_KEY_V1,
  SAVE_KEY_BACKUP,
  loadState,
} from '../src/systems/save.js';

// Mock localStorage in Node environment
const mockStorage = new Map();
globalThis.localStorage = {
  getItem: (k) => mockStorage.get(k) ?? null,
  setItem: (k, v) => mockStorage.set(k, String(v)),
  removeItem: (k) => mockStorage.delete(k),
  clear: () => mockStorage.clear(),
};

describe('G4. Save v2 Schema & Migration', () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  test('loadState with empty storage returns default v2 state', () => {
    const state = loadState();
    assert.equal(state.version, 2);
    assert.equal(state.gold, 60);
    assert.equal(state.weaponLevel, 0);
    assert.deepEqual(state.inventory, []);
    assert.deepEqual(state.storage, []);
    assert.equal(state.accountLevel, 1);
  });

  test('v1 save is properly migrated to v2 with backup preserved', () => {
    const v1Data = {
      gold: 450,
      inventory: [{ id: 'loot_1', tier: 'rare', name: '유물 조각', value: 300, slot: 2 }],
      storage: [{ id: 'store_1', tier: 'uncommon', name: '강화 부속', value: 80, slot: 1 }],
      weaponLevel: 3,
      quests: {
        sergeant_ring: { state: 'ready_to_turn_in' },
        blade_fragment: { state: 'active' },
      },
      sq01_destroyProtection: true,
      factionRep: { guild: 10, vigil: 2, crown: 0 },
      deathHistory: [{ session_id: 's1', floor: 2, cause: 'mob' }],
      deathStreak: 1,
      stats: { runs: 5, extractions: 3, deaths: 2 },
    };

    mockStorage.set(SAVE_KEY_V1, JSON.stringify(v1Data));

    const loaded = loadState();

    // 1. Check v2 state
    assert.equal(loaded.version, 2);
    assert.equal(loaded.gold, 450);
    assert.equal(loaded.weaponLevel, 3);
    assert.equal(loaded.inventory.length, 1);
    assert.equal(loaded.inventory[0].name, '유물 조각');
    assert.equal(loaded.storage.length, 1);
    assert.equal(loaded.quests.sergeant_ring.state, 'ready_to_turn_in');
    assert.equal(loaded.sq01_destroyProtection, true);
    assert.equal(loaded.factionRep.guild, 10);
    assert.equal(loaded.stats.extractions, 3);

    // 2. Check backup was saved
    assert.ok(mockStorage.has(SAVE_KEY_BACKUP));
    assert.equal(mockStorage.get(SAVE_KEY_BACKUP), JSON.stringify(v1Data));

    // 3. Check v2 key was saved
    assert.ok(mockStorage.has(SAVE_KEY_V2));
  });

  test('Corrupted JSON safely falls back to default without throwing', () => {
    mockStorage.set(SAVE_KEY_V2, '{ invalid_json !!! ');

    let state;
    assert.doesNotThrow(() => {
      state = loadState();
    });

    assert.equal(state.version, 2);
    assert.equal(state.gold, 60);
  });

  test('validateAndSanitize repairs missing or invalid fields', () => {
    const invalidData = {
      gold: -999, // invalid negative gold -> falls back to default 60
      inventory: 'not an array', // invalid -> falls back to []
      weaponLevel: 999, // exceeds max 5 -> clamped to 5
      stats: null, // invalid -> falls back to default stats
    };

    const sanitized = validateAndSanitize(invalidData);
    assert.equal(sanitized.gold, 60);
    assert.deepEqual(sanitized.inventory, []);
    assert.equal(sanitized.weaponLevel, 5);
    assert.deepEqual(sanitized.stats, { runs: 0, extractions: 0, deaths: 0 });
  });
});
