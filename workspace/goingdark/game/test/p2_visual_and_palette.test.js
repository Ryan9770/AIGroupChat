// ============================================================================
// Phase 2 검증 테스트: 비주얼 버티컬 슬라이스 & 팔레트 & 전조 시스템
// 14_antigravity_production_brief.md P2-01 ~ P2-05 준수 검증
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

import {
  CORE_PALETTE,
  RAMP_PALETTE_32,
  FLOOR_LUTS,
  TELEGRAPH_KINDS,
  TELEGRAPH_STYLES,
  simulateColorblindness,
  hexToRgb,
} from '../src/data/palette.js';
import { createEnemy } from '../src/entities/enemies.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('P2-03. Core Palette & 32-Color Ramp Invariants', () => {
  // 1. 핵심 8색 팔레트 검증
  const expectedCoreKeys = [
    'VOID', 'STONE', 'OLD_GOLD', 'HOLY_LIGHT',
    'COAGULATED_RED', 'BILE_GREEN', 'BRUISED_PURPLE', 'ALARM_VERMILION',
  ];
  for (const key of expectedCoreKeys) {
    assert.ok(CORE_PALETTE[key], `Core palette must define ${key}`);
    assert.match(CORE_PALETTE[key], /^#[0-9A-Fa-f]{6}$/, `${key} must be a valid 6-character hex`);
  }

  // 2. 32색 램프 팔레트 검증
  assert.equal(RAMP_PALETTE_32.length, 32, 'Expanded palette must contain exactly 32 colors');
  const uniqueColors = new Set(RAMP_PALETTE_32.map((c) => c.toUpperCase()));
  assert.equal(uniqueColors.size, 32, 'All 32 ramp colors must be unique');

  // 3. 5개 층별 LUT 검증
  for (let f = 1; f <= 5; f++) {
    const lut = FLOOR_LUTS[f];
    assert.ok(lut, `Floor ${f} LUT must be defined`);
    assert.ok(lut.name, `Floor ${f} must have a name`);
    assert.match(lut.primary, /^#[0-9A-Fa-f]{6}$/);
    assert.match(lut.secondary, /^#[0-9A-Fa-f]{6}$/);
    assert.match(lut.dark, /^#[0-9A-Fa-f]{6}$/);
  }

  // 4. 리매핑된 스프라이트 시트 파일 존재 및 팔레트 유효성 검증
  const remappedPath = path.resolve(__dirname, '../public/assets/sprites/0x72_DungeonTilesetII_remapped.png');
  assert.ok(fs.existsSync(remappedPath), 'Remapped spritesheet must exist');

  const fileData = fs.readFileSync(remappedPath);
  const png = PNG.sync.read(fileData);
  assert.ok(png.width > 0 && png.height > 0, 'Spritesheet must have valid dimensions');

  const rampSet = new Set(RAMP_PALETTE_32.map((hex) => hex.toUpperCase()));
  let sampledOpaqueCount = 0;
  let matchesRampCount = 0;

  // 픽셀 샘플링 검사
  for (let i = 0; i < png.data.length; i += 40) { // 10픽셀마다 샘플
    const a = png.data[i + 3];
    if (a > 0) {
      sampledOpaqueCount++;
      const hex = '#' + [png.data[i], png.data[i + 1], png.data[i + 2]]
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
      if (rampSet.has(hex)) {
        matchesRampCount++;
      }
    }
  }

  assert.ok(sampledOpaqueCount > 0, 'Must have inspected opaque pixels');
  assert.equal(matchesRampCount, sampledOpaqueCount, 'All remapped opaque pixels must belong to the 32-color ramp');
});

test('P2-03 & P2-05. Color Accessibility & Telegraph Dual Coding', () => {
  // 1. 색각이상 시뮬레이션 동작 검증
  const testHex = '#A83A3A';
  const deut = simulateColorblindness(testHex, 'deuteranopia');
  const prot = simulateColorblindness(testHex, 'protanopia');
  const mono = simulateColorblindness(testHex, 'monochrome');

  assert.match(deut, /^#[0-9A-Fa-f]{6}$/);
  assert.match(prot, /^#[0-9A-Fa-f]{6}$/);
  assert.match(mono, /^#[0-9A-Fa-f]{6}$/);

  // 모노크롬 변환 시 R=G=B 휘도 일치
  const monoRgb = hexToRgb(mono);
  assert.equal(monoRgb.r, monoRgb.g);
  assert.equal(monoRgb.g, monoRgb.b);

  // 2. 텔레그래프 듀얼 코딩(색상 + 선 패턴 + 기호) 검증
  for (const kind of Object.values(TELEGRAPH_KINDS)) {
    const style = TELEGRAPH_STYLES[kind];
    assert.ok(style, `Style for telegraph ${kind} must be defined`);
    assert.ok(style.pattern, `Style for ${kind} must specify pattern for non-color identification`);
    assert.ok(style.symbol, `Style for ${kind} must specify iconic symbol for dual coding`);
  }

  // 즉시 피해(실선, !) vs 지속 위험(점선, ≈) 식별 보장
  assert.notDeepEqual(
    TELEGRAPH_STYLES[TELEGRAPH_KINDS.IMMEDIATE].dash,
    TELEGRAPH_STYLES[TELEGRAPH_KINDS.PERSISTENT].dash,
    'Immediate and persistent telegraphs must use distinct dash patterns for colorblindness'
  );
});

test('P2-05. Enemy Telegraph State & Timing Invariants (>= 0.4s Telegraphs)', () => {
  const dummyGame = {
    player: { x: 5, y: 5, gaze: 0, lampActiveUntil: 0 },
    rng: { combat: { next: () => 0.2 } },
    time: 10,
    isNoiseAudible: () => false,
    onNoise: () => {},
    spawnProjectile: () => {},
    damagePlayer: () => {},
  };

  const enemyTypes = ['skeleton', 'mite', 'royalGuard', 'cultist', 'wraith'];

  for (const type of enemyTypes) {
    const enemy = createEnemy(type, 5, 5.5); // 플레이어 공격 사거리 내 배치
    enemy.state = 'alert';

    // 적 업데이트 1스텝 실행
    enemy.update(1 / 60, dummyGame);

    // 공격 타이머/샷 타이머 카운트다운을 진행시켜 텔레그래프 진입 테스트
    // 적어도 0.4초 이상의 텔레그래프 시간을 가져야 함
    const dt = 1 / 60;
    let enteredTelegraph = false;
    let telegraphDuration = 0;

    for (let step = 0; step < 180; step++) { // 최대 3초 시뮬레이션
      enemy.update(dt, dummyGame);
      if (enemy.state === 'telegraph') {
        enteredTelegraph = true;
        telegraphDuration += dt;
      } else if (enteredTelegraph && enemy.state !== 'telegraph') {
        break; // 텔레그래프 종료 후 공격 발동
      }
    }

    assert.ok(enteredTelegraph, `Enemy ${type} must enter telegraph state before attacking`);
    assert.ok(
      telegraphDuration >= 0.38, // 0.4s 근사 허용치
      `Enemy ${type} telegraph duration (${telegraphDuration.toFixed(2)}s) must be >= 0.4s`
    );
  }
});
