// ============================================================================
// Phase 6: 성능 및 벤치마크 검증 (Performance & Benchmark Invariants)
// 14_antigravity_production_brief.md P6-03 준수:
// 1. 30 엔티티 시뮬레이션 p95 프레임 갱신 시간 <= 16.7ms (60 FPS 보장)
// 2. 100 엔티티 극한 스트레스 p95 <= 33.3ms (30 FPS 이상 방어)
// 3. 1,000회 연속 던전 생성/소멸 및 런 순환 시 메모리 누수 방지 (증가량 <= 20MB)
// 4. 파티클 풀(400개) 재활용 및 Zero-GC 불변식
// ============================================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RunEngine } from '../src/run/RunEngine.js';
import { ParticleSystem } from '../src/render/ParticleSystem.js';
import { DEFAULT_STATE_V2 } from '../src/systems/save.js';

function computePercentile(samples, p) {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

describe('P6-03. Performance Benchmarking & Memory Invariants', () => {
  test('30 entities simulation: p95 frame calculation time <= 16.7ms across 3,600 ticks', () => {
    const save = structuredClone(DEFAULT_STATE_V2);
    const engine = new RunEngine({ save, floor: 1, seed: 104523 });

    // Spawn 30 active enemies distributed around player
    for (let i = 0; i < 30; i++) {
      const angle = (i / 30) * Math.PI * 2;
      const radius = 5 + (i % 5);
      const ex = engine.player.x + Math.cos(angle) * radius;
      const ey = engine.player.y + Math.sin(angle) * radius;
      engine.enemies.push({
        id: `perf_mob_${i}`,
        type: i % 2 === 0 ? 'mite' : 'skeleton',
        name: `Perf Mob ${i}`,
        x: ex,
        y: ey,
        hp: 50,
        maxHp: 50,
        alive: true,
        state: 'chase',
        speed: 3.5,
        attackCooldown: 1.0,
        telegraph: 0,
        update: (_dt, _game) => {},
      });
    }

    const frameTimes = [];
    const totalFrames = 3600; // 60 seconds at 60Hz

    for (let f = 0; f < totalFrames; f++) {
      const t0 = performance.now();
      engine.update(1 / 60);
      const t1 = performance.now();
      frameTimes.push(t1 - t0);
    }

    const p95 = computePercentile(frameTimes, 95);
    const p99 = computePercentile(frameTimes, 99);
    const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;

    console.log(`\n  [Benchmark 30 Entities] Avg: ${avg.toFixed(3)}ms | p95: ${p95.toFixed(3)}ms | p99: ${p99.toFixed(3)}ms`);
    assert.ok(p95 <= 16.7, `p95 calculation time (${p95.toFixed(3)}ms) must be <= 16.7ms`);
  });

  test('100 entities stress test: p95 frame calculation time <= 33.3ms across 600 ticks', () => {
    const save = structuredClone(DEFAULT_STATE_V2);
    const engine = new RunEngine({ save, floor: 2, seed: 991823 });

    for (let i = 0; i < 100; i++) {
      const angle = (i / 100) * Math.PI * 2;
      const radius = 4 + (i % 8);
      engine.enemies.push({
        id: `stress_mob_${i}`,
        type: 'skeleton',
        name: `Stress Mob ${i}`,
        x: engine.player.x + Math.cos(angle) * radius,
        y: engine.player.y + Math.sin(angle) * radius,
        hp: 60,
        maxHp: 60,
        alive: true,
        state: 'chase',
        speed: 3.0,
        attackCooldown: 1.0,
        telegraph: 0,
        update: (_dt, _game) => {},
      });
    }

    const frameTimes = [];
    const totalFrames = 600;

    for (let f = 0; f < totalFrames; f++) {
      const t0 = performance.now();
      engine.update(1 / 60);
      const t1 = performance.now();
      frameTimes.push(t1 - t0);
    }

    const p95 = computePercentile(frameTimes, 95);
    console.log(`  [Stress 100 Entities] p95: ${p95.toFixed(3)}ms (Threshold <= 33.3ms)`);
    assert.ok(p95 <= 33.3, `p95 stress time (${p95.toFixed(3)}ms) must be <= 33.3ms`);
  });

  test('1,000 runs lifecycle & heap memory retention delta <= 20MB', () => {
    if (global.gc) global.gc();
    const initialHeap = process.memoryUsage().heapUsed;

    const runsCount = 1000;
    for (let i = 0; i < runsCount; i++) {
      const save = structuredClone(DEFAULT_STATE_V2);
      const engine = new RunEngine({ save, floor: (i % 5) + 1, seed: 100000 + i });
      // Simulate 10 frames of gameplay per run
      for (let f = 0; f < 10; f++) {
        engine.update(1 / 60);
      }
    }

    if (global.gc) global.gc();
    const finalHeap = process.memoryUsage().heapUsed;
    const heapDiffMB = (finalHeap - initialHeap) / (1024 * 1024);

    console.log(`  [Memory Retention 1000 Runs] Heap Delta: ${heapDiffMB.toFixed(2)} MB (Max 20.0MB)`);
    assert.ok(heapDiffMB <= 20.0, `Heap memory growth (${heapDiffMB.toFixed(2)}MB) must be <= 20MB`);
  });

  test('ParticleSystem pool recycling: 10,000 particles spawned with zero memory pool explosion', () => {
    const pool = new ParticleSystem();

    for (let i = 0; i < 1000; i++) {
      pool.emitBlood(50, 50, 5);
      pool.emitCoin(50, 50, 5);
      if (i % 50 === 0) {
        pool.update(0.1);
      }
    }

    assert.ok(pool.particles.length <= 400, `Particle count (${pool.particles.length}) must never exceed MAX_PARTICLES (400)`);
  });
});
