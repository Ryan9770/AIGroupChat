import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../src/entities/player.js';
import { PLAYER_BASE } from '../src/data/data.js';

describe('G1 & G3. Player Mechanics & P0 Slow Debuff', () => {
  let player;

  beforeEach(() => {
    player = new Player({ weaponLevel: 0, inventory: [] });
  });

  test('P0: Speed debuff lasts exactly 3.0s simulation time and returns to base speed', () => {
    const baseWalkSpeed = player.currentSpeed(false, true, 50.0);
    assert.equal(baseWalkSpeed, PLAYER_BASE.walkSpeed);

    // Apply debuff at t = 50.0s (lasts until 53.0s)
    player.speedDebuffUntil = 53.0;

    // At t = 51.0s, debuff is active (20% reduction)
    const debuffedSpeed = player.currentSpeed(false, true, 51.0);
    assert.equal(debuffedSpeed, PLAYER_BASE.walkSpeed * 0.8);

    // At t = 52.9s, debuff is still active
    const nearEndSpeed = player.currentSpeed(false, true, 52.9);
    assert.equal(nearEndSpeed, PLAYER_BASE.walkSpeed * 0.8);

    // At t = 53.05s, debuff has expired! Base speed restored!
    const restoredSpeed = player.currentSpeed(false, true, 53.05);
    assert.equal(restoredSpeed, PLAYER_BASE.walkSpeed);
  });

  test('Guard reduces damage by 70%', () => {
    assert.equal(player.guardReduction, 0.70);
    const incomingDmg = 30;
    const finalDmg = incomingDmg * (1 - player.guardReduction);
    assert.ok(Math.abs(finalDmg - 9) < 1e-6);
  });

  test('Roll provides invulnerability duration', () => {
    const dummyGame = { onNoise: () => {} };
    const rolled = player.tryRoll(1, 0, dummyGame);
    assert.ok(rolled);
    assert.ok(player.invulnerable);
    assert.equal(player.rollTimer, PLAYER_BASE.roll.invuln);

    // Update time less than invuln duration
    player.update(0.1, 10.0, { moveX: 0, moveY: 0, sprint: false });
    assert.ok(player.invulnerable);

    // Update time past invuln duration
    player.update(0.25, 10.25, { moveX: 0, moveY: 0, sprint: false });
    assert.equal(player.invulnerable, false);
  });

  test('Player guarding stance updates from input and limits movement speed', () => {
    assert.equal(player.guarding, false);

    // Guard down input sets guarding = true
    player.update(0.1, 10.0, { moveX: 1, moveY: 0, sprint: false, guardDown: true });
    assert.equal(player.guarding, true);
    assert.equal(player.currentSpeed(false, true, 10.0), PLAYER_BASE.guardSpeed);

    // Releasing guard resets guarding = false
    player.update(0.1, 10.1, { moveX: 1, moveY: 0, sprint: false, guardDown: false });
    assert.equal(player.guarding, false);
    assert.equal(player.currentSpeed(false, true, 10.1), PLAYER_BASE.walkSpeed);
  });

  test('Player tryAttack is safe with missing onPlayerAttack or null game', () => {
    // Null game object
    assert.doesNotThrow(() => {
      const ok = player.tryAttack(null);
      assert.equal(ok, true);
    });

    player.attackCd = 0;
    // Object without onPlayerAttack
    assert.doesNotThrow(() => {
      const ok = player.tryAttack({});
      assert.equal(ok, true);
    });

    player.attackCd = 0;
    // Object with onPlayerAttack
    let callbackCalled = false;
    const ok = player.tryAttack({ onPlayerAttack: () => { callbackCalled = true; } });
    assert.equal(ok, true);
    assert.equal(callbackCalled, true);
  });

  test('Player sprint and walk movement speeds reflect updated balance', () => {
    assert.equal(PLAYER_BASE.walkSpeed, 4.5);
    assert.equal(PLAYER_BASE.sprintSpeed, 7.8);
    assert.equal(player.currentSpeed(false, true, 0), 4.5);
    assert.equal(player.currentSpeed(true, true, 0), 7.8);
  });

  test('InputController supports touch joystick movement and action triggers', async () => {
    const { InputController } = await import('../src/input/InputController.js');
    const input = new InputController(null);

    // Initial state
    assert.equal(input.moveX, 0);
    assert.equal(input.moveY, 0);

    // Touch joystick move
    input.setTouchMove(0.7, -0.7, true);
    assert.equal(input.moveX, 0.7);
    assert.equal(input.moveY, -0.7);
    assert.equal(input.sprint, true);
    assert.equal(input.isTouchMoving, true);

    // Touch action triggers
    input.triggerAction('attack');
    input.triggerAction('guard', true);
    input.triggerAction('gate', true);
    input.triggerAction('consumable', 'holyWater');

    const snap = input.poll();
    assert.equal(snap.moveX, 0.7);
    assert.equal(snap.moveY, -0.7);
    assert.equal(snap.sprint, true);
    assert.equal(snap.actions.attack, true);
    assert.equal(snap.actions.consumable, 'holyWater');
    assert.equal(snap.guardDown, true);
    assert.ok(snap.keys.has('KeyF'));

    // Release guard and gate
    input.triggerAction('guard', false);
    input.triggerAction('gate', false);
    input.setTouchMove(0, 0, false);

    const snap2 = input.poll();
    assert.equal(snap2.moveX, 0);
    assert.equal(snap2.moveY, 0);
    assert.equal(snap2.sprint, false);
    assert.equal(snap2.guardDown, false);
    assert.equal(snap2.keys.has('KeyF'), false);
    assert.equal(snap2.actions.attack, false);

    input.destroy();
  });

  test('TouchControls gracefully instantiates and respects mode config', async () => {
    const { InputController } = await import('../src/input/InputController.js');
    const { TouchControls } = await import('../src/input/TouchControls.js');
    const input = new InputController(null);

    // Mode 'off' should not be enabled
    const tcOff = new TouchControls(input, { mode: 'off' });
    assert.equal(tcOff.isEnabled, false);

    // Mode 'on' should be enabled
    const tcOn = new TouchControls(input, { mode: 'on' });
    assert.equal(tcOn.isEnabled, true);

    tcOff.destroy();
    tcOn.destroy();
    input.destroy();
  });
});
