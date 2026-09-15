import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SeededRng } from '../src/core/rng.js';
import { RoomGraphGenerator } from '../src/core/roomGraph.js';

/**
 * 독립 검사 함수 (생성기 자체 validateGraph를 호출하지 않고 별도로 불변식 검증)
 */
function independentValidateGraph(graph, floorNum) {
  if (!graph || !Array.isArray(graph.rooms) || graph.rooms.length < 6) {
    return { valid: false, reason: 'rooms < 6' };
  }

  const rooms = graph.rooms;

  // 1. BFS 연결성 및 최단거리 독립 계산
  const distMap = new Map();
  const queue = [0];
  distMap.set(0, 0);

  while (queue.length > 0) {
    const curId = queue.shift();
    const curDist = distMap.get(curId);
    const room = rooms.find(r => r.id === curId);
    if (!room) continue;
    for (const nId of room.neighbors) {
      if (!distMap.has(nId)) {
        distMap.set(nId, curDist + 1);
        queue.push(nId);
      }
    }
  }

  if (distMap.size !== rooms.length) {
    return { valid: false, reason: 'disconnected rooms' };
  }

  // 2. 방 격자 좌표 중복 검사
  const coords = new Set();
  for (const r of rooms) {
    const key = `${r.gx},${r.gy}`;
    if (coords.has(key)) {
      return { valid: false, reason: `duplicate coords: ${key}` };
    }
    coords.add(key);
  }

  // 3. 보물방 누락 여부 검사 (전 층 필수)
  const treasureRoom = rooms.find(r => r.type === 'treasure');
  if (!treasureRoom || !distMap.has(treasureRoom.id)) {
    return { valid: false, reason: 'missing treasure room' };
  }

  // 4. 5층 보스방 시작방 최단 BFS 거리 >= 3 검사
  if (floorNum === 5) {
    const bossRoom = rooms.find(r => r.type === 'boss');
    if (!bossRoom || !distMap.has(bossRoom.id)) {
      return { valid: false, reason: 'missing boss room' };
    }
    const bossDist = distMap.get(bossRoom.id);
    if (bossDist < 3) {
      return { valid: false, reason: `boss dist < 3 (${bossDist})` };
    }
  } else {
    const stairsRoom = rooms.find(r => r.type === 'stairs');
    if (!stairsRoom || !distMap.has(stairsRoom.id)) {
      return { valid: false, reason: 'missing stairs room' };
    }
  }

  // 5. 탈출 체크포인트 게이트 검사 (1, 3, 5층 필수)
  if (floorNum === 1 || floorNum === 3 || floorNum === 5) {
    const gateRoom = rooms.find(r => r.type === 'gate');
    if (!gateRoom || !distMap.has(gateRoom.id)) {
      return { valid: false, reason: 'missing gate room on checkpoint floor' };
    }
  }

  // 6. 2~5층 역주행 복귀 계단 (시작방 존재 및 연결)
  if (floorNum >= 2) {
    const startRoom = rooms.find(r => r.type === 'start');
    if (!startRoom) {
      return { valid: false, reason: 'missing start room for return stairs' };
    }
  }

  return { valid: true };
}

describe('G2 & P0-04. Room Graph Invariants & Independent Verification (10,000 Seeds)', () => {
  test('10,000 seeds across floors 1~5 guarantee 0 missing treasure, 0 boss dist < 3, 0 escape violations, fallback < 0.1%', () => {
    let fallbackCount = 0;
    let missingTreasureCount = 0;
    let bossDistTooCloseCount = 0;
    let escapePolicyViolations = 0;
    const testCount = 10000;

    for (let i = 0; i < testCount; i++) {
      const seed = 100000 + i;
      const floorNum = (i % 5) + 1;
      const rng = new SeededRng(seed);
      const gen = new RoomGraphGenerator(rng.map);

      const graph = gen.generate(floorNum);

      if (graph.isTemplate) {
        fallbackCount++;
      }

      const check = independentValidateGraph(graph, floorNum);
      if (!check.valid) {
        if (check.reason === 'missing treasure room') missingTreasureCount++;
        else if (check.reason?.startsWith('boss dist < 3')) bossDistTooCloseCount++;
        else if (check.reason?.includes('gate') || check.reason?.includes('stairs')) escapePolicyViolations++;
        assert.fail(`Seed ${seed} (Floor ${floorNum}) failed independent check: ${check.reason}`);
      }
    }

    assert.equal(missingTreasureCount, 0, 'Missing treasure rooms must be 0 across 10,000 seeds');
    assert.equal(bossDistTooCloseCount, 0, 'Boss distance < 3 must be 0 across 10,000 seeds');
    assert.equal(escapePolicyViolations, 0, 'Escape policy violations must be 0 across 10,000 seeds');

    const fallbackRate = fallbackCount / testCount;
    // 수용 기준: 폴백률 < 0.1% (0.001)
    assert.ok(fallbackRate < 0.001, `Fallback rate ${fallbackRate * 100}% (${fallbackCount}/${testCount}) must be < 0.1%`);
  });
});
