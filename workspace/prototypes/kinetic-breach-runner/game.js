/**
 * Kinetic Breach Runner (절개항해) - Core Game Engine
 * Implements the full mechanics defined in docs/KINETIC_BREACH_RUNNER_PROTOTYPE.md
 */

// ==========================================
// 1. CONSTANTS & CONFIGURATION
// ==========================================
const TILE_SIZE = 32;
const MAP_WIDTH = 48;
const MAP_HEIGHT = 34;

const TILE = {
  EMPTY: 0,
  BULKHEAD: 1,         // Indestructible border/outer wall
  VULNERABLE: 2,       // Normal breachable wall seam (Cyan cracks)
  UNSEALABLE: 3,       // Volatile unsealable wall (Orange/Red cracks)
  SEALED: 4,           // Nanite foam sealed wall
  AIRLOCK_FLOOR: 5,    // Secure airlock zone floor
  AIRLOCK_WALL: 6,     // Secure airlock boundary
  VALVE: 7             // Pressure relief valve switch
};

const PRESSURE_STAGE = {
  SAFE: 'safe',         // 0% ~ 39%
  WARNING: 'warning',   // 40% ~ 74%
  CRITICAL: 'critical', // 75% ~ 99%
  COLLAPSE: 'collapse'  // 100%
};

// Vector2 Math Helper
class Vec2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
  set(x, y) { this.x = x; this.y = y; return this; }
  copy() { return new Vec2(this.x, this.y); }
  add(v) { this.x += v.x; this.y += v.y; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; return this; }
  mult(s) { this.x *= s; this.y *= s; return this; }
  mag() { return Math.hypot(this.x, this.y); }
  norm() {
    const m = this.mag();
    if (m > 0.0001) { this.x /= m; this.y /= m; }
    return this;
  }
  dist(v) { return Math.hypot(this.x - v.x, this.y - v.y); }
  dot(v) { return this.x * v.x + this.y * v.y; }
}

// ==========================================
// 2. PARTICLE SYSTEM
// ==========================================
class Particle {
  constructor(x, y, vx, vy, color, size, life, type = 'normal') {
    this.pos = new Vec2(x, y);
    this.vel = new Vec2(vx, vy);
    this.color = color;
    this.size = size;
    this.maxLife = life;
    this.life = life;
    this.type = type; // 'normal', 'debris', 'jet', 'foam', 'spark'
  }

  update(dt) {
    this.life -= dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    if (this.type === 'debris') {
      this.vel.mult(0.92); // friction
      this.size = Math.max(0.5, this.size * 0.98);
    } else if (this.type === 'jet') {
      this.vel.x += (Math.random() - 0.5) * 120 * dt;
      this.vel.y += (Math.random() - 0.5) * 120 * dt;
      this.size += dt * 3;
    } else if (this.type === 'spark') {
      this.vel.mult(0.88);
    }
  }

  draw(ctx) {
    if (this.life <= 0) return;
    const alpha = Math.max(0, this.life / this.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.pos.x, this.pos.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ==========================================
// 3. PRESSURE GRAPH & BREACH LOGIC
// ==========================================
class Breach {
  constructor(tileX, tileY, normalX, normalY, isUnsealable = false) {
    this.tileX = tileX;
    this.tileY = tileY;
    this.worldX = (tileX + 0.5) * TILE_SIZE;
    this.worldY = (tileY + 0.5) * TILE_SIZE;
    this.normal = new Vec2(normalX, normalY).norm();
    this.isUnsealable = isUnsealable;
    this.leakRate = isUnsealable ? 2.8 : 1.6; // % per second
    this.isSealed = false;
    this.jetTimer = 0;
  }
}

class PressureGraph {
  constructor(game) {
    this.game = game;
    this.pressure = 0.0;           // 0 to 100
    this.baseLeakRate = 0.25;      // Ambient system pressure rise per second
    this.activeLeakRate = 0.0;     // Total leak from all breaches
    this.breaches = [];
    this.collapseTimer = 10.0;     // 10s countdown when at 100%
    this.isCollapsed = false;
    this.valvesActive = 0;
  }

  reset() {
    this.pressure = 5.0;
    this.activeLeakRate = 0.0;
    this.breaches = [];
    this.collapseTimer = 10.0;
    this.isCollapsed = false;
    this.valvesActive = 0;
  }

  addBreach(tileX, tileY, normX, normY, isUnsealable) {
    const breach = new Breach(tileX, tileY, normX, normY, isUnsealable);
    this.breaches.push(breach);
    this.recalcLeakRate();
    return breach;
  }

  sealBreach(breach) {
    if (breach.isUnsealable) return false;
    breach.isSealed = true;
    this.breaches = this.breaches.filter(b => b !== breach);
    // Instant pressure relief reward
    this.pressure = Math.max(0, this.pressure - (this.game.player.upgrades.rapidNanite ? 5.0 : 2.5));
    this.recalcLeakRate();
    return true;
  }

  recalcLeakRate() {
    let rate = this.baseLeakRate;
    for (const b of this.breaches) {
      if (!b.isSealed) {
        rate += b.leakRate;
      }
    }
    // Relief valves reduce leak rate
    rate -= this.valvesActive * 2.0;
    this.activeLeakRate = Math.max(0, rate);
  }

  update(dt) {
    // Pressure dynamics
    this.pressure += this.activeLeakRate * dt;
    this.pressure = Math.min(100, Math.max(0, this.pressure));

    // Handle 100% Collapse countdown
    if (this.pressure >= 99.9) {
      this.collapseTimer -= dt;
      if (this.collapseTimer <= 0) {
        this.collapseTimer = 0;
        this.isCollapsed = true;
        this.game.onChamberCollapse();
      }
    } else {
      // Recover collapse timer when pressure is maintained below 100%
      this.collapseTimer = Math.min(10.0, this.collapseTimer + dt * 1.5);
    }

    // Spawn high-pressure gas jet particles from active breaches
    for (const b of this.breaches) {
      b.jetTimer += dt;
      if (b.jetTimer > 0.04) {
        b.jetTimer = 0;
        const speed = 160 + Math.random() * 120;
        const spread = (Math.random() - 0.5) * 0.7;
        const dir = new Vec2(
          b.normal.x * Math.cos(spread) - b.normal.y * Math.sin(spread),
          b.normal.x * Math.sin(spread) + b.normal.y * Math.cos(spread)
        ).norm();

        const color = b.isUnsealable ? '#f97316' : '#67e8f9';
        this.game.spawnParticle(
          b.worldX, b.worldY,
          dir.x * speed, dir.y * speed,
          color, 3.5, 0.45, 'jet'
        );
      }
    }
  }

  getStage() {
    if (this.pressure >= 100 || this.collapseTimer < 10.0) return PRESSURE_STAGE.COLLAPSE;
    if (this.pressure >= 75) return PRESSURE_STAGE.CRITICAL;
    if (this.pressure >= 40) return PRESSURE_STAGE.WARNING;
    return PRESSURE_STAGE.SAFE;
  }
}

// ==========================================
// 4. PLAYER EXPLORER CONTROLLER
// ==========================================
class Player {
  constructor(game, startX, startY) {
    this.game = game;
    this.pos = new Vec2(startX, startY);
    this.vel = new Vec2(0, 0);
    this.radius = 12;

    // Suit Stats
    this.maxHp = 100;
    this.hp = 100;
    this.sealants = 5;          // Nanite seal canisters
    this.carriedSpecimens = 0;  // High-value research samples in pack
    this.bankedSpecimens = 0;   // Permanently secured samples

    // Movement & Thruster Tuning
    this.thrusterForce = 420;
    this.friction = 0.90;       // Vacuum / low drag space feel
    this.baseRecoilKick = 550;   // Kinetic recoil impulse on breach

    // Tools & Timers
    this.cutCooldown = 0;
    this.cutMaxCooldown = 0.28;
    this.sealCooldown = 0;
    this.invulnTimer = 0;

    // Upgrades (Acquired at Decompression Chamber)
    this.upgrades = {
      vectorThruster: false,   // Recoil +35%
      rapidNanite: false,      // Seal range +50% & instant 5% pressure drop
      overchargedBlade: false, // Cut radius +40%
      pressureSuit: false      // Jet damage -50%, Max HP +25
    };

    this.aimAngle = 0;
  }

  applyUpgrade(id) {
    if (id === 'vectorThruster') {
      this.upgrades.vectorThruster = true;
      this.baseRecoilKick *= 1.35;
    } else if (id === 'rapidNanite') {
      this.upgrades.rapidNanite = true;
    } else if (id === 'overchargedBlade') {
      this.upgrades.overchargedBlade = true;
    } else if (id === 'pressureSuit') {
      this.upgrades.pressureSuit = true;
      this.maxHp += 25;
      this.hp += 25;
    }
  }

  update(dt, input, aimWorldPos) {
    // Cooldowns
    if (this.cutCooldown > 0) this.cutCooldown -= dt;
    if (this.sealCooldown > 0) this.sealCooldown -= dt;
    if (this.invulnTimer > 0) this.invulnTimer -= dt;

    // Aim calculation
    const dx = aimWorldPos.x - this.pos.x;
    const dy = aimWorldPos.y - this.pos.y;
    this.aimAngle = Math.atan2(dy, dx);

    // Directional Thrusters (WASD)
    const moveDir = new Vec2(0, 0);
    if (input.up) moveDir.y -= 1;
    if (input.down) moveDir.y += 1;
    if (input.left) moveDir.x -= 1;
    if (input.right) moveDir.x += 1;

    if (moveDir.mag() > 0) {
      moveDir.norm();
      this.vel.x += moveDir.x * this.thrusterForce * dt;
      this.vel.y += moveDir.y * this.thrusterForce * dt;

      // Small thruster sparks
      if (Math.random() < 0.35) {
        this.game.spawnParticle(
          this.pos.x - moveDir.x * 10,
          this.pos.y - moveDir.y * 10,
          -moveDir.x * 50 + (Math.random() - 0.5) * 20,
          -moveDir.y * 50 + (Math.random() - 0.5) * 20,
          '#38bdf8', 2, 0.25, 'spark'
        );
      }
    }

    // Chamber Pressure Wind Drag Effect (At high pressure, air turbulence pushes)
    const pressureStage = this.game.pressureGraph.getStage();
    if (pressureStage === PRESSURE_STAGE.WARNING || pressureStage === PRESSURE_STAGE.CRITICAL) {
      const turbulence = (Math.sin(Date.now() * 0.003) + Math.cos(this.pos.y * 0.02)) * 15;
      this.vel.x += turbulence * dt;
    }

    // Friction / Damping
    this.vel.mult(this.friction);

    // Position integration with collision resolution
    this.moveWithCollision(dt);

    // Hazard Jet Stream Collision (Pushes and damages player if caught in breach jet)
    this.checkBreachJetDamage(dt);
  }

  moveWithCollision(dt) {
    const nextX = this.pos.x + this.vel.x * dt;
    const nextY = this.pos.y + this.vel.y * dt;

    // X Axis collision
    if (!this.game.isSolidAt(nextX - this.radius, this.pos.y - this.radius) &&
        !this.game.isSolidAt(nextX + this.radius, this.pos.y - this.radius) &&
        !this.game.isSolidAt(nextX - this.radius, this.pos.y + this.radius) &&
        !this.game.isSolidAt(nextX + this.radius, this.pos.y + this.radius)) {
      this.pos.x = nextX;
    } else {
      this.vel.x *= -0.2; // Bounce lightly off wall
    }

    // Y Axis collision
    if (!this.game.isSolidAt(this.pos.x - this.radius, nextY - this.radius) &&
        !this.game.isSolidAt(this.pos.x + this.radius, nextY - this.radius) &&
        !this.game.isSolidAt(this.pos.x - this.radius, nextY + this.radius) &&
        !this.game.isSolidAt(this.pos.x + this.radius, nextY + this.radius)) {
      this.pos.y = nextY;
    } else {
      this.vel.y *= -0.2;
    }
  }

  // Check if player is caught directly in an active breach's high-pressure jet stream
  checkBreachJetDamage(dt) {
    for (const b of this.game.pressureGraph.breaches) {
      if (b.isSealed) continue;
      const toPlayer = new Vec2(this.pos.x - b.worldX, this.pos.y - b.worldY);
      const dist = toPlayer.mag();
      if (dist < 90) {
        // Project onto jet normal
        toPlayer.norm();
        const alignment = toPlayer.dot(b.normal);
        if (alignment > 0.65) { // Inside the cone
          // Push player away
          const push = 380 * (1 - dist / 90);
          this.vel.x += b.normal.x * push * dt;
          this.vel.y += b.normal.y * push * dt;

          // Damage
          const rawDmg = b.isUnsealable ? 22 : 12;
          const dmg = (this.upgrades.pressureSuit ? rawDmg * 0.5 : rawDmg) * dt;
          this.takeDamage(dmg, '고압 분출 제트 피격 (Pressure Jet Blast)');
        }
      }
    }
  }

  // CORE MECHANIC: Kinetic Breach (절개 및 반동 추진)
  executeBreach(aimWorldPos) {
    if (this.cutCooldown > 0) return false;
    this.cutCooldown = this.cutMaxCooldown;

    const cutDir = new Vec2(
      Math.cos(this.aimAngle),
      Math.sin(this.aimAngle)
    ).norm();

    const cutReach = this.upgrades.overchargedBlade ? 72 : 52;
    const cutEnd = new Vec2(
      this.pos.x + cutDir.x * cutReach,
      this.pos.y + cutDir.y * cutReach
    );

    // Audio
    this.game.audio.playCut();

    // Check hit against tiles along cut ray
    let hitTile = null;
    let hitNormal = new Vec2(0, 0);

    const steps = 14;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = this.pos.x + (cutEnd.x - this.pos.x) * t;
      const py = this.pos.y + (cutEnd.y - this.pos.y) * t;
      const tx = Math.floor(px / TILE_SIZE);
      const ty = Math.floor(py / TILE_SIZE);

      const tileType = this.game.getTile(tx, ty);
      if (tileType === TILE.VULNERABLE || tileType === TILE.UNSEALABLE) {
        hitTile = { tx, ty, type: tileType };
        // Normal points from wall center towards player
        const tileCenterX = (tx + 0.5) * TILE_SIZE;
        const tileCenterY = (ty + 0.5) * TILE_SIZE;
        hitNormal = new Vec2(this.pos.x - tileCenterX, this.pos.y - tileCenterY).norm();
        break;
      } else if (tileType === TILE.VALVE) {
        // Relief valve cut - activate it!
        this.game.activateValve(tx, ty);
        this.game.audio.playShatter();
        break;
      } else if (tileType === TILE.BULKHEAD || tileType === TILE.AIRLOCK_WALL) {
        // Indestructible wall hit: sparks only
        this.game.spawnDebrisSparks(px, py, -cutDir.x, -cutDir.y, 8, '#7899a4');
        break;
      }
    }

    // RECOIL THRUST IMPULSE: Always kicks player backward!
    // KINETIC RECOIL = -cutDir * recoilKick
    this.vel.x += -cutDir.x * this.baseRecoilKick;
    this.vel.y += -cutDir.y * this.baseRecoilKick;
    this.game.audio.playRecoil();
    this.game.camera.addTrauma(0.4);

    // If a vulnerable bulkhead was severed
    if (hitTile) {
      const isUnsealable = (hitTile.type === TILE.UNSEALABLE);
      // Change tile to empty (shattered open)
      this.game.setTile(hitTile.tx, hitTile.ty, TILE.EMPTY);

      // Register breach into PressureGraph
      this.game.pressureGraph.addBreach(
        hitTile.tx, hitTile.ty,
        hitNormal.x, hitNormal.y,
        isUnsealable
      );

      // Effects: Shatter sound, heavy screen shake, debris burst
      this.game.audio.playShatter();
      this.game.camera.addTrauma(0.65);
      this.game.triggerHitstop(3); // 3-frame micro freeze

      const tileWorldX = (hitTile.tx + 0.5) * TILE_SIZE;
      const tileWorldY = (hitTile.ty + 0.5) * TILE_SIZE;
      const debrisColor = isUnsealable ? '#f97316' : '#22d3ee';
      this.game.spawnDebrisSparks(tileWorldX, tileWorldY, hitNormal.x, hitNormal.y, 24, debrisColor);

      this.game.showBanner(
        isUnsealable ? "봉합 불가 취약벽 파단! 고압 누출 발생!" : "벽면 절개 성공! 고압 누출 발생!",
        isUnsealable
      );

      return true;
    }

    // If no wall was severed, player still performed a Kinetic Thrust Dash
    this.game.spawnDebrisSparks(this.pos.x, this.pos.y, cutDir.x, cutDir.y, 10, '#38bdf8');
    return true;
  }

  // CORE MECHANIC: Nanite Seal (봉합재 분사)
  executeSeal() {
    if (this.sealCooldown > 0) return false;
    if (this.sealants <= 0) {
      this.game.showBanner("봉합재 부족! (No Sealants Remaining)", true);
      this.game.audio.playDamage();
      return false;
    }

    const sealRange = this.upgrades.rapidNanite ? 135 : 90;
    let closestBreach = null;
    let closestDist = Infinity;

    // Find nearest active breach
    for (const b of this.game.pressureGraph.breaches) {
      if (b.isSealed) continue;
      const dist = this.pos.dist(new Vec2(b.worldX, b.worldY));
      if (dist < sealRange && dist < closestDist) {
        closestDist = dist;
        closestBreach = b;
      }
    }

    if (!closestBreach) {
      this.game.showBanner("사거리 내 활성 누출구가 없습니다.", false);
      return false;
    }

    if (closestBreach.isUnsealable) {
      this.game.showBanner("경고: 봉합 불가능한 불안정 결정체입니다!", true);
      this.game.audio.playDamage();
      return false;
    }

    // Perform Seal!
    this.sealCooldown = 0.35;
    this.sealants--;

    const sealed = this.game.pressureGraph.sealBreach(closestBreach);
    if (sealed) {
      // Put a SEALED tile in place
      this.game.setTile(closestBreach.tileX, closestBreach.tileY, TILE.SEALED);

      this.game.audio.playSeal();
      this.game.showBanner("누출구 봉합 완료! 압력 안정화.", false);

      // Nanite foam particles
      for (let i = 0; i < 20; i++) {
        this.game.spawnParticle(
          closestBreach.worldX + (Math.random() - 0.5) * 16,
          closestBreach.worldY + (Math.random() - 0.5) * 16,
          (Math.random() - 0.5) * 40,
          (Math.random() - 0.5) * 40,
          '#38bdf8', 4.5, 0.8, 'foam'
        );
      }
      return true;
    }
    return false;
  }

  takeDamage(amount, cause) {
    if (this.invulnTimer > 0) return;
    this.hp -= amount;
    this.game.audio.playDamage();
    this.game.camera.addTrauma(0.3);

    if (this.hp <= 0) {
      this.hp = 0;
      this.game.onPlayerDeath(cause);
    }
  }

  draw(ctx, aimWorldPos) {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);

    // 1. Aim Guide & Laser Sight
    ctx.rotate(this.aimAngle);

    // Laser sight line
    ctx.strokeStyle = 'rgba(25, 212, 214, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(this.upgrades.overchargedBlade ? 72 : 52, 0);
    ctx.stroke();
    ctx.setLineDash([]);

    // Recoil Projection Line (Behind the player in red/cyan showing recoil path)
    const recoilLength = (this.baseRecoilKick / 550) * 45;
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-recoilLength, 0);
    ctx.stroke();

    // Recoil Arrowhead
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.moveTo(-recoilLength, 0);
    ctx.lineTo(-recoilLength + 6, -4);
    ctx.lineTo(-recoilLength + 6, 4);
    ctx.fill();

    // 2. Player Body (Explorer Suit with thrusters)
    // Suit base
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Visor / Helmet (Cyan glow in aim direction)
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath();
    ctx.arc(4, 0, 6, -Math.PI / 2, Math.PI / 2);
    ctx.fill();

    // Plasma Cutter Arm
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.strokeRect(6, -3, 10, 6);

    ctx.restore();
  }
}

// ==========================================
// 5. SPECIMENS & ITEMS
// ==========================================
class ItemEntity {
  constructor(x, y, type) {
    this.pos = new Vec2(x, y);
    this.type = type; // 'specimen', 'sealant', 'health'
    this.radius = 10;
    this.bobTimer = Math.random() * Math.PI * 2;
    this.collected = false;
  }

  update(dt) {
    this.bobTimer += dt * 3;
  }

  draw(ctx) {
    if (this.collected) return;
    const offsetY = Math.sin(this.bobTimer) * 3;
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y + offsetY);

    if (this.type === 'specimen') {
      // Alien Core Specimen (Glowing purple/gold crystal orb)
      ctx.shadowColor = '#a855f7';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#c084fc';
      ctx.strokeStyle = '#fae8ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Core ring
      ctx.strokeStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.stroke();
    } else if (this.type === 'sealant') {
      // Nanite canister (Blue container)
      ctx.fillStyle = '#0284c7';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.fillRect(-6, -8, 12, 16);
      ctx.strokeRect(-6, -8, 12, 16);
      // Cap
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(-4, -10, 8, 3);
    } else if (this.type === 'health') {
      // Nanite med kit (Green cross)
      ctx.fillStyle = '#065f46';
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 1.5;
      ctx.fillRect(-8, -8, 16, 16);
      ctx.strokeRect(-8, -8, 16, 16);
      ctx.fillStyle = '#6ee7b7';
      ctx.fillRect(-2, -6, 4, 12);
      ctx.fillRect(-6, -2, 12, 4);
    }

    ctx.restore();
  }
}

// ==========================================
// 6. CAMERA & SCREEN SHAKE
// ==========================================
class Camera {
  constructor(canvasWidth, canvasHeight) {
    this.pos = new Vec2(0, 0);
    this.target = new Vec2(0, 0);
    this.viewportWidth = canvasWidth;
    this.viewportHeight = canvasHeight;
    this.trauma = 0;
  }

  resize(w, h) {
    this.viewportWidth = w;
    this.viewportHeight = h;
  }

  addTrauma(amount) {
    this.trauma = Math.min(1.0, this.trauma + amount);
  }

  update(dt, targetPos) {
    this.target = targetPos;
    // Smooth follow
    this.pos.x += (this.target.x - this.pos.x) * 6 * dt;
    this.pos.y += (this.target.y - this.pos.y) * 6 * dt;

    // Decay trauma
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 1.8);
    }
  }

  getOffset() {
    const shake = this.trauma * this.trauma * 16;
    const offsetX = (Math.random() - 0.5) * shake;
    const offsetY = (Math.random() - 0.5) * shake;

    return {
      x: Math.round(this.viewportWidth / 2 - this.pos.x + offsetX),
      y: Math.round(this.viewportHeight / 2 - this.pos.y + offsetY)
    };
  }
}

// ==========================================
// 7. RUN MANAGER & MAIN GAME CONTROLLER
// ==========================================
class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.audio = new AudioManager();

    this.currentSector = 1;
    this.maxSectors = 4;
    this.state = 'TITLE'; // 'TITLE', 'PLAYING', 'AIRLOCK', 'GAMEOVER', 'VICTORY'
    this.isPaused = false;
    this.hitstopFrames = 0;

    // Map Grid
    this.map = [];
    this.tilesWidth = MAP_WIDTH;
    this.tilesHeight = MAP_HEIGHT;

    // Subsystems
    this.pressureGraph = new PressureGraph(this);
    this.camera = new Camera(this.canvas.width, this.canvas.height);
    this.particles = [];
    this.items = [];
    this.player = null;

    // Airlock zone definition
    this.airlockBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    this.inAirlockZone = false;

    // Controls
    this.input = { up: false, down: false, left: false, right: false };
    this.mouseWorld = new Vec2(0, 0);
    this.mouseScreen = new Vec2(0, 0);

    // Diagnostics / Stats
    this.stats = {
      breachesMade: 0,
      sealsMade: 0,
      specimensSecured: 0,
      startTime: 0,
      lastFps: 60,
      frameTimeMs: 16
    };
    this.lastFrameTime = performance.now();
    this.debugVisible = false;

    this.initDOM();
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  initDOM() {
    // HUD Elements
    this.uiPressureVal = document.getElementById('hud-pressure-val');
    this.uiPressureFill = document.getElementById('hud-pressure-fill');
    this.uiPressureTag = document.getElementById('hud-pressure-tag');
    this.uiLeakRate = document.getElementById('hud-leak-rate');
    this.uiCollapseAlert = document.getElementById('hud-collapse-alert');
    this.uiHpVal = document.getElementById('hud-hp-val');
    this.uiHpFill = document.getElementById('hud-hp-fill');
    this.uiSealantsVal = document.getElementById('hud-sealants-val');
    this.uiSpecimensVal = document.getElementById('hud-specimens-val');
    this.uiBankedVal = document.getElementById('hud-banked-val');
    this.uiSectorName = document.getElementById('hud-sector-name');
    this.alarmFlash = document.getElementById('alarm-flash');
    this.banner = document.getElementById('notification-banner');
    this.debugPanel = document.getElementById('debug-panel');

    // Modals
    this.modalHelp = document.getElementById('modal-help');
    this.modalAirlock = document.getElementById('modal-airlock');
    this.modalGameover = document.getElementById('modal-gameover');
    this.modalVictory = document.getElementById('modal-victory');

    // Buttons
    document.getElementById('btn-help').onclick = () => this.toggleHelp();
    document.getElementById('btn-close-help').onclick = () => this.toggleHelp();
    document.getElementById('btn-mute').onclick = (e) => {
      const isMuted = this.audio.toggleMute();
      e.target.innerText = isMuted ? "소리: OFF" : "소리: ON";
    };

    // Airlock Modal Action Buttons
    document.getElementById('btn-airlock-bank').onclick = () => this.onAirlockBank();
    document.getElementById('btn-airlock-next').onclick = () => this.onAirlockNextSector();
    document.getElementById('btn-airlock-extract').onclick = () => this.onAirlockExtract();

    // Restart Buttons
    document.getElementById('btn-restart').onclick = () => this.startNewRun();
    document.getElementById('btn-victory-restart').onclick = () => this.startNewRun();

    // Upgrades
    this.setupUpgradeCards();

    // Setup Event Listeners for inputs
    this.setupInputHandlers();
  }

  resizeCanvas() {
    const container = document.getElementById('game-container');
    this.canvas.width = container.clientWidth;
    this.canvas.height = container.clientHeight;
    this.camera.resize(this.canvas.width, this.canvas.height);
  }

  setupInputHandlers() {
    window.addEventListener('keydown', (e) => {
      this.audio.ensureContext();

      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.input.up = true;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') this.input.down = true;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.input.left = true;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') this.input.right = true;

      // Space / J / Left Click -> Kinetic Breach
      if (e.code === 'Space' || e.code === 'KeyJ') {
        if (this.state === 'PLAYING' && this.player) {
          const cut = this.player.executeBreach(this.mouseWorld);
          if (cut) this.stats.breachesMade++;
        }
      }

      // Shift / K / Right Click -> Nanite Seal
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyK') {
        if (this.state === 'PLAYING' && this.player) {
          const sealed = this.player.executeSeal();
          if (sealed) this.stats.sealsMade++;
        }
      }

      // E -> Interact (Airlock console)
      if (e.code === 'KeyE') {
        if (this.inAirlockZone && this.state === 'PLAYING') {
          this.openAirlockConsole();
        }
      }

      // F3 or Tab -> Toggle Debug Panel
      if (e.code === 'F3' || e.code === 'Tab') {
        e.preventDefault();
        this.debugVisible = !this.debugVisible;
        this.debugPanel.classList.toggle('active', this.debugVisible);
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.input.up = false;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') this.input.down = false;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.input.left = false;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') this.input.right = false;
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseScreen.set(e.clientX - rect.left, e.clientY - rect.top);
      // Convert to world space
      const offset = this.camera.getOffset();
      this.mouseWorld.set(this.mouseScreen.x - offset.x, this.mouseScreen.y - offset.y);
    });

    this.canvas.addEventListener('mousedown', (e) => {
      this.audio.ensureContext();
      if (this.state !== 'PLAYING' || !this.player) return;

      if (e.button === 0) { // Left click: Cut / Breach
        const cut = this.player.executeBreach(this.mouseWorld);
        if (cut) this.stats.breachesMade++;
      } else if (e.button === 2) { // Right click: Seal
        const sealed = this.player.executeSeal();
        if (sealed) this.stats.sealsMade++;
      }
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setupUpgradeCards() {
    const cards = document.querySelectorAll('.upgrade-card');
    cards.forEach(card => {
      card.addEventListener('click', () => {
        if (!this.player) return;
        const upgradeId = card.getAttribute('data-upgrade');
        const cost = parseInt(card.getAttribute('data-cost'), 10);

        if (this.player.upgrades[upgradeId]) {
          this.showBanner("이미 장착된 업그레이드입니다.", false);
          return;
        }

        if (this.player.bankedSpecimens < cost) {
          this.showBanner(`표본 데이터 부족! (필요: ${cost})`, true);
          this.audio.playDamage();
          return;
        }

        this.player.bankedSpecimens -= cost;
        this.player.applyUpgrade(upgradeId);
        card.classList.add('selected');
        card.querySelector('.upgrade-cost').innerText = "장착 완료 (INSTALLED)";
        this.audio.playCollect();
        this.showBanner("슈트 업그레이드 성공!", false);
        this.updateHUD();
      });
    });
  }

  toggleHelp() {
    this.modalHelp.classList.toggle('active');
    this.isPaused = this.modalHelp.classList.contains('active');
  }

  showBanner(text, isCritical = false) {
    this.banner.innerText = text;
    this.banner.className = isCritical ? 'show critical' : 'show';
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => {
      this.banner.className = '';
    }, 2400);
  }

  triggerHitstop(frames = 3) {
    this.hitstopFrames = frames;
  }

  spawnParticle(x, y, vx, vy, color, size, life, type = 'normal') {
    this.particles.push(new Particle(x, y, vx, vy, color, size, life, type));
  }

  spawnDebrisSparks(x, y, dirX, dirY, count, color) {
    for (let i = 0; i < count; i++) {
      const angle = Math.atan2(dirY, dirX) + (Math.random() - 0.5) * 1.5;
      const speed = 70 + Math.random() * 180;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      this.spawnParticle(x, y, vx, vy, color, 2 + Math.random() * 2, 0.4 + Math.random() * 0.3, 'debris');
    }
  }

  // ==========================================
  // MAP GENERATION & SECTOR LAYOUTS
  // ==========================================
  loadSector(sectorIndex) {
    this.currentSector = sectorIndex;
    this.map = new Array(MAP_HEIGHT).fill(0).map(() => new Array(MAP_WIDTH).fill(TILE.BULKHEAD));
    this.items = [];
    this.particles = [];
    this.pressureGraph.reset();

    const sectorNames = [
      "제1구역: 저압 침투 시험장 (Low Pressure Bay)",
      "제2구역: 고압 도관 파단망 (Pressurized Conduits)",
      "제3구역: 원자로 격리 차폐구역 (Reactor Isolation)",
      "제4구역: 심층 붕괴 코어 (Abyssal Core Void)"
    ];
    this.uiSectorName.innerText = sectorNames[sectorIndex - 1] || "미확인 심층 구역";

    // Build Sector Architecture
    this.buildSectorMap(sectorIndex);

    // Initial player placement
    if (!this.player) {
      this.player = new Player(this, 120, 150);
    } else {
      this.player.pos.set(120, 150);
      this.player.vel.set(0, 0);
    }

    this.state = 'PLAYING';
    this.showBanner(`${this.uiSectorName.innerText} 진입 완료.`, false);
  }

  buildSectorMap(sector) {
    // 1. Clear inner space into rooms separated by vulnerable seams
    // Outer boundary stays indestructible BULKHEAD
    for (let y = 1; y < MAP_HEIGHT - 1; y++) {
      for (let x = 1; x < MAP_WIDTH - 1; x++) {
        this.map[y][x] = TILE.EMPTY;
      }
    }

    // 2. Build Decompression Airlock at the entrance (Top-Left)
    this.airlockBounds = { minX: 1, maxX: 7, minY: 1, maxY: 7 };
    for (let y = 1; y <= 7; y++) {
      for (let x = 1; x <= 7; x++) {
        if (x === 7 || y === 7) {
          // Airlock blast door (exit open at x=4, y=7)
          if (x === 4 && y === 7) {
            this.map[y][x] = TILE.EMPTY; // open doorway
          } else {
            this.map[y][x] = TILE.AIRLOCK_WALL;
          }
        } else {
          this.map[y][x] = TILE.AIRLOCK_FLOOR;
        }
      }
    }

    // 3. Create Internal Vulnerable Bulkheads and Chambers
    // Vertical partition 1 at x = 14
    for (let y = 1; y < MAP_HEIGHT - 1; y++) {
      this.map[y][14] = (y % 4 === 0) ? TILE.BULKHEAD : TILE.VULNERABLE;
    }

    // Horizontal partition at y = 16
    for (let x = 14; x < MAP_WIDTH - 1; x++) {
      this.map[16][x] = (x % 5 === 0) ? TILE.BULKHEAD : TILE.VULNERABLE;
    }

    // Vertical partition 2 at x = 30
    for (let y = 1; y < 16; y++) {
      this.map[y][30] = TILE.VULNERABLE;
    }

    // Sector 2+ adds Unsealable Volatile Seams and Relief Valves
    if (sector >= 2) {
      for (let y = 18; y < MAP_HEIGHT - 3; y++) {
        this.map[y][32] = (y % 2 === 0) ? TILE.UNSEALABLE : TILE.VULNERABLE;
      }
      // Add pressure relief valves
      this.map[5][22] = TILE.VALVE;
      this.map[25][20] = TILE.VALVE;
    }

    if (sector >= 3) {
      // Sector 3 has tight reactor corridors
      for (let x = 20; x < 40; x += 6) {
        for (let y = 18; y < MAP_HEIGHT - 2; y++) {
          if (y % 3 !== 0) this.map[y][x] = TILE.UNSEALABLE;
        }
      }
      this.map[10][40] = TILE.VALVE;
    }

    // 4. Populate Specimen Pods & Resources
    const specimenCount = 2 + sector;
    for (let i = 0; i < specimenCount; i++) {
      let x, y;
      do {
        x = Math.floor(Math.random() * (MAP_WIDTH - 12)) + 10;
        y = Math.floor(Math.random() * (MAP_HEIGHT - 4)) + 2;
      } while (this.map[y][x] !== TILE.EMPTY);

      this.items.push(new ItemEntity((x + 0.5) * TILE_SIZE, (y + 0.5) * TILE_SIZE, 'specimen'));
    }

    // Sealant Caches
    const sealantCount = 3 + sector;
    for (let i = 0; i < sealantCount; i++) {
      let x, y;
      do {
        x = Math.floor(Math.random() * (MAP_WIDTH - 6)) + 5;
        y = Math.floor(Math.random() * (MAP_HEIGHT - 6)) + 5;
      } while (this.map[y][x] !== TILE.EMPTY);

      this.items.push(new ItemEntity((x + 0.5) * TILE_SIZE, (y + 0.5) * TILE_SIZE, 'sealant'));
    }

    // Health Pack
    for (let i = 0; i < 2; i++) {
      let x, y;
      do {
        x = Math.floor(Math.random() * (MAP_WIDTH - 6)) + 5;
        y = Math.floor(Math.random() * (MAP_HEIGHT - 6)) + 5;
      } while (this.map[y][x] !== TILE.EMPTY);

      this.items.push(new ItemEntity((x + 0.5) * TILE_SIZE, (y + 0.5) * TILE_SIZE, 'health'));
    }
  }

  activateValve(tx, ty) {
    this.setTile(tx, ty, TILE.EMPTY);
    this.pressureGraph.valvesActive++;
    this.pressureGraph.pressure = Math.max(0, this.pressureGraph.pressure - 20);
    this.pressureGraph.recalcLeakRate();
    this.showBanner("감압 밸브 개방! 챔버 압력 대폭 완화 (-20%)", false);
    // Huge steam vent particles
    this.spawnDebrisSparks((tx + 0.5) * TILE_SIZE, (ty + 0.5) * TILE_SIZE, 0, -1, 30, '#e2e8f0');
  }

  getTile(tx, ty) {
    if (tx < 0 || tx >= MAP_WIDTH || ty < 0 || ty >= MAP_HEIGHT) return TILE.BULKHEAD;
    return this.map[ty][tx];
  }

  setTile(tx, ty, tile) {
    if (tx >= 0 && tx < MAP_WIDTH && ty >= 0 && ty < MAP_HEIGHT) {
      this.map[ty][tx] = tile;
    }
  }

  isSolidAt(worldX, worldY) {
    const tx = Math.floor(worldX / TILE_SIZE);
    const ty = Math.floor(worldY / TILE_SIZE);
    const t = this.getTile(tx, ty);
    return t === TILE.BULKHEAD || t === TILE.VULNERABLE || t === TILE.UNSEALABLE ||
           t === TILE.SEALED || t === TILE.AIRLOCK_WALL || t === TILE.VALVE;
  }

  // ==========================================
  // AIRLOCK CONSOLE & EXTRACTION
  // ==========================================
  checkAirlockZone() {
    if (!this.player) return;
    const tx = Math.floor(this.player.pos.x / TILE_SIZE);
    const ty = Math.floor(this.player.pos.y / TILE_SIZE);

    const inside = (tx >= this.airlockBounds.minX && tx < this.airlockBounds.maxX &&
                    ty >= this.airlockBounds.minY && ty < this.airlockBounds.maxY);

    if (inside !== this.inAirlockZone) {
      this.inAirlockZone = inside;
      if (inside) {
        this.showBanner("감압실 진입 완료. [E] 콘솔 조작 가능", false);
        this.audio.playAirlock();
      }
    }
  }

  openAirlockConsole() {
    this.state = 'AIRLOCK';
    this.modalAirlock.classList.add('active');

    document.getElementById('airlock-carried-count').innerText = this.player.carriedSpecimens;
    document.getElementById('airlock-banked-count').innerText = this.player.bankedSpecimens;
  }

  onAirlockBank() {
    if (!this.player || this.player.carriedSpecimens <= 0) {
      this.showBanner("사출할 표본이 없습니다.", false);
      return;
    }

    const count = this.player.carriedSpecimens;
    this.player.bankedSpecimens += count;
    this.stats.specimensSecured += count;
    this.player.carriedSpecimens = 0;

    // Bonus reward: +2 Sealants & +25 HP on bank
    this.player.sealants += 2;
    this.player.hp = Math.min(this.player.maxHp, this.player.hp + 25);

    this.audio.playCollect();
    this.showBanner(`표본 ${count}개 안전 사출 완료! 영구 보존되었습니다.`, false);

    document.getElementById('airlock-carried-count').innerText = this.player.carriedSpecimens;
    document.getElementById('airlock-banked-count').innerText = this.player.bankedSpecimens;
    this.updateHUD();
  }

  onAirlockNextSector() {
    this.modalAirlock.classList.remove('active');
    if (this.currentSector >= this.maxSectors) {
      this.onRunVictory();
      return;
    }
    this.loadSector(this.currentSector + 1);
  }

  onAirlockExtract() {
    this.modalAirlock.classList.remove('active');
    // Successful voluntary run extraction!
    this.onRunVictory();
  }

  onPlayerDeath(cause) {
    this.state = 'GAMEOVER';
    this.audio.playDamage();
    document.getElementById('death-cause').innerText = `사망 원인: ${cause}`;
    document.getElementById('gameover-stats').innerText =
      `확보한 표본: ${this.stats.specimensSecured}개 | 총 절개 횟수: ${this.stats.breachesMade}회 | 봉합: ${this.stats.sealsMade}회`;
    this.modalGameover.classList.add('active');
  }

  onChamberCollapse() {
    this.onPlayerDeath("챔버 내 압력 100% 한계 초과로 인한 격벽 대붕괴 (Catastrophic Overpressure Collapse)");
  }

  onRunVictory() {
    this.state = 'VICTORY';
    this.audio.playCollect();
    document.getElementById('victory-stats').innerText =
      `최종 탐사 성공! 영구 보존 표본: ${this.player.bankedSpecimens}개 | 총 절개 횟수: ${this.stats.breachesMade}회 | 총 봉합 횟수: ${this.stats.sealsMade}회`;
    this.modalVictory.classList.add('active');
  }

  startNewRun() {
    this.modalGameover.classList.remove('active');
    this.modalVictory.classList.remove('active');
    this.modalAirlock.classList.remove('active');

    this.stats = {
      breachesMade: 0,
      sealsMade: 0,
      specimensSecured: 0,
      startTime: performance.now(),
      lastFps: 60,
      frameTimeMs: 16
    };

    this.player = null;
    this.loadSector(1);
  }

  // ==========================================
  // GAME LOOP: UPDATE & RENDER
  // ==========================================
  update(dt) {
    if (this.hitstopFrames > 0) {
      this.hitstopFrames--;
      return;
    }

    if (this.state !== 'PLAYING') return;

    // Subsystem Updates
    this.pressureGraph.update(dt);
    this.player.update(dt, this.input, this.mouseWorld);
    this.camera.update(dt, this.player.pos);

    // Audio Pressure Modulation
    this.audio.updatePressure(this.pressureGraph.pressure / 100);

    // Check item pickups
    for (const item of this.items) {
      if (item.collected) continue;
      item.update(dt);
      if (this.player.pos.dist(item.pos) < this.player.radius + item.radius) {
        item.collected = true;
        if (item.type === 'specimen') {
          this.player.carriedSpecimens++;
          this.audio.playCollect();
          this.showBanner("코어 표본 회수 완료! 감압실에서 사출하십시오.", false);
        } else if (item.type === 'sealant') {
          this.player.sealants = Math.min(9, this.player.sealants + 2);
          this.audio.playItemPickup();
          this.showBanner("나노 봉합재 +2 획득", false);
        } else if (item.type === 'health') {
          this.player.hp = Math.min(this.player.maxHp, this.player.hp + 30);
          this.audio.playItemPickup();
          this.showBanner("슈트 내구도 +30 수리", false);
        }
      }
    }

    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.update(dt);
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // Airlock zone detection
    this.checkAirlockZone();

    // Update HUD and Alarms
    this.updateHUD();
  }

  updateHUD() {
    if (!this.player) return;

    const pressure = Math.round(this.pressureGraph.pressure);
    const stage = this.pressureGraph.getStage();

    this.uiPressureVal.innerText = `${pressure}%`;
    this.uiPressureFill.style.width = `${pressure}%`;
    this.uiPressureFill.className = `gauge-bar-fill ${stage}`;

    this.uiPressureTag.innerText = stage.toUpperCase();
    this.uiPressureTag.className = `pressure-status-tag ${stage}`;

    this.uiLeakRate.innerText = `누출 전파율: +${this.pressureGraph.activeLeakRate.toFixed(1)}%/s`;

    // Collapse countdown alert
    if (stage === PRESSURE_STAGE.COLLAPSE) {
      this.uiCollapseAlert.style.display = 'block';
      this.uiCollapseAlert.innerText = `격벽 붕괴 임계 카운트: ${this.pressureGraph.collapseTimer.toFixed(1)}s`;
      this.alarmFlash.classList.add('active');
    } else {
      this.uiCollapseAlert.style.display = 'none';
      this.alarmFlash.classList.toggle('active', stage === PRESSURE_STAGE.CRITICAL);
    }

    // Player Stats
    this.uiHpVal.innerText = `${Math.round(this.player.hp)} / ${this.player.maxHp}`;
    this.uiHpFill.style.width = `${(this.player.hp / this.player.maxHp) * 100}%`;
    this.uiSealantsVal.innerText = this.player.sealants;
    this.uiSpecimensVal.innerText = this.player.carriedSpecimens;
    this.uiBankedVal.innerText = this.player.bankedSpecimens;

    // Debug Panel (F3)
    if (this.debugVisible) {
      this.debugPanel.innerHTML = `
        <strong>[F3 DIAGNOSTICS]</strong><br>
        FPS: ${this.stats.lastFps} (${this.stats.frameTimeMs.toFixed(1)}ms)<br>
        Player: (${this.player.pos.x.toFixed(0)}, ${this.player.pos.y.toFixed(0)})<br>
        Velocity: (${this.player.vel.x.toFixed(1)}, ${this.player.vel.y.toFixed(1)}) Mag: ${this.player.vel.mag().toFixed(1)}<br>
        Active Breaches: ${this.pressureGraph.breaches.length}<br>
        Chamber Pressure: ${this.pressureGraph.pressure.toFixed(2)}%<br>
        Particles: ${this.particles.length}
      `;
    }
  }

  draw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const offset = this.camera.getOffset();

    this.ctx.save();
    this.ctx.translate(offset.x, offset.y);

    // 1. Draw TileMap Grid
    this.drawMap(this.ctx);

    // 2. Draw Items & Specimen Pods
    for (const item of this.items) {
      item.draw(this.ctx);
    }

    // 3. Draw Particles (Debris, Jet streams, Sparks)
    for (const p of this.particles) {
      p.draw(this.ctx);
    }

    // 4. Draw Player
    if (this.player) {
      this.player.draw(this.ctx, this.mouseWorld);
    }

    this.ctx.restore();
  }

  drawMap(ctx) {
    const startX = 0;
    const endX = MAP_WIDTH;
    const startY = 0;
    const endY = MAP_HEIGHT;

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const tile = this.map[y][x];
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;

        if (tile === TILE.EMPTY) {
          // Subtle floor grid
          ctx.fillStyle = '#0a1019';
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = '#0f1a29';
          ctx.lineWidth = 1;
          ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
        } else if (tile === TILE.BULKHEAD) {
          // Indestructible border wall
          ctx.fillStyle = '#111827';
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = '#1f2937';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
          // Reinforcement bolts
          ctx.fillStyle = '#374151';
          ctx.fillRect(px + 4, py + 4, 3, 3);
          ctx.fillRect(px + TILE_SIZE - 7, py + 4, 3, 3);
        } else if (tile === TILE.VULNERABLE) {
          // Vulnerable Breachable Wall (Glowing cyan fracture seam)
          ctx.fillStyle = '#0f2231';
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = '#155e75';
          ctx.lineWidth = 1;
          ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
          // Glowing crack seam
          ctx.strokeStyle = '#22d3ee';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(px + 4, py + TILE_SIZE / 2);
          ctx.lineTo(px + TILE_SIZE / 2, py + 6);
          ctx.lineTo(px + TILE_SIZE - 4, py + TILE_SIZE - 6);
          ctx.stroke();
        } else if (tile === TILE.UNSEALABLE) {
          // Volatile Unsealable Seam (Orange glowing danger cracks)
          ctx.fillStyle = '#291414';
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = '#7c2d12';
          ctx.lineWidth = 1;
          ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = '#f97316';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(px + 6, py + 4);
          ctx.lineTo(px + TILE_SIZE - 8, py + TILE_SIZE / 2);
          ctx.lineTo(px + 8, py + TILE_SIZE - 4);
          ctx.stroke();
        } else if (tile === TILE.SEALED) {
          // Nanite Foam Sealed Wall
          ctx.fillStyle = '#075985';
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          ctx.fillStyle = '#38bdf8';
          // Foam bubble texture
          ctx.beginPath();
          ctx.arc(px + 8, py + 10, 4, 0, Math.PI * 2);
          ctx.arc(px + 20, py + 14, 6, 0, Math.PI * 2);
          ctx.arc(px + 12, py + 24, 5, 0, Math.PI * 2);
          ctx.fill();
        } else if (tile === TILE.AIRLOCK_FLOOR) {
          // Safe Airlock Interior Floor (Teal safety hazard stripes)
          ctx.fillStyle = '#064e3b';
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = '#059669';
          ctx.lineWidth = 1;
          ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
        } else if (tile === TILE.AIRLOCK_WALL) {
          // Heavy reinforced airlock bulkhead
          ctx.fillStyle = '#065f46';
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = '#34d399';
          ctx.lineWidth = 2;
          ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
        } else if (tile === TILE.VALVE) {
          // Pressure Relief Valve
          ctx.fillStyle = '#1e1b4b';
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = '#818cf8';
          ctx.lineWidth = 2;
          ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
          // Valve wheel
          ctx.fillStyle = '#6366f1';
          ctx.beginPath();
          ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, 9, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  run() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.stats.frameTimeMs = dt * 1000;
    this.stats.lastFps = Math.round(1 / dt);
    this.lastFrameTime = now;

    if (!this.isPaused) {
      this.update(dt);
    }
    this.draw();

    requestAnimationFrame(() => this.run());
  }
}

// Start Game on window load
window.addEventListener('load', () => {
  const game = new Game();
  window.gameInstance = game;
  game.startNewRun();
  game.run();
});
