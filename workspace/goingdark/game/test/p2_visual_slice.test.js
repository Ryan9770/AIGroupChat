import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SPRITE_DEFS } from '../src/data/spriteAtlasDefs.js';
import { ParticleSystem } from '../src/render/ParticleSystem.js';
import { LightmapSystem } from '../src/render/LightmapSystem.js';
import { DungeonRenderer, ROOM_DISPLAY_INFO } from '../src/render/DungeonRenderer.js';

describe('P2-01 & P2-04. Visual Vertical Slice & Game Feel Invariants', () => {
  test('P2-01: Auto-generated SPRITE_DEFS has all required environment and entity sprite definitions', () => {
    // Environmental sprites
    assert.ok(SPRITE_DEFS.floor_1, 'Must have floor_1');
    assert.ok(SPRITE_DEFS.floor_8, 'Must have floor_8');
    assert.ok(SPRITE_DEFS.wall_mid, 'Must have wall_mid');
    assert.ok(SPRITE_DEFS.wall_top_mid, 'Must have wall_top_mid');
    assert.ok(SPRITE_DEFS.door_open, 'Must have door_open');
    assert.ok(SPRITE_DEFS.stairs_down, 'Must have stairs_down');
    assert.ok(SPRITE_DEFS.stairs_up, 'Must have stairs_up');
    assert.ok(SPRITE_DEFS.altar, 'Must have altar');
    assert.ok(SPRITE_DEFS.gate_crystal, 'Must have gate_crystal');
    assert.ok(SPRITE_DEFS.chest_closed, 'Must have chest_closed');
    assert.ok(SPRITE_DEFS.chest_open, 'Must have chest_open');
    assert.ok(SPRITE_DEFS.chest_mimic_open, 'Must have chest_mimic_open');

    // Required entities (§5.3 mapping)
    const entityKeys = [
      'player',
      'skeleton',
      'skeletonCaptain',
      'royalGuard',
      'mite',
      'golem',
      'cultist',
      'wraith',
      'mimic',
      'boss_warden',
      'boss_hart',
    ];

    for (const k of entityKeys) {
      const def = SPRITE_DEFS[k];
      assert.ok(def, `Entity sprite group '${k}' must exist in SPRITE_DEFS`);
      assert.ok(Array.isArray(def.idle), `${k} must have idle animation frames`);
      assert.ok(def.idle.length > 0, `${k} idle frames must not be empty`);
      for (const f of def.idle) {
        assert.ok(typeof f.x === 'number' && f.x >= 0);
        assert.ok(typeof f.y === 'number' && f.y >= 0);
        assert.ok(typeof f.w === 'number' && f.w > 0);
        assert.ok(typeof f.h === 'number' && f.h > 0);
      }
    }

    // Specific §5.3 mapping checks
    assert.equal(SPRITE_DEFS.skeletonCaptain.scale, 1.25, 'skeletonCaptain must have scale 1.25');
  });

  test('P2-04: ParticleSystem pool caps at MAX_PARTICLES with zero memory unbounded growth', () => {
    const ps = new ParticleSystem();

    // Emit 1,000 dust particles
    for (let i = 0; i < 1000; i++) {
      ps.emitDust(0, 0, 1);
    }
    assert.ok(ps.particles.length <= 400, `Particle count (${ps.particles.length}) must not exceed MAX_PARTICLES (400)`);

    // Emit 100 damage numbers
    for (let i = 0; i < 100; i++) {
      ps.spawnDamageNumber(0, 0, 25, false, false);
    }
    assert.ok(ps.damageNumbers.length <= 60, `Damage numbers (${ps.damageNumbers.length}) must not exceed MAX_DAMAGE_NUMBERS (60)`);

    // Update and lifecycle expiration
    ps.update(1.0); // 1 full second
    assert.equal(ps.particles.length, 0, 'Particles must expire after lifespan');
    assert.equal(ps.damageNumbers.length, 0, 'Damage numbers must expire after lifespan');

    // Camera trauma clamping
    ps.addTrauma(0.7);
    ps.addTrauma(0.5);
    assert.equal(ps.shakeTrauma, 1.0, 'Trauma must clamp strictly at 1.0');
    ps.update(0.5);
    assert.ok(ps.shakeTrauma < 1.0, 'Trauma must decay over time');
  });

  test('P2-02: LightmapSystem initializes with half-resolution buffer and resizes properly', () => {
    const lm = new LightmapSystem(1280, 720);
    // In headless node, canvas is null, but dimensions are stored
    assert.equal(lm.width, 1280);
    assert.equal(lm.height, 720);

    lm.resize(1920, 1080);
    assert.equal(lm.width, 960);
    assert.equal(lm.height, 540);
  });

  test('Sephiria Room-Locked Camera: Locks camera to room center and animates slide transition to next room', () => {
    const canvas = { width: 1280, height: 720 };
    const renderer = new DungeonRenderer(canvas, null);

    const room0 = { id: 0, type: 'start', x: 6, y: 6, w: 28, h: 20, centerX: 20, centerY: 16, neighbors: [1] };
    const room1 = { id: 1, type: 'combat', x: 42, y: 6, w: 28, h: 20, centerX: 56, centerY: 16, neighbors: [0] };

    const mockEngine = {
      floorNum: 1,
      time: 0,
      player: { x: 20, y: 16, facing: 0 },
      roomGraph: { rooms: [room0, room1] },
      visitedRooms: new Set(),
      currentRoomId: 0,
    };

    // 1. 초기 상태: 시작 방 중심에 고정
    renderer.updateCamera(mockEngine, 1 / 60);
    assert.equal(renderer.currentRoomId, 0);
    assert.equal(renderer.camX, 20);
    assert.equal(renderer.camY, 16);
    assert.equal(renderer.isTransitioning, false);
    assert.ok(renderer.bannerRoomInfo, 'Room banner info must be set upon room entry');
    assert.equal(renderer.bannerRoomInfo.name, ROOM_DISPLAY_INFO.start.name);

    // 2. 플레이어가 방 안에서 이동해도 카메라는 방 중심에 견고히 고정
    mockEngine.time = 0.5;
    mockEngine.player.x = 26; // 방 내부 동쪽
    mockEngine.player.y = 18;
    renderer.updateCamera(mockEngine, 1 / 60);
    assert.equal(renderer.camX, 20, 'Camera must remain locked to room 0 centerX');
    assert.equal(renderer.camY, 16, 'Camera must remain locked to room 0 centerY');
    assert.equal(renderer.isTransitioning, false);

    // 3. 복도로 진입하여 다음 방(Room 1) 방향으로 중간 지점을 넘었을 때 슬라이드 전환 애니메이션 시작
    mockEngine.time = 1.0;
    mockEngine.player.x = 40; // 복도 중간을 넘어 Room 1에 더 가까워짐
    renderer.updateCamera(mockEngine, 1 / 60);
    assert.equal(renderer.isTransitioning, true, 'Transition must initiate when entering next room zone');
    assert.equal(renderer.targetRoomId, 1);
    assert.equal(renderer.bannerRoomInfo.name, ROOM_DISPLAY_INFO.combat.name);

    // 4. 애니메이션 진행: 0 < progress < 1 사이에서 부드럽게 보간
    mockEngine.time = 1.2;
    renderer.updateCamera(mockEngine, 0.2);
    assert.ok(renderer.isTransitioning);
    assert.ok(renderer.camX > 20 && renderer.camX < 56, 'Camera must be interpolating between room 0 and room 1');

    // 5. 전환 애니메이션 완료: 다음 방 중심(56, 16)에 완벽히 고정
    mockEngine.time = 1.5;
    renderer.updateCamera(mockEngine, 0.3);
    assert.equal(renderer.isTransitioning, false, 'Transition must complete');
    assert.equal(renderer.currentRoomId, 1);
    assert.equal(renderer.camX, 56, 'Camera must lock to Room 1 centerX');
    assert.equal(renderer.camY, 16, 'Camera must lock to Room 1 centerY');
  });
});
