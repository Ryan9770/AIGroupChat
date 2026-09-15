import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RunEngine } from '../src/run/RunEngine.js';
import { DEFAULT_STATE_V2 } from '../src/systems/save.js';
import { FIXED_STEP } from '../src/core/constants.js';

describe('P1-02. RunEngine Headless Simulation (Node Environment)', () => {
  test('RunEngine can simulate a complete run (movement, loot, floor change, extraction) without Canvas/DOM', () => {
    const save = structuredClone(DEFAULT_STATE_V2);
    let runResult = null;
    const notifications = [];
    const sounds = [];

    const engine = new RunEngine(save, {
      seed: 445566,
      onEnd: (res) => { runResult = res; },
      onNotify: (msg) => notifications.push(msg),
      onSFX: (sfx) => sounds.push(sfx),
    });

    assert.equal(engine.floorNum, 1);
    assert.equal(engine.ended, false);
    assert.ok(engine.player.x > 0 && engine.player.y > 0);

    // 1. Simulate 60 steps of player movement
    for (let i = 0; i < 60; i++) {
      engine.update(FIXED_STEP, {
        moveX: 1,
        moveY: 0,
        sprint: true,
        actions: {},
      });
    }
    assert.ok(engine.time > 0);

    // 2. Open a chest
    const chest = engine.chests[0];
    if (chest) {
      engine.player.x = chest.x;
      engine.player.y = chest.y;
      engine.tryInteract();
      assert.equal(chest.opened, true);
      assert.ok(engine.runXp > 0);
    }

    // 3. Move to stairs and descend to floor 2
    assert.ok(engine.stairs);
    engine.player.x = engine.stairs.x;
    engine.player.y = engine.stairs.y;
    engine.tryInteract();
    assert.equal(engine.floorNum, 2);

    // XP threshold reached on floor 2 descent triggers blessing selection modal
    if (engine.blessingSelectionActive) {
      assert.ok(engine.currentBlessingOptions.length > 0);
      engine.chooseBlessing(0);
      assert.equal(engine.blessingSelectionActive, false);
      assert.equal(Object.keys(engine.activeBlessings).length, 1);
    }

    // 4. Return to floor 1 via retreat stairs
    assert.ok(engine.prevStairs);
    engine.player.x = engine.prevStairs.x;
    engine.player.y = engine.prevStairs.y;
    engine.tryInteract();
    assert.equal(engine.floorNum, 1);

    // 5. Simulate gate extraction
    const gate = engine.gates[0];
    assert.ok(gate);
    engine.player.x = gate.x;
    engine.player.y = gate.y;
    engine.time = 18 * 60; // Set time past gate opening time

    // Hold F for gate charge time (8s = 480 steps)
    for (let i = 0; i < 490 && !engine.ended; i++) {
      engine.update(FIXED_STEP, {
        moveX: 0,
        moveY: 0,
        keys: new Set(['KeyF']),
        actions: {},
      });
    }

    assert.equal(engine.ended, true);
    assert.ok(runResult);
    assert.equal(runResult.type, 'extract');
    assert.ok(sounds.includes('goldChime'));
  });

  test('RunEngine handles player death settlement cleanly in headless mode', () => {
    const save = structuredClone(DEFAULT_STATE_V2);
    let runResult = null;

    const engine = new RunEngine(save, {
      seed: 778899,
      onEnd: (res) => { runResult = res; },
    });

    // Inflict fatal damage
    engine.damagePlayer(999, 'mob');

    assert.equal(engine.player.dead, true);
    assert.equal(engine.ended, true);
    assert.ok(runResult);
    assert.equal(runResult.type, 'death');
    assert.equal(runResult.cause, 'mob');
  });

  test('RunEngine handles player attack action seamlessly without throwing', () => {
    const save = structuredClone(DEFAULT_STATE_V2);
    const sounds = [];
    const noises = [];

    const engine = new RunEngine(save, {
      seed: 112233,
      onSFX: (sfx) => sounds.push(sfx),
    });
    engine.onNoise = (x, y, kind, radius) => {
      noises.push({ kind, radius });
    };

    // Trigger attack via input actions
    assert.doesNotThrow(() => {
      engine.update(FIXED_STEP, {
        moveX: 0,
        moveY: 0,
        actions: { attack: true },
      });
    });

    assert.ok(sounds.includes('swordSwing'));
    assert.ok(noises.some((n) => n.kind === 'attack'));
    assert.ok(engine.player.attackSwingT > 0);
  });

  test('RunEngine handles player guard stance and mitigates damage with shieldBlock SFX', () => {
    const save = structuredClone(DEFAULT_STATE_V2);
    const sounds = [];
    const noises = [];

    const engine = new RunEngine(save, {
      seed: 334455,
      onSFX: (sfx) => sounds.push(sfx),
    });
    engine.onNoise = (x, y, kind, radius) => {
      noises.push({ kind, radius });
    };

    // Update with guardDown = true
    engine.update(FIXED_STEP, {
      moveX: 0,
      moveY: 0,
      guardDown: true,
      actions: {},
    });

    assert.equal(engine.player.guarding, true);

    const initialHp = engine.player.hp;
    const incomingDmg = 20;

    // Receive damage while guarding
    engine.damagePlayer(incomingDmg, 'mite');

    const expectedDamage = incomingDmg * (1 - engine.player.guardReduction);
    assert.ok(Math.abs((initialHp - engine.player.hp) - expectedDamage) < 1e-5);
    assert.ok(sounds.includes('shieldBlock'));
    assert.ok(noises.some((n) => n.kind === 'guardBlock'));
  });

  test('RunEngine handles player holy water lantern (Q) activation and cooldown feedback', () => {
    const save = structuredClone(DEFAULT_STATE_V2);
    const sounds = [];
    const notifications = [];

    const engine = new RunEngine(save, {
      seed: 991122,
      onSFX: (sfx) => sounds.push(sfx),
      onNotify: (msg) => notifications.push(msg),
    });

    // 1. Trigger Q lamp skill via actions
    engine.update(FIXED_STEP, {
      moveX: 0,
      moveY: 0,
      actions: { lamp: true },
    });

    assert.ok(sounds.includes('holyBell'));
    assert.ok(engine.player.lampActiveUntil > engine.time);
    assert.ok(engine.player.lampCd > 0);
    assert.ok(notifications.some((n) => n.includes('성수 등불 점등')));

    // 2. Trigger again while on cooldown
    notifications.length = 0;
    engine.update(FIXED_STEP, {
      moveX: 0,
      moveY: 0,
      actions: { lamp: true },
    });

    assert.ok(notifications.some((n) => n.includes('재사용 대기')));
  });

  test('RunEngine preserves gateCharge when taking damage during gate channeling', () => {
    const save = structuredClone(DEFAULT_STATE_V2);
    const engine = new RunEngine(save, { seed: 556677 });
    const gate = engine.gates[0];
    assert.ok(gate);
    engine.player.x = gate.x;
    engine.player.y = gate.y;
    engine.time = 18 * 60; // Open gate

    // 1. Channel gate for 120 steps (~2.0 seconds)
    for (let i = 0; i < 120; i++) {
      engine.update(FIXED_STEP, {
        moveX: 0,
        moveY: 0,
        keys: new Set(['KeyF']),
        actions: {},
      });
    }

    const chargeBeforeHit = engine.player.gateCharge;
    assert.ok(chargeBeforeHit >= 1.9, `Gate charge should be ~2.0s, got ${chargeBeforeHit}`);
    assert.equal(engine.player.charging, true);

    // 2. Inflict non-fatal damage to player while channeling
    engine.damagePlayer(15, 'mite');
    assert.equal(engine.player.hp, 85);

    // Gate charge must NOT be reset to 0, and charging flag remains intact
    assert.ok(engine.player.gateCharge >= chargeBeforeHit, 'Gate charge must not be reset to 0 on damage');
    assert.equal(engine.player.charging, true, 'Charging state must remain true');

    // 3. Continue holding KeyF for remainder of charge time and extract successfully
    for (let i = 0; i < 400 && !engine.ended; i++) {
      engine.update(FIXED_STEP, {
        moveX: 0,
        moveY: 0,
        keys: new Set(['KeyF']),
        actions: {},
      });
    }
    assert.equal(engine.ended, true);
  });
});
