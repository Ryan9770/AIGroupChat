import { BOSS_WARDEN, BOSS_HART, gazeBand } from '../data/data.js';
import { resolveCircleTileSlide } from '../core/collision.js';

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function dirTo(from, to) { const dx = to.x - from.x, dy = to.y - from.y; const d = Math.hypot(dx, dy) || 1; return { x: dx / d, y: dy / d, d }; }

export class Warden {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.radius = 0.75;
    this.hp = BOSS_WARDEN.hp;
    this.maxHp = BOSS_WARDEN.hp;
    this.phaseIdx = 0;
    this.dead = false;
    this.state = 'idle'; // idle | move | telegraph | recover
    this.telegraphTimer = 0;
    this.attackTimer = 3;
    this.waveTimer = BOSS_WARDEN.phases[1]?.waveIntervalSec ?? 15;
    this.reinforceTimer = 15;
    this.currentAttack = null;
    this.facing = 0;
    this.markedUntil = 0;
    this.markStartAt = 0;
    this.engaged = false;
    this.hitFlash = 0;
    this.poolZones = []; // {x,y,until}
    this.name = BOSS_WARDEN.name;
    this.bleedTimer = 0;
    this.bleedDps = 0;
    this.stunTimer = 0;
  }

  get phase() { return BOSS_WARDEN.phases[this.phaseIdx]; }
  get alive() { return !this.dead; }

  takeDamage(dmg, game, isBleed = false) {
    if (this.dead || !this.engaged) return;
    this.hp -= dmg;
    this.hitFlash = Math.max(this.hitFlash, 0.12);
    if (!isBleed) game.onNoise(this.x, this.y, 'hit');
    const prevPhase = this.phaseIdx;
    if (this.hp <= BOSS_WARDEN.phases[2].from && this.phaseIdx < 2) this.phaseIdx = 2;
    else if (this.hp <= BOSS_WARDEN.phases[1].from && this.phaseIdx < 1) this.phaseIdx = 1;
    if (this.phaseIdx !== prevPhase) {
      this.state = 'idle'; this.attackTimer = 1.5;
      game.onBossPhaseChange(this.phaseIdx);
    }
    if (this.hp <= 0) { this.hp = 0; this.die(game); }
  }

  die(game) {
    this.dead = true;
    this.state = 'dead';
    game.onBossDeath(this);
  }

  engage() { this.engaged = true; }

  moveBy(dx, dy, game) {
    if (game?.tilemap) {
      resolveCircleTileSlide(this, this.radius, dx, dy, game.tilemap);
    } else {
      this.x += dx;
      this.y += dy;
    }
  }

  update(dt, game) {
    if (this.dead || !this.engaged) return;
    if (this.hitFlash > 0) this.hitFlash -= dt;

    if (this.bleedTimer > 0) {
      this.bleedTimer -= dt;
      if (this.bleedDps > 0) {
        this.takeDamage(this.bleedDps * dt, game, true);
        if (this.dead) return;
      }
    }
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      return;
    }

    const p = game.player;
    const band = gazeBand(p.gaze);
    this.poolZones = this.poolZones.filter(z => z.until > game.time);
    for (const z of this.poolZones) {
      if (Math.hypot(p.x - z.x, p.y - z.y) < 1.4) game.damagePlayer(this.phase.poolDps * dt, 'boss', true);
    }

    if (this.phaseIdx < 2) {
      const dir = dirTo(this, p);
      this.facing = Math.atan2(dir.y, dir.x);
      const d = dist(this, p);
      if (this.state === 'idle' || this.state === 'move') {
        this.state = 'move';
        if (d > 2.0) {
          this.moveBy(dir.x * this.phase.moveSpeed * dt, dir.y * this.phase.moveSpeed * dt, game);
        }
        this.attackTimer -= dt;
        if (this.phaseIdx === 1) {
          this.waveTimer -= dt;
          if (this.waveTimer <= 0) { this.waveTimer = this.phase.waveIntervalSec; this.fireWave(game); }
        }
        if (this.attackTimer <= 0) this.beginAttack(game, d);
      } else if (this.state === 'telegraph') {
        this.telegraphTimer -= dt;
        if (this.telegraphTimer <= 0) this.resolveAttack(game);
      }
    } else {
      // P3: 고정 포대
      const dir = dirTo(this, p);
      this.facing = Math.atan2(dir.y, dir.x);
      this.reinforceTimer -= dt;
      const interval = band.bossReinforceInterval;
      if (this.reinforceTimer <= 0) { this.reinforceTimer = interval; game.onBossReinforce?.(2); }
      if (this.state === 'idle') {
        this.attackTimer -= dt;
        if (this.attackTimer <= 0) this.beginAttack(game, dist(this, p));
      } else if (this.state === 'telegraph') {
        this.telegraphTimer -= dt;
        if (this.telegraphTimer <= 0) this.resolveAttack(game);
      }
    }
  }

  beginAttack(game, d) {
    const ph = this.phase;
    if (this.phaseIdx === 0) {
      this.currentAttack = d <= 2.4 ? 'slash' : 'thrust';
      this.telegraphTimer = this.currentAttack === 'slash' ? ph.slashTelegraph : ph.thrustTelegraph;
    } else if (this.phaseIdx === 1) {
      this.currentAttack = 'spear';
      this.telegraphTimer = ph.spearTelegraph;
    } else {
      const rngRoll = (game.rng?.combat ? game.rng.combat.next() : 0.5);
      this.currentAttack = rngRoll < 0.5 ? 'aoe' : 'gazeBeam';
      this.telegraphTimer = this.currentAttack === 'aoe' ? ph.aoeTelegraph : ph.gazeBeamMarkSec;
      if (this.currentAttack === 'gazeBeam') this.markStartAt = game.time;
    }
    this.state = 'telegraph';
  }

  resolveAttack(game) {
    const ph = this.phase;
    const p = game.player;
    const d = dist(this, p);
    if (this.currentAttack === 'slash' && d <= 2.6) game.damagePlayer(ph.slashDmg, 'boss');
    else if (this.currentAttack === 'thrust' && d <= ph.thrustRange) game.damagePlayer(ph.thrustDmg, 'boss');
    else if (this.currentAttack === 'spear' && d <= 4.2) {
      game.damagePlayer(ph.spearDmg, 'boss');
      this.poolZones.push({ x: p.x, y: p.y, until: game.time + ph.poolDur });
    } else if (this.currentAttack === 'aoe' && d <= ph.aoeRadius) game.damagePlayer(ph.aoeDmg, 'boss');
    else if (this.currentAttack === 'gazeBeam' && d <= 6) game.damagePlayer(ph.gazeBeamDmg, 'boss');
    this.state = 'idle';
    this.attackTimer = this.phaseIdx === 2 ? 2.5 : 1.4;
  }

  fireWave(game) {
    const p = game.player;
    const d = dist(this, p);
    if (d < 7 && !game.player.justRolled) {
      game.damagePlayer(this.phase.waveDmg, 'boss');
      game.player.speedDebuffUntil = game.time + 3;
    }
  }
}

// 보스 E1 '보고하는 자 병정장 하르트' (07_extension_pack.md §B) — 4층 사이드 보스
export class Hart {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.radius = 0.65;
    this.hp = BOSS_HART.hp;
    this.maxHp = BOSS_HART.hp;
    this.phaseIdx = 0;
    this.dead = false;
    this.state = 'idle'; // idle | move | telegraph | volley | dead
    this.telegraphTimer = 0;
    this.attackTimer = 2;
    this.volleyLeft = 0;
    this.currentAttack = null;
    this.facing = 0;
    this.engaged = false;
    this.hitFlash = 0;
    this.name = BOSS_HART.name;
    this.summonedP1 = false;
    this.pulsedP2 = false;
    this.bleedTimer = 0;
    this.bleedDps = 0;
    this.stunTimer = 0;
  }

  get phase() { return BOSS_HART.phases[this.phaseIdx]; }
  get alive() { return !this.dead; }

  engage() { this.engaged = true; }

  moveBy(dx, dy, game) {
    if (game?.tilemap) {
      resolveCircleTileSlide(this, this.radius, dx, dy, game.tilemap);
    } else {
      this.x += dx;
      this.y += dy;
    }
  }

  takeDamage(dmg, game, isBleed = false) {
    if (this.dead || !this.engaged) return;
    this.hp -= dmg;
    this.hitFlash = Math.max(this.hitFlash, 0.12);
    if (!isBleed) game.onNoise(this.x, this.y, 'hit');
    const prevPhase = this.phaseIdx;
    if (this.hp <= BOSS_HART.phases[2].from && this.phaseIdx < 2) this.phaseIdx = 2;
    else if (this.hp <= BOSS_HART.phases[1].from && this.phaseIdx < 1) this.phaseIdx = 1;
    if (this.phaseIdx !== prevPhase) {
      this.state = 'idle'; this.attackTimer = 1.2;
      game.onHartPhaseChange(this.phaseIdx);
    }
    if (this.hp <= 0) { this.hp = 0; this.die(game); }
  }

  die(game) {
    this.dead = true;
    this.state = 'dead';
    game.onHartDeath(this);
  }

  update(dt, game) {
    if (this.dead || !this.engaged) return;
    if (this.hitFlash > 0) this.hitFlash -= dt;

    if (this.bleedTimer > 0) {
      this.bleedTimer -= dt;
      if (this.bleedDps > 0) {
        this.takeDamage(this.bleedDps * dt, game, true);
        if (this.dead) return;
      }
    }
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      return;
    }

    const p = game.player;
    const dir = dirTo(this, p);
    this.facing = Math.atan2(dir.y, dir.x);
    const d = dist(this, p);

    if (this.phaseIdx === 0 && !this.summonedP1) {
      this.summonedP1 = true;
      game.onHartSummon?.(2);
    }
    if (this.phaseIdx === 1 && !this.pulsedP2) {
      this.pulsedP2 = true;
      game.onHartAlertPulse?.(this.phase.alertPulseRadius);
    }

    if (this.phaseIdx < 2) {
      if (this.state === 'idle' || this.state === 'move') {
        this.state = 'move';
        if (d > 3.0) {
          this.moveBy(dir.x * this.phase.moveSpeed * dt, dir.y * this.phase.moveSpeed * dt, game);
        }
        this.attackTimer -= dt;
        if (this.attackTimer <= 0) this.beginAttack(game, d);
      } else if (this.state === 'telegraph') {
        this.telegraphTimer -= dt;
        if (this.telegraphTimer <= 0) this.resolveAttack(game);
      }
    } else {
      // P3: 고정, 창 3연사(문을 잠그고 후퇴하는 서사는 정지+연사로 단순화 — README 참조)
      if (this.state === 'idle') {
        this.attackTimer -= dt;
        if (this.attackTimer <= 0) this.beginAttack(game, d);
      } else if (this.state === 'telegraph') {
        this.telegraphTimer -= dt;
        if (this.telegraphTimer <= 0) {
          this.resolveSpear(game);
          this.volleyLeft -= 1;
          if (this.volleyLeft > 0) { this.telegraphTimer = this.phase.volleyIntervalSec; }
          else { this.state = 'idle'; this.attackTimer = 2.5; }
        }
      }
    }
  }

  beginAttack(game, d) {
    const ph = this.phase;
    if (this.phaseIdx === 2) {
      this.currentAttack = 'spear';
      this.state = 'telegraph';
      this.telegraphTimer = ph.spearTelegraph;
      this.volleyLeft = ph.volleyCount;
      return;
    }
    this.currentAttack = d <= ph.spinRange + 0.5 ? 'spin' : 'spear';
    this.telegraphTimer = this.currentAttack === 'spin' ? ph.spinTelegraph : ph.spearTelegraph;
    this.state = 'telegraph';
  }

  resolveAttack(game) {
    const ph = this.phase;
    const d = dist(this, game.player);
    if (this.currentAttack === 'spin' && d <= ph.spinRange) game.damagePlayer(ph.spinDmg, 'hart');
    else if (this.currentAttack === 'spear' && d <= ph.spearRange) game.damagePlayer(ph.spearDmg, 'hart');
    this.state = 'idle';
    this.attackTimer = 1.3;
  }

  resolveSpear(game) {
    const ph = this.phase;
    const d = dist(this, game.player);
    if (d <= ph.spearRange) game.damagePlayer(ph.spearDmg, 'hart');
  }
}
