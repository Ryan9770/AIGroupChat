// ============================================================================
// 타일맵 시스템 (Tilemap & Rasterization)
// 방 그래프(roomGraph)를 16px 타일 격자(바닥/벽/문/통로)로 래스터화
// P1-01: 타일 기반 충돌 및 가시선(LOS) 판정
// ============================================================================

export const TILE_TYPES = {
  VOID: 0,
  FLOOR: 1,
  WALL: 2,
  DOOR: 3,
  CORRIDOR: 4,
};

export class Tilemap {
  constructor(width, height) {
    this.width = Math.ceil(width);
    this.height = Math.ceil(height);
    this.grid = new Uint8Array(this.width * this.height); // defaults to VOID (0)
  }

  get(x, y) {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) {
      return TILE_TYPES.WALL; // out of bounds treated as solid wall
    }
    return this.grid[ty * this.width + tx];
  }

  set(tx, ty, tileType) {
    if (tx >= 0 && tx < this.width && ty >= 0 && ty < this.height) {
      this.grid[ty * this.width + tx] = tileType;
    }
  }

  isSolid(x, y) {
    const t = this.get(x, y);
    return t === TILE_TYPES.WALL || t === TILE_TYPES.VOID;
  }

  isWalkable(x, y) {
    return !this.isSolid(x, y);
  }

  /**
   * 주어진 원(중심 x, y, 반경 radius)이 벽과 충돌하는지 여부
   */
  checkCircleSolid(x, y, radius = 0.35) {
    const minX = Math.floor(x - radius);
    const maxX = Math.floor(x + radius);
    const minY = Math.floor(y - radius);
    const maxY = Math.floor(y + radius);

    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (this.isSolid(tx + 0.5, ty + 0.5)) {
          // Circle vs AABB (tx, ty, tx+1, ty+1)
          const closestX = Math.max(tx, Math.min(x, tx + 1));
          const closestY = Math.max(ty, Math.min(y, ty + 1));
          const dx = x - closestX;
          const dy = y - closestY;
          if (dx * dx + dy * dy < radius * radius) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * 방 그래프(roomGraph)로부터 래스터화된 타일맵 생성
   */
  static fromRoomGraph(graph) {
    const mapW = Math.max(64, Math.ceil(graph.worldW + 16));
    const mapH = Math.max(64, Math.ceil(graph.worldH + 16));
    const tilemap = new Tilemap(mapW, mapH);

    const rooms = graph.rooms || [];

    // 1. 각 방의 바닥과 벽 배치
    for (const r of rooms) {
      const rx = Math.floor(r.x);
      const ry = Math.floor(r.y);
      const rw = Math.floor(r.w);
      const rh = Math.floor(r.h);

      // 벽 테두리 (방 둘레)
      for (let x = rx; x < rx + rw; x++) {
        tilemap.set(x, ry, TILE_TYPES.WALL);
        tilemap.set(x, ry + rh - 1, TILE_TYPES.WALL);
      }
      for (let y = ry; y < ry + rh; y++) {
        tilemap.set(rx, y, TILE_TYPES.WALL);
        tilemap.set(rx + rw - 1, y, TILE_TYPES.WALL);
      }

      // 내부 바닥
      for (let y = ry + 1; y < ry + rh - 1; y++) {
        for (let x = rx + 1; x < rx + rw - 1; x++) {
          tilemap.set(x, y, TILE_TYPES.FLOOR);
        }
      }
    }

    // 2. 연결 통로 및 문 배치
    for (const r of rooms) {
      const rx1 = Math.floor(r.centerX);
      const ry1 = Math.floor(r.centerY);

      for (const nId of r.neighbors) {
        const nr = rooms.find(x => x.id === nId);
        if (!nr || nr.id < r.id) continue;

        const rx2 = Math.floor(nr.centerX);
        const ry2 = Math.floor(nr.centerY);

        // L자 또는 직선 통로 카빙 (두께 3타일)
        const midX = rx2;
        const midY = ry1;

        tilemap._carveCorridor(rx1, ry1, midX, midY, 1);
        tilemap._carveCorridor(midX, midY, rx2, ry2, 1);
      }
    }

    // 3. 통로 외곽을 벽으로 둘러싸기 (바닥/통로에 인접한 VOID를 WALL로 변경)
    for (let y = 0; y < mapH; y++) {
      for (let x = 0; x < mapW; x++) {
        if (tilemap.grid[y * mapW + x] === TILE_TYPES.VOID) {
          if (tilemap._hasAdjacentWalkable(x, y)) {
            tilemap.grid[y * mapW + x] = TILE_TYPES.WALL;
          }
        }
      }
    }

    return tilemap;
  }

  _carveCorridor(x1, y1, x2, y2, halfWidth = 1) {
    const minX = Math.min(x1, x2) - halfWidth;
    const maxX = Math.max(x1, x2) + halfWidth;
    const minY = Math.min(y1, y2) - halfWidth;
    const maxY = Math.max(y1, y2) + halfWidth;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        this.set(x, y, TILE_TYPES.CORRIDOR);
      }
    }
  }

  _hasAdjacentWalkable(tx, ty) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          const t = this.grid[ny * this.width + nx];
          if (t === TILE_TYPES.FLOOR || t === TILE_TYPES.CORRIDOR || t === TILE_TYPES.DOOR) {
            return true;
          }
        }
      }
    }
    return false;
  }
}
