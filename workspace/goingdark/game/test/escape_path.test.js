import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RunEngine } from '../src/run/RunEngine.js';
import { DEFAULT_STATE_V2 } from '../src/systems/save.js';
import { FIXED_STEP } from '../src/core/constants.js';

describe('G1 & P1-03. Escape Path Lifecycle Across Floors 1~5 (RunEngine Real API)', () => {
  test('Floor 1: Guaranteed checkpoint gate allows full charge and successful extraction', () => {
    const save = structuredClone(DEFAULT_STATE_V2);
    let result = null;
    const engine = new RunEngine(save, {
      seed: 112233,
      onEnd: (res) => { result = res; },
    });

    assert.equal(engine.floorNum, 1);
    const gate = engine.gates[0];
    assert.ok(gate, 'Floor 1 must spawn a checkpoint gate');

    // Move player to gate
    engine.player.x = gate.x;
    engine.player.y = gate.y;
    engine.time = 60; // 1F gate opens at 60s

    // Charge gate with KeyF
    for (let i = 0; i < 500 && !engine.ended; i++) {
      engine.update(FIXED_STEP, {
        moveX: 0,
        moveY: 0,
        keys: new Set(['KeyF']),
        actions: {},
      });
    }

    assert.equal(engine.ended, true, 'Charging gate on Floor 1 must trigger extraction');
    assert.equal(result?.type, 'extract');
  });

  test('Floors 2~4: Return stairs allow seamless retreat to previous floors and advance to next', () => {
    const save = structuredClone(DEFAULT_STATE_V2);
    const engine = new RunEngine(save, { seed: 223344 });

    // Descend 1F -> 2F
    engine.player.x = engine.stairs.x;
    engine.player.y = engine.stairs.y;
    engine.tryInteract();
    if (engine.blessingSelectionActive) engine.chooseBlessing(0);
    assert.equal(engine.floorNum, 2);

    // Verify retreat stairs on 2F -> 1F
    assert.ok(engine.prevStairs, 'Floor 2 must have return stairs');
    engine.player.x = engine.prevStairs.x;
    engine.player.y = engine.prevStairs.y;
    engine.tryInteract();
    assert.equal(engine.floorNum, 1, 'Return stairs must retreat to Floor 1');

    // Advance 1F -> 2F -> 3F
    engine.player.x = engine.stairs.x;
    engine.player.y = engine.stairs.y;
    engine.tryInteract();
    assert.equal(engine.floorNum, 2);

    engine.player.x = engine.stairs.x;
    engine.player.y = engine.stairs.y;
    engine.tryInteract();
    if (engine.blessingSelectionActive) engine.chooseBlessing(0);
    assert.equal(engine.floorNum, 3);

    // Floor 3 has both return stairs and checkpoint gate
    assert.ok(engine.prevStairs, 'Floor 3 must have return stairs');
    assert.ok(engine.gates.length > 0, 'Floor 3 must have checkpoint gate');

    // Advance 3F -> 4F
    engine.player.x = engine.stairs.x;
    engine.player.y = engine.stairs.y;
    engine.tryInteract();
    if (engine.blessingSelectionActive) engine.chooseBlessing(0);
    assert.equal(engine.floorNum, 4);
    assert.ok(engine.prevStairs, 'Floor 4 must have return stairs');
  });

  test('Floor 5: Boss defeat spawns victory gate and enables final extraction', () => {
    const save = structuredClone(DEFAULT_STATE_V2);
    let result = null;
    const engine = new RunEngine(save, {
      seed: 334455,
      onEnd: (res) => { result = res; },
    });

    // Advance straight to Floor 5
    for (let f = 1; f <= 4; f++) {
      engine.player.x = engine.stairs.x;
      engine.player.y = engine.stairs.y;
      engine.tryInteract();
      if (engine.blessingSelectionActive) engine.chooseBlessing(0);
    }
    assert.equal(engine.floorNum, 5);
    assert.ok(engine.boss, 'Floor 5 must have boss Warden');

    // Engage and defeat boss
    engine.boss.engage();
    engine.boss.takeDamage(9999, engine);
    assert.equal(engine.boss.alive, false);

    // Defeating boss awards XP which may trigger blessing level up reward
    if (engine.blessingSelectionActive) {
      engine.chooseBlessing(0);
    }

    // Defeating boss must spawn victory gate
    const victoryGate = engine.gates.find(g => g.isBossGate);
    assert.ok(victoryGate, 'Victory gate must spawn on Floor 5 upon boss death');

    // Defeating boss and clearing threats allows extraction through victory gate
    engine.enemies = [];
    engine.player.x = victoryGate.x;
    engine.player.y = victoryGate.y;

    for (let i = 0; i < 500 && !engine.ended; i++) {
      engine.update(FIXED_STEP, {
        moveX: 0,
        moveY: 0,
        keys: new Set(['KeyF']),
        actions: {},
      });
    }

    assert.equal(engine.ended, true);
    assert.equal(result?.type, 'extract');
    assert.equal(result?.floor, 5);
  });
});
