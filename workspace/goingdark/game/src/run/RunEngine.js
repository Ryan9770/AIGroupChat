// ============================================================================
// 던전 런 시뮬레이션 엔진 (RunEngine)
// DOM / Canvas 완전 독립형 순수 규칙 및 결정론적 물리 시뮬레이션 엔진
// P1-02: 규칙 및 엔티티 시뮬레이션 분리 (Node 환경 헤드리스 1런 검증 가능)
// ============================================================================

import {
  PLAYER_BASE, GAZE, TIDE_STAGES, GATE_OPEN_AT_SEC,
  FLOOR_DEFS, RESPAWN_SEC, RESPAWN_SEC_HUNT, gazeBand, rollLootTier, makeLootItem,
  BOSS_WARDEN, BOSS_HART, HART_UNIQUE_ITEM, DIALOGUE,
  CURSED_RELICS, ROOM_EVENTS, CONSUMABLES,
} from '../data/data.js';
import { createEnemy } from '../entities/enemies.js';
import { Warden, Hart } from '../entities/boss.js';
import { Player } from '../entities/player.js';
import { addItem, removeItem } from '../systems/inventory.js';
import { SeededRng, generateSeed, hashString } from '../core/rng.js';
import { RULES_VERSION } from '../core/constants.js';
import { RoomGraphGenerator } from '../core/roomGraph.js';
import { RunSettlement } from '../core/settlement.js';
import { rollBlessingOptions } from '../core/blessings.js';
import { Tilemap } from '../core/tilemap.js';
import { checkProjectileWallHit, testConeHit, resolveCircleTileSlide } from '../core/collision.js';

const XP_THRESHOLDS = [60, 150, 270, 420, 600, 820, 1100, 1450, 1900];

export class RunEngine {
  constructor(saveState, opts = {}) {
    if (saveState && typeof saveState === 'object' && ('save' in saveState || 'floor' in saveState) && !('inventory' in saveState)) {
      opts = saveState;
      saveState = opts.save || {};
    }
    this.save = saveState;
    this.speedMul = opts.speedMultiplier ?? 1;
    this.sessionId = opts.sessionId ?? `s_${Date.now()}`;

    // 콜백 인터페이스 (오디오, 알림, UI 팝업 등 외부 통지)
    this.onEnd = opts.onEnd ?? (() => {});
    this.onNotify = opts.onNotify ?? (() => {});
    this.onDialogue = opts.onDialogue ?? (() => {});
    this.onSFX = opts.onSFX ?? (() => {});
    this.onBlessingPrompt = opts.onBlessingPrompt ?? (() => {});

    // 결정론적 RNG 및 런 정산기
    this.seed = opts.seed ?? generateSeed();
    this.rng = new SeededRng(this.seed);
    this.settlement = new RunSettlement(this.save, this.sessionId);
    this.roomGen = new RoomGraphGenerator(this.rng.map);

    this.time = 0;
    this.floorNum = opts.floor ?? 1;
    this.enemies = [];
    this.projectiles = [];
    this.chests = [];
    this.altars = [];
    this.gates = [];
    this.groundItems = [];
    this.traps = [];
    this.secretWalls = [];
    this.roomEvents = [];
    this.stairs = null;
    this.prevStairs = null;
    this.boss = null;
    this.sideBoss = null;
    this.golemRoomTriggered = false;
    this.noiseEvents = [];
    this.tideStageIdx = -1;
    this.tideAccum = 0;
    this.gateAlarmed = false;
    this.huntSpawnCount = 0;
    this.ended = false;
    this._lastTabNoiseTime = -999;
    this._hotUntil = 0;
    this._hotPerSec = 0;

    // 축복(빌드) 시스템 상태
    this.runXp = 0;
    this.blessingLevel = 0;
    this.activeBlessings = {};
    this.blessingSelectionActive = false;
    this.currentBlessingOptions = [];

    // 방 그래프 및 타일맵 상태
    this.roomGraph = null;
    this.tilemap = null;
    this.visitedRooms = new Set();
    this.currentRoomId = 0;
    this.roomW = 64;
    this.roomH = 64;

    this.player = new Player(this.save);
    this.input = { moveX: 0, moveY: 0, sprint: false, mouseX: 0, mouseY: 0, mouseDown: false, guardDown: false };

    // 메타 해금 패시브 적용
    if (this.save.unlockedNodes?.includes('iron_vitality')) {
      this.player.maxHp += 10;
      this.player.hp += 10;
    }
    if (this.save.unlockedNodes?.includes('swift_feet')) {
      this.player.moveSpeedMul = (this.player.moveSpeedMul ?? 1) * 1.05;
    }
    if (this.save.unlockedNodes?.includes('stamina_breathing')) {
      this.player.staminaRegenMul = (this.player.staminaRegenMul ?? 1) * 1.15;
    }
    if (this.save.unlockedNodes?.includes('shadow_cloak')) {
      this.player.gazeRateMul = (this.player.gazeRateMul ?? 1) * 0.90;
    }

    // 층 캐시
    this.floorCache = new Map();
    const startFloor = opts.floor ?? 1;
    this.awardedFloorXp = new Set([startFloor]);

    this._loadFloor(startFloor);
  }

  _saveCurrentFloorState() {
    if (!this.floorNum) return;
    this.floorCache.set(this.floorNum, {
      floorNum: this.floorNum,
      floorDef: this.floorDef,
      roomGraph: this.roomGraph,
      tilemap: this.tilemap,
      visitedRooms: new Set(this.visitedRooms),
      currentRoomId: this.currentRoomId,
      roomW: this.roomW,
      roomH: this.roomH,
      enemies: this.enemies,
      chests: this.chests,
      altars: this.altars,
      gates: this.gates,
      traps: this.traps,
      secretWalls: this.secretWalls,
      roomEvents: this.roomEvents,
      groundItems: this.groundItems,
      boss: this.boss,
      sideBoss: this.sideBoss,
      landmark: this.landmark,
      golemRoomTriggered: this.golemRoomTriggered,
      stairs: this.stairs,
      prevStairs: this.prevStairs,
    });
  }

  get floor() {
    return this.floorNum;
  }

  _loadFloor(n, direction = 'init') {
    const def = FLOOR_DEFS.find(f => f.floor === n);
    this.floorDef = def;
    this.floorNum = n;
    this.projectiles = [];

    if (this.floorCache.has(n)) {
      const cached = this.floorCache.get(n);
      this.roomGraph = cached.roomGraph;
      this.tilemap = cached.tilemap;
      this.visitedRooms = cached.visitedRooms;
      this.currentRoomId = cached.currentRoomId;
      this.roomW = cached.roomW;
      this.roomH = cached.roomH;
      this.enemies = cached.enemies;
      this.chests = cached.chests;
      this.altars = cached.altars;
      this.gates = cached.gates;
      this.traps = cached.traps || [];
      this.secretWalls = cached.secretWalls || [];
      this.roomEvents = cached.roomEvents || [];
      this.groundItems = cached.groundItems || [];
      this.boss = cached.boss;
      this.sideBoss = cached.sideBoss;
      this.landmark = cached.landmark;
      this.golemRoomTriggered = cached.golemRoomTriggered;
      this.stairs = cached.stairs;
      this.prevStairs = cached.prevStairs;

      if (direction === 'ascend' && this.stairs) {
        this.player.x = this.stairs.x;
        this.player.y = this.stairs.y;
      } else if (direction === 'descend' && this.prevStairs) {
        this.player.x = this.prevStairs.x;
        this.player.y = this.prevStairs.y;
      } else {
        const startRoom = this.roomGraph.rooms.find(r => r.type === 'start') ?? this.roomGraph.rooms[0];
        this.player.x = startRoom.centerX;
        this.player.y = startRoom.centerY;
      }
      return;
    }

    this.roomGraph = this.roomGen.generate(n);
    this.tilemap = Tilemap.fromRoomGraph(this.roomGraph);
    this.visitedRooms.clear();
    this.visitedRooms.add(0);
    this.currentRoomId = 0;

    const rooms = this.roomGraph.rooms;
    const startRoom = rooms.find(r => r.type === 'start') ?? rooms[0];

    this.roomW = Math.max(...rooms.map(r => r.x + r.w)) + 12;
    this.roomH = Math.max(...rooms.map(r => r.y + r.h)) + 12;

    this.player.x = startRoom.centerX;
    this.player.y = startRoom.centerY;

    this.enemies = [];
    this.chests = [];
    this.altars = [];
    this.gates = [];
    this.traps = [];
    this.secretWalls = [];
    this.roomEvents = [];
    this.groundItems = [];
    this.boss = null;
    this.sideBoss = null;
    this.landmark = null;
    this.golemRoomTriggered = false;

    if (n > 1) {
      this.prevStairs = {
        x: startRoom.x + 3,
        y: startRoom.y + 3,
        targetFloor: n - 1,
        label: `${n - 1}층으로 후퇴`,
      };
    } else {
      this.prevStairs = null;
    }

    const stairsRoom = rooms.find(r => r.type === 'stairs' || r.type === 'boss') ?? rooms[rooms.length - 1];
    if (n < 5) {
      this.stairs = {
        x: stairsRoom.centerX,
        y: stairsRoom.centerY,
        targetFloor: n + 1,
        label: `${n + 1}층으로 전진`,
      };
    } else {
      this.stairs = null;
      this.boss = new Warden(stairsRoom.centerX, stairsRoom.centerY);
    }

    if (def.sideBoss === 'hart') {
      const eliteRoom = rooms.find(r => r.type === 'elite') ?? rooms[1];
      this.sideBoss = new Hart(eliteRoom.centerX, eliteRoom.centerY);
    }

    if (n === 1 || n === 3 || n === 5 || def.gate) {
      const gateRoom = rooms.find(r => r.type === 'gate') ?? rooms[rooms.length - 2];
      this.gates.push({
        x: gateRoom.centerX,
        y: gateRoom.centerY,
        id: `gate_${n}_checkpoint`,
      });
    }

    const altarRooms = rooms.filter(r => r.type === 'altar');
    for (let i = 0; i < altarRooms.length; i++) {
      const ar = altarRooms[i];
      this.altars.push({
        x: ar.centerX,
        y: ar.centerY,
        usedAt: -999,
        id: `altar_${n}_${i}`,
      });
    }

    // 층별 랜드마크 5종 배정 (11 §5 층별 아트 키)
    let landmarkRoom = null;
    let landmarkType = null;
    if (n === 1) {
      landmarkRoom = rooms.find(r => r.type === 'treasure') || rooms[1];
      landmarkType = 'customs_crane_vault';
    } else if (n === 2) {
      landmarkRoom = rooms.find(r => r.type === 'combat') || rooms[1];
      landmarkType = 'bone_stable_tower';
    } else if (n === 3) {
      landmarkRoom = rooms.find(r => r.type === 'altar') || rooms[1];
      landmarkType = 'inverted_bell';
    } else if (n === 4) {
      landmarkRoom = rooms.find(r => r.type === 'elite') || rooms[1];
      landmarkType = 'tilted_coronation_hall';
    } else if (n === 5) {
      landmarkRoom = rooms.find(r => r.type === 'boss') || rooms[rooms.length - 1];
      landmarkType = 'heart_throne';
    }

    if (landmarkRoom) {
      this.landmark = {
        floor: n,
        type: landmarkType,
        x: landmarkRoom.centerX,
        y: landmarkRoom.centerY,
      };
    }

    const treasureRooms = rooms.filter(r => r.type === 'treasure');
    let chestIdx = 0;
    const isMimicRoll = () => (n >= 2 && this.rng.spawn.next() < 0.25);

    for (const tr of treasureRooms) {
      this.chests.push({
        x: tr.centerX - 3,
        y: tr.centerY,
        opened: false,
        isMimic: isMimicRoll(),
        id: `chest_${n}_${chestIdx++}`,
        armory: (n === 2 || n === 3) && chestIdx === 1,
      });
      this.chests.push({
        x: tr.centerX + 3,
        y: tr.centerY,
        opened: false,
        isMimic: isMimicRoll(),
        id: `chest_${n}_${chestIdx++}`,
        armory: false,
      });
    }
    while (chestIdx < def.chests) {
      const r = rooms[chestIdx % rooms.length];
      this.chests.push({
        x: r.centerX,
        y: r.centerY,
        opened: false,
        isMimic: isMimicRoll(),
        id: `chest_${n}_${chestIdx++}`,
        armory: false,
      });
    }

    const trapRooms = rooms.filter(r => r.type === 'trap');
    for (const tr of trapRooms) {
      for (let ox = -3; ox <= 3; ox += 3) {
        for (let oy = -3; oy <= 3; oy += 3) {
          this.traps.push({
            x: tr.centerX + ox,
            y: tr.centerY + oy,
            type: 'spike',
            triggered: false,
            cooldownUntil: 0,
          });
        }
      }
    }

    const secretRoom = rooms.find(r => r.type === 'secret');
    if (secretRoom && secretRoom.secretDoor) {
      const parentRoom = rooms.find(r => r.id === secretRoom.secretDoor.fromRoomId);
      if (parentRoom) {
        const dir = secretRoom.secretDoor.dir;
        let wx = parentRoom.centerX;
        let wy = parentRoom.centerY;
        if (dir === 'E') wx = parentRoom.x + parentRoom.w;
        else if (dir === 'W') wx = parentRoom.x;
        else if (dir === 'S') wy = parentRoom.y + parentRoom.h;
        else if (dir === 'N') wy = parentRoom.y;
        this.secretWalls.push({
          x: wx,
          y: wy,
          dir,
          parentRoomId: parentRoom.id,
          secretRoomId: secretRoom.id,
          revealed: false,
        });

        this.chests.push({
          x: secretRoom.centerX,
          y: secretRoom.centerY,
          opened: false,
          isMimic: false,
          armory: true,
          id: `secret_chest_${n}`,
        });
      }
    }

    const eventRooms = rooms.filter(r => r.type === 'event');
    for (let i = 0; i < eventRooms.length; i++) {
      const er = eventRooms[i];
      const evDef = ROOM_EVENTS[Math.floor(this.rng.map.next() * ROOM_EVENTS.length)];
      this.roomEvents.push({
        x: er.centerX,
        y: er.centerY,
        eventDef: evDef,
        used: false,
        id: `event_${n}_${i}`,
      });
    }

    const combatRooms = rooms.filter(r => r.type === 'combat' || r.type === 'elite');
    let cIdx = 0;
    let packCounter = 0;

    for (const spawn of def.spawns) {
      for (let i = 0; i < spawn.n; i++) {
        const targetRoom = combatRooms.length > 0 ? combatRooms[cIdx % combatRooms.length] : rooms[1];
        cIdx++;

        const ox = (this.rng.spawn.next() - 0.5) * (targetRoom.w - 6);
        const oy = (this.rng.spawn.next() - 0.5) * (targetRoom.h - 6);
        const x = targetRoom.centerX + ox;
        const y = targetRoom.centerY + oy;

        const opts = {};
        if (spawn.type === 'mite') {
          if (i % 3 === 0) {
            packCounter++;
            opts.isPackLeader = true;
          }
          opts.packId = `pack${packCounter}`;
        }

        if (targetRoom.type === 'elite' || (n >= 2 && this.rng.spawn.next() < 0.20)) {
          const modKeys = ['frenzied', 'regenerating', 'explosive'];
          opts.eliteMod = modKeys[Math.floor(this.rng.spawn.next() * modKeys.length)];
        }

        const e = createEnemy(spawn.type, x, y, opts);
        if (this.tilemap) resolveCircleTileSlide(e, e.radius ?? 0.35, 0, 0, this.tilemap);
        e.respawnSpot = { x: e.x, y: e.y, defId: spawn.type, opts };
        this.enemies.push(e);
      }
    }
  }

  tryRoll() {
    if (this.player.invOpen || this.blessingSelectionActive) return;
    let dx = this.input.moveX, dy = this.input.moveY;
    if (dx === 0 && dy === 0) {
      dx = Math.cos(this.player.facing);
      dy = Math.sin(this.player.facing);
    }
    if (this.player.tryRoll(dx, dy, this)) this.onSFX('roll');
  }

  tryLamp() {
    if (this.blessingSelectionActive) return;
    if (this.player.lampCd > 0) {
      this.onNotify(`등불 재사용 대기 중 (${Math.ceil(this.player.lampCd)}초 남음)`, 25);
      return;
    }
    if (this.player.tryLamp(this)) {
      this.onSFX('holyBell');
      this.onNoise(this.player.x, this.player.y, 'lamp', 2);
      this.onNotify('✨ 성수 등불 점등 — 시야 대폭 확장 & 시선 상승 정지', 50);
    }
  }

  onLampStun(x, y, radius, dur) {
    for (const e of this.enemies) {
      if (!e.dead && Math.hypot(e.x - x, e.y - y) <= radius) {
        e.stunTimer = dur;
      }
    }
    if (this.boss && this.boss.alive && this.boss.engaged && Math.hypot(this.boss.x - x, this.boss.y - y) <= radius) {
      this.boss.stunTimer = dur;
    }
    if (this.sideBoss && this.sideBoss.alive && this.sideBoss.engaged && Math.hypot(this.sideBoss.x - x, this.sideBoss.y - y) <= radius) {
      this.sideBoss.stunTimer = dur;
    }
    this.onNotify('눈부신 섬광 — 주변 적 경직!', 40);
  }

  onPlayerAttack() {
    this.onSFX('swordSwing');
    this.onNoise(this.player.x, this.player.y, 'attack', 8 * (this.player.noiseRadiusMul ?? 1));
  }

  tryAttack() {
    if (this.blessingSelectionActive) return;
    if (!this.player.tryAttack(this)) return;

    const range = PLAYER_BASE.attack.range;
    const { dmg, isCrit } = this.player.weaponDamageRoll(this.rng.combat);

    let hitSomething = false;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const hit = testConeHit(e.x, e.y, this.player.x, this.player.y, this.player.facing, Math.PI / 1.5, range + 0.6);
      if (!hit) continue;

      let finalDmg = dmg;
      if (e.def.guardReduction) finalDmg *= (1 - e.def.guardReduction);
      if (e.def.armorReduction) finalDmg *= (1 - e.def.armorReduction);

      e.takeDamage(finalDmg, this);
      if (this.player.bleedDps > 0) {
        e.bleedDps = this.player.bleedDps;
        e.bleedTimer = this.player.bleedDur;
      }
      hitSomething = true;
    }

    if (this.boss && this.boss.alive && this.boss.engaged) {
      const d = Math.hypot(this.boss.x - this.player.x, this.boss.y - this.player.y);
      if (d <= range + 1.0) {
        this.boss.takeDamage(dmg, this);
        if (this.player.bleedDps > 0) {
          this.boss.bleedDps = this.player.bleedDps;
          this.boss.bleedTimer = this.player.bleedDur;
        }
        hitSomething = true;
      }
    }
    if (this.sideBoss && this.sideBoss.alive && this.sideBoss.engaged) {
      const d = Math.hypot(this.sideBoss.x - this.player.x, this.sideBoss.y - this.player.y);
      if (d <= range + 1.0) {
        this.sideBoss.takeDamage(dmg, this);
        if (this.player.bleedDps > 0) {
          this.sideBoss.bleedDps = this.player.bleedDps;
          this.sideBoss.bleedTimer = this.player.bleedDur;
        }
        hitSomething = true;
      }
    }

    if (hitSomething) {
      this.onSFX('swordHit');
      if (isCrit) this.onNotify('💥 치명타 적중!', 30);
    }
  }

  tryInteract() {
    if (this.blessingSelectionActive) return;
    const p = this.player;
    const R = PLAYER_BASE.interactRadius;

    // 1. 바닥 드롭 아이템 회수
    for (let i = this.groundItems.length - 1; i >= 0; i--) {
      const it = this.groundItems[i];
      if (Math.hypot(it.x - p.x, it.y - p.y) <= R + 0.8) {
        if (addItem(p.inventory, it)) {
          this.groundItems.splice(i, 1);
          this.onSFX('goldChime');
          this.onNotify(`바닥에서 [${it.name}] 회수`, 40);
          return;
        } else {
          this.onNotify('가방이 가득 차 주울 수 없다', 40);
          return;
        }
      }
    }

    // 2. 다음 층 계단
    if (this.stairs && Math.hypot(this.stairs.x - p.x, this.stairs.y - p.y) <= R + 0.8) {
      return this._descend();
    }

    // 3. 이전 층 복귀 계단
    if (this.prevStairs && Math.hypot(this.prevStairs.x - p.x, this.prevStairs.y - p.y) <= R + 0.8) {
      return this._ascend();
    }

    // 4. 상자
    for (const c of this.chests) {
      if (c.opened) continue;
      if (Math.hypot(c.x - p.x, c.y - p.y) <= R) return this._openChest(c);
    }

    // 5. 제단
    for (const a of this.altars) {
      if (Math.hypot(a.x - p.x, a.y - p.y) <= R) return this._useAltar(a);
    }

    // 6. 비밀 벽
    for (const sw of this.secretWalls) {
      if (!sw.revealed && Math.hypot(sw.x - p.x, sw.y - p.y) <= R + 0.5) {
        return this._revealSecretWall(sw);
      }
    }

    // 7. 방 이벤트 상호작용
    for (const ev of this.roomEvents) {
      if (!ev.used && Math.hypot(ev.x - p.x, ev.y - p.y) <= R + 0.8) {
        return this._triggerRoomEvent(ev);
      }
    }

    // 8. 보스 조우
    if (this.boss && !this.boss.engaged && this.boss.alive) {
      const d = Math.hypot(this.boss.x - p.x, this.boss.y - p.y);
      if (d <= 16) return this._engageBoss();
    }
    if (this.sideBoss && !this.sideBoss.engaged && !this.sideBoss.dead) {
      const d = Math.hypot(this.sideBoss.x - p.x, this.sideBoss.y - p.y);
      if (d <= 16) return this._engageHart();
    }
  }

  _revealSecretWall(sw) {
    if (sw.revealed) return;
    sw.revealed = true;
    this.onSFX('doorOpen');
    this.addRunXp(50);
    const secRoom = this.roomGraph.rooms.find(r => r.id === sw.secretRoomId);
    if (secRoom) {
      secRoom.discovered = true;
      this.visitedRooms.add(secRoom.id);
    }
    this.onNotify('🔍 숨겨진 비밀 통로를 발견했습니다! (+50 XP)', 60);
  }

  _triggerRoomEvent(ev) {
    if (ev.used) return;
    const def = ev.eventDef;
    if (!def) return;
    ev.used = true;
    this.onSFX('blessingCard');

    if (def.id === 'shrine_of_sacrifice') {
      this.player.hp = Math.max(1, this.player.hp - def.costHp);
      const tier = rollLootTier(() => this.rng.loot.next());
      const item = makeLootItem(tier, () => this.rng.loot.next());
      addItem(this.player.inventory, item);
      this.onNotify(`희생의 대가로 [${item.name}]을(를) 획득했습니다! (HP -${def.costHp})`, 60);
    } else if (def.id === 'ancient_library') {
      this.addRunXp(def.xpReward);
      this.onNotify(`고대 서고에서 지식을 탐독했습니다! (+${def.xpReward} XP)`, 60);
    } else if (def.id === 'holy_fountain') {
      this.player.gaze = Math.max(0, this.player.gaze - def.gazeReduce);
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + def.healHp);
      this.onNotify(`정화의 샘에서 안식을 얻었습니다 (시선 -${def.gazeReduce}, HP +${def.healHp})`, 60);
    } else if (def.id === 'cursed_tomb') {
      const item = { id: `tomb_gold_${Date.now()}`, tier: 'rare', name: '도굴한 황금 보물', value: def.goldReward, slot: 1 };
      addItem(this.player.inventory, item);
      for (let i = 0; i < def.ambushCount; i++) {
        const e = createEnemy('skeleton', ev.x + (i * 2 - 1), ev.y, { eliteMod: 'frenzied' });
        if (this.tilemap) resolveCircleTileSlide(e, e.radius ?? 0.35, 0, 0, this.tilemap);
        e.state = 'alert';
        this.enemies.push(e);
      }
      this.onNotify(`무덤을 열어 ${def.goldReward}G 상당의 보물을 얻었지만, 수호자가 깨어납니다!`, 60);
    } else if (def.id === 'prisoner_cage') {
      this.player.atkBonus = (this.player.atkBonus ?? 0) + def.buffDmg;
      this.onNotify(`포로를 구출했습니다! 지원 사격으로 공격력 +${def.buffDmg} 증가`, 60);
    } else if (def.id === 'gambler_chest') {
      const lucky = (this.rng.loot.next() < 0.5);
      if (lucky) {
        const item = makeLootItem('epic', () => this.rng.loot.next());
        addItem(this.player.inventory, item);
        this.onNotify(`도박 성공! [${item.name}] 에픽 전리품을 획득했습니다!`, 60);
      } else {
        this.damagePlayer(def.trapDamage, 'gambler_trap');
        this.onSFX('trapTrigger');
        this.onNotify(`함정이 발동했습니다! (${def.trapDamage} 피해)`, 60);
      }
    } else if (def.id === 'forge_anvil') {
      if ((this.save.weaponLevel ?? 0) < 5) {
        this.save.weaponLevel = (this.save.weaponLevel ?? 0) + 1;
        this.player.weaponLevel = this.save.weaponLevel;
        this.onSFX('shieldBlock');
        this.onNotify(`모루에서 무기를 벼렸습니다! 무기 강화도 +${this.save.weaponLevel}`, 60);
      } else {
        this.onNotify('무기가 이미 최고 강화 상태입니다.', 40);
      }
    } else if (def.id === 'wandering_merchant') {
      const pot = { ...CONSUMABLES.potion, id: `pot_${Date.now()}`, tier: 'consumable' };
      addItem(this.player.inventory, pot);
      this.onNotify('방랑 상인이 긴급 치유 물약을 건넸습니다.', 60);
    }
  }

  _openChest(chest) {
    chest.opened = true;
    this.onSFX('chestOpen');

    if (chest.isMimic) {
      this.onNotify('⚠️ 상자가 이빨을 드러냅니다! 식인 궤 (미믹) 출현!', 60);
      const mimicMob = createEnemy('mimic', chest.x, chest.y);
      if (this.tilemap) resolveCircleTileSlide(mimicMob, mimicMob.radius ?? 0.35, 0, 0, this.tilemap);
      this.enemies.push(mimicMob);
      this.onNoise(chest.x, chest.y, 'hit', 12);
      return;
    }

    this.addRunXp(40);

    const sq01 = this.save.quests?.blade_fragment;
    const alreadyCarrying = this.player.inventory.some(i => i.questItem === 'blade_fragment');

    if (chest.armory && sq01?.state === 'active' && !alreadyCarrying) {
      const item = {
        id: `quest_blade_fragment_${Date.now()}`,
        tier: 'quest',
        name: '왕실 검날 (기억 파편)',
        value: 0,
        slot: 2,
        questItem: 'blade_fragment',
      };
      if (addItem(this.player.inventory, item)) {
        this.onNotify('★ 퀘스트 아이템 획득: 왕실 검날 (기억 파편)', 60);
      } else {
        this.groundItems.push({ ...item, x: chest.x, y: chest.y });
        this.onNotify('가방 가득 참 — 왕실 검날 바닥에 떨어짐 (E로 습득)', 60);
      }
    } else {
      let item;
      if (this.rng.loot.next() < 0.15 && CURSED_RELICS.length > 0) {
        const relicDef = CURSED_RELICS[Math.floor(this.rng.loot.next() * CURSED_RELICS.length)];
        item = {
          id: `relic_${relicDef.id}_${Math.floor(this.rng.loot.next() * 1e9)}`,
          tier: relicDef.tier,
          name: relicDef.name,
          value: relicDef.value,
          slot: relicDef.slot,
          relicId: relicDef.id,
          isCursedRelic: true,
          desc: relicDef.desc,
          effect: relicDef.effect,
        };
      } else {
        const tier = rollLootTier(() => this.rng.loot.next());
        item = makeLootItem(tier, () => this.rng.loot.next());
      }

      if (addItem(this.player.inventory, item)) {
        this.onSFX('goldChime');
        this.onNotify(`[${item.tier.toUpperCase()}] ${item.name} 획득 (+${item.value}G 가치)`, 40);
      } else {
        this.groundItems.push({ ...item, x: chest.x, y: chest.y });
        this.onNotify(`가방 가득 참 — [${item.name}] 바닥에 떨어짐`, 50);
      }
    }

    if (this.floorDef.spawns.some(s => s.type === 'golem')) {
      this.golemRoomTriggered = true;
    }
    this.onNoise(chest.x, chest.y, 'loot', 8 * (this.player.noiseRadiusMul ?? 1));
  }

  _useAltar(altar) {
    if (this.time - altar.usedAt < 45) {
      this.onNotify('제단이 아직 응답하지 않는다', 40);
      return;
    }
    altar.usedAt = this.time;
    this.player.gaze = Math.max(0, this.player.gaze - GAZE.altarReduce);
    this.onSFX('holyBell');
    const d = DIALOGUE.altar_interact[0];
    this.onDialogue(d.speaker, d.text);
    this.onNotify(`시선 -${GAZE.altarReduce}`, 60);
  }

  _descend() {
    if (this.floorNum >= 5) return;
    const nextFloor = this.floorNum + 1;
    if (!this.awardedFloorXp.has(nextFloor)) {
      this.awardedFloorXp.add(nextFloor);
      this.addRunXp(60);
    }
    this.onNotify(`${nextFloor}층으로 전진`, 40);
    this.onSFX('doorOpen');
    this._saveCurrentFloorState();
    this._loadFloor(nextFloor, 'descend');
  }

  _ascend() {
    if (this.floorNum <= 1) return;
    const prevFloor = this.floorNum - 1;
    this.onNotify(`${prevFloor}층으로 후퇴`, 40);
    this.onSFX('doorOpen');
    this._saveCurrentFloorState();
    this._loadFloor(prevFloor, 'ascend');
  }

  _engageBoss() {
    this.boss.engage();
    const d = DIALOGUE.boss_engage[0];
    this.onDialogue(d.speaker, d.text, 5000);
    this.onNotify(`⚔ ${BOSS_WARDEN.name} 조우 — HP ${this.boss.hp}`, 40);
  }

  _engageHart() {
    this.sideBoss.engage();
    const d = DIALOGUE.hart_engage[0];
    this.onDialogue(d.speaker, d.text, 5000);
    this.onNotify(`⚔ ${BOSS_HART.name} 조우 — HP ${this.sideBoss.hp}`, 40);
  }

  useConsumable(consumableId) {
    if (this.blessingSelectionActive) return;
    const item = this.player.inventory.find(i => i.consumableId === consumableId);
    if (!item) {
      this.onNotify(`${consumableId} 없음`, 40);
      return;
    }
    removeItem(this.player.inventory, item.id);

    if (item.effect === 'gaze') {
      this.player.gaze = Math.max(0, this.player.gaze - item.amount);
      this.onSFX('holyBell');
      this.onNotify(`${item.name} 사용 — 시선 -${item.amount}`, 40);
    } else if (item.effect === 'heal') {
      const healAmt = item.amount * (this.player.healMul ?? 1);
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + healAmt);
      this.onNotify(`${item.name} 사용 — HP +${Math.round(healAmt)}`, 40);
    } else if (item.effect === 'healOverTime') {
      this._hotUntil = this.time + 4;
      this._hotPerSec = (item.amount * (this.player.healMul ?? 1)) / 4;
      this.onNotify(`${item.name} 사용 — HP 서서히 회복`, 40);
    } else if (item.effect === 'lampCdReset') {
      this.player.lampCd = 0;
      this.onNotify(`${item.name} 사용 — 등불 쿨다운 초기화`, 40);
    }
  }

  tryGate() {
    if (this.blessingSelectionActive) return;
    const p = this.player;
    const gate = this.gates.find(g => Math.hypot(g.x - p.x, g.y - p.y) <= PLAYER_BASE.interactRadius + 1.8);
    if (!gate) {
      p.charging = false;
      const nearGate = this.gates.some(g => Math.hypot(g.x - p.x, g.y - p.y) <= PLAYER_BASE.interactRadius + 3.0);
      if (!nearGate) {
        p.gateCharge = 0;
      } else if (p.gateCharge > 0) {
        p.gateCharge = Math.max(0, p.gateCharge - this._dt * 1.5);
      }
      return;
    }

    const isOpen = gate.isBossGate || (this.time >= GATE_OPEN_AT_SEC) || (this.floorNum === 1 && this.time >= 60);
    if (!isOpen) {
      if (!this._gateLockedNotified || this.time - this._gateLockedNotified > 3) {
        this.onNotify('게이트가 아직 열리지 않았다 (18분 후 개방)', 40);
        this._gateLockedNotified = this.time;
      }
      return;
    }

    if (!p.charging) {
      p.charging = true;
      p.gateCharge = p.gateCharge ?? 0;
      if (!this.gateAlarmed) {
        this.gateAlarmed = true;
        this.onSFX('gateAlarm');
        this.onNotify('⚠ 전 층 경보! 반경 40m 잔재가 게이트로 집결한다', 40);
        for (const e of this.enemies) {
          if (e.dead) continue;
          if (Math.hypot(e.x - gate.x, e.y - gate.y) <= PLAYER_BASE.gateAlarmRadius) e.state = 'alert';
        }
      }
    }

    p.gateCharge += this._dt;
    if (p.gateCharge >= PLAYER_BASE.gateChargeTime) {
      this.extract();
    }
  }

  extract() {
    if (this.ended) return;
    this.ended = true;

    const summary = this.settlement.settleExtract({
      floor: this.floorNum,
      inventory: this.player.inventory,
      seed: this.seed,
      time: this.time,
      blessings: this.activeBlessings,
    });

    this.onSFX('goldChime');
    this.onEnd(summary);
  }

  addRunXp(amount) {
    this.runXp += amount;
    const nextThreshold = XP_THRESHOLDS[this.blessingLevel] ?? 999999;
    if (this.runXp >= nextThreshold && this.blessingLevel < XP_THRESHOLDS.length) {
      this.blessingLevel++;
      this._triggerBlessingSelection();
    }
  }

  _triggerBlessingSelection() {
    const options = rollBlessingOptions(this.rng.perk, this.activeBlessings, 3);
    if (!options || options.length === 0) return;

    this.blessingSelectionActive = true;
    this.currentBlessingOptions = options;
    this.onSFX('goldChime');
    this.onBlessingPrompt(options, this.blessingLevel);
  }

  chooseBlessing(idx) {
    if (!this.blessingSelectionActive) return;
    if (idx === null || idx === undefined || idx < 0) {
      this.blessingSelectionActive = false;
      this.currentBlessingOptions = [];
      this.onSFX('doorClose');
      this.onNotify('축복을 선택하지 않고 지나쳤습니다', 40);
      return;
    }
    if (!this.currentBlessingOptions[idx]) return;
    const chosen = this.currentBlessingOptions[idx];
    this.blessingSelectionActive = false;
    this.currentBlessingOptions = [];

    this.activeBlessings[chosen.id] = (this.activeBlessings[chosen.id] ?? 0) + 1;
    chosen.apply(this.player);

    this.onSFX('upgradeSuccess');
    this.onNotify(`축복 획득: ${chosen.name}`, 60);
  }

  onNoise(x, y, kind, radius) {
    const R = radius ?? (kind === 'death' ? 22 : kind === 'roll' ? PLAYER_BASE.roll.noiseRadius : 18);
    this.noiseEvents.push({ x, y, t: this.time, radius: R });
    this.onSFX(kind, x, y);
  }

  isNoiseAudible(entity, listenRadius) {
    for (let i = this.noiseEvents.length - 1; i >= 0; i--) {
      const ev = this.noiseEvents[i];
      if (this.time - ev.t > 3) continue;
      const R = Math.max(ev.radius, listenRadius);
      if (Math.hypot(entity.x - ev.x, entity.y - ev.y) <= R) return true;
    }
    return false;
  }

  showVoice(text) {
    this.onNotify(`"${text}"`, 90);
  }

  spawnProjectile(shooter, target, dmg) {
    this.onSFX('crossbowFire');
    const dx = target.x - shooter.x, dy = target.y - shooter.y;
    const d = Math.hypot(dx, dy) || 1;
    this.projectiles.push({
      x: shooter.x, y: shooter.y,
      vx: (dx / d) * 18, vy: (dy / d) * 18,
      dmg, life: 2.2, from: shooter.defId,
    });
  }

  damagePlayer(dmg, source, isDot = false) {
    const p = this.player;
    if (p.dead) return;
    if (p.invulnerable && !isDot) return;

    let final = dmg;
    if (p.guarding && !isDot) {
      final *= (1 - p.guardReduction);
      this.onSFX('shieldBlock');
      this.onNoise(p.x, p.y, 'guardBlock', 8 * (p.noiseRadiusMul ?? 1));
    } else {
      if (!isDot) this.onSFX('hitPlayer');
    }
    p.hp -= final;
    if (p.hp <= 0 && !p.dead) this._onPlayerDeath(source);
  }

  onEnemyDeath(enemy) {
    this.onSFX('swordHit');
    this.player.onKillTrigger();
    this.addRunXp(enemy.def.hp >= 100 ? 50 : 25);

    if (enemy.def.questDrop && this.save.quests?.[enemy.def.questDrop]?.state === 'active') {
      const item = { id: `quest_${enemy.def.questDrop}`, tier: 'quest', name: '병장의 반지', value: 0, slot: 1, questItem: enemy.def.questDrop };
      if (!addItem(this.player.inventory, item)) {
        this.groundItems.push({ ...item, x: enemy.x, y: enemy.y });
        this.onNotify('가방 가득 참 — 병장의 반지 바닥에 떨어짐 (E로 습득)', 60);
      } else {
        this.onNotify('★ 퀘스트 아이템 획득: 병장의 반지', 60);
      }
    }

    const drop = enemy.def.drop;
    if (drop) {
      let tier = null;
      const r = this.rng.loot.next();
      if (drop.epicChance && r < drop.epicChance) tier = 'epic';
      else if (drop.rareChance && r < (drop.epicChance ?? 0) + drop.rareChance) tier = 'rare';
      else if (drop.uncommonChance && r < (drop.epicChance ?? 0) + (drop.rareChance ?? 0) + drop.uncommonChance) tier = 'uncommon';
      else if (drop.commonChance && this.rng.loot.chance(drop.commonChance)) tier = 'common';

      if (tier) {
        const item = makeLootItem(tier, () => this.rng.loot.next());
        if (addItem(this.player.inventory, item)) {
          this.onNotify(`[${tier}] ${item.name} 드롭`, 50);
        } else {
          this.groundItems.push({ ...item, x: enemy.x, y: enemy.y });
          this.onNotify(`가방 가득 참 — [${item.name}] 바닥에 떨어짐 (E로 습득)`, 50);
        }
      }
    }

    if (enemy.def.voiceOnDeath && !enemy.deathVoiceShown) {
      enemy.deathVoiceShown = true;
      this.showVoice(enemy.def.voiceOnDeath);
    }
    enemy.deadAt = this.time;
  }

  onBossPhaseChange(idx) {
    const key = idx === 1 ? 'boss_p2' : idx === 2 ? 'boss_p3' : null;
    if (key) {
      const d = DIALOGUE[key][0];
      this.onDialogue(d.speaker, d.text, 5000);
    }
    this.onNotify(`${BOSS_WARDEN.phases[idx].name} 돌입!`, 40);
  }

  onBossReinforce(n) {
    if (this.huntSpawnCount >= BOSS_WARDEN.phases[2].reinforceCap) return;
    for (let i = 0; i < n && this.huntSpawnCount < BOSS_WARDEN.phases[2].reinforceCap; i++) {
      const type = this.rng.spawn.chance(0.5) ? 'skeleton' : 'mite';
      const e = createEnemy(type, this.boss.x + (this.rng.spawn.next() - 0.5) * 6, this.boss.y + (this.rng.spawn.next() - 0.5) * 6, {});
      if (this.tilemap) resolveCircleTileSlide(e, e.radius ?? 0.35, 0, 0, this.tilemap);
      e.state = 'alert';
      this.enemies.push(e);
      this.huntSpawnCount++;
    }
    this.onNotify('증원 방송 — 잔재가 소환된다!', 40);
  }

  onBossDeath(boss) {
    const d = DIALOGUE.boss_dead[0];
    this.onDialogue(d.speaker, d.text, 6000);
    this.onSFX('questComplete');
    this.addRunXp(200);

    const epic = this.rng.loot.chance(BOSS_WARDEN.epicDropChance);
    for (let i = 0; i < BOSS_WARDEN.guaranteedRareDrops; i++) {
      const item = makeLootItem('rare', () => this.rng.loot.next());
      if (!addItem(this.player.inventory, item)) {
        this.groundItems.push({ ...item, x: boss.x + (i - 1) * 2, y: boss.y });
      }
    }
    if (epic) {
      const item = makeLootItem('epic', () => this.rng.loot.next());
      if (!addItem(this.player.inventory, item)) {
        this.groundItems.push({ ...item, x: boss.x, y: boss.y + 2 });
      }
      this.onNotify('★★★ 에픽 드롭: 심연의 심장!', 80);
    }

    this.gates.push({
      x: boss.x,
      y: boss.y,
      id: 'gate_boss_victory',
      isBossGate: true,
    });
    this.onNotify(`🏆 ${BOSS_WARDEN.name} 처치! 탈출 게이트가 개방되었습니다.`, 60);
  }

  onHartPhaseChange(idx) {
    const key = idx === 1 ? 'hart_p2' : idx === 2 ? 'hart_p3' : null;
    if (key) {
      const d = DIALOGUE[key][0];
      this.onDialogue(d.speaker, d.text, 5000);
    }
    this.onNotify(`${BOSS_HART.phases[idx].name} 돌입!`, 40);
  }

  onHartSummon(n) {
    for (let i = 0; i < n; i++) {
      const e = createEnemy('skeleton', this.sideBoss.x + (this.rng.spawn.next() - 0.5) * 6, this.sideBoss.y + (this.rng.spawn.next() - 0.5) * 6, {});
      if (this.tilemap) resolveCircleTileSlide(e, e.radius ?? 0.35, 0, 0, this.tilemap);
      e.state = 'alert';
      this.enemies.push(e);
    }
    this.showVoice('보고!');
    this.onNotify('하르트가 병정을 소집한다', 40);
  }

  onHartAlertPulse(radius) {
    for (const e of this.enemies) {
      if (!e.dead && e.defId.startsWith('skeleton') && Math.hypot(e.x - this.sideBoss.x, e.y - this.sideBoss.y) <= radius) {
        e.state = 'alert';
      }
    }
    this.onNotify('하르트가 시야를 공유한다 — 주변 병정이 각성한다', 40);
  }

  onHartDeath(boss) {
    const d = DIALOGUE.hart_dead[0];
    this.onDialogue(d.speaker, d.text, 6000);
    this.onSFX('questComplete');
    this.addRunXp(150);

    for (let i = 0; i < BOSS_HART.rareDrops; i++) {
      const item = makeLootItem('rare', () => this.rng.loot.next());
      if (!addItem(this.player.inventory, item)) this.groundItems.push({ ...item, x: boss.x + i, y: boss.y });
    }
    for (let i = 0; i < BOSS_HART.uncommonDrops; i++) {
      const item = makeLootItem('uncommon', () => this.rng.loot.next());
      if (!addItem(this.player.inventory, item)) this.groundItems.push({ ...item, x: boss.x - i, y: boss.y });
    }
    const unique = { ...HART_UNIQUE_ITEM, id: `hart_report_${Date.now()}` };
    if (!addItem(this.player.inventory, unique)) {
      this.groundItems.push({ ...unique, x: boss.x, y: boss.y + 2 });
    }
    this.onNotify(`${BOSS_HART.name} 처치! 전리품 획득`, 60);
  }

  _onPlayerDeath(cause) {
    this.player.dead = true;
    this.onSFX('death');

    const summary = this.settlement.settleDeath({
      floor: this.floorNum,
      cause,
      inventory: this.player.inventory,
      weaponLevel: this.player.weaponLevel,
      seed: this.seed,
      time: this.time,
      blessings: this.activeBlessings,
    });

    this.ended = true;
    this.onEnd(summary);
  }

  _updateTideAndGaze(dt) {
    this.time += dt;

    let newStageIdx = -1;
    for (let i = 0; i < TIDE_STAGES.length; i++) {
      if (this.time >= TIDE_STAGES[i].atSec) newStageIdx = i;
    }
    if (newStageIdx !== this.tideStageIdx) {
      this.tideStageIdx = newStageIdx;
      this.tideAccum = 0;
      if (newStageIdx >= 0) {
        const rhythmKey = newStageIdx === 0 ? 'rhythm_tide_1' : newStageIdx === 1 ? 'rhythm_tide_2' : 'rhythm_tide_3';
        this.onSFX(rhythmKey);
        this.onSFX('tideHorn');
        this.onNotify(`🌊 심연 조수 ${TIDE_STAGES[newStageIdx].label}`, 40);
        const key = newStageIdx === 0 ? 'tide_1' : newStageIdx === 1 ? 'tide_2' : null;
        if (key) {
          const d = DIALOGUE[key][0];
          this.onDialogue(d.speaker, d.text);
        }
      }
    }

    if (this.tideStageIdx >= 0) {
      const stage = TIDE_STAGES[this.tideStageIdx];
      this.tideAccum += dt;
      if (this.tideAccum >= stage.tickSec) {
        this.tideAccum -= stage.tickSec;
        this.damagePlayer(stage.dmgPerTick, 'tide', true);
      }
    }

    if (!this._gateOpenNotified && this.time >= GATE_OPEN_AT_SEC) {
      this._gateOpenNotified = true;
      this.onSFX('rhythm_gate_beacon');
      const d = DIALOGUE.gate_open[0];
      this.onDialogue(d.speaker, d.text);
      this.onNotify('🚪 탈출 게이트 개방!', 40);
    }

    if (!(this.player.lampActiveUntil > this.time)) {
      const relicBonus = this.player.inventory.filter(i => i.tier === 'rare' || i.tier === 'epic').length * GAZE.relicHoldBonusPerSec;
      const gazeSuppressMul = this.player.inventory.some(i => i.effect === 'gazeSuppress')
        ? (1 - HART_UNIQUE_ITEM.amount)
        : 1;
      const blessingMul = this.player.gazeRateMul ?? 1;

      this.player.gaze = Math.min(
        GAZE.max,
        this.player.gaze + (GAZE.riseRatePerSec + relicBonus) * gazeSuppressMul * blessingMul * dt,
      );
    }

    const prevBand = this._prevGazeBand;
    const band = gazeBand(this.player.gaze);
    if (band !== prevBand) {
      this._prevGazeBand = band;
      if (band.min === 61) {
        const d = DIALOGUE.gaze_61[0];
        this.onDialogue(d.speaker, d.text);
      }
      if (band.min === 91) {
        const d = DIALOGUE.gaze_91[0];
        this.onDialogue(d.speaker, d.text, 5000);
      }
    }

    if (this.player.gaze >= GAZE.thresholds.whisper + 1) {
      this._huntRegroup = (this._huntRegroup ?? 0) + dt;
      this._huntSpawn = (this._huntSpawn ?? 0) + dt;
      if (this._huntRegroup >= GAZE.searchPartyRegroupInterval) {
        this._huntRegroup = 0;
        for (const e of this.enemies) {
          if (!e.dead && e.defId.startsWith('skeleton')) e.state = 'alert';
        }
      }
      if (this._huntSpawn >= GAZE.searchPartySpawnInterval) {
        this._huntSpawn = 0;
        if (this.huntSpawnCount < 10) {
          for (let i = 0; i < 2; i++) {
            const e = createEnemy('skeleton', this.player.x + (this.rng.spawn.next() - 0.5) * 10, this.player.y + (this.rng.spawn.next() - 0.5) * 10, {});
            if (this.tilemap) resolveCircleTileSlide(e, e.radius ?? 0.35, 0, 0, this.tilemap);
            e.state = 'alert';
            this.enemies.push(e);
            this.huntSpawnCount++;
          }
          this.onNotify('🔎 수색대 추격 조 발생!', 40);
        }
      }
    }
  }

  update(dtReal, inputState = null) {
    if (this.ended || this.player.dead) return;

    if (this.blessingSelectionActive) {
      if (inputState?.actions?.blessingChoice !== null && inputState?.actions?.blessingChoice !== undefined) {
        this.chooseBlessing(inputState.actions.blessingChoice);
      }
      return;
    }

    const dt = dtReal * this.speedMul;
    this._dt = dt;

    if (inputState) {
      this.input = inputState;
      if (inputState.actions) {
        if (inputState.actions.roll) this.tryRoll();
        if (inputState.actions.lamp) this.tryLamp();
        if (inputState.actions.interact) this.tryInteract();
        if (inputState.actions.attack) this.tryAttack();
        if (inputState.actions.consumable) this.useConsumable(inputState.actions.consumable);
        if (inputState.actions.tabInv) {
          this.player.invOpen = !this.player.invOpen;
          if (this.player.invOpen && (this.time - this._lastTabNoiseTime >= 1.0)) {
            this._lastTabNoiseTime = this.time;
            this.onNoise(this.player.x, this.player.y, 'invOpen', 14 * (this.player.noiseRadiusMul ?? 1));
          }
        }
      }
    }

    this._updateTideAndGaze(dt);

    // 플레이어 이동 및 타일맵 충돌 갱신
    const prevPx = this.player.x;
    const prevPy = this.player.y;
    this.player.update(dt, this.time, this.input, this.tilemap);
    const moved = Math.hypot(this.player.x - prevPx, this.player.y - prevPy);
    this._footstepDist = (this._footstepDist ?? 0) + moved;
    if (this._footstepDist >= 0.9) {
      this._footstepDist = 0;
      const mat = this.floorNum === 1 ? 'coin' : this.floorNum === 2 ? 'bone' : this.floorNum === 5 ? 'flesh' : 'stone';
      const rngVal = this.rng.decor ? this.rng.decor.next() : 0.5;
      this.onSFX(`footstep_${mat}`, this.player.x, this.player.y, rngVal);
    }

    if (this._hotUntil && this.time < this._hotUntil) {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + this._hotPerSec * dt);
    }

    // 마우스 조준 각도 갱신
    if (this.input.facing !== undefined) {
      this.player.facing = this.input.facing;
    } else if (this.input.worldMouseX !== undefined && this.input.worldMouseY !== undefined) {
      this.player.facing = Math.atan2(this.input.worldMouseY - this.player.y, this.input.worldMouseX - this.player.x);
    }

    this.player.x = Math.max(1, Math.min(this.roomW - 1, this.player.x));
    this.player.y = Math.max(1, Math.min(this.roomH - 1, this.player.y));

    // 방 감지 및 방문 등록
    if (this.roomGraph) {
      const curRoom = this.roomGraph.rooms.find(r =>
        this.player.x >= r.x && this.player.x <= r.x + r.w &&
        this.player.y >= r.y && this.player.y <= r.y + r.h
      );
      if (curRoom) {
        this.currentRoomId = curRoom.id;
        this.visitedRooms.add(curRoom.id);
      }
    }

    if (this.input.keys?.has('KeyF')) {
      this.tryGate();
    } else {
      this.player.charging = false;
      const nearGate = this.gates.some(g => Math.hypot(g.x - this.player.x, g.y - this.player.y) <= PLAYER_BASE.interactRadius + 3.0);
      if (!nearGate) {
        this.player.gateCharge = 0;
      } else if (this.player.gateCharge > 0) {
        this.player.gateCharge = Math.max(0, this.player.gateCharge - dt * 1.5);
      }
    }

    // 적 업데이트 및 리스폰
    for (const e of this.enemies) {
      if (e.dead) {
        const spot = e.respawnSpot;
        const interval = this.player.gaze >= 91 ? RESPAWN_SEC_HUNT : RESPAWN_SEC;
        if (spot && this.time - e.deadAt >= interval && spot.defId !== 'skeletonCaptain') {
          const ne = createEnemy(spot.defId, spot.x, spot.y, spot.opts);
          if (this.tilemap) resolveCircleTileSlide(ne, ne.radius ?? 0.35, 0, 0, this.tilemap);
          ne.respawnSpot = spot;
          this.enemies.push(ne);
          e.respawnSpot = null;
        }
        continue;
      }
      e.update(dt, this);
      if (this.tilemap) resolveCircleTileSlide(e, e.radius ?? 0.35, 0, 0, this.tilemap);
      e.x = Math.max(1, Math.min(this.roomW - 1, e.x));
      e.y = Math.max(1, Math.min(this.roomH - 1, e.y));
    }
    this.enemies = this.enemies.filter(e => !(e.dead && !e.respawnSpot && this.time - e.deadAt > 1));

    if (this.boss) {
      this.boss.update(dt, this);
      if (this.tilemap) resolveCircleTileSlide(this.boss, this.boss.radius ?? 0.75, 0, 0, this.tilemap);
    }
    if (this.sideBoss) {
      this.sideBoss.update(dt, this);
      if (this.tilemap) resolveCircleTileSlide(this.sideBoss, this.sideBoss.radius ?? 0.65, 0, 0, this.tilemap);
    }

    // 투사체 이동 및 벽 충돌
    for (const pr of this.projectiles) {
      const prevX = pr.x;
      const prevY = pr.y;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.life -= dt;

      if (checkProjectileWallHit(prevX, prevY, pr.x, pr.y, this.tilemap)) {
        pr.life = 0;
        continue;
      }

      if (Math.hypot(pr.x - this.player.x, pr.y - this.player.y) < 0.7) {
        this.damagePlayer(pr.dmg, pr.from);
        pr.life = 0;
      }
    }

    this.projectiles = this.projectiles.filter(p => p.life > 0);
    this.noiseEvents = this.noiseEvents.filter(ev => this.time - ev.t < 3.5);

    if (this.player.hp <= 0 && !this.player.dead) this._onPlayerDeath('mob');
  }

  snapshotHash() {
    const p = this.player;
    const enemyState = (this.enemies || [])
      .map(e => `${e.defId}:${e.x.toFixed(2)},${e.y.toFixed(2)},${e.hp},${e.state}`)
      .join('|');
    const invState = (p?.inventory || [])
      .map(i => `${i.id}:${i.tier}:${i.value}`)
      .join(';');
    const snapshotStr = [
      `RULES:${RULES_VERSION}`,
      `SEED:${this.seed}`,
      `FLOOR:${this.floorNum}`,
      `TIME:${(this.time || 0).toFixed(2)}`,
      `PL:${p?.x?.toFixed(2)},${p?.y?.toFixed(2)},${p?.hp?.toFixed(1)},${p?.stamina?.toFixed(1)},${p?.gaze?.toFixed(1)},${p?.weaponLevel}`,
      `INV:${invState}`,
      `ENEMIES:${enemyState}`,
      `RUNXP:${this.runXp}`,
      `BLESS:${Object.keys(this.activeBlessings || {}).sort().join(',')}`,
    ].join('##');
    return hashString(snapshotStr);
  }
}
