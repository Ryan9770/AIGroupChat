/**
 * Pixel Momentum Print (픽셀 관성 인쇄) - Core Game Engine
 * Implements the full momentum editing action-puzzle mechanics defined in docs/PIXEL_MOMENTUM_PRINT_DISCUSSION_RESULT.md
 */

// ==========================================
// 1. CONSTANTS & QUANTIZATION
// ==========================================
const TILE_SIZE = 32;
const MAP_WIDTH = 30;
const MAP_HEIGHT = 20;

// 8 Quantized Directions (0 = E, 1 = SE, 2 = S, 3 = SW, 4 = W, 5 = NW, 6 = N, 7 = NE)
const DIRECTIONS = [
  { name: 'E',  dx: 1,      dy: 0,      arrow: '→', angle: 0 },
  { name: 'SE', dx: 0.7071, dy: 0.7071, arrow: '↘', angle: Math.PI / 4 },
  { name: 'S',  dx: 0,      dy: 1,      arrow: '↓', angle: Math.PI / 2 },
  { name: 'SW', dx: -0.7071,dy: 0.7071, arrow: '↙', angle: 3 * Math.PI / 4 },
  { name: 'W',  dx: -1,     dy: 0,      arrow: '←', angle: Math.PI },
  { name: 'NW', dx: -0.7071,dy: -0.7071,arrow: '↖', angle: -3 * Math.PI / 4 },
  { name: 'N',  dx: 0,      dy: -1,     arrow: '↑', angle: -Math.PI / 2 },
  { name: 'NE', dx: 0.7071, dy: -0.7071,arrow: '↗', angle: -Math.PI / 4 }
];

// 3 Quantized Magnitude Levels (px/s)
const MAGNITUDES = {
  1: { speed: 200, label: '약 (LOW)',    color: '#38bdf8' },
  2: { speed: 360, label: '중 (MEDIUM)', color: '#f59e0b' },
  3: { speed: 540, label: '강 (HIGH)',   color: '#ef4444' }
};

const TILE = {
  EMPTY: 0,
  WALL: 1,          // Solid indestructible wall
  VOID: 2,          // Bottomless pit (player/crates fall if moving too slowly)
  CRACKED_WALL: 3,  // Destructible by Magnitude 2+ collision
  DEFLECTOR_NE: 4,  // 45-deg angled bumper (slash /)
  DEFLECTOR_NW: 5,  // 45-deg angled bumper (backslash \)
  DOOR_LOCKED: 6,   // Security barrier (opens when switch is pressed)
  DOOR_OPEN: 7,     // Opened gate
  EXIT: 8           // Level exit goal
};

// 2D Vector Helper
class Vec2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
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
}

// Momentum Stamp Data Model
class MomentumStamp {
  constructor(dirIndex, magLevel, sourceType = 'Source') {
    this.dirIndex = dirIndex;   // 0..7
    this.magLevel = magLevel;   // 1..3
    this.sourceType = sourceType;
  }

  getVector() {
    const d = DIRECTIONS[this.dirIndex];
    const speed = MAGNITUDES[this.magLevel].speed;
    return new Vec2(d.dx * speed, d.dy * speed);
  }
}

// Particle Class
class PixelParticle {
  constructor(x, y, vx, vy, color, size, life) {
    this.pos = new Vec2(x, y);
    this.vel = new Vec2(vx, vy);
    this.color = color;
    this.size = size;
    this.maxLife = life;
    this.life = life;
  }

  update(dt) {
    this.life -= dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.vel.mult(0.92);
  }

  draw(ctx) {
    if (this.life <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.life / this.maxLife);
    ctx.fillStyle = this.color;
    ctx.fillRect(this.pos.x - this.size / 2, this.pos.y - this.size / 2, this.size, this.size);
    ctx.restore();
  }
}

// ==========================================
// 2. MOMENTUM SOURCES & DYNAMIC OBJECTS
// ==========================================

// Moving Momentum Source (Piston, Drone, or Pendulum Orb)
class MomentumSource {
  constructor(x, y, type, range = 120, speed = 180, axis = 'X') {
    this.startX = x;
    this.startY = y;
    this.pos = new Vec2(x, y);
    this.vel = new Vec2(0, 0);
    this.type = type; // 'piston', 'drone', 'pendulum'
    this.range = range;
    this.speed = speed;
    this.axis = axis; // 'X', 'Y', 'DIAG', 'CIRCLE'
    this.timer = 0;
    this.radius = 16;
  }

  update(dt) {
    this.timer += dt;
    const prevX = this.pos.x;
    const prevY = this.pos.y;

    if (this.axis === 'X') {
      const offset = Math.sin(this.timer * 3) * this.range;
      this.pos.x = this.startX + offset;
      this.pos.y = this.startY;
    } else if (this.axis === 'Y') {
      const offset = Math.sin(this.timer * 3) * this.range;
      this.pos.x = this.startX;
      this.pos.y = this.startY + offset;
    } else if (this.axis === 'DIAG') {
      const offset = Math.sin(this.timer * 2.5) * this.range;
      this.pos.x = this.startX + offset;
      this.pos.y = this.startY + offset;
    } else if (this.axis === 'CIRCLE') {
      this.pos.x = this.startX + Math.cos(this.timer * 2) * this.range;
      this.pos.y = this.startY + Math.sin(this.timer * 2) * this.range;
    }

    if (dt > 0.0001) {
      this.vel.x = (this.pos.x - prevX) / dt;
      this.vel.y = (this.pos.y - prevY) / dt;
    }
  }

  // Quantizes current instant velocity into 8-dir & 3-mag
  getQuantizedStamp() {
    const mag = this.vel.mag();
    if (mag < 20) return null;

    let dirIndex = 0;
    let maxDot = -Infinity;
    const normVel = this.vel.copy().norm();

    for (let i = 0; i < DIRECTIONS.length; i++) {
      const d = DIRECTIONS[i];
      const dot = normVel.x * d.dx + normVel.y * d.dy;
      if (dot > maxDot) {
        maxDot = dot;
        dirIndex = i;
      }
    }

    let magLevel = 1;
    if (mag > 320) magLevel = 3;
    else if (mag > 160) magLevel = 2;

    return new MomentumStamp(dirIndex, magLevel, this.type.toUpperCase());
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);

    if (this.type === 'piston') {
      // Metallic hydraulic ram
      ctx.fillStyle = '#475569';
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2;
      ctx.fillRect(-18, -12, 36, 24);
      ctx.strokeRect(-18, -12, 36, 24);

      // Glowing velocity indicator
      ctx.fillStyle = '#06b6d4';
      ctx.fillRect(-12, -4, 24, 8);
    } else if (this.type === 'drone') {
      // Flying kinetic hover drone
      ctx.fillStyle = '#312e81';
      ctx.strokeStyle = '#818cf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Pulsing center
      ctx.fillStyle = '#a855f7';
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.type === 'pendulum') {
      // Heavy kinetic orb
      ctx.fillStyle = '#78350f';
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Trailing ribbon particles indicator
    const norm = this.vel.copy().norm();
    if (this.vel.mag() > 40) {
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(norm.x * 24, norm.y * 24);
      ctx.stroke();
    }

    ctx.restore();
  }
}

// Movable Object (Crate, Kinetic Cargo, Sphere)
class MovableEntity {
  constructor(id, x, y, width, height, type = 'crate', isGoalCargo = false) {
    this.id = id;
    this.pos = new Vec2(x, y);
    this.vel = new Vec2(0, 0);
    this.w = width;
    this.h = height;
    this.type = type;
    this.isGoalCargo = isGoalCargo; // Must be delivered to cargo dock!
    this.friction = 0.96;
    this.trailTimer = 0;
  }

  update(dt, game) {
    if (this.vel.mag() > 5) {
      this.trailTimer += dt;
      if (this.trailTimer > 0.05) {
        this.trailTimer = 0;
        game.spawnParticle(
          this.pos.x + (Math.random() - 0.5) * this.w,
          this.pos.y + (Math.random() - 0.5) * this.h,
          -this.vel.x * 0.2, -this.vel.y * 0.2,
          this.isGoalCargo ? '#fde047' : '#8b5cf6',
          3, 0.35
        );
      }
    }

    // Move with collision resolution
    this.moveWithCollision(dt, game);

    // Damping
    this.vel.mult(this.friction);
    if (this.vel.mag() < 3) this.vel.set(0, 0);
  }

  moveWithCollision(dt, game) {
    const nextX = this.pos.x + this.vel.x * dt;
    const nextY = this.pos.y + this.vel.y * dt;

    const hw = this.w / 2;
    const hh = this.h / 2;

    // Check Deflector Bumper tiles first
    const centerTx = Math.floor(nextX / TILE_SIZE);
    const centerTy = Math.floor(nextY / TILE_SIZE);
    const centerTile = game.getTile(centerTx, centerTy);

    if (centerTile === TILE.DEFLECTOR_NE) { // 45-deg slash /
      // Reflect: vx <-> -vy
      const temp = this.vel.x;
      this.vel.x = -this.vel.y;
      this.vel.y = -temp;
      game.audio.playDeflect();
      game.camera.addTrauma(0.2);
      return;
    } else if (centerTile === TILE.DEFLECTOR_NW) { // 45-deg backslash \
      // Reflect: vx <-> vy
      const temp = this.vel.x;
      this.vel.x = this.vel.y;
      this.vel.y = temp;
      game.audio.playDeflect();
      game.camera.addTrauma(0.2);
      return;
    }

    // X Axis Collision
    if (!game.isObstacle(nextX - hw, this.pos.y - hh) &&
        !game.isObstacle(nextX + hw, this.pos.y - hh) &&
        !game.isObstacle(nextX - hw, this.pos.y + hh) &&
        !game.isObstacle(nextX + hw, this.pos.y + hh)) {
      this.pos.x = nextX;
    } else {
      // Wall Impact Check
      this.handleWallHit(nextX, this.pos.y, game, true);
      this.vel.x *= -0.4;
    }

    // Y Axis Collision
    if (!game.isObstacle(this.pos.x - hw, nextY - hh) &&
        !game.isObstacle(this.pos.x + hw, nextY - hh) &&
        !game.isObstacle(this.pos.x - hw, nextY + hh) &&
        !game.isObstacle(this.pos.x + hw, nextY + hh)) {
      this.pos.y = nextY;
    } else {
      this.handleWallHit(this.pos.x, nextY, game, false);
      this.vel.y *= -0.4;
    }
  }

  handleWallHit(targetX, targetY, game, isHorizontal) {
    const speed = this.vel.mag();
    if (speed > 80) {
      game.audio.playImpact(Math.min(2, speed / 250));
      game.camera.addTrauma(Math.min(0.5, speed / 600));

      // Check if cracked wall is smashed
      const tx = Math.floor(targetX / TILE_SIZE);
      const ty = Math.floor(targetY / TILE_SIZE);
      if (game.getTile(tx, ty) === TILE.CRACKED_WALL) {
        if (speed >= 300) { // Smashed by Medium or High momentum
          game.setTile(tx, ty, TILE.EMPTY);
          game.audio.playImpact(2.5);
          game.camera.addTrauma(0.6);
          game.showBanner("충격 격벽 파괴 성공!", false);
          for (let i = 0; i < 18; i++) {
            game.spawnParticle(
              (tx + 0.5) * TILE_SIZE, (ty + 0.5) * TILE_SIZE,
              (Math.random() - 0.5) * 160, (Math.random() - 0.5) * 160,
              '#e2e8f0', 3, 0.4
            );
          }
        } else {
          game.showBanner("충격량이 부족합니다 (최소 중급 360px/s 필요)", true);
        }
      }
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);

    const hw = this.w / 2;
    const hh = this.h / 2;

    if (this.isGoalCargo) {
      // Golden High-Priority Specimen Cargo
      ctx.fillStyle = '#eab308';
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 2;
      ctx.fillRect(-hw, -hh, this.w, this.h);
      ctx.strokeRect(-hw, -hh, this.w, this.h);

      // Core insignia
      ctx.fillStyle = '#ca8a04';
      ctx.fillRect(-hw + 6, -hh + 6, this.w - 12, this.h - 12);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('★', 0, 0);
    } else {
      // Standard Heavy Kinetic Crate
      ctx.fillStyle = '#1e293b';
      ctx.strokeStyle = '#8b5cf6';
      ctx.lineWidth = 2;
      ctx.fillRect(-hw, -hh, this.w, this.h);
      ctx.strokeRect(-hw, -hh, this.w, this.h);

      // Diagonal cross brace
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-hw, -hh); ctx.lineTo(hw, hh);
      ctx.moveTo(hw, -hh); ctx.lineTo(-hw, hh);
      ctx.stroke();
    }

    ctx.restore();
  }
}

// Interactive Floor Pressure Switch
class FloorSwitch {
  constructor(x, y, targetDoorId) {
    this.pos = new Vec2(x, y);
    this.targetDoorId = targetDoorId;
    this.isPressed = false;
    this.radius = 16;
  }

  update(entities, player, game) {
    let pressed = false;

    // Check player
    if (this.pos.dist(player.pos) < this.radius + player.radius) {
      pressed = true;
    }

    // Check movable crates
    if (!pressed) {
      for (const e of entities) {
        if (this.pos.dist(e.pos) < this.radius + e.w / 2) {
          pressed = true;
          break;
        }
      }
    }

    if (pressed !== this.isPressed) {
      this.isPressed = pressed;
      game.onSwitchToggled(this.targetDoorId, pressed);
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);

    ctx.fillStyle = this.isPressed ? '#065f46' : '#1e1e2f';
    ctx.strokeStyle = this.isPressed ? '#10b981' : '#64748b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Center light
    ctx.fillStyle = this.isPressed ? '#34d399' : '#f43f5e';
    ctx.beginPath();
    ctx.arc(0, 0, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

// Cargo Extraction Dock
class CargoDock {
  constructor(x, y) {
    this.pos = new Vec2(x, y);
    this.w = 40;
    this.h = 40;
    this.isFulfilled = false;
  }

  update(entities, game) {
    if (this.isFulfilled) return;
    for (const e of entities) {
      if (e.isGoalCargo && this.pos.dist(e.pos) < 22 && e.vel.mag() < 30) {
        this.isFulfilled = true;
        game.onDockFulfilled();
        break;
      }
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);

    ctx.fillStyle = this.isFulfilled ? '#064e3b' : '#312e81';
    ctx.strokeStyle = this.isFulfilled ? '#10b981' : '#a855f7';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(-this.w / 2, -this.h / 2, this.w, this.h);
    ctx.setLineDash([]);

    ctx.fillStyle = this.isFulfilled ? '#34d399' : '#c084fc';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.isFulfilled ? 'DOCKED' : 'CARGO DOCK', 0, 0);

    ctx.restore();
  }
}

// ==========================================
// 3. PLAYER CONTROLLER
// ==========================================
class MomentumPlayer {
  constructor(game, x, y) {
    this.game = game;
    this.pos = new Vec2(x, y);
    this.vel = new Vec2(0, 0);
    this.radius = 12;
    this.walkSpeed = 240;
    this.friction = 0.90;

    // Slots
    this.slots = [null, null, null];
    this.activeSlot = 0; // 0, 1, 2

    this.aimAngle = 0;
    this.isAiming = false; // Slow-Mo Aiming
  }

  setSlot(index) {
    if (index >= 0 && index < 3) {
      this.activeSlot = index;
      this.game.updateSlotUI();
    }
  }

  cycleSlot() {
    this.activeSlot = (this.activeSlot + 1) % 3;
    this.game.updateSlotUI();
  }

  update(dt, input, aimWorld) {
    const dx = aimWorld.x - this.pos.x;
    const dy = aimWorld.y - this.pos.y;
    this.aimAngle = Math.atan2(dy, dx);

    // Normal movement (WASD)
    const move = new Vec2(0, 0);
    if (input.up) move.y -= 1;
    if (input.down) move.y += 1;
    if (input.left) move.x -= 1;
    if (input.right) move.x += 1;

    if (move.mag() > 0) {
      move.norm();
      this.vel.x += move.x * this.walkSpeed * dt * 5;
      this.vel.y += move.y * this.walkSpeed * dt * 5;
    }

    this.vel.mult(this.friction);
    this.moveWithCollision(dt);
  }

  moveWithCollision(dt) {
    const nextX = this.pos.x + this.vel.x * dt;
    const nextY = this.pos.y + this.vel.y * dt;

    if (!this.game.isObstacle(nextX - this.radius, this.pos.y - this.radius) &&
        !this.game.isObstacle(nextX + this.radius, this.pos.y - this.radius) &&
        !this.game.isObstacle(nextX - this.radius, this.pos.y + this.radius) &&
        !this.game.isObstacle(nextX + this.radius, this.pos.y + this.radius)) {
      this.pos.x = nextX;
    } else {
      this.vel.x *= -0.2;
    }

    if (!this.game.isObstacle(this.pos.x - this.radius, nextY - this.radius) &&
        !this.game.isObstacle(this.pos.x + this.radius, nextY - this.radius) &&
        !this.game.isObstacle(this.pos.x - this.radius, nextY + this.radius) &&
        !this.game.isObstacle(this.pos.x + this.radius, nextY + this.radius)) {
      this.pos.y = nextY;
    } else {
      this.vel.y *= -0.2;
    }
  }

  // ACTION: Extract momentum from closest source
  tryExtract() {
    let closestSource = null;
    let closestDist = Infinity;

    for (const src of this.game.sources) {
      const d = this.pos.dist(src.pos);
      if (d < 75 && d < closestDist) {
        closestDist = d;
        closestSource = src;
      }
    }

    if (!closestSource) {
      this.game.showBanner("수집 범위(75px) 내에 움직이는 관성원이 없습니다.", true);
      return false;
    }

    const stamp = closestSource.getQuantizedStamp();
    if (!stamp) {
      this.game.showBanner("현재 관성원의 속도가 너무 낮아 수집할 수 없습니다.", true);
      return false;
    }

    // Save into active slot
    this.slots[this.activeSlot] = stamp;
    this.game.audio.playCollect();
    this.game.showBanner(
      `슬롯 [${this.activeSlot + 1}]에 ${stamp.sourceType} 관성 (${DIRECTIONS[stamp.dirIndex].arrow} ${MAGNITUDES[stamp.magLevel].label}) 수집 완료!`,
      false
    );

    // Visual ribbon burst
    for (let i = 0; i < 15; i++) {
      this.game.spawnParticle(
        closestSource.pos.x, closestSource.pos.y,
        (this.pos.x - closestSource.pos.x) * 2 + (Math.random() - 0.5) * 60,
        (this.pos.y - closestSource.pos.y) * 2 + (Math.random() - 0.5) * 60,
        '#06b6d4', 3, 0.35
      );
    }

    this.game.updateSlotUI();
    return true;
  }

  // ACTION: Print momentum stamp onto targeted entity or self
  tryPrint(aimWorld) {
    const stamp = this.slots[this.activeSlot];
    if (!stamp) {
      this.game.showBanner("선택된 슬롯에 저장된 관성 띠가 없습니다.", true);
      return false;
    }

    // Target check: Closest entity within aim radius, or self
    let target = null;
    let minDist = 36;

    for (const e of this.game.movables) {
      const d = aimWorld.dist(e.pos);
      if (d < minDist) {
        minDist = d;
        target = e;
      }
    }

    // If aiming near player, print onto player
    if (!target && aimWorld.dist(this.pos) < 40) {
      target = this;
    }

    if (!target) {
      this.game.showBanner("인쇄할 대상을 지정하십시오 (상자 또는 자신)", true);
      return false;
    }

    const vec = stamp.getVector();

    if (target === this) {
      // Print onto player: Flings the player!
      this.vel.set(vec.x, vec.y);
      this.game.showBanner("플레이어 슈트에 관성 인쇄! 고속 기동.", false);
    } else {
      // Print onto crate: Imparts kinetic vector
      target.vel.set(vec.x, vec.y);

      // Newton's 3rd law reaction pushback on player if standing close
      if (this.pos.dist(target.pos) < 45) {
        const reactionNorm = this.pos.copy().sub(target.pos).norm();
        this.vel.x += reactionNorm.x * vec.mag() * 0.45;
        this.vel.y += reactionNorm.y * vec.mag() * 0.45;
      }

      this.game.showBanner("사물에 관성 인쇄 완료! 충돌 반응 진행.", false);
    }

    this.game.audio.playPrint(stamp.magLevel);
    this.game.camera.addTrauma(0.35);

    // Consume or keep slot? Prototype design: Stamps are persistent until overwritten or consumed.
    // In our action puzzle, consuming gives puzzle depth:
    this.slots[this.activeSlot] = null;
    this.game.updateSlotUI();
    this.game.stats.stampsUsed++;

    return true;
  }

  draw(ctx, aimWorld) {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);

    // Player base body
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = '#8b5cf6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Momentum Imprinter Gun Pointer
    ctx.rotate(this.aimAngle);
    ctx.fillStyle = '#c084fc';
    ctx.fillRect(4, -3, 12, 6);

    ctx.restore();
  }
}

// ==========================================
// 4. CAMERA
// ==========================================
class Camera {
  constructor(w, h) {
    this.pos = new Vec2(0, 0);
    this.target = new Vec2(0, 0);
    this.w = w;
    this.h = h;
    this.trauma = 0;
  }

  resize(w, h) { this.w = w; this.h = h; }
  addTrauma(amount) { this.trauma = Math.min(1.0, this.trauma + amount); }

  update(dt, targetPos) {
    this.target = targetPos;
    this.pos.x += (this.target.x - this.pos.x) * 6 * dt;
    this.pos.y += (this.target.y - this.pos.y) * 6 * dt;
    if (this.trauma > 0) this.trauma = Math.max(0, this.trauma - dt * 2.0);
  }

  getOffset() {
    const shake = this.trauma * this.trauma * 16;
    const offsetX = (Math.random() - 0.5) * shake;
    const offsetY = (Math.random() - 0.5) * shake;
    return {
      x: Math.round(this.w / 2 - this.pos.x + offsetX),
      y: Math.round(this.h / 2 - this.pos.y + offsetY)
    };
  }
}

// ==========================================
// 5. MAIN GAME CONTROLLER & LEVEL DESIGN
// ==========================================
class PixelMomentumGame {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.audio = new MomentumAudioManager();

    this.currentLevel = 1;
    this.maxLevels = 5;
    this.timeDilation = 1.0; // 1.0 = normal, 0.2 = slow-mo
    this.state = 'PLAYING'; // 'PLAYING', 'VICTORY'

    // Map & Entities
    this.map = [];
    this.sources = [];
    this.movables = [];
    this.switches = [];
    this.cargoDock = null;
    this.particles = [];
    this.player = null;

    this.camera = new Camera(this.canvas.width, this.canvas.height);

    // Controls
    this.input = { up: false, down: false, left: false, right: false };
    this.mouseWorld = new Vec2(0, 0);
    this.mouseScreen = new Vec2(0, 0);

    // Stats
    this.stats = {
      stampsUsed: 0,
      levelStartTime: performance.now(),
      fps: 60
    };
    this.lastFrameTime = performance.now();
    this.debugVisible = false;

    this.initDOM();
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  initDOM() {
    this.slowMoVignette = document.getElementById('slowmo-vignette');
    this.slowMoIndicator = document.getElementById('slowmo-indicator');
    this.banner = document.getElementById('notification-banner');
    this.debugPanel = document.getElementById('debug-panel');
    this.uiLevelName = document.getElementById('hud-level-name');
    this.uiObjective = document.getElementById('hud-objective-status');

    this.slotElements = [
      document.getElementById('slot-1'),
      document.getElementById('slot-2'),
      document.getElementById('slot-3')
    ];

    this.slotElements.forEach((el, idx) => {
      el.onclick = () => {
        if (this.player) this.player.setSlot(idx);
      };
    });

    document.getElementById('btn-mute').onclick = (e) => {
      const isMuted = this.audio.toggleMute();
      e.target.innerText = isMuted ? "소리: OFF" : "소리: ON";
    };

    document.getElementById('btn-help').onclick = () => this.toggleModal('modal-help');
    document.getElementById('btn-close-help').onclick = () => this.toggleModal('modal-help');
    document.getElementById('btn-retry').onclick = () => this.loadLevel(this.currentLevel);
    document.getElementById('btn-victory-restart').onclick = () => this.loadLevel(1);

    this.setupInputHandlers();
  }

  resizeCanvas() {
    const container = document.getElementById('game-container');
    this.canvas.width = container.clientWidth;
    this.canvas.height = container.clientHeight;
    this.camera.resize(this.canvas.width, this.canvas.height);
  }

  toggleModal(id) {
    const modal = document.getElementById(id);
    modal.classList.toggle('active');
  }

  showBanner(text, isAlert = false) {
    this.banner.innerText = text;
    this.banner.className = isAlert ? 'show critical' : 'show';
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => { this.banner.className = ''; }, 2600);
  }

  setupInputHandlers() {
    window.addEventListener('keydown', (e) => {
      this.audio.ensureContext();

      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.input.up = true;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') this.input.down = true;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.input.left = true;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') this.input.right = true;

      // Slot Selection
      if (e.code === 'Digit1') this.player.setSlot(0);
      if (e.code === 'Digit2') this.player.setSlot(1);
      if (e.code === 'Digit3') this.player.setSlot(2);
      if (e.code === 'KeyQ') this.player.cycleSlot();

      // Collect (E)
      if (e.code === 'KeyE') {
        if (this.player) this.player.tryExtract();
      }

      // Slow-Mo Toggle via Space
      if (e.code === 'Space') {
        this.setSlowMo(true);
      }

      // Retry (R)
      if (e.code === 'KeyR') {
        this.loadLevel(this.currentLevel);
      }

      // F3 Debug
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

      if (e.code === 'Space') {
        this.setSlowMo(false);
      }
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseScreen.set(e.clientX - rect.left, e.clientY - rect.top);
      const offset = this.camera.getOffset();
      this.mouseWorld.set(this.mouseScreen.x - offset.x, this.mouseScreen.y - offset.y);
    });

    this.canvas.addEventListener('mousedown', (e) => {
      this.audio.ensureContext();
      if (e.button === 0) { // Left Click: Print Stamp (or Collect if near source)
        if (this.player) {
          // If aiming near source, collect
          let nearSource = false;
          for (const s of this.sources) {
            if (this.mouseWorld.dist(s.pos) < 35) {
              this.player.tryExtract();
              nearSource = true;
              break;
            }
          }
          if (!nearSource) {
            this.player.tryPrint(this.mouseWorld);
          }
        }
      } else if (e.button === 2) { // Right Click: Hold for Slow-Mo Aim
        this.setSlowMo(true);
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) {
        this.setSlowMo(false);
      }
    });

    this.canvas.addEventListener('wheel', (e) => {
      if (this.player) this.player.cycleSlot();
    });

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setSlowMo(active) {
    this.timeDilation = active ? 0.2 : 1.0;
    this.slowMoVignette.classList.toggle('active', active);
    this.slowMoIndicator.classList.toggle('show', active);
    this.audio.setSlowMoAudio(active);
  }

  updateSlotUI() {
    if (!this.player) return;
    this.slotElements.forEach((el, idx) => {
      el.classList.toggle('selected', idx === this.player.activeSlot);
      const stamp = this.player.slots[idx];
      const iconEl = el.querySelector('.slot-icon');
      const barsContainer = el.querySelector('.slot-mag-bars');

      if (stamp) {
        const dir = DIRECTIONS[stamp.dirIndex];
        iconEl.innerText = dir.arrow;
        iconEl.style.color = MAGNITUDES[stamp.magLevel].color;
        barsContainer.innerHTML = `
          <div class="mag-bar active-1"></div>
          <div class="mag-bar ${stamp.magLevel >= 2 ? 'active-2' : ''}"></div>
          <div class="mag-bar ${stamp.magLevel >= 3 ? 'active-3' : ''}"></div>
        `;
      } else {
        iconEl.innerText = '—';
        iconEl.style.color = '#64748b';
        barsContainer.innerHTML = `
          <div class="mag-bar"></div>
          <div class="mag-bar"></div>
          <div class="mag-bar"></div>
        `;
      }
    });
  }

  spawnParticle(x, y, vx, vy, color, size, life) {
    this.particles.push(new PixelParticle(x, y, vx, vy, color, size, life));
  }

  // ==========================================
  // LEVEL LOADER & LEVEL DESIGNS
  // ==========================================
  loadLevel(levelIndex) {
    this.currentLevel = levelIndex;
    this.setSlowMo(false);
    this.map = new Array(MAP_HEIGHT).fill(0).map(() => new Array(MAP_WIDTH).fill(TILE.WALL));
    this.sources = [];
    this.movables = [];
    this.switches = [];
    this.cargoDock = null;
    this.particles = [];

    // Clear inner floor
    for (let y = 1; y < MAP_HEIGHT - 1; y++) {
      for (let x = 1; x < MAP_WIDTH - 1; x++) {
        this.map[y][x] = TILE.EMPTY;
      }
    }

    if (levelIndex === 1) {
      // LEVEL 1: 관성 추출 기초 (Leaping chasm)
      this.uiLevelName.innerText = "제1실: 관성 추출과 도약 (Vector Extraction 101)";
      this.uiObjective.innerText = "목표: 피스톤에서 운동량을 추출하여 공허 균열을 건너 출구로 탈출하십시오.";

      this.player = new MomentumPlayer(this, 120, 300);

      // Void Chasm in middle
      for (let y = 1; y < MAP_HEIGHT - 1; y++) {
        this.map[y][14] = TILE.VOID;
        this.map[y][15] = TILE.VOID;
      }

      // Linear Horizontal Piston Source on the left
      this.sources.push(new MomentumSource(180, 160, 'piston', 100, 260, 'X'));

      // Exit goal on the right
      this.map[10][26] = TILE.EXIT;

    } else if (levelIndex === 2) {
      // LEVEL 2: 화물 수송과 충격 격벽 (Cargo Shunting & Breaker Wall)
      this.uiLevelName.innerText = "제2실: 화물 수송과 충격 격벽 (Cargo Shunting)";
      this.uiObjective.innerText = "목표: 고속 드론에서 강한 관성을 수집하여 상자에 인쇄하고, 균열벽을 부순 뒤 스위치를 밟으십시오.";

      this.player = new MomentumPlayer(this, 120, 150);

      // Cracked wall barrier at x = 18
      for (let y = 8; y <= 12; y++) {
        this.map[y][18] = TILE.CRACKED_WALL;
      }

      // Security Door at exit
      this.map[10][27] = TILE.DOOR_LOCKED;
      this.map[10][28] = TILE.EXIT;

      // Heavy Crate
      this.movables.push(new MovableEntity(1, 240, 320, 28, 28, 'crate'));

      // High-Speed Hover Drone
      this.sources.push(new MomentumSource(200, 200, 'drone', 90, 380, 'X'));

      // Pressure Switch at x = 22, y = 10
      this.switches.push(new FloorSwitch(22 * TILE_SIZE, 10 * TILE_SIZE, 'exitDoor'));

    } else if (levelIndex === 3) {
      // LEVEL 3: 연쇄 반작용 편향 (Bumper Deflection)
      this.uiLevelName.innerText = "제3실: 연쇄 반작용 편향 (Deflection Matrix)";
      this.uiObjective.innerText = "목표: 각도 반사판(Bumper)을 활용해 관성 궤적을 굴절시켜 숨겨진 스위치를 타격하십시오.";

      this.player = new MomentumPlayer(this, 120, 320);

      // Angled Deflector Bumpers
      this.map[6][12] = TILE.DEFLECTOR_NE;  // Slash /
      this.map[6][22] = TILE.DEFLECTOR_NW;  // Backslash \
      this.map[14][22] = TILE.DEFLECTOR_NE;

      // Movable kinetic sphere
      this.movables.push(new MovableEntity(2, 12 * TILE_SIZE, 14 * TILE_SIZE, 24, 24, 'orb'));

      // Pendulum source
      this.sources.push(new MomentumSource(200, 100, 'pendulum', 110, 320, 'Y'));

      // Remote Switch
      this.switches.push(new FloorSwitch(12 * TILE_SIZE, 18 * TILE_SIZE, 'exitDoor'));

      // Door & Exit
      this.map[10][27] = TILE.DOOR_LOCKED;
      this.map[10][28] = TILE.EXIT;

    } else if (levelIndex === 4) {
      // LEVEL 4: 정밀 화물 안착 (Precision Cargo Delivery)
      this.uiLevelName.innerText = "제4실: 정밀 화물 안착 챌린지 (Precision Cargo Dock)";
      this.uiObjective.innerText = "목표: 황금 코어 화물을 공허 구덩이에 빠뜨리지 않고 우측 화물 도크에 정밀 안착시키십시오.";

      this.player = new MomentumPlayer(this, 100, 200);

      // Goal Cargo Cube
      this.movables.push(new MovableEntity(3, 200, 200, 30, 30, 'crate', true));

      // Void pits surrounding the corridor
      for (let x = 12; x <= 22; x++) {
        this.map[4][x] = TILE.VOID;
        this.map[8][x] = TILE.VOID;
      }

      // Precision Weak/Medium Source
      this.sources.push(new MomentumSource(160, 350, 'piston', 80, 180, 'X'));

      // Cargo Dock at x = 25, y = 6
      this.cargoDock = new CargoDock(25 * TILE_SIZE, 6 * TILE_SIZE);

      // Exit activates when cargo docked
      this.map[10][27] = TILE.DOOR_LOCKED;
      this.map[10][28] = TILE.EXIT;

    } else if (levelIndex === 5) {
      // LEVEL 5: 운동량 연쇄 마스터 (Grand Kinetic Matrix)
      this.uiLevelName.innerText = "제5실: 운동량 연쇄 마스터 (Grand Kinetic Matrix)";
      this.uiObjective.innerText = "목표: 모든 물리 역학을 총동원하여 이중 격벽을 해제하고 최종 탈출구에 도달하십시오.";

      this.player = new MomentumPlayer(this, 100, 320);

      // Multiple crates & sources
      this.movables.push(new MovableEntity(4, 220, 200, 28, 28, 'crate'));
      this.movables.push(new MovableEntity(5, 340, 380, 28, 28, 'crate'));

      this.sources.push(new MomentumSource(180, 120, 'drone', 120, 420, 'DIAG'));
      this.sources.push(new MomentumSource(420, 240, 'pendulum', 90, 300, 'CIRCLE'));

      this.map[7][15] = TILE.DEFLECTOR_NW;
      this.map[12][20] = TILE.CRACKED_WALL;

      this.switches.push(new FloorSwitch(15 * TILE_SIZE, 15 * TILE_SIZE, 'door1'));
      this.switches.push(new FloorSwitch(24 * TILE_SIZE, 8 * TILE_SIZE, 'exitDoor'));

      this.map[10][22] = TILE.DOOR_LOCKED;
      this.map[10][27] = TILE.DOOR_LOCKED;
      this.map[10][28] = TILE.EXIT;
    }

    this.updateSlotUI();
    this.showBanner(`${this.uiLevelName.innerText} 시작`, false);
  }

  onSwitchToggled(doorId, pressed) {
    this.audio.playSwitch();
    // Unlock doors in map
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        if (this.map[y][x] === TILE.DOOR_LOCKED && pressed) {
          this.map[y][x] = TILE.DOOR_OPEN;
        } else if (this.map[y][x] === TILE.DOOR_OPEN && !pressed) {
          this.map[y][x] = TILE.DOOR_LOCKED;
        }
      }
    }
  }

  onDockFulfilled() {
    this.audio.playSwitch();
    this.showBanner("황금 코어 화물 안착 완료! 탈출 게이트 개방.", false);
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        if (this.map[y][x] === TILE.DOOR_LOCKED) {
          this.map[y][x] = TILE.DOOR_OPEN;
        }
      }
    }
  }

  getTile(tx, ty) {
    if (tx < 0 || tx >= MAP_WIDTH || ty < 0 || ty >= MAP_HEIGHT) return TILE.WALL;
    return this.map[ty][tx];
  }

  setTile(tx, ty, tile) {
    if (tx >= 0 && tx < MAP_WIDTH && ty >= 0 && ty < MAP_HEIGHT) {
      this.map[ty][tx] = tile;
    }
  }

  isObstacle(worldX, worldY) {
    const tx = Math.floor(worldX / TILE_SIZE);
    const ty = Math.floor(worldY / TILE_SIZE);
    const t = this.getTile(tx, ty);
    return t === TILE.WALL || t === TILE.CRACKED_WALL || t === TILE.DOOR_LOCKED;
  }

  // ==========================================
  // GAME LOOP: UPDATE & RENDER
  // ==========================================
  update(dt) {
    const effectiveDt = dt * this.timeDilation;

    // 1. Sources
    for (const s of this.sources) {
      s.update(effectiveDt);
    }

    // 2. Movable Entities
    for (const m of this.movables) {
      m.update(effectiveDt, this);
    }

    // 3. Player
    if (this.player) {
      this.player.update(effectiveDt, this.input, this.mouseWorld);
      this.camera.update(dt, this.player.pos); // Camera updates smoothly in real time

      // Check level exit
      const tx = Math.floor(this.player.pos.x / TILE_SIZE);
      const ty = Math.floor(this.player.pos.y / TILE_SIZE);
      if (this.getTile(tx, ty) === TILE.EXIT) {
        this.onLevelCleared();
      }

      // Check void fall (if player moves slowly into void pit)
      if (this.getTile(tx, ty) === TILE.VOID && this.player.vel.mag() < 120) {
        this.audio.playHazard();
        this.showBanner("공허 심연으로 추락했습니다! 레벨 재시작.", true);
        this.loadLevel(this.currentLevel);
      }
    }

    // 4. Switches & Dock
    for (const sw of this.switches) {
      sw.update(this.movables, this.player, this);
    }

    if (this.cargoDock) {
      this.cargoDock.update(this.movables, this);
    }

    // 5. Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.update(effectiveDt);
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    // Debug Panel (F3)
    if (this.debugVisible && this.player) {
      this.debugPanel.innerHTML = `
        <strong>[F3 진단 모드]</strong><br>
        FPS: ${this.stats.fps}<br>
        Time Scale: ${this.timeDilation.toFixed(2)}x<br>
        Player: (${this.player.pos.x.toFixed(0)}, ${this.player.pos.y.toFixed(0)}) Vel: ${this.player.vel.mag().toFixed(1)}<br>
        Active Slot: [${this.player.activeSlot + 1}]<br>
        Entities: ${this.movables.length} | Sources: ${this.sources.length}<br>
        Total Stamps Used: ${this.stats.stampsUsed}
      `;
    }
  }

  onLevelCleared() {
    this.audio.playVictory();
    if (this.currentLevel < this.maxLevels) {
      this.showBanner(`제${this.currentLevel}실 통과! 다음 시험실로 진행합니다.`, false);
      this.loadLevel(this.currentLevel + 1);
    } else {
      document.getElementById('victory-stats').innerText =
        `총 인쇄 횟수: ${this.stats.stampsUsed}회 | 5대 전 시험실 완주 완료!`;
      this.toggleModal('modal-victory');
    }
  }

  draw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const offset = this.camera.getOffset();

    this.ctx.save();
    this.ctx.translate(offset.x, offset.y);

    // 1. Draw Map Tiles
    this.drawMap(this.ctx);

    // 2. Draw Switches & Cargo Dock
    for (const sw of this.switches) sw.draw(this.ctx);
    if (this.cargoDock) this.cargoDock.draw(this.ctx);

    // 3. Draw Sources
    for (const s of this.sources) s.draw(this.ctx);

    // 4. Draw Movables
    for (const m of this.movables) m.draw(this.ctx);

    // 5. Draw Particles
    for (const p of this.particles) p.draw(this.ctx);

    // 6. Draw Player
    if (this.player) this.player.draw(this.ctx, this.mouseWorld);

    // 7. TRAJECTORY PREVIEW (When slow-mo aiming with active stamp)
    this.drawTrajectoryPreview(this.ctx);

    this.ctx.restore();
  }

  drawMap(ctx) {
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        const t = this.map[y][x];
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;

        if (t === TILE.EMPTY) {
          ctx.fillStyle = '#0b0f19';
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = '#111827';
          ctx.lineWidth = 1;
          ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
        } else if (t === TILE.WALL) {
          ctx.fillStyle = '#111827';
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = '#1e293b';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
        } else if (t === TILE.VOID) {
          ctx.fillStyle = '#030508';
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          // Hazard grid
          ctx.strokeStyle = 'rgba(244, 63, 94, 0.2)';
          ctx.beginPath();
          ctx.moveTo(px, py); ctx.lineTo(px + TILE_SIZE, py + TILE_SIZE);
          ctx.stroke();
        } else if (t === TILE.CRACKED_WALL) {
          ctx.fillStyle = '#1e1e24';
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(px + 4, py + 8); ctx.lineTo(px + 16, py + 24); ctx.lineTo(px + 28, py + 12);
          ctx.stroke();
        } else if (t === TILE.DEFLECTOR_NE) {
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          // Slash bumper /
          ctx.strokeStyle = '#06b6d4';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(px, py + TILE_SIZE); ctx.lineTo(px + TILE_SIZE, py);
          ctx.stroke();
        } else if (t === TILE.DEFLECTOR_NW) {
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          // Backslash bumper \
          ctx.strokeStyle = '#06b6d4';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(px, py); ctx.lineTo(px + TILE_SIZE, py + TILE_SIZE);
          ctx.stroke();
        } else if (t === TILE.DOOR_LOCKED) {
          ctx.fillStyle = '#450a0a';
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2;
          ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
          ctx.fillStyle = '#f87171';
          ctx.fillRect(px + 10, py + 6, 12, 20);
        } else if (t === TILE.DOOR_OPEN) {
          ctx.fillStyle = '#064e3b';
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = 1;
          ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
        } else if (t === TILE.EXIT) {
          ctx.fillStyle = '#064e3b';
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          ctx.fillStyle = '#34d399';
          ctx.font = 'bold 12px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('EXIT', px + TILE_SIZE / 2, py + TILE_SIZE / 2);
        }
      }
    }
  }

  // Trajectory Preview line when Slow-Mo is active
  drawTrajectoryPreview(ctx) {
    if (this.timeDilation >= 1.0 || !this.player) return;
    const stamp = this.player.slots[this.player.activeSlot];
    if (!stamp) return;

    // Find targeted entity under mouse, or player
    let target = null;
    let minDist = 36;
    for (const e of this.movables) {
      if (this.mouseWorld.dist(e.pos) < minDist) {
        minDist = this.mouseWorld.dist(e.pos);
        target = e;
      }
    }
    if (!target && this.mouseWorld.dist(this.player.pos) < 40) {
      target = this.player;
    }

    if (!target) return;

    // Compute preview ray
    const vec = stamp.getVector();
    const dir = vec.copy().norm();
    const len = vec.mag() * 0.45;

    ctx.save();
    ctx.strokeStyle = MAGNITUDES[stamp.magLevel].color;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);

    ctx.beginPath();
    ctx.moveTo(target.pos.x, target.pos.y);
    ctx.lineTo(target.pos.x + dir.x * len, target.pos.y + dir.y * len);
    ctx.stroke();

    // Target highlight ring
    ctx.setLineDash([]);
    ctx.strokeStyle = '#c084fc';
    ctx.beginPath();
    ctx.arc(target.pos.x, target.pos.y, 20, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  run() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.stats.fps = Math.round(1 / dt);
    this.lastFrameTime = now;

    this.update(dt);
    this.draw();

    requestAnimationFrame(() => this.run());
  }
}

// Start Game on window load
window.addEventListener('load', () => {
  const game = new PixelMomentumGame();
  window.gameInstance = game;
  game.loadLevel(1);
  game.run();
});
