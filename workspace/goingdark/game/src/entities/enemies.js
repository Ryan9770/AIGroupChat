import { ENEMY_DEFS, ELITE_MODIFIERS, gazeBand } from '../data/data.js';
import { resolveCircleTileSlide, hasLineOfSight } from '../core/collision.js';

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function dirTo(from, to) { const dx = to.x - from.x, dy = to.y - from.y; const d = Math.hypot(dx, dy) || 1; return { x: dx / d, y: dy / d, d }; }

let uid = 1;

export class BaseEnemy {
  constructor(defId, x, y, opts = {}) {
    this.uid = uid++;
    this.defId = defId;
    this.def = ENEMY_DEFS[defId] ?? ENEMY_DEFS.skeleton;
    this.x = x; this.y = y;
    this.radius = opts.radius ?? (this.defId === 'golem' ? 0.55 : 0.35);
    this.lastSeenPos = null;
    
    // 엘리트 변형 적용
    this.eliteMod = opts.eliteMod ?? null;
    const modDef = this.eliteMod ? ELITE_MODIFIERS[this.eliteMod] : null;
    let hpMul = (opts.hpMul ?? 1) * (modDef?.hpMul ?? 1);
    this.hp = this.def.hp * hpMul;
    this.maxHp = this.hp;
    this.spawnX = x; this.spawnY = y;
    this.state = 'idle'; // idle | alert | attack | telegraph | reload | retreat | dead | frenzy
    this.alertUntil = 0;
    this.telegraphTimer = 0;
    this.attackTimer = 0;
    this.dead = false;
    this.packId = opts.packId ?? null;
    this.isPackLeader = opts.isPackLeader ?? false;
    this.frenzyUntil = 0;
    this.facing = 0;
    this.deathVoiceShown = false;
    this.spotVoiceShown = false;
    this.hitFlash = 0;

    // R5 상태 효과: 출혈 및 경직
    this.bleedTimer = 0;
    this.bleedDps = 0;
    this.stunTimer = 0;
  }

  get alive() { return !this.dead; }

  get name() {
    if (this.eliteMod && ELITE_MODIFIERS[this.eliteMod]) {
      return ELITE_MODIFIERS[this.eliteMod].prefix + this.def.name;
    }
    return this.def.name;
  }

  updateStatusEffects(dt, game) {
    if (this.dead) return true;

    // 엘리트 재생 처리
    if (this.eliteMod === 'regenerating' && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + (ELITE_MODIFIERS.regenerating.regenPerSec ?? 4) * dt);
    }

    // R5 출혈 처리
    if (this.bleedTimer > 0) {
      this.bleedTimer -= dt;
      if (this.bleedDps > 0) {
        this.hp -= this.bleedDps * dt;
        this.hitFlash = Math.max(this.hitFlash, 0.08);
        if (this.hp <= 0) {
          this.hp = 0;
          this.die(game);
          return true;
        }
      }
    }

    // R5 경직 처리 (경직 중 행동 불가)
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      return true;
    }

    return false;
  }

  takeDamage(dmg, game) {
    if (this.dead) return;
    this.hp -= dmg;
    this.hitFlash = 0.12;
    game.onNoise(this.x, this.y, 'hit');
    if (this.hp <= 0) {
      this.hp = 0;
      this.die(game);
    } else {
      this.state = 'alert';
      this.alertUntil = game.time + 8;
    }
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    this.state = 'dead';
    game.onNoise(this.x, this.y, 'death');

    // 엘리트 파열 사체 (폭발 피해)
    if (this.eliteMod === 'explosive') {
      const p = game.player;
      if (p && dist(this, p) <= ELITE_MODIFIERS.explosive.explodeRadius) {
        game.damagePlayer(ELITE_MODIFIERS.explosive.explodeDmg, 'elite_explosion');
      }
      game.onNoise(this.x, this.y, 'hit');
    }

    game.onEnemyDeath(this);
  }

  moveBy(dx, dy, game) {
    if (game?.tilemap) {
      resolveCircleTileSlide(this, this.radius, dx, dy, game.tilemap);
    } else {
      this.x += dx;
      this.y += dy;
    }
  }

  detectPlayer(game) {
    const band = gazeBand(game.player.gaze);
    const mul = this.def.soundImmune ? 1.0 : (this.defId.startsWith('skeleton') ? band.skeletonDetectMul : 1.0);
    let range = (this.def.detectRange ?? 10) * mul;
    const d = dist(this, game.player);
    // Q 성수 등불: 반경 6m 내 몹 탐지 -35% (은밀 기동)
    if (game.player.lampActiveUntil > game.time && d <= 6) range *= (1 - 0.35);
    if (d > range) return false;
    // 벽 뒤의 플레이어는 가시선(LOS)이 차단되어 시각적으로 감지 불가 (소음으로만 감지)
    if (game?.tilemap && !hasLineOfSight(this.x, this.y, game.player.x, game.player.y, game.tilemap)) {
      return false;
    }
    return true;
  }
}

export class SkeletonEnemy extends BaseEnemy {
  constructor(defId, x, y, opts) {
    super(defId, x, y, opts);
    this.ammo = this.def.magazine;
    this.reloadTimer = 0;
    this.shotTimer = 0;
  }

  update(dt, game) {
    if (this.dead) return;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.updateStatusEffects(dt, game)) return;

    const p = game.player;
    const d = dist(this, p);

    if (this.state === 'idle') {
      if (this.detectPlayer(game) || game.isNoiseAudible(this, 26)) {
        this.state = 'alert';
        this.alertUntil = game.time + 8;
        if (!this.spotVoiceShown) { game.showVoice(this.def.voiceOnSpot); this.spotVoiceShown = true; }
      }
      return;
    }

    const hasLos = !game?.tilemap || hasLineOfSight(this.x, this.y, p.x, p.y, game.tilemap);
    if (hasLos) {
      this.lastSeenPos = { x: p.x, y: p.y };
      this.alertUntil = game.time + 8;
    } else if (this.lastSeenPos && dist(this, this.lastSeenPos) < 1.0) {
      this.lastSeenPos = null;
    }

    if (!hasLos && !this.lastSeenPos && game.time > this.alertUntil) {
      this.state = 'idle';
      return;
    }

    // alert / combat behavior
    const target = (hasLos || !this.lastSeenPos) ? p : this.lastSeenPos;
    const dir = dirTo(this, target);
    this.facing = Math.atan2(dir.y, dir.x);
    const speedMul = (this.eliteMod === 'frenzied' ? ELITE_MODIFIERS.frenzied.speedMul : 1);
    const speed = this.def.moveSpeed * speedMul;

    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this.ammo = this.def.magazine;
    }

    if (hasLos && d < this.def.retreatDist + 1 && d < this.def.attackRange) {
      // 후퇴 사격: 벽을 뚫지 않고 슬라이딩하며 거리 벌리기
      this.moveBy(-dir.x * speed * dt, -dir.y * speed * dt, game);
    } else if (d > this.def.attackRange || !hasLos) {
      this.moveBy(dir.x * speed * dt, dir.y * speed * dt, game);
    }

    const telegraphDuration = this.def.telegraphSec ?? 0.6;
    if (hasLos && this.reloadTimer <= 0 && this.ammo > 0 && d <= this.def.attackRange) {
      this.shotTimer -= dt;
      if (this.shotTimer <= telegraphDuration && this.shotTimer > 0) {
        if (this.state !== 'telegraph') {
          this.state = 'telegraph';
          this.attackKind = 'shoot';
          game.onNoise?.(this.x, this.y, 'crossbow_click');
        }
        this.telegraphTimer = this.shotTimer;
      } else if (this.shotTimer <= 0) {
        this.state = 'alert';
        const dmgMul = (this.eliteMod === 'frenzied' ? ELITE_MODIFIERS.frenzied.dmgMul : 1);
        game.spawnProjectile(this, p, this.def.dmg * dmgMul);
        this.ammo -= 1;
        this.shotTimer = this.def.shotIntervalSec + telegraphDuration;
        if (this.ammo <= 0) this.reloadTimer = this.def.reloadSec;
      }
    } else if (this.state === 'telegraph') {
      this.state = 'alert';
    }
  }
}

export class MiteEnemy extends BaseEnemy {
  update(dt, game) {
    if (this.dead) return;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.updateStatusEffects(dt, game)) return;

    const p = game.player;
    const d = dist(this, p);
    const frenzied = game.time < this.frenzyUntil;
    const band = gazeBand(p.gaze);

    if (this.state === 'idle') {
      const alertR = band.miteAlertRadius;
      if (this.detectPlayer(game) || game.isNoiseAudible(this, alertR)) {
        this.state = 'alert';
        this.alertUntil = game.time + 8;
      }
      return;
    }

    const hasLos = !game?.tilemap || hasLineOfSight(this.x, this.y, p.x, p.y, game.tilemap);
    if (hasLos) {
      this.lastSeenPos = { x: p.x, y: p.y };
      this.alertUntil = game.time + 8;
    } else if (this.lastSeenPos && dist(this, this.lastSeenPos) < 1.0) {
      this.lastSeenPos = null;
    }

    if (!hasLos && !this.lastSeenPos && game.time > this.alertUntil) {
      this.state = 'idle';
      return;
    }

    const target = (hasLos || !this.lastSeenPos) ? p : this.lastSeenPos;
    const dir = dirTo(this, target);
    this.facing = Math.atan2(dir.y, dir.x);
    let speed = frenzied ? this.def.frenzySpeed : this.def.moveSpeed;
    if (this.eliteMod === 'frenzied') speed *= ELITE_MODIFIERS.frenzied.speedMul;

    const leapTelegraph = this.def.leapTelegraphSec ?? 0.45;
    if (d > this.def.attackRange || !hasLos) {
      if (this.state === 'telegraph') this.state = 'alert';
      this.moveBy(dir.x * speed * dt, dir.y * speed * dt, game);
    } else {
      this.attackTimer -= dt;
      if (this.attackTimer <= leapTelegraph && this.attackTimer > 0) {
        if (this.state !== 'telegraph') {
          this.state = 'telegraph';
          this.attackKind = 'bite';
          game.onNoise?.(this.x, this.y, 'bite');
        }
        this.telegraphTimer = this.attackTimer;
      } else if (this.attackTimer <= 0) {
        this.state = 'alert';
        const dmgMul = (this.eliteMod === 'frenzied' ? ELITE_MODIFIERS.frenzied.dmgMul : 1);
        game.damagePlayer(this.def.biteDmg * dmgMul, 'mite');
        this.attackTimer = this.def.biteInterval;
      }
    }
  }

  die(game) {
    super.die(game);
    if (this.isPackLeader && game.enemies) {
      for (const e of game.enemies) {
        if (e.packId === this.packId && !e.dead) e.frenzyUntil = game.time + 4;
      }
    }
  }
}

export class GolemEnemy extends BaseEnemy {
  constructor(defId, x, y, opts) {
    super(defId, x, y, opts);
    this.attackKind = null;
    this.sweepCombo = 0;
  }

  update(dt, game) {
    if (this.dead) return;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.updateStatusEffects(dt, game)) return;

    const p = game.player;
    const d = dist(this, p);
    const band = gazeBand(p.gaze);

    if (this.state === 'idle') {
      if (this.detectPlayer(game) || game.golemRoomTriggered) {
        this.state = 'alert';
        this.alertUntil = game.time + 8;
      }
      return;
    }

    const hasLos = !game?.tilemap || hasLineOfSight(this.x, this.y, p.x, p.y, game.tilemap);
    if (hasLos) {
      this.lastSeenPos = { x: p.x, y: p.y };
      this.alertUntil = game.time + 8;
    } else if (this.lastSeenPos && dist(this, this.lastSeenPos) < 1.0) {
      this.lastSeenPos = null;
    }

    if (!hasLos && !this.lastSeenPos && game.time > this.alertUntil) {
      this.state = 'idle';
      return;
    }

    const target = (hasLos || !this.lastSeenPos) ? p : this.lastSeenPos;
    const toSpawn = dist(this, { x: this.spawnX, y: this.spawnY });
    const dir = dirTo(this, target);
    this.facing = Math.atan2(dir.y, dir.x);

    const dmgMul = (this.eliteMod === 'frenzied' ? ELITE_MODIFIERS.frenzied.dmgMul : 1);

    if (this.state === 'telegraph') {
      this.telegraphTimer -= dt;
      if (this.telegraphTimer <= 0) {
        if (this.attackKind === 'slam' && dist(this, p) <= this.def.slamRadius) {
          game.damagePlayer(this.def.slamDmg * dmgMul, 'golem');
        } else if (this.attackKind === 'sweep' && dist(this, p) <= 2.4) {
          game.damagePlayer(this.def.sweepDmg * dmgMul, 'golem');
        }
        if (this.attackKind === 'sweep' && this.sweepCombo < 1) {
          this.sweepCombo += 1;
          this.telegraphTimer = this.def.sweepTelegraph / band.golemTelegraphMul;
        } else {
          this.sweepCombo = 0;
          this.state = 'alert';
          this.attackTimer = 1.0;
        }
      }
      return;
    }

    if (toSpawn > this.def.leashRadius && d > this.def.leashRadius) {
      // 이탈 불가 — 스폰 지점 복귀
      const back = dirTo(this, { x: this.spawnX, y: this.spawnY });
      this.moveBy(back.x * this.def.moveSpeed * dt, back.y * this.def.moveSpeed * dt, game);
      return;
    }

    if (d <= 2.4 && hasLos) {
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) {
        this.state = 'telegraph';
        const rngRoll = game.rng?.combat ? game.rng.combat.next() : 0.5;
        this.attackKind = rngRoll < 0.5 ? 'slam' : 'sweep';
        this.telegraphTimer = (this.attackKind === 'slam' ? this.def.slamTelegraph : this.def.sweepTelegraph) / band.golemTelegraphMul;
      }
    } else {
      const speedMul = (this.eliteMod === 'frenzied' ? ELITE_MODIFIERS.frenzied.speedMul : 1);
      this.moveBy(dir.x * this.def.moveSpeed * speedMul * dt, dir.y * this.def.moveSpeed * speedMul * dt, game);
    }
  }
}

export class RoyalGuardEnemy extends BaseEnemy {
  update(dt, game) {
    if (this.dead) return;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.updateStatusEffects(dt, game)) return;

    const p = game.player;
    const d = dist(this, p);

    if (this.state === 'idle') {
      if (this.detectPlayer(game)) {
        this.state = 'alert';
        this.alertUntil = game.time + 8;
        if (!this.spotVoiceShown) { game.showVoice(this.def.voiceOnSpot); this.spotVoiceShown = true; }
      }
      return;
    }

    const hasLos = !game?.tilemap || hasLineOfSight(this.x, this.y, p.x, p.y, game.tilemap);
    if (hasLos) {
      this.lastSeenPos = { x: p.x, y: p.y };
      this.alertUntil = game.time + 8;
    } else if (this.lastSeenPos && dist(this, this.lastSeenPos) < 1.0) {
      this.lastSeenPos = null;
    }

    if (!hasLos && !this.lastSeenPos && game.time > this.alertUntil) {
      this.state = 'idle';
      return;
    }

    const target = (hasLos || !this.lastSeenPos) ? p : this.lastSeenPos;
    const dir = dirTo(this, target);
    this.facing = Math.atan2(dir.y, dir.x);
    const speedMul = (this.eliteMod === 'frenzied' ? ELITE_MODIFIERS.frenzied.speedMul : 1);
    const speed = this.def.moveSpeed * speedMul;
    const guardTelegraph = 0.45;

    if (d > this.def.attackRange || !hasLos) {
      if (this.state === 'telegraph') this.state = 'alert';
      this.moveBy(dir.x * speed * dt, dir.y * speed * dt, game);
    } else {
      this.attackTimer -= dt;
      if (this.attackTimer <= guardTelegraph && this.attackTimer > 0) {
        if (this.state !== 'telegraph') {
          this.state = 'telegraph';
          this.attackKind = 'thrust';
          game.onNoise?.(this.x, this.y, 'thrust');
        }
        this.telegraphTimer = this.attackTimer;
      } else if (this.attackTimer <= 0) {
        this.state = 'alert';
        const dmgMul = (this.eliteMod === 'frenzied' ? ELITE_MODIFIERS.frenzied.dmgMul : 1);
        game.damagePlayer(this.def.dmg * dmgMul, 'royalGuard');
        this.attackTimer = this.def.meleeInterval;
      }
    }
  }
}

// 신규 일반 적 1: 어둠 광신도 (Cultist)
export class CultistEnemy extends BaseEnemy {
  constructor(defId, x, y, opts) {
    super(defId, x, y, opts);
    this.shotTimer = 1.0;
  }

  update(dt, game) {
    if (this.dead) return;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.updateStatusEffects(dt, game)) return;

    const p = game.player;
    const d = dist(this, p);

    if (this.state === 'idle') {
      if (this.detectPlayer(game) || game.isNoiseAudible(this, 24)) {
        this.state = 'alert';
        this.alertUntil = game.time + 8;
        if (!this.spotVoiceShown) { game.showVoice(this.def.voiceOnSpot); this.spotVoiceShown = true; }
      }
      return;
    }

    const hasLos = !game?.tilemap || hasLineOfSight(this.x, this.y, p.x, p.y, game.tilemap);
    if (hasLos) {
      this.lastSeenPos = { x: p.x, y: p.y };
      this.alertUntil = game.time + 8;
    } else if (this.lastSeenPos && dist(this, this.lastSeenPos) < 1.0) {
      this.lastSeenPos = null;
    }

    if (!hasLos && !this.lastSeenPos && game.time > this.alertUntil) {
      this.state = 'idle';
      return;
    }

    const target = (hasLos || !this.lastSeenPos) ? p : this.lastSeenPos;
    const dir = dirTo(this, target);
    this.facing = Math.atan2(dir.y, dir.x);
    const speedMul = (this.eliteMod === 'frenzied' ? ELITE_MODIFIERS.frenzied.speedMul : 1);
    const speed = this.def.moveSpeed * speedMul;

    if (hasLos && d < this.def.retreatDist && d < this.def.attackRange) {
      this.moveBy(-dir.x * speed * dt, -dir.y * speed * dt, game);
    } else if (d > this.def.attackRange || !hasLos) {
      this.moveBy(dir.x * speed * dt, dir.y * speed * dt, game);
    }

    const cultistTelegraph = this.def.telegraphSec ?? 0.6;
    if (hasLos && d <= this.def.attackRange) {
      this.shotTimer -= dt;
      if (this.shotTimer <= cultistTelegraph && this.shotTimer > 0) {
        if (this.state !== 'telegraph') {
          this.state = 'telegraph';
          this.attackKind = 'dark_orb';
          game.onNoise?.(this.x, this.y, 'chant');
        }
        this.telegraphTimer = this.shotTimer;
      } else if (this.shotTimer <= 0) {
        this.state = 'alert';
        const dmgMul = (this.eliteMod === 'frenzied' ? ELITE_MODIFIERS.frenzied.dmgMul : 1);
        game.spawnProjectile(this, p, this.def.dmg * dmgMul, 'dark');
        this.shotTimer = this.def.shotIntervalSec + cultistTelegraph;
      }
    } else if (this.state === 'telegraph') {
      this.state = 'alert';
    }
  }
}

// 신규 일반 적 2: 심연 망령 (Wraith)
export class WraithEnemy extends BaseEnemy {
  constructor(defId, x, y, opts) {
    super(defId, x, y, opts);
  }

  update(dt, game) {
    if (this.dead) return;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.updateStatusEffects(dt, game)) return;

    const p = game.player;
    const d = dist(this, p);

    if (this.state === 'idle') {
      if (this.detectPlayer(game) || game.isNoiseAudible(this, 20)) {
        this.state = 'alert';
        this.alertUntil = game.time + 8;
        if (!this.spotVoiceShown) { game.showVoice(this.def.voiceOnSpot); this.spotVoiceShown = true; }
      }
      return;
    }

    const hasLos = !game?.tilemap || hasLineOfSight(this.x, this.y, p.x, p.y, game.tilemap);
    if (hasLos) {
      this.lastSeenPos = { x: p.x, y: p.y };
      this.alertUntil = game.time + 8;
    } else if (this.lastSeenPos && dist(this, this.lastSeenPos) < 1.0) {
      this.lastSeenPos = null;
    }

    if (!hasLos && !this.lastSeenPos && game.time > this.alertUntil) {
      this.state = 'idle';
      return;
    }

    const target = (hasLos || !this.lastSeenPos) ? p : this.lastSeenPos;
    const dir = dirTo(this, target);
    this.facing = Math.atan2(dir.y, dir.x);
    const speedMul = (this.eliteMod === 'frenzied' ? ELITE_MODIFIERS.frenzied.speedMul : 1);
    const speed = this.def.moveSpeed * speedMul;

    const wraithTelegraph = 0.5;
    if (d > this.def.attackRange || !hasLos) {
      if (this.state === 'telegraph') this.state = 'alert';
      this.moveBy(dir.x * speed * dt, dir.y * speed * dt, game);
    } else {
      this.attackTimer -= dt;
      if (this.attackTimer <= wraithTelegraph && this.attackTimer > 0) {
        if (this.state !== 'telegraph') {
          this.state = 'telegraph';
          this.attackKind = 'chill';
          game.onNoise?.(this.x, this.y, 'chill');
        }
        this.telegraphTimer = this.attackTimer;
      } else if (this.attackTimer <= 0) {
        this.state = 'alert';
        const dmgMul = (this.eliteMod === 'frenzied' ? ELITE_MODIFIERS.frenzied.dmgMul : 1);
        game.damagePlayer(this.def.dmg * dmgMul, 'wraith');
        if (p.applySlowDebuff) p.applySlowDebuff(this.def.slowDuration);
        this.attackTimer = this.def.meleeInterval;
      }
    }
  }
}

// 신규 기믹 몬스터: 미믹 상자 (Mimic)
export class MimicEnemy extends BaseEnemy {
  constructor(defId, x, y, opts) {
    super(defId, x, y, opts);
    this.state = 'alert'; // 깨어나면 즉시 전투 상태
  }

  update(dt, game) {
    if (this.dead) return;
    if (this.hitFlash > 0) this.hitFlash -= dt;
    if (this.updateStatusEffects(dt, game)) return;

    const p = game.player;
    const d = dist(this, p);
    const hasLos = !game?.tilemap || hasLineOfSight(this.x, this.y, p.x, p.y, game.tilemap);
    if (hasLos) {
      this.lastSeenPos = { x: p.x, y: p.y };
    } else if (this.lastSeenPos && dist(this, this.lastSeenPos) < 1.0) {
      this.lastSeenPos = null;
    }

    const target = (hasLos || !this.lastSeenPos) ? p : this.lastSeenPos;
    const dir = dirTo(this, target);
    this.facing = Math.atan2(dir.y, dir.x);
    const speed = this.def.moveSpeed;

    if (d > this.def.attackRange || !hasLos) {
      this.moveBy(dir.x * speed * dt, dir.y * speed * dt, game);
    } else {
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) {
        game.damagePlayer(this.def.dmg, 'mimic');
        this.attackTimer = this.def.meleeInterval;
      }
    }
  }
}

export function createEnemy(defId, x, y, opts = {}) {
  if (defId === 'mite') return new MiteEnemy(defId, x, y, opts);
  if (defId === 'golem') return new GolemEnemy(defId, x, y, opts);
  if (defId === 'royalGuard') return new RoyalGuardEnemy(defId, x, y, opts);
  if (defId === 'cultist') return new CultistEnemy(defId, x, y, opts);
  if (defId === 'wraith') return new WraithEnemy(defId, x, y, opts);
  if (defId === 'mimic') return new MimicEnemy(defId, x, y, opts);
  return new SkeletonEnemy(defId, x, y, opts); // skeleton, skeletonCaptain
}
