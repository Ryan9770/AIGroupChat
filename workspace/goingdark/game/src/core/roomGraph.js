// ============================================================================
// 시드 기반 방 그래프 생성기 (Procedural Room Graph Generator)
// 각 층 6~10개 방 (start, combat, elite, treasure, altar, event, stairs, gate)
// 단절/겹침/탈출 불가 0건 보장 및 안전 템플릿 폴백 내장
// P0-04: 보물방 100% 보장, 5층 보스방 BFS 최단거리 >= 3 보장
// ============================================================================

export const ROOM_TYPES = {
  start: { label: '시작방', color: '#3a5a40' },
  combat: { label: '전투방', color: '#6a3838' },
  elite: { label: '엘리트방', color: '#8a2b2b' },
  treasure: { label: '보물방', color: '#b8860b' },
  altar: { label: '제단방', color: '#3b6e8c' },
  event: { label: '이벤트방', color: '#6b4c82' },
  stairs: { label: '계단방', color: '#4a6b5d' },
  gate: { label: '탈출게이트방', color: '#2b7a78' },
  boss: { label: '보스방', color: '#8b0000' },
};

const DIRS = [
  { dx: 1, dy: 0, dir: 'E', opp: 'W' },
  { dx: -1, dy: 0, dir: 'W', opp: 'E' },
  { dx: 0, dy: 1, dir: 'S', opp: 'N' },
  { dx: 0, dy: -1, dir: 'N', opp: 'S' },
];

export class RoomGraphGenerator {
  constructor(rng) {
    this.rng = rng;
  }

  generate(floorNum = 1) {
    const targetRoomCount = Math.min(10, Math.max(6, 5 + floorNum));
    const maxRetries = 10;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const graph = this._tryBuildGraph(floorNum, targetRoomCount);
      if (this.validateGraph(graph, floorNum)) {
        return graph;
      }
    }

    // 검증된 안전 템플릿 폴백
    return this.getSafeTemplate(floorNum);
  }

  _tryBuildGraph(floorNum, targetCount) {
    const grid = new Map(); // "gx,gy" -> room
    const rooms = [];

    const startRoom = {
      id: 0,
      type: 'start',
      gx: 0,
      gy: 0,
      doors: [],
      neighbors: [],
      distFromStart: 0,
    };
    grid.set('0,0', startRoom);
    rooms.push(startRoom);

    let frontier = [startRoom];

    while (rooms.length < targetCount && frontier.length > 0) {
      const parentIdx = Math.floor(this.rng.next() * frontier.length);
      const parent = frontier[parentIdx];

      const freeDirs = DIRS.filter(d => !grid.has(`${parent.gx + d.dx},${parent.gy + d.dy}`));
      if (freeDirs.length === 0) {
        frontier.splice(parentIdx, 1);
        continue;
      }

      const pickedDir = freeDirs[Math.floor(this.rng.next() * freeDirs.length)];
      const nx = parent.gx + pickedDir.dx;
      const ny = parent.gy + pickedDir.dy;

      const newRoom = {
        id: rooms.length,
        type: 'combat',
        gx: nx,
        gy: ny,
        doors: [pickedDir.opp],
        neighbors: [parent.id],
        distFromStart: parent.distFromStart + 1,
      };

      parent.doors.push(pickedDir.dir);
      parent.neighbors.push(newRoom.id);

      grid.set(`${nx},${ny}`, newRoom);
      rooms.push(newRoom);
      frontier.push(newRoom);
    }

    // 추가 순환 통로 (1~2개)를 놓아 경로 다양성 부여 (시작방 직결 단축로는 제외하여 최단거리 유지)
    for (const r of rooms) {
      for (const d of DIRS) {
        const neighbor = grid.get(`${r.gx + d.dx},${r.gy + d.dy}`);
        if (neighbor && !r.neighbors.includes(neighbor.id) && this.rng.chance(0.20)) {
          if (r.id === 0 || neighbor.id === 0) continue;
          r.doors.push(d.dir);
          r.neighbors.push(neighbor.id);
          neighbor.doors.push(d.opp);
          neighbor.neighbors.push(r.id);
        }
      }
    }

    // 비밀방 (기믹): 숨겨진 방 추가
    if (this.rng.chance(0.40) || floorNum >= 2) {
      const candidates = rooms.filter(r => r.id !== 0 && r.type !== 'boss' && r.type !== 'stairs');
      for (const parent of candidates) {
        const freeDirs = DIRS.filter(d => !grid.has(`${parent.gx + d.dx},${parent.gy + d.dy}`));
        if (freeDirs.length > 0) {
          const pickedDir = freeDirs[Math.floor(this.rng.next() * freeDirs.length)];
          const nx = parent.gx + pickedDir.dx;
          const ny = parent.gy + pickedDir.dy;
          const secretRoom = {
            id: rooms.length,
            type: 'secret',
            isSecret: true,
            discovered: false,
            secretDoor: { dir: pickedDir.dir, opp: pickedDir.opp, fromRoomId: parent.id, revealed: false },
            gx: nx,
            gy: ny,
            doors: [pickedDir.opp],
            neighbors: [parent.id],
            distFromStart: parent.distFromStart + 1,
          };
          parent.doors.push(pickedDir.dir);
          parent.neighbors.push(secretRoom.id);
          grid.set(`${nx},${ny}`, secretRoom);
          rooms.push(secretRoom);
          break;
        }
      }
    }

    // 실제 BFS 최단 거리 계산
    const distMap = new Map();
    for (const r of rooms) distMap.set(r.id, Infinity);
    distMap.set(0, 0);
    const q = [0];
    while (q.length > 0) {
      const curId = q.shift();
      const cDist = distMap.get(curId);
      const curRoom = rooms.find(r => r.id === curId);
      if (!curRoom) continue;
      for (const nId of curRoom.neighbors) {
        if (distMap.get(nId) > cDist + 1) {
          distMap.set(nId, cDist + 1);
          q.push(nId);
        }
      }
    }
    for (const r of rooms) {
      r.distFromStart = distMap.get(r.id) ?? 0;
    }

    // 방 역할 배정
    this._assignRoomRoles(rooms, floorNum);

    // 월드 좌표 및 바운딩 박스 계산
    this._calculateWorldBounds(rooms);

    const maxRx = Math.max(...rooms.map(r => r.x + r.w));
    const maxRy = Math.max(...rooms.map(r => r.y + r.h));

    return {
      floorNum,
      rooms,
      startRoomId: 0,
      stairsRoomId: rooms.find(r => r.type === 'stairs' || r.type === 'boss')?.id ?? (rooms.length - 1),
      gateRoomId: rooms.find(r => r.type === 'gate')?.id ?? null,
      secretRoomId: rooms.find(r => r.type === 'secret')?.id ?? null,
      worldW: maxRx + 12,
      worldH: maxRy + 12,
      isTemplate: false,
    };
  }

  _assignRoomRoles(rooms, floorNum) {
    // 실제 BFS 거리 내림차순 정렬
    const sorted = [...rooms].sort((a, b) => b.distFromStart - a.distFromStart);

    // 5층 보스방: 시작방 BFS 최단거리 >= 3 만족하는 방 우선 배정
    if (floorNum === 5) {
      const bossCandidate = sorted.find(r => r.id !== 0 && r.distFromStart >= 3);
      if (bossCandidate) {
        bossCandidate.type = 'boss';
      } else {
        sorted[0].type = 'boss';
      }
    } else {
      sorted[0].type = 'stairs';
    }

    // 체크포인트 층(1, 3, 5)에는 탈출 게이트 방 필수 보장
    if (floorNum === 1 || floorNum === 3 || floorNum === 5) {
      const gateCandidate = sorted.find(r =>
        r.id !== 0 &&
        r.type !== 'boss' &&
        r.type !== 'stairs' &&
        r.neighbors.length <= 2
      ) || sorted.find(r => r.id !== 0 && r.type !== 'boss' && r.type !== 'stairs');

      if (gateCandidate) {
        gateCandidate.type = 'gate';
      }
    }

    // 보물방 강제 배정 (D-05 해결): 잎새 노드 우선, 없으면 일반 전투방 중 1개 전환
    const leaves = rooms.filter(r => r.neighbors.length === 1 && r.type === 'combat');
    if (leaves.length > 0) {
      leaves[0].type = 'treasure';
    } else {
      const combatRoom = rooms.find(r => r.type === 'combat' && r.id !== 0);
      if (combatRoom) {
        combatRoom.type = 'treasure';
      }
    }

    // 제단방 배정 (보물방으로 쓰이지 않은 잎 노드 또는 combat 방)
    const remainingLeaves = rooms.filter(r => r.neighbors.length === 1 && r.type === 'combat');
    if (remainingLeaves.length > 0) {
      remainingLeaves[0].type = 'altar';
    } else {
      const altarCandidate = rooms.find(r => r.type === 'combat' && r.id !== 0);
      if (altarCandidate) {
        altarCandidate.type = 'altar';
      }
    }

    // 중간 방 중 1개를 엘리트 또는 이벤트방/함정방으로 배정
    const remaining = rooms.filter(r => r.type === 'combat');
    if (remaining.length > 0 && floorNum >= 2) {
      remaining[0].type = 'elite';
    }
    if (remaining.length > 1) {
      remaining[1].type = 'event';
    }
    if (remaining.length > 2 && floorNum >= 2) {
      remaining[2].type = 'trap';
    } else if (remaining.length > 0 && floorNum >= 2) {
      remaining[remaining.length - 1].type = 'trap';
    }
  }

  _calculateWorldBounds(rooms) {
    const minGx = Math.min(...rooms.map(r => r.gx));
    const minGy = Math.min(...rooms.map(r => r.gy));

    const roomW = 28;
    const roomH = 20;
    const padding = 6;

    for (const r of rooms) {
      r.w = roomW;
      r.h = roomH;
      r.x = padding + (r.gx - minGx) * (roomW + 8);
      r.y = padding + (r.gy - minGy) * (roomH + 8);
      r.centerX = r.x + r.w / 2;
      r.centerY = r.y + r.h / 2;
    }
  }

  validateGraph(graph, floorNum) {
    if (!graph || !graph.rooms || graph.rooms.length < 6) return false;

    const rooms = graph.rooms;
    const visited = new Set();
    const queue = [0];
    visited.add(0);

    const distMap = new Map();
    distMap.set(0, 0);

    while (queue.length > 0) {
      const currId = queue.shift();
      const curr = rooms.find(r => r.id === currId);
      const cDist = distMap.get(currId);
      if (!curr) continue;
      for (const nId of curr.neighbors) {
        if (!visited.has(nId)) {
          visited.add(nId);
          distMap.set(nId, cDist + 1);
          queue.push(nId);
        }
      }
    }

    // 모든 방이 연결되어 있어야 함
    if (visited.size !== rooms.length) return false;

    // 계단/보스방 연결 확인
    const targetRoom = rooms.find(r => r.type === 'stairs' || r.type === 'boss');
    if (!targetRoom || !visited.has(targetRoom.id)) return false;

    // 5층 보스방 BFS 최단거리 >= 3 검증 (D-05 해결)
    if (floorNum === 5) {
      const bossRoom = rooms.find(r => r.type === 'boss');
      if (!bossRoom) return false;
      const bossBfsDist = distMap.get(bossRoom.id) ?? 0;
      if (bossBfsDist < 3) return false;
    }

    // 게이트 필수 층인 경우 게이트 연결 확인
    if (floorNum === 1 || floorNum === 3 || floorNum === 5) {
      const gateRoom = rooms.find(r => r.type === 'gate');
      if (!gateRoom || !visited.has(gateRoom.id)) return false;
    }

    // 보물방 1개 이상 연결 확인 (D-05 해결)
    const treasureRoom = rooms.find(r => r.type === 'treasure');
    if (!treasureRoom || !visited.has(treasureRoom.id)) return false;

    // 방 격자 좌표 중복 없어야 함
    const coords = new Set();
    for (const r of rooms) {
      const key = `${r.gx},${r.gy}`;
      if (coords.has(key)) return false;
      coords.add(key);
    }

    return true;
  }

  getSafeTemplate(floorNum) {
    // 사전 검증된 안전 템플릿 (선형+분기 7개 방)
    const rooms = [
      { id: 0, type: 'start', gx: 0, gy: 0, neighbors: [1], doors: ['E'], distFromStart: 0 },
      { id: 1, type: 'combat', gx: 1, gy: 0, neighbors: [0, 2, 4], doors: ['W', 'E', 'S'], distFromStart: 1 },
      { id: 2, type: 'treasure', gx: 2, gy: 0, neighbors: [1, 3], doors: ['W', 'E'], distFromStart: 2 },
      { id: 3, type: floorNum === 5 ? 'boss' : 'stairs', gx: 3, gy: 0, neighbors: [2], doors: ['W'], distFromStart: 3 },
      { id: 4, type: 'altar', gx: 1, gy: 1, neighbors: [1, 5], doors: ['N', 'E'], distFromStart: 2 },
      { id: 5, type: 'gate', gx: 2, gy: 1, neighbors: [4, 6], doors: ['W', 'S'], distFromStart: 3 },
      { id: 6, type: 'elite', gx: 2, gy: 2, neighbors: [5], doors: ['N'], distFromStart: 4 },
    ];
    this._calculateWorldBounds(rooms);
    const maxRx = Math.max(...rooms.map(r => r.x + r.w));
    const maxRy = Math.max(...rooms.map(r => r.y + r.h));

    return {
      floorNum,
      rooms,
      startRoomId: 0,
      stairsRoomId: 3,
      gateRoomId: 5,
      secretRoomId: null,
      worldW: maxRx + 12,
      worldH: maxRy + 12,
      isTemplate: true,
    };
  }
}
