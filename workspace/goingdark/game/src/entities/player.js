// ============================================================================
// 플레이어 엔티티 (Player)
// 이동, 스태미나, 가드, 구르기 무적, 근접 공격, 등불 스킬
// P0 감속 디버프 시뮬레이션 시간 비교 수정 및 축복(빌드) 수치 훅 연동
// ============================================================================

import { PLAYER_BASE, UPGRADE_DMG_BONUS_PER_LEVEL } from '../data/data.js';
import { heavyItemCount } from '../systems/inventory.js';
import { resolveCircleTileSlide } from '../core/collision.js';

export class Player {
  constructor(saveState) {
    this.x = 0;
    this.y = 0;
    this.hp = PLAYER_BASE.hp;
    this.maxHp = PLAYER_BASE.hp;
    this.stamina = PLAYER_BASE.stamina;
    this.maxStamina = PLAYER_BASE.stamina;
    this.gaze = 0;
    this.facing = 0;

    this.attackCd = 0;
    this.rollCd = 0;
    this.rolling = false;
    this.rollTimer = 0;
    this.justRolled = false;
    this.guarding = false;
    this.invOpen = false;

    this.lampCd = 0;
    this.lampActiveUntil = -1;
    this.gaugePause = false;
    this.gateCharge = 0;
    this.charging = false;

    // 감속 디버프 만료 시각 (-1은 디버프 없음)
    this.speedDebuffUntil = -1;

    this.weaponLevel = saveState.weaponLevel ?? 0;
    this.inventory = saveState.inventory; // shared reference
    this.dead = false;
    this.attackSwingT = 0;

    // 축복(Blessings) 스탯 모디파이어
    this.dmgMul = 1;
    this.atkCdMul = 1;
    this.critChance = 0;
    this.critMul = 1.8;
    this.guardReductionOverride = null;
    this.guardSpeedPenalty = 0;
    this.rollInvulnBonus = 0;
    this.moveSpeedMul = 1;
    this.staminaRegenMul = 1;
    this.sprintDrainMul = 1;
    this.lampDurBonus = 0;
    this.noiseRadiusMul = 1;
    this.gazeRateMul = 1;
    this.healMul = 1;

    this.atkSpeedBuffTimer = 0;
    this.hasSecondBreath = false;
    this.secondBreathUsed = false;
    this.bleedDps = 0;
    this.bleedDur = 0;
    this.onKillStamina = 0;
    this.onKillHeal = 0;
    this.lampStunRadius = 0;
    this.lampStunDur = 0;
  }

  get heavyPenalty() {
    return heavyItemCount(this.inventory) > 0 ? PLAYER_BASE.heavyItemSpeedPenalty : 0;
  }

  get guardReduction() {
    return this.guardReductionOverride ?? PLAYER_BASE.guard.dmgReduction;
  }

  currentSpeed(sprintHeld, moving, time = 0) {
    let s = PLAYER_BASE.walkSpeed;
    if (this.guarding) {
      s = PLAYER_BASE.guardSpeed * Math.max(0.2, 1 - (this.guardSpeedPenalty ?? 0));
    } else if (sprintHeld && this.stamina > 0 && moving) {
      s = PLAYER_BASE.sprintSpeed;
    }

    s *= (1 - this.heavyPenalty);
    if (this.invOpen) s *= (1 - PLAYER_BASE.invOpenSpeedPenalty);

    // P0 수정: 0 초과 비교가 아닌 현재 시뮬레이션 시간(time)과 비교
    if (this.speedDebuffUntil > time) {
      s *= 0.8;
    }

    if (this.moveSpeedMul) s *= this.moveSpeedMul;
    return s;
  }

  weaponDamageRoll(rng = null) {
    const r = typeof rng === 'function' ? rng() : (rng && rng.next ? rng.next() : 0.5);
    const base = PLAYER_BASE.attack.dmgMin + r * (PLAYER_BASE.attack.dmgMax - PLAYER_BASE.attack.dmgMin);
    let total = (base + this.weaponLevel * UPGRADE_DMG_BONUS_PER_LEVEL) * (this.dmgMul ?? 1);

    let isCrit = false;
    if (this.critChance > 0) {
      const cr = typeof rng === 'function' ? rng() : (rng && rng.next ? rng.next() : 0.5);
      if (cr < this.critChance) {
        total *= this.critMul;
        isCrit = true;
      }
    }

    return { dmg: total, isCrit };
  }

  update(dt, time, input, tilemap = null) {
    this.justRolled = this.rollTimer > 0 && (this.rollTimer - dt) <= 0;
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.rollCd > 0) this.rollCd -= dt;
    if (this.lampCd > 0) this.lampCd -= dt;
    if (this.attackSwingT > 0) this.attackSwingT -= dt;
    if (this.atkSpeedBuffTimer > 0) this.atkSpeedBuffTimer -= dt;

    if (this.rollTimer > 0) {
      this.rollTimer -= dt;
      if (this.rollTimer <= 0) this.rolling = false;
    }

    // 위기 시 재기의 숨결 발동
    if (this.hasSecondBreath && !this.secondBreathUsed && this.hp <= this.maxHp * 0.25) {
      this.hp = Math.min(this.maxHp, this.hp + 30);
      this.secondBreathUsed = true;
    }

    this.guarding = Boolean(input?.guardDown && !this.rolling && !this.invOpen && this.attackSwingT <= 0);

    const sprinting = Boolean(input?.sprint && !this.guarding && !this.invOpen);
    const moving = Boolean(input?.moveX || input?.moveY);

    if (sprinting && moving) {
      const drain = PLAYER_BASE.staminaDrainPerSec * (this.sprintDrainMul ?? 1) * dt;
      this.stamina = Math.max(0, this.stamina - drain);
    } else {
      const regen = 12 * (this.staminaRegenMul ?? 1) * dt;
      this.stamina = Math.min(this.maxStamina, this.stamina + regen);
    }

    // P0: time 파라미터를 currentSpeed에 전달하여 3초 경과 시 자동 원복
    const speed = this.currentSpeed(sprinting, moving, time);
    const radius = PLAYER_BASE.radius ?? 0.35;

    if (!this.rolling) {
      let mx = input.moveX, my = input.moveY;
      const len = Math.hypot(mx, my) || 1;
      mx /= len; my /= len;
      const dx = mx * speed * dt;
      const dy = my * speed * dt;
      if (tilemap) {
        resolveCircleTileSlide(this, radius, dx, dy, tilemap);
      } else {
        this.x += dx;
        this.y += dy;
      }
    } else {
      const dx = this.rollDirX * PLAYER_BASE.sprintSpeed * 1.4 * dt;
      const dy = this.rollDirY * PLAYER_BASE.sprintSpeed * 1.4 * dt;
      if (tilemap) {
        resolveCircleTileSlide(this, radius, dx, dy, tilemap);
      } else {
        this.x += dx;
        this.y += dy;
      }
    }
  }

  get invulnerable() {
    return this.rolling;
  }

  tryRoll(dirX, dirY, game) {
    if (this.rollCd > 0 || this.rolling) return false;
    const len = Math.hypot(dirX, dirY) || 1;
    this.rollDirX = dirX / len;
    this.rollDirY = dirY / len;
    this.rolling = true;
    this.rollTimer = PLAYER_BASE.roll.invuln + (this.rollInvulnBonus ?? 0);
    this.rollCd = PLAYER_BASE.roll.cooldown;

    const noiseR = PLAYER_BASE.roll.noiseRadius * (this.noiseRadiusMul ?? 1);
    game.onNoise(this.x, this.y, 'roll', noiseR);
    return true;
  }

  tryAttack(game) {
    if (this.attackCd > 0 || this.rolling || this.invOpen) return false;
    const atkSpeedMul = (this.atkCdMul ?? 1) * (this.atkSpeedBuffTimer > 0 ? 0.7 : 1.0);
    this.attackCd = PLAYER_BASE.attack.cooldown * atkSpeedMul;
    this.attackSwingT = 0.18;
    game?.onPlayerAttack?.();
    return true;
  }

  tryLamp(game) {
    if (this.lampCd > 0) return false;
    this.lampCd = PLAYER_BASE.lampSkill.cooldown;
    const dur = PLAYER_BASE.lampSkill.duration + (this.lampDurBonus ?? 0);
    this.lampActiveUntil = game.time + dur;
    game.onNoise(this.x, this.y, 'lamp', 0);

    if (this.lampStunRadius > 0 && game.onLampStun) {
      game.onLampStun(this.x, this.y, this.lampStunRadius, this.lampStunDur);
    }
    return true;
  }

  onKillTrigger() {
    if (this.onKillAtkSpeedBuff) {
      this.atkSpeedBuffTimer = 4.0;
    }
    if (this.onKillStamina > 0) {
      this.stamina = Math.min(this.maxStamina, this.stamina + this.onKillStamina);
    }
    if (this.onKillHeal > 0) {
      this.hp = Math.min(this.maxHp, this.hp + this.onKillHeal);
    }
  }
}
