import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SeededRng, hashString } from '../src/core/rng.js';

describe('G2. SeededRng & Determinism', () => {
  test('Same seed produces identical random sequences', () => {
    const rng1 = new SeededRng(12345);
    const rng2 = new SeededRng(12345);

    const seq1 = Array.from({ length: 20 }, () => rng1.map.next());
    const seq2 = Array.from({ length: 20 }, () => rng2.map.next());

    assert.deepEqual(seq1, seq2);
  });

  test('Different seeds produce different sequences', () => {
    const rng1 = new SeededRng(1111);
    const rng2 = new SeededRng(2222);

    const v1 = rng1.map.next();
    const v2 = rng2.map.next();

    assert.notEqual(v1, v2);
  });

  test('Named streams are isolated and independent', () => {
    const rngA = new SeededRng(9999);
    const rngB = new SeededRng(9999);

    // rngA performs 100 combat rolls
    for (let i = 0; i < 100; i++) {
      rngA.combat.next();
    }

    // rngA's map and loot streams should still exactly match rngB's map and loot streams
    const mapA = Array.from({ length: 10 }, () => rngA.map.next());
    const mapB = Array.from({ length: 10 }, () => rngB.map.next());
    assert.deepEqual(mapA, mapB);

    const lootA = Array.from({ length: 10 }, () => rngA.loot.next());
    const lootB = Array.from({ length: 10 }, () => rngB.loot.next());
    assert.deepEqual(lootA, lootB);
  });

  test('hashString is consistent and deterministic', () => {
    assert.equal(hashString('test_seed_42'), hashString('test_seed_42'));
    assert.notEqual(hashString('seed_A'), hashString('seed_B'));
  });
});
