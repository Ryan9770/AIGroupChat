// ============================================================================
// 충돌 및 가시선(LOS) 판정 시스템 (Collision & LOS World)
// P1-01: 원-AABB 슬라이드 충돌, DDA 기반 LOS, 부채꼴/원/직선 공격 판정
// ============================================================================

/**
 * 각도 정규화 (-PI ~ PI)
 */
export function normalizeAngle(angle) {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * 원-타일맵 AABB 슬라이딩 충돌 해결
 * @param {{x: number, y: number}} pos 현재 위치 (in-place 갱신)
 * @param {number} radius 원 충돌체 반경
 * @param {number} dx 이동량 X
 * @param {number} dy 이동량 Y
 * @param {Tilemap} tilemap 타일맵 인스턴스
 * @returns {{x: number, y: number}} 갱신된 위치
 */
export function resolveCircleTileSlide(pos, radius, dx, dy, tilemap) {
  if (!tilemap) {
    pos.x += dx;
    pos.y += dy;
    return pos;
  }

  // 0. 초기 위치가 이미 벽과 겹친 경우 바깥으로 밀어내기 (depenetration)
  _depenetrateCircle(pos, radius, tilemap);

  // 1. X축 이동 및 충돌 해결 (이진 탐색)
  if (dx !== 0) {
    const nextX = pos.x + dx;
    if (!tilemap.checkCircleSolid(nextX, pos.y, radius)) {
      pos.x = nextX;
    } else {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        if (tilemap.checkCircleSolid(pos.x + dx * mid, pos.y, radius)) {
          hi = mid;
        } else {
          lo = mid;
        }
      }
      pos.x += dx * lo;
    }
  }

  // 2. Y축 이동 및 충돌 해결 (이진 탐색)
  if (dy !== 0) {
    const nextY = pos.y + dy;
    if (!tilemap.checkCircleSolid(pos.x, nextY, radius)) {
      pos.y = nextY;
    } else {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        if (tilemap.checkCircleSolid(pos.x, pos.y + dy * mid, radius)) {
          hi = mid;
        } else {
          lo = mid;
        }
      }
      pos.y += dy * lo;
    }
  }

  return pos;
}

function _depenetrateCircle(pos, radius, tilemap) {
  const minX = Math.floor(pos.x - radius);
  const maxX = Math.floor(pos.x + radius);
  const minY = Math.floor(pos.y - radius);
  const maxY = Math.floor(pos.y + radius);

  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      if (tilemap.isSolid(tx + 0.5, ty + 0.5)) {
        const closestX = Math.max(tx, Math.min(pos.x, tx + 1));
        const closestY = Math.max(ty, Math.min(pos.y, ty + 1));
        const vx = pos.x - closestX;
        const vy = pos.y - closestY;
        const d = Math.hypot(vx, vy);

        if (d < radius && d > 1e-6) {
          const push = radius - d + 0.001;
          pos.x += (vx / d) * push;
          pos.y += (vy / d) * push;
        } else if (d <= 1e-6) {
          const dLeft = pos.x - tx;
          const dRight = (tx + 1) - pos.x;
          const dTop = pos.y - ty;
          const dBottom = (ty + 1) - pos.y;
          const minD = Math.min(dLeft, dRight, dTop, dBottom);
          if (minD === dLeft) pos.x = tx - radius - 0.001;
          else if (minD === dRight) pos.x = tx + 1 + radius + 0.001;
          else if (minD === dTop) pos.y = ty - radius - 0.001;
          else pos.y = ty + 1 + radius + 0.001;
        }
      }
    }
  }
}

/**
 * DDA (Digital Differential Analyzer) 기반 광선 투사 (LOS 및 투사체 관통 검사)
 * @param {number} x0 시작 X
 * @param {number} y0 시작 Y
 * @param {number} x1 종료 X
 * @param {number} y1 종료 Y
 * @param {Tilemap|Function} isSolidFn tilemap 인스턴스 또는 (tx, ty) => boolean
 * @returns {{ hit: boolean, hitX: number, hitY: number, distance: number }}
 */
export function raycastDDA(x0, y0, x1, y1, tilemapOrFn) {
  const isSolid = typeof tilemapOrFn === 'function'
    ? tilemapOrFn
    : (tx, ty) => tilemapOrFn.isSolid(tx + 0.5, ty + 0.5);

  const dx = x1 - x0;
  const dy = y1 - y0;
  const totalDist = Math.hypot(dx, dy);

  if (totalDist === 0) {
    const solid = isSolid(Math.floor(x0), Math.floor(y0));
    return { hit: solid, hitX: x0, hitY: y0, distance: 0 };
  }

  const dirX = dx / totalDist;
  const dirY = dy / totalDist;

  let mapX = Math.floor(x0);
  let mapY = Math.floor(y0);

  const stepX = dirX >= 0 ? 1 : -1;
  const stepY = dirY >= 0 ? 1 : -1;

  const deltaDistX = Math.abs(dirX) < 1e-8 ? 1e30 : Math.abs(1 / dirX);
  const deltaDistY = Math.abs(dirY) < 1e-8 ? 1e30 : Math.abs(1 / dirY);

  let sideDistX = (dirX >= 0) ? (mapX + 1.0 - x0) * deltaDistX : (x0 - mapX) * deltaDistX;
  let sideDistY = (dirY >= 0) ? (mapY + 1.0 - y0) * deltaDistY : (y0 - mapY) * deltaDistY;

  let currentDist = 0;
  let hit = false;
  let side = 0; // 0 for X-wall, 1 for Y-wall

  while (currentDist <= totalDist) {
    if (isSolid(mapX, mapY)) {
      hit = true;
      break;
    }

    if (sideDistX < sideDistY) {
      currentDist = sideDistX;
      sideDistX += deltaDistX;
      mapX += stepX;
      side = 0;
    } else {
      currentDist = sideDistY;
      sideDistY += deltaDistY;
      mapY += stepY;
      side = 1;
    }
  }

  if (hit && currentDist <= totalDist) {
    return {
      hit: true,
      hitX: x0 + dirX * currentDist,
      hitY: y0 + dirY * currentDist,
      distance: currentDist,
      side,
    };
  }

  return {
    hit: false,
    hitX: x1,
    hitY: y1,
    distance: totalDist,
    side: -1,
  };
}

/**
 * 가시선(Line of Sight) 존재 여부 검사
 */
export function hasLineOfSight(x0, y0, x1, y1, tilemap) {
  const result = raycastDDA(x0, y0, x1, y1, tilemap);
  return !result.hit;
}

/**
 * 원거리 투사체 벽 충돌 검사
 */
export function checkProjectileWallHit(prevX, prevY, currX, currY, tilemap) {
  if (!tilemap) return false;
  if (tilemap.isSolid(currX, currY)) return true;
  const ray = raycastDDA(prevX, prevY, currX, currY, tilemap);
  return ray.hit;
}

// ============================================================================
// 공격 판정 기하 함수 (텔레그래프 렌더 형상과 정확히 1:1 일치)
// ============================================================================

/**
 * 원형 범위 공격 판정 (AOE, 폭발, 파문)
 */
export function testCircleHit(px, py, originX, originY, radius) {
  const d = Math.hypot(px - originX, py - originY);
  return d <= radius;
}

/**
 * 부채꼴 범위 공격 판정 (휘두르기, 베기, 클리브)
 * @param {number} coneAngle 부채꼴 전체 화각 (라디안, 예: Math.PI / 2)
 */
export function testConeHit(px, py, originX, originY, facingAngle, coneAngle, radius) {
  const d = Math.hypot(px - originX, py - originY);
  if (d > radius) return false;
  if (d === 0) return true;

  const targetAngle = Math.atan2(py - originY, px - originX);
  const diff = Math.abs(normalizeAngle(targetAngle - facingAngle));
  return diff <= (coneAngle / 2);
}

/**
 * 직선/선분 범위 공격 판정 (찌르기, 돌진, 빔, 레이저)
 * @param {number} thickness 선 두께 (직경)
 */
export function testLineHit(px, py, x1, y1, x2, y2, thickness = 1.0) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return Math.hypot(px - x1, py - y1) <= (thickness / 2);
  }

  // 선분 투영 계수 t clamp [0, 1]
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;

  const distToLine = Math.hypot(px - projX, py - projY);
  return distToLine <= (thickness / 2);
}
