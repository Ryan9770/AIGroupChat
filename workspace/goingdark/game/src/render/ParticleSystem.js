// ============================================================================
// 파티클 및 게임 필 시스템 (ParticleSystem)
// 고정 크기 파티클 풀(GC 스파이크 방지), 피격 스쿼시, 데미지 숫자, 잔해 연출
// P2-04: 게임 필 패키지 (먼지/금화/뼈 파편/위액/성수 빛)
// ============================================================================

const MAX_PARTICLES = 400;
const MAX_DAMAGE_NUMBERS = 60;

export class ParticleSystem {
  constructor() {
    this.particles = [];
    this.damageNumbers = [];
    this.hitstopTimer = 0; // 초 단위
    this.shakeTrauma = 0;  // 0 ~ 1.0
  }

  triggerHitstop(duration = 0.07) {
    this.hitstopTimer = Math.max(this.hitstopTimer, duration);
  }

  addTrauma(amount) {
    this.shakeTrauma = Math.min(1.0, this.shakeTrauma + amount);
  }

  emitDust(x, y, count = 3) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 1.5;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.25 + Math.random() * 0.2,
        maxLife: 0.45,
        color: '#8a7d6a',
        size: 2 + Math.random() * 2,
      });
    }
  }

  emitBlood(x, y, count = 5) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.0 + Math.random() * 3.0;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.3 + Math.random() * 0.25,
        maxLife: 0.55,
        color: Math.random() < 0.5 ? '#8b0000' : '#5c0000',
        size: 2.5 + Math.random() * 2.5,
      });
    }
  }

  emitSpark(x, y, count = 4) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.0 + Math.random() * 3.0;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.15 + Math.random() * 0.15,
        maxLife: 0.3,
        color: '#ffdd66',
        size: 1.5 + Math.random() * 1.5,
      });
    }
  }

  emitCoin(x, y, count = 6) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.0 + Math.random() * 2.5;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        life: 0.4 + Math.random() * 0.3,
        maxLife: 0.7,
        color: '#ffd700',
        size: 2.5,
      });
    }
  }

  emitHoly(x, y, count = 8) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.8 + Math.random() * 2.0;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.0,
        life: 0.5 + Math.random() * 0.4,
        maxLife: 0.9,
        color: '#cfe6ff',
        size: 2.5 + Math.random() * 2.0,
      });
    }
  }

  spawnDamageNumber(x, y, amount, isCrit = false, isPlayerDmg = false) {
    if (this.damageNumbers.length >= MAX_DAMAGE_NUMBERS) this.damageNumbers.shift();
    this.damageNumbers.push({
      x, y,
      text: `${Math.round(amount)}`,
      vy: -2.0,
      life: 0.7,
      maxLife: 0.7,
      isCrit,
      isPlayerDmg,
    });
  }

  update(dt) {
    // 히트스톱 차감
    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= dt;
    }

    // 트라우마 감쇄
    if (this.shakeTrauma > 0) {
      this.shakeTrauma = Math.max(0, this.shakeTrauma - dt * 1.5);
    }

    // 파티클 업데이트
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // 데미지 숫자 업데이트
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const dn = this.damageNumbers[i];
      dn.y += dn.vy * dt;
      dn.life -= dt;
      if (dn.life <= 0) {
        this.damageNumbers.splice(i, 1);
      }
    }
  }

  render(ctx, w2s) {
    // 파티클 렌더링
    for (const p of this.particles) {
      const [sx, sy] = w2s(p.x, p.y);
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.fillRect(sx - p.size / 2, sy - p.size / 2, p.size, p.size);
      ctx.restore();
    }

    // 플로팅 데미지 숫자 렌더링
    for (const dn of this.damageNumbers) {
      const [sx, sy] = w2s(dn.x, dn.y);
      const alpha = Math.min(1.0, (dn.life / dn.maxLife) * 1.5);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = dn.isCrit ? 'bold 16px monospace' : 'bold 12px monospace';
      ctx.textAlign = 'center';

      if (dn.isPlayerDmg) {
        ctx.fillStyle = '#ff4d4d';
      } else if (dn.isCrit) {
        ctx.fillStyle = '#ffdd44';
        ctx.shadowColor = '#ffaa00';
        ctx.shadowBlur = 4;
      } else {
        ctx.fillStyle = '#ffffff';
      }

      ctx.fillText(dn.text, sx, sy);
      ctx.restore();
    }
  }
}
