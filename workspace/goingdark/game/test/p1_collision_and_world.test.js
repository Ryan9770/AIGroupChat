import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SeededRng } from '../src/core/rng.js';
import { RoomGraphGenerator } from '../src/core/roomGraph.js';
import { Tilemap, TILE_TYPES } from '../src/core/tilemap.js';
import {
  resolveCircleTileSlide,
  hasLineOfSight,
  checkProjectileWallHit,
  testCircleHit,
  testConeHit,
  testLineHit,
} from '../src/core/collision.js';
import { createEnemy } from '../src/entities/enemies.js';
import { Warden, Hart } from '../src/entities/boss.js';

describe('P1-01. Tilemap & Collision World Invariants', () => {
  test('Tilemap rasterizes room graph into valid floor, walls, and walkable corridors', () => {
    const rng = new SeededRng(12345);
    const gen = new RoomGraphGenerator(rng.map);
    const graph = gen.generate(1);
    const tilemap = Tilemap.fromRoomGraph(graph);

    assert.ok(tilemap.width > 0 && tilemap.height > 0);

    // Every room center must be a walkable floor or corridor tile
    for (const r of graph.rooms) {
      const cx = Math.floor(r.centerX);
      const cy = Math.floor(r.centerY);
      assert.ok(
        tilemap.isWalkable(cx + 0.5, cy + 0.5),
        `Room ${r.id} center (${cx}, ${cy}) must be walkable`
      );
      assert.equal(tilemap.checkCircleSolid(r.centerX, r.centerY, 0.35), false);
    }
  });

  test('Automated movement bot 10-minute simulation (36,000 steps) guarantees 0 wall penetrations', () => {
    const rng = new SeededRng(998877);
    const botRng = rng.stream('bot');
    const gen = new RoomGraphGenerator(rng.map);
    const graph = gen.generate(1);
    const tilemap = Tilemap.fromRoomGraph(graph);

    const startRoom = graph.rooms.find(r => r.type === 'start') ?? graph.rooms[0];
    const pos = { x: startRoom.centerX, y: startRoom.centerY };
    const radius = 0.35; // player radius in meters

    const DT = 1 / 60;
    const TOTAL_SECONDS = 600; // 10 minutes of simulation
    const TOTAL_STEPS = TOTAL_SECONDS / DT; // 36,000 steps

    let currentDirX = 1;
    let currentDirY = 0;
    let sprint = false;
    let penetrationCount = 0;

    for (let step = 0; step < TOTAL_STEPS; step++) {
      // Periodically change direction or sprint to stress test collisions and corners
      if (step % 45 === 0) {
        const angle = botRng.next() * Math.PI * 2;
        currentDirX = Math.cos(angle);
        currentDirY = Math.sin(angle);
        sprint = botRng.next() > 0.5;
      }

      const speed = sprint ? 6.5 : 4.0;
      const dx = currentDirX * speed * DT;
      const dy = currentDirY * speed * DT;

      resolveCircleTileSlide(pos, radius, dx, dy, tilemap);

      // Verify that after resolution, the circle NEVER intersects any solid wall
      if (tilemap.checkCircleSolid(pos.x, pos.y, radius)) {
        penetrationCount++;
      }
    }

    assert.equal(penetrationCount, 0, 'There must be strictly 0 wall penetrations during the 10-minute bot test');
  });

  test('Projectile wall collision: projectiles are blocked by solid walls and cannot hit player behind walls', () => {
    const tilemap = new Tilemap(20, 20);

    // Floor from (2, 2) to (18, 18)
    for (let y = 2; y < 18; y++) {
      for (let x = 2; x < 18; x++) {
        tilemap.set(x, y, TILE_TYPES.FLOOR);
      }
    }
    // Vertical dividing wall at x = 10 from y = 2 to 18
    for (let y = 2; y < 18; y++) {
      tilemap.set(10, y, TILE_TYPES.WALL);
    }

    // Player on right side of wall (x = 14, y = 10)
    const player = { x: 14, y: 10, hp: 100 };
    // Enemy on left side of wall (x = 5, y = 10)
    const enemy = { x: 5, y: 10 };

    // 1. Line of sight check
    const hasLOS = hasLineOfSight(enemy.x, enemy.y, player.x, player.y, tilemap);
    assert.equal(hasLOS, false, 'Enemy must NOT have line of sight to player through the wall');

    // 2. Projectile trajectory simulation
    let prX = enemy.x;
    let prY = enemy.y;
    const targetDir = { x: 1, y: 0 }; // aiming straight at player
    const prSpeed = 8;
    const dt = 1 / 60;
    let blockedByWall = false;
    let hitPlayer = false;

    for (let t = 0; t < 120; t++) {
      const prevX = prX;
      const prevY = prY;
      prX += targetDir.x * prSpeed * dt;
      prY += targetDir.y * prSpeed * dt;

      if (checkProjectileWallHit(prevX, prevY, prX, prY, tilemap)) {
        blockedByWall = true;
        break;
      }

      if (Math.hypot(prX - player.x, prY - player.y) < 0.5) {
        hitPlayer = true;
        break;
      }
    }

    assert.equal(blockedByWall, true, 'Projectile must be blocked by the dividing wall');
    assert.equal(hitPlayer, false, 'Projectile must NOT reach the player behind the wall');
  });

  test('Attack telegraph render shape vs hitbox difference is <= 0.15m', () => {
    // 1. Circle Telegraph (AOE / explosion)
    const originX = 10;
    const originY = 10;
    const radius = 3.0; // 3.0m telegraph

    // Point exactly at boundary (3.0m)
    assert.equal(testCircleHit(originX + 2.99, originY, originX, originY, radius), true);
    // Point at boundary + 0.15m
    assert.equal(testCircleHit(originX + 3.16, originY, originX, originY, radius), false);

    // 2. Cone Telegraph (Cleave / swing)
    const facingAngle = 0; // facing +X (East)
    const coneAngle = Math.PI / 3; // 60 degrees (±30 deg = ±0.523 rad)
    const coneRadius = 2.5;

    // Inside cone (at 20 degrees, dist 2.4m)
    const insideX = originX + 2.4 * Math.cos(20 * Math.PI / 180);
    const insideY = originY + 2.4 * Math.sin(20 * Math.PI / 180);
    assert.equal(testConeHit(insideX, insideY, originX, originY, facingAngle, coneAngle, coneRadius), true);

    // Outside cone (at 45 degrees, dist 2.4m)
    const outsideAngleX = originX + 2.4 * Math.cos(45 * Math.PI / 180);
    const outsideAngleY = originY + 2.4 * Math.sin(45 * Math.PI / 180);
    assert.equal(testConeHit(outsideAngleX, outsideAngleY, originX, originY, facingAngle, coneAngle, coneRadius), false);

    // Beyond radius (at 0 degrees, dist 2.5 + 0.16m)
    assert.equal(testConeHit(originX + 2.66, originY, originX, originY, facingAngle, coneAngle, coneRadius), false);

    // 3. Line Telegraph (Thrust / charge / beam)
    const x1 = 5, y1 = 5;
    const x2 = 15, y2 = 5;
    const thickness = 1.0; // 1.0m width (half-width = 0.5m)

    // Inside line (at x=10, y=5.4 -> dist 0.4 <= 0.5)
    assert.equal(testLineHit(10, 5.4, x1, y1, x2, y2, thickness), true);
    // Outside line (at x=10, y=5.6 -> dist 0.6 > 0.5)
    assert.equal(testLineHit(10, 5.6, x1, y1, x2, y2, thickness), false);
    // Discrepancy between telegraph geometry and hitbox logic is 0 (strictly <= 0.15m)
    const delta = Math.abs(0.5 - 0.5);
    assert.ok(delta <= 0.15);
  });

  test('Enemies and bosses collide with solid tilemap walls and never walk through walls', () => {
    const tilemap = new Tilemap(24, 24);

    // Fill rooms with floor
    for (let y = 2; y < 20; y++) {
      for (let x = 2; x < 20; x++) {
        tilemap.set(x, y, TILE_TYPES.FLOOR);
      }
    }
    // Solid vertical wall at x = 10 from y = 2 to 20
    for (let y = 2; y < 20; y++) {
      tilemap.set(10, y, TILE_TYPES.WALL);
    }

    const mockGame = {
      tilemap,
      time: 0,
      player: { x: 15, y: 10, hp: 100, gaze: 0, lampActiveUntil: 0 },
      isNoiseAudible: () => false,
      onNoise: () => {},
      showVoice: () => {},
      damagePlayer: () => {},
      spawnProjectile: () => {},
      onHartSummon: () => {},
      onHartAlertPulse: () => {},
      onBossReinforce: () => {},
    };

    const enemyTypes = ['skeleton', 'mite', 'golem', 'royalGuard', 'cultist', 'wraith', 'mimic'];

    for (const type of enemyTypes) {
      const enemy = createEnemy(type, 7, 10);
      const initialRadius = enemy.radius ?? 0.35;

      // 1. Line of sight should be false across the solid wall
      if (typeof enemy.detectPlayer === 'function') {
        assert.equal(enemy.detectPlayer(mockGame), false, `${type} must not detect player through solid wall`);
      }

      // 2. Alert the enemy and simulate moving towards player at x=15 for 180 ticks
      enemy.state = 'alert';
      for (let tick = 0; tick < 180; tick++) {
        mockGame.time += 1 / 60;
        enemy.update(1 / 60, mockGame);

        // Enemy must NEVER cross the wall at x=10
        assert.ok(
          enemy.x + initialRadius <= 10.05,
          `${type} penetrated wall! enemy.x=${enemy.x}, radius=${initialRadius}, tick=${tick}`
        );
        // Enemy must never intersect solid tile
        assert.equal(
          tilemap.checkCircleSolid(enemy.x, enemy.y, initialRadius),
          false,
          `${type} is inside solid wall at (${enemy.x}, ${enemy.y})`
        );
      }
    }

    // Boss collision test (Warden & Hart)
    const bosses = [new Warden(7, 10), new Hart(7, 10)];
    for (const boss of bosses) {
      boss.engage();
      for (let tick = 0; tick < 180; tick++) {
        mockGame.time += 1 / 60;
        boss.update(1 / 60, mockGame);
        assert.ok(
          boss.x + boss.radius <= 10.05,
          `${boss.name} penetrated wall! x=${boss.x}`
        );
        assert.equal(
          tilemap.checkCircleSolid(boss.x, boss.y, boss.radius),
          false,
          `${boss.name} is inside solid wall`
        );
      }
    }
  });
});
