// ============================================================================
// 던전 렌더러 (DungeonRenderer)
// 0x72 픽셀 스프라이트 렌더, 오토타일, 조명/어둠 시스템, 파티클, 카메라 선행
// P2-01 (D-01), P2-02, P2-04, P2-05 구현
// ============================================================================

import { PLAYER_BASE } from '../data/data.js';
import { spriteAtlas } from '../systems/spriteAtlas.js';
import { LightmapSystem } from './LightmapSystem.js';
import { ParticleSystem } from './ParticleSystem.js';
import { TILE_TYPES } from '../core/tilemap.js';
import { CORE_PALETTE, FLOOR_LUTS } from '../data/palette.js';

const SCALE = 24; // px per meter (1m = 24px)
const FLOOR_COLORS = {
  1: FLOOR_LUTS[1]?.dark ?? '#1c1712',
  2: FLOOR_LUTS[2]?.dark ?? '#16181a',
  3: FLOOR_LUTS[3]?.dark ?? '#111820',
  4: FLOOR_LUTS[4]?.dark ?? '#181416',
  5: FLOOR_LUTS[5]?.dark ?? '#0d0606',
};

// 타일 좌표 기반 결정론적 난수 (바닥 변주용)
function tileHash(x, y) {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const ROOM_DISPLAY_INFO = {
  start: { icon: '🏛️', name: '시작의 안식처', sub: '정비 및 출발 구역' },
  combat: { icon: '⚔️', name: '적 잔재 출몰 구역', sub: '몬스터 소탕 지역' },
  elite: { icon: '💀', name: '정예 수호자의 전당', sub: '경고: 강력한 정예 수호자' },
  treasure: { icon: '💎', name: '황금 보물창고', sub: '보급품 및 희귀 전리품 상자' },
  altar: { icon: '🩸', name: '피의 서약 제단', sub: '체력을 바쳐 심연의 축복 획득' },
  event: { icon: '📜', name: '버려진 탐사대 유적', sub: '고대 유적 및 정화의 샘' },
  trap: { icon: '⚠️', name: '가시 함정 구역', sub: '위험: 바닥 함정 주의' },
  stairs: { icon: '🪜', name: '심연 하강 계단', sub: '다음 층으로 연결되는 통로' },
  gate: { icon: '🌀', name: '아비그라 탈출 게이트', sub: '전리품 확보 후 안전 귀환' },
  boss: { icon: '👑', name: '심연 집행자의 전당', sub: '보스 결전장: 처형자 베르덴' },
  secret: { icon: '🔮', name: '숨겨진 비밀 성소', sub: '미지의 비밀 공간 발견' },
};

export class DungeonRenderer {
  constructor(canvas, ctx) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.camX = 0;
    this.camY = 0;
    this.scale = SCALE;

    this.lightmap = new LightmapSystem(canvas ? canvas.width : 640, canvas ? canvas.height : 360);
    this.particles = new ParticleSystem();

    this._lastPlayerX = 0;
    this._lastPlayerY = 0;
    this._lastHitT = 0;

    // 방 고정 카메라 및 룸 슬라이드 전환 애니메이션 (Sephiria 스타일)
    this.currentRoomId = null;
    this.targetRoomId = null;
    this.isTransitioning = false;
    this.transitionProgress = 1;
    this.transitionDuration = 0.42; // 420ms 부드럽고 경쾌한 룸 슬라이드 전환
    this.fromCamX = 0;
    this.fromCamY = 0;
    this.targetCamX = 0;
    this.targetCamY = 0;
    this.lastFloorNum = null;

    // 방 진입 배너 알림
    this.bannerRoomInfo = null;
    this.bannerTimer = 0;
    this._lastCameraUpdateTime = -1;
  }

  screenToWorld(screenX, screenY) {
    const vw = this.canvas.width / this.scale;
    const vh = this.canvas.height / this.scale;
    const ox = this.camX - vw / 2;
    const oy = this.camY - vh / 2;
    return {
      x: ox + screenX / this.scale,
      y: oy + screenY / this.scale,
    };
  }

  updateCamera(engine, dt = 1 / 60) {
    if (!engine || !engine.player) return;

    if (this._lastCameraUpdateTime === engine.time) return;
    this._lastCameraUpdateTime = engine.time;

    // 층이 변경되었거나 새 런인 경우 즉시 리셋
    if (this.lastFloorNum !== engine.floorNum) {
      this.lastFloorNum = engine.floorNum;
      this.currentRoomId = null;
      this.targetRoomId = null;
      this.isTransitioning = false;
      this.transitionProgress = 1;
      this.bannerTimer = 0;
    }

    const p = engine.player;
    const vw = this.canvas ? this.canvas.width / this.scale : 53.33;
    const vh = this.canvas ? this.canvas.height / this.scale : 30;

    const activeRoom = this._findActiveRoom(p, engine.roomGraph);

    if (activeRoom) {
      const roomCam = this._getRoomCamPos(activeRoom, vw, vh, p);

      if (this.currentRoomId === null) {
        // 첫 프레임: 즉시 해당 방의 중심으로 카메라 고정
        this.currentRoomId = activeRoom.id;
        this.targetRoomId = activeRoom.id;
        this.camX = roomCam.x;
        this.camY = roomCam.y;
        this.fromCamX = roomCam.x;
        this.fromCamY = roomCam.y;
        this.targetCamX = roomCam.x;
        this.targetCamY = roomCam.y;
        this.isTransitioning = false;
        this.transitionProgress = 1;
        this._triggerRoomBanner(activeRoom);
        if (engine.visitedRooms) engine.visitedRooms.add(activeRoom.id);
        engine.currentRoomId = activeRoom.id;
      } else if (activeRoom.id !== this.currentRoomId && activeRoom.id !== this.targetRoomId) {
        // 다음 방으로 이동 감지 -> Sephiria 스타일 카메라 슬라이드 전환 애니메이션 시작!
        this.isTransitioning = true;
        this.transitionProgress = 0;
        this.fromCamX = this.camX;
        this.fromCamY = this.camY;
        this.targetRoomId = activeRoom.id;
        this.targetCamX = roomCam.x;
        this.targetCamY = roomCam.y;
        this._triggerRoomBanner(activeRoom);
        if (engine.visitedRooms) engine.visitedRooms.add(activeRoom.id);
        engine.currentRoomId = activeRoom.id;
      }

      if (this.isTransitioning) {
        this.transitionProgress += dt / this.transitionDuration;
        if (this.transitionProgress >= 1) {
          this.transitionProgress = 1;
          this.isTransitioning = false;
          this.currentRoomId = this.targetRoomId;
          this.camX = this.targetCamX;
          this.camY = this.targetCamY;
        } else {
          // easeInOutCubic 보간 곡선 (부드러운 시작과 감속)
          const t = this.transitionProgress;
          const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
          this.camX = this.fromCamX + (this.targetCamX - this.fromCamX) * ease;
          this.camY = this.fromCamY + (this.targetCamY - this.fromCamY) * ease;
        }
      } else {
        // 방에 고정된 상태
        this.camX = roomCam.x;
        this.camY = roomCam.y;
      }
    } else {
      // roomGraph가 없는 환경(테스트 등): 부드러운 플레이어 추종 폴백
      this.camX = p.x;
      this.camY = p.y;
    }
  }

  _findActiveRoom(p, roomGraph) {
    if (!roomGraph?.rooms || roomGraph.rooms.length === 0) return null;
    const rooms = roomGraph.rooms;

    // 1. 플레이어가 방의 경계 영역(1m 여유) 안에 있는지 확인
    for (const r of rooms) {
      if (p.x >= r.x - 1.0 && p.x <= r.x + r.w + 1.0 &&
          p.y >= r.y - 1.0 && p.y <= r.y + r.h + 1.0) {
        return r;
      }
    }

    // 2. 복도(Corridor)에 있는 경우:
    // 현재 방과 이웃 방들 사이의 거리를 비교하여, 복도 중간 지점을 넘었으면 다음 방으로 판정
    if (this.currentRoomId !== null) {
      const curRoom = rooms.find(r => r.id === this.currentRoomId);
      if (curRoom) {
        const dCur = Math.hypot(p.x - curRoom.centerX, p.y - curRoom.centerY);
        let closestNeighbor = null;
        let minNeighborDist = Infinity;

        for (const nId of (curRoom.neighbors || [])) {
          const nr = rooms.find(r => r.id === nId);
          if (!nr) continue;
          const dNeighbor = Math.hypot(p.x - nr.centerX, p.y - nr.centerY);
          if (dNeighbor < minNeighborDist) {
            minNeighborDist = dNeighbor;
            closestNeighbor = nr;
          }
        }

        if (closestNeighbor && minNeighborDist < dCur) {
          return closestNeighbor;
        }
        return curRoom;
      }
    }

    // 3. 폴백: 가장 가까운 방
    let closest = rooms[0];
    let minDist = Infinity;
    for (const r of rooms) {
      const d = Math.hypot(p.x - r.centerX, p.y - r.centerY);
      if (d < minDist) {
        minDist = d;
        closest = r;
      }
    }
    return closest;
  }

  _getRoomCamPos(room, vw, vh, p) {
    if (!room) return { x: p.x, y: p.y };

    let cx = room.centerX;
    let cy = room.centerY;

    // 만약 뷰포트 크기가 방보다 작다면(작은 해상도), 방 내부에서 플레이어를 따라 클램프
    if (room.w > vw) {
      cx = Math.max(room.x + vw / 2, Math.min(room.x + room.w - vw / 2, p.x));
    }
    if (room.h > vh) {
      cy = Math.max(room.y + vh / 2, Math.min(room.y + room.h - vh / 2, p.y));
    }
    return { x: cx, y: cy };
  }

  _triggerRoomBanner(room) {
    if (!room) return;
    const info = ROOM_DISPLAY_INFO[room.type] ?? {
      icon: '🚪',
      name: `${room.id + 1}번 구역`,
      sub: '미지의 던전 회랑',
    };
    this.bannerRoomInfo = info;
    this.bannerTimer = 2.2;
  }

  _renderRoomTransitionEffects(ctx, dt) {
    // 1. 방 이동 슬라이드 전환 중 미세한 시각 효과 (Sephiria 스타일 슬라이드 비네트)
    if (this.isTransitioning) {
      const t = this.transitionProgress;
      const alpha = Math.sin(t * Math.PI) * 0.18;
      ctx.save();
      ctx.fillStyle = `rgba(10, 8, 6, ${alpha})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      // 이동 방향 전환 분할선 펄스
      const lineAlpha = Math.sin(t * Math.PI) * 0.40;
      const sweepX = this.fromCamX !== this.targetCamX
        ? (this.targetCamX > this.fromCamX ? t * this.canvas.width : (1 - t) * this.canvas.width)
        : this.canvas.width / 2;
      ctx.strokeStyle = `rgba(216, 164, 58, ${lineAlpha})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(sweepX, 0);
      ctx.lineTo(sweepX, this.canvas.height);
      ctx.stroke();
      ctx.restore();
    }

    // 2. Sephiria 스타일 방 진입 배너 UI
    if (this.bannerTimer > 0 && this.bannerRoomInfo) {
      this.bannerTimer -= dt;
      let alpha = 1.0;
      if (this.bannerTimer > 1.7) {
        alpha = (2.2 - this.bannerTimer) / 0.5;
      } else if (this.bannerTimer < 0.6) {
        alpha = this.bannerTimer / 0.6;
      }
      alpha = Math.max(0, Math.min(1, alpha));

      ctx.save();
      ctx.globalAlpha = alpha;

      const bw = 290;
      const bh = 46;
      const bx = Math.round((this.canvas.width - bw) / 2);
      const by = 26;

      // 유리 형태의 어두운 필터 배경
      ctx.fillStyle = 'rgba(12, 10, 8, 0.88)';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(bx, by, bw, bh, 8);
      } else {
        ctx.rect(bx, by, bw, bh);
      }
      ctx.fill();

      // 은은한 골드 테두리
      ctx.strokeStyle = 'rgba(216, 164, 58, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(bx, by, bw, bh, 8);
      } else {
        ctx.rect(bx, by, bw, bh);
      }
      ctx.stroke();

      // 상단 텍스트 (방 이름)
      ctx.fillStyle = '#f4eedc';
      ctx.font = 'bold 14px "Noto Sans KR", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${this.bannerRoomInfo.icon}  ${this.bannerRoomInfo.name}`, bx + 14, by + 16);

      // 하단 서브 텍스트 (방 설명)
      ctx.fillStyle = '#d8a43a';
      ctx.font = '11px "Noto Sans KR", sans-serif';
      ctx.fillText(this.bannerRoomInfo.sub, bx + 38, by + 32);

      ctx.restore();
    }
  }

  render(engine, dt = 1 / 60) {
    const ctx = this.ctx;
    if (!ctx || !engine) return;

    // 픽셀 아트 무보간 렌더링 정책
    ctx.imageSmoothingEnabled = false;

    const p = engine.player;
    const vw = this.canvas.width / this.scale;
    const vh = this.canvas.height / this.scale;

    // 1. 방 고정 카메라 (Sephiria 스타일) 및 전환 애니메이션 갱신
    this.updateCamera(engine, dt);

    const camX = this.camX;
    const camY = this.camY;

    // 카메라 트라우마 화면 흔들림 적용
    let shakeX = 0;
    let shakeY = 0;
    const shakeSetting = engine.save?.settings?.screenShake !== false ? 1.0 : 0.0;
    if (this.particles.shakeTrauma > 0 && shakeSetting > 0) {
      const shakeMag = this.particles.shakeTrauma * this.particles.shakeTrauma * 6 * shakeSetting;
      shakeX = (Math.random() * 2 - 1) * shakeMag;
      shakeY = (Math.random() * 2 - 1) * shakeMag;
    }

    // 카메라 오프셋 및 픽셀 스냅
    const ox = Math.round((camX - vw / 2) * this.scale) / this.scale;
    const oy = Math.round((camY - vh / 2) * this.scale) / this.scale;
    const w2s = (wx, wy) => [
      Math.round((wx - ox) * this.scale + shakeX),
      Math.round((wy - oy) * this.scale + shakeY),
    ];

    // 파티클 시뮬레이션 갱신
    this.particles.update(dt);

    // 플레이어 이동 시 먼지 파티클
    const moved = Math.hypot(p.x - this._lastPlayerX, p.y - this._lastPlayerY);
    if (moved > 0.08) {
      this.particles.emitDust(p.x, p.y + 0.3, 1);
      this._lastPlayerX = p.x;
      this._lastPlayerY = p.y;
    }

    // 배경 색상
    ctx.fillStyle = FLOOR_COLORS[engine.floorNum] ?? '#120e0a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // 2. 타일맵 렌더링 (화면 내 가시 영역만 래스터화)
    this._renderTilemap(ctx, engine, ox, oy, vw, vh, w2s);

    // 2.5 층별 랜드마크 렌더링 (11 §5 층별 아트 키)
    this._renderLandmark(ctx, engine, w2s);

    // 3. 오브젝트 렌더링 (제단, 상자, 바닥 아이템, 게이트, 계단, 함정)
    this._renderObjects(ctx, engine, w2s);

    // 4. 전조(텔레그래프) 렌더링 (P2-05 3중 신호)
    this._renderTelegraphs(ctx, engine, w2s);

    // 5. 몬스터 및 보스 스프라이트 렌더링
    this._renderEnemies(ctx, engine, w2s);

    // 6. 플레이어 스프라이트 렌더링
    this._renderPlayer(ctx, engine, w2s);

    // 7. 투사체 렌더링
    this._renderProjectiles(ctx, engine, w2s);

    // 8. 파티클 및 데미지 숫자 렌더링
    this.particles.render(ctx, w2s);

    // 9. 조명 및 어둠 라이트맵 합성 (P2-02)
    this.lightmap.render(ctx, engine, w2s, this.scale);

    // 10. 방 진입 배너 및 방 전환 슬라이드 연출 (Sephiria 스타일)
    this._renderRoomTransitionEffects(ctx, dt);
  }

  _renderTilemap(ctx, engine, ox, oy, vw, vh, w2s) {
    const tilemap = engine.tilemap;
    const tileSize = this.scale;

    const minTx = Math.max(0, Math.floor(ox - 1));
    const maxTx = Math.min(tilemap ? tilemap.width - 1 : Math.ceil(engine.roomW), Math.ceil(ox + vw + 1));
    const minTy = Math.max(0, Math.floor(oy - 1));
    const maxTy = Math.min(tilemap ? tilemap.height - 1 : Math.ceil(engine.roomH), Math.ceil(oy + vh + 1));

    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        const [sx, sy] = w2s(tx, ty);
        const tileType = tilemap ? tilemap.get(tx, ty) : TILE_TYPES.FLOOR;

        if (tileType === TILE_TYPES.FLOOR || tileType === TILE_TYPES.CORRIDOR) {
          // 바닥 변주: tileHash 기반 floor_1 ~ floor_8 선택
          const h = tileHash(tx, ty);
          const fNum = Math.floor(h * 8) + 1;
          const floorKey = `floor_${fNum}`;
          if (!spriteAtlas.draw(ctx, floorKey, sx, sy, tileSize, tileSize)) {
            ctx.fillStyle = '#221a14';
            ctx.fillRect(sx, sy, tileSize, tileSize);
          }
        } else if (tileType === TILE_TYPES.WALL) {
          // 벽 오토타일링 (주변 타일 인접성 판별)
          const belowTile = tilemap ? tilemap.get(tx, ty + 1) : TILE_TYPES.VOID;
          const aboveTile = tilemap ? tilemap.get(tx, ty - 1) : TILE_TYPES.VOID;
          const leftTile = tilemap ? tilemap.get(tx - 1, ty) : TILE_TYPES.VOID;
          const rightTile = tilemap ? tilemap.get(tx + 1, ty) : TILE_TYPES.VOID;

          let wallKey = 'wall_mid';
          if (belowTile === TILE_TYPES.FLOOR || belowTile === TILE_TYPES.CORRIDOR) {
            wallKey = 'wall_mid'; // 플레이어를 향하는 벽 정면
          } else if (aboveTile === TILE_TYPES.FLOOR || aboveTile === TILE_TYPES.CORRIDOR) {
            wallKey = 'wall_top_mid';
          } else if (rightTile === TILE_TYPES.FLOOR || rightTile === TILE_TYPES.CORRIDOR) {
            wallKey = 'wall_left';
          } else if (leftTile === TILE_TYPES.FLOOR || leftTile === TILE_TYPES.CORRIDOR) {
            wallKey = 'wall_right';
          }

          if (!spriteAtlas.draw(ctx, wallKey, sx, sy, tileSize, tileSize)) {
            ctx.fillStyle = '#4a3b2c';
            ctx.fillRect(sx, sy, tileSize, tileSize);
          }

          // 왕실 행렬 벽화 모티프 (5단계: 얼굴이 지워지고 심장만 남는 변화)
          if ((belowTile === TILE_TYPES.FLOOR || belowTile === TILE_TYPES.CORRIDOR) && ((tx + ty) % 5 === 0)) {
            this._renderWallMural(ctx, sx, sy, tileSize, engine.floorNum, tx, ty);
          }
        } else if (tileType === TILE_TYPES.DOOR) {
          spriteAtlas.draw(ctx, 'door_open', sx, sy, tileSize, tileSize);
        }
      }
    }
  }

  _renderObjects(ctx, engine, w2s) {
    const sz = this.scale;

    // 함정
    for (const tr of engine.traps) {
      const [x, y] = w2s(tr.x - 0.5, tr.y - 0.5);
      const key = tr.triggered ? 'trap_spike_up' : 'trap_spike_down';
      spriteAtlas.draw(ctx, key, x, y, sz, sz);
    }

    // 제단
    for (const a of engine.altars) {
      const [x, y] = w2s(a.x - 0.5, a.y - 0.5);
      if (!spriteAtlas.draw(ctx, 'altar', x, y, sz, sz)) {
        ctx.fillStyle = '#4a8fd8';
        ctx.fillRect(x, y, sz, sz);
      }
    }

    // 상자
    for (const c of engine.chests) {
      const [x, y] = w2s(c.x - 0.5, c.y - 0.5);
      let key = 'chest_closed';
      if (c.opened) {
        key = c.isMimic ? 'chest_mimic_open' : 'chest_open';
      }
      if (!spriteAtlas.draw(ctx, key, x, y, sz, sz)) {
        ctx.fillStyle = c.opened ? '#3a2d1d' : '#d8a43a';
        ctx.fillRect(x, y, sz, sz);
      }
    }

    // 바닥 드롭 아이템
    for (const it of engine.groundItems) {
      const [x, y] = w2s(it.x, it.y);
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 탈출 게이트
    for (const g of engine.gates) {
      const [x, y] = w2s(g.x - 0.8, g.y - 0.8);
      const isReady = g.isBossGate || (engine.time >= 18 * 60) || (engine.floorNum === 1 && engine.time >= 60);
      const gateSz = sz * 1.6;

      if (!spriteAtlas.draw(ctx, 'hole', x, y, gateSz, gateSz)) {
        ctx.fillStyle = isReady ? '#2b7a78' : '#333333';
        ctx.fillRect(x, y, gateSz, gateSz);
      }

      if (isReady) {
        // 활성화 게이트 주변 역류 펄스 이펙트
        ctx.save();
        ctx.strokeStyle = '#3aafa9';
        ctx.lineWidth = 2;
        const pulseR = (gateSz / 2) + Math.sin(engine.time * 4) * 4;
        ctx.beginPath();
        ctx.arc(x + gateSz / 2, y + gateSz / 2, pulseR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // 게이트 충전 프로그레스 바
      if (engine.player.charging || (engine.player.gateCharge && engine.player.gateCharge > 0)) {
        const barW = gateSz + 8;
        ctx.fillStyle = '#111';
        ctx.fillRect(x - 4, y + gateSz + 6, barW, 5);
        ctx.fillStyle = '#3aafa9';
        ctx.fillRect(x - 4, y + gateSz + 6, barW * Math.min(1, (engine.player.gateCharge || 0) / PLAYER_BASE.gateChargeTime), 5);
      }
    }

    // 계단
    if (engine.stairs) {
      const [x, y] = w2s(engine.stairs.x - 0.5, engine.stairs.y - 0.5);
      spriteAtlas.draw(ctx, 'stairs_down', x, y, sz, sz);
    }
    if (engine.prevStairs) {
      const [x, y] = w2s(engine.prevStairs.x - 0.5, engine.prevStairs.y - 0.5);
      spriteAtlas.draw(ctx, 'stairs_up', x, y, sz, sz);
    }
  }

  _renderTelegraphs(ctx, engine, w2s) {
    const scale = this.scale;
    const p = engine.player;

    for (const e of engine.enemies) {
      if (e.dead || e.state !== 'telegraph') continue;
      const [ex, ey] = w2s(e.x, e.y);

      ctx.save();
      if (e.defId === 'skeleton' || e.defId === 'skeletonCaptain') {
        // 원거리 석궁 조준선 (Dashed line + target crosshair)
        const aimDist = (e.def?.attackRange ?? 14) * scale;
        const targetX = ex + Math.cos(e.facing) * aimDist;
        const targetY = ey + Math.sin(e.facing) * aimDist;

        ctx.strokeStyle = CORE_PALETTE.ALARM_VERMILION;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(targetX, targetY);
        ctx.stroke();

        // 플레이어 근처 타겟 십자선
        const [px, py] = w2s(p.x, p.y);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(px, py, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.moveTo(px - 14, py);
        ctx.lineTo(px + 14, py);
        ctx.moveTo(px, py - 14);
        ctx.lineTo(px, py + 14);
        ctx.stroke();
      } else if (e.defId === 'cultist') {
        // 암흑 주술 차징 원 + 탄도 궤적
        ctx.strokeStyle = CORE_PALETTE.BRUISED_PURPLE;
        ctx.fillStyle = 'rgba(141, 90, 145, 0.28)';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(ex, ey, 1.2 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        const aimDist = (e.def?.attackRange ?? 13) * scale;
        ctx.strokeStyle = CORE_PALETTE.ALARM_VERMILION;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex + Math.cos(e.facing) * aimDist, ey + Math.sin(e.facing) * aimDist);
        ctx.stroke();
      } else if (e.defId === 'mite') {
        // 심연충 도약/물기: 플레이어 위치 타겟 원 (1.2m)
        const [px, py] = w2s(p.x, p.y);
        const r = 1.2 * scale;
        ctx.fillStyle = 'rgba(230, 80, 60, 0.25)';
        ctx.strokeStyle = CORE_PALETTE.ALARM_VERMILION;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // 내부 '!' 심볼 (색상 제거 시에도 식별 가능)
        ctx.fillStyle = CORE_PALETTE.ALARM_VERMILION;
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', px, py);
      } else if (e.defId === 'royalGuard') {
        // 왕실 호위 잔재: 전방 찌르기 직사각형 (1.8m x 0.8m)
        ctx.translate(ex, ey);
        ctx.rotate(e.facing);
        ctx.fillStyle = 'rgba(230, 80, 60, 0.25)';
        ctx.strokeStyle = CORE_PALETTE.ALARM_VERMILION;
        ctx.lineWidth = 2;
        const rw = 1.8 * scale;
        const rh = 0.8 * scale;
        ctx.fillRect(0, -rh / 2, rw, rh);
        ctx.strokeRect(0, -rh / 2, rw, rh);
        // 전방 화살표 쉐브론
        ctx.beginPath();
        ctx.moveTo(rw * 0.4, -rh * 0.3);
        ctx.lineTo(rw * 0.7, 0);
        ctx.lineTo(rw * 0.4, rh * 0.3);
        ctx.stroke();
      } else if (e.defId === 'golem') {
        if (e.attackKind === 'slam') {
          // 지면 충격파 원 (2.2m)
          const r = (e.def?.slamRadius ?? 2.2) * scale;
          ctx.fillStyle = 'rgba(230, 80, 60, 0.25)';
          ctx.strokeStyle = CORE_PALETTE.ALARM_VERMILION;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(ex, ey, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          // 내부 십자 격자선
          ctx.beginPath();
          ctx.moveTo(ex - r, ey); ctx.lineTo(ex + r, ey);
          ctx.moveTo(ex, ey - r); ctx.lineTo(ex, ey + r);
          ctx.stroke();
        } else {
          // 전방 부채꼴 휘두르기 (2.4m, ±50도)
          const r = 2.4 * scale;
          ctx.fillStyle = 'rgba(230, 80, 60, 0.25)';
          ctx.strokeStyle = CORE_PALETTE.ALARM_VERMILION;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.arc(ex, ey, r, e.facing - 0.85, e.facing + 0.85);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      } else if (e.defId === 'wraith') {
        // 냉기 망령: 지속 위험 파문 (Bile Green, Dashed line, '≈' symbol)
        const r = (e.def?.attackRange ?? 1.6) * scale;
        ctx.fillStyle = 'rgba(120, 168, 61, 0.25)';
        ctx.strokeStyle = CORE_PALETTE.BILE_GREEN;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(ex, ey, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = CORE_PALETTE.BILE_GREEN;
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('≈', ex, ey);
      } else {
        // 일반 폴백 전조
        const r = (e.def?.attackRange ?? 2) * scale;
        ctx.fillStyle = 'rgba(230, 80, 80, 0.22)';
        ctx.strokeStyle = CORE_PALETTE.ALARM_VERMILION;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ex, ey, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    // 보스 감시자 전조
    if (engine.boss && engine.boss.alive && engine.boss.engaged && engine.boss.state === 'telegraph') {
      const b = engine.boss;
      const [x, y] = w2s(b.x, b.y);
      ctx.save();
      if (b.currentAttack === 'thrust') {
        const rad = b.phase.thrustRange * scale;
        ctx.translate(x, y);
        ctx.rotate(b.facing ?? 0);
        ctx.fillStyle = 'rgba(230, 80, 60, 0.3)';
        ctx.strokeStyle = CORE_PALETTE.ALARM_VERMILION;
        ctx.lineWidth = 3;
        ctx.fillRect(0, -scale * 0.6, rad, scale * 1.2);
        ctx.strokeRect(0, -scale * 0.6, rad, scale * 1.2);
      } else {
        const rad = b.phase.aoeRadius * scale;
        ctx.fillStyle = 'rgba(230, 80, 60, 0.28)';
        ctx.strokeStyle = CORE_PALETTE.ALARM_VERMILION;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    // 사이드 보스 하르트 전조
    if (engine.sideBoss && engine.sideBoss.alive && engine.sideBoss.engaged && engine.sideBoss.state === 'telegraph') {
      const hb = engine.sideBoss;
      const [x, y] = w2s(hb.x, hb.y);
      const rad = (hb.phase?.spinRange ?? 3.5) * scale;

      ctx.save();
      ctx.fillStyle = 'rgba(207, 230, 255, 0.25)';
      ctx.strokeStyle = CORE_PALETTE.HOLY_LIGHT;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  _renderEnemies(ctx, engine, w2s) {
    const sz = this.scale;
    const time = engine.time;

    for (const e of engine.enemies) {
      if (e.dead) continue;
      const [x, y] = w2s(e.x - 0.5, e.y - 0.7);
      const flip = e.facing !== undefined && (e.facing > Math.PI / 2 || e.facing < -Math.PI / 2);
      const state = e.hitFlash > 0 ? 'hit' : e.state === 'alert' || e.state === 'telegraph' ? 'run' : 'idle';

      // 스프라이트 렌더링
      const drew = spriteAtlas.drawEntity(
        ctx, e.defId, state, time, x, y, sz, sz, flip, e.hitFlash, e.scale ?? 1.0
      );

      if (!drew) {
        ctx.fillStyle = e.hitFlash > 0 ? '#fff' : '#933';
        ctx.fillRect(x, y, sz, sz);
      }

      // 몬스터 변형 시각 오버레이 (색만 바꾼 적 금지 원칙 준수)
      if (e.defId === 'skeletonCaptain') {
        // 해골 병장: 황동 투구 뿔 & 어깨 견장 오버레이
        ctx.save();
        ctx.strokeStyle = CORE_PALETTE.OLD_GOLD;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + sz * 0.3, y + 2);
        ctx.lineTo(x + sz * 0.15, y - 6);
        ctx.lineTo(x + sz * 0.35, y - 1);
        ctx.moveTo(x + sz * 0.7, y + 2);
        ctx.lineTo(x + sz * 0.85, y - 6);
        ctx.lineTo(x + sz * 0.65, y - 1);
        ctx.stroke();
        ctx.fillStyle = CORE_PALETTE.OLD_GOLD;
        ctx.fillRect(x + 2, y + sz * 0.35, 4, 6);
        ctx.fillRect(x + sz - 6, y + sz * 0.35, 4, 6);
        ctx.restore();
      } else if (e.isPackLeader) {
        // 심연충 조장: 두개 외골격 껍질 + 역삼각 흉터
        ctx.save();
        ctx.fillStyle = '#1c1712';
        ctx.strokeStyle = CORE_PALETTE.COAGULATED_RED;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + sz * 0.3, y + 4);
        ctx.lineTo(x + sz * 0.7, y + 4);
        ctx.lineTo(x + sz * 0.5, y + 10);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // 엘리트 수식어 고유 기하 외형
      if (e.eliteMod === 'frenzied') {
        // 광폭화: 4방향 회전 가시 링
        ctx.save();
        ctx.strokeStyle = CORE_PALETTE.ALARM_VERMILION;
        ctx.lineWidth = 1.5;
        const [cx, cy] = w2s(e.x, e.y);
        const rot = time * 3;
        for (let k = 0; k < 4; k++) {
          const ang = rot + (k * Math.PI) / 2;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(ang) * 14, cy + Math.sin(ang) * 14);
          ctx.lineTo(cx + Math.cos(ang) * 20, cy + Math.sin(ang) * 20);
          ctx.stroke();
        }
        ctx.restore();
      } else if (e.eliteMod === 'regenerating') {
        // 재생: 녹색 십자 룬 펄스
        ctx.save();
        ctx.fillStyle = CORE_PALETTE.BILE_GREEN;
        const [cx, cy] = w2s(e.x, e.y - 0.9);
        const pulse = Math.sin(time * 4) * 2;
        ctx.fillRect(cx - 2, cy - 6 - pulse, 4, 12);
        ctx.fillRect(cx - 6, cy - 2 - pulse, 12, 4);
        ctx.restore();
      } else if (e.eliteMod === 'explosive') {
        // 파열: 톱니 경고 링
        ctx.save();
        ctx.strokeStyle = CORE_PALETTE.OLD_GOLD;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        const [cx, cy] = w2s(e.x, e.y);
        ctx.beginPath();
        ctx.arc(cx, cy, 16, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // 시선 91+ 수색대 경보 탐조 표시
      if (engine.player?.gaze >= 91) {
        ctx.save();
        ctx.strokeStyle = CORE_PALETTE.ALARM_VERMILION;
        ctx.lineWidth = 1;
        const [cx, cy] = w2s(e.x, e.y);
        ctx.beginPath();
        ctx.arc(cx, cy, sz * 0.7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // HP 바 렌더링
      if (e.hp < e.maxHp) {
        const [barX, barY] = w2s(e.x, e.y - 0.8);
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(barX - 12, barY, 24, 3);
        ctx.fillStyle = '#c73a3a';
        ctx.fillRect(barX - 12, barY, 24 * Math.max(0, e.hp / e.maxHp), 3);
      }
    }

    // 감시자 보스
    if (engine.boss && engine.boss.alive) {
      const b = engine.boss;
      const [x, y] = w2s(b.x - 1.0, b.y - 1.2);
      const bSz = sz * 2.0;
      const flip = b.facing !== undefined && (b.facing > Math.PI / 2 || b.facing < -Math.PI / 2);
      const state = b.hitFlash > 0 ? 'hit' : b.state === 'move' ? 'run' : 'idle';

      spriteAtlas.drawEntity(ctx, 'boss_warden', state, time, x, y, bSz, bSz, flip, b.hitFlash, 1.0);

      // Phase 5: 감시자 보스 3단계 페이즈 외형 변화 (P1 봉인 집행관 -> P2 위액 창 -> P3 동심원 기관)
      this._renderWardenPhaseOverlay(ctx, b, x, y, bSz, time, flip, w2s);

      if (b.engaged) {
        const [barX, barY] = w2s(b.x, b.y - 1.4);
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fillRect(barX - 30, barY, 60, 5);
        ctx.fillStyle = '#d83a3a';
        ctx.fillRect(barX - 30, barY, 60 * Math.max(0, b.hp / b.maxHp), 5);
      }
    }

    // 하르트 보스
    if (engine.sideBoss && engine.sideBoss.alive) {
      const hb = engine.sideBoss;
      const [x, y] = w2s(hb.x - 0.8, hb.y - 1.0);
      const hbSz = sz * 1.6;
      const flip = hb.facing !== undefined && (hb.facing > Math.PI / 2 || hb.facing < -Math.PI / 2);
      const state = hb.hitFlash > 0 ? 'hit' : hb.state === 'move' ? 'run' : 'idle';

      spriteAtlas.drawEntity(ctx, 'boss_hart', state, time, x, y, hbSz, hbSz, flip, hb.hitFlash, 1.0);

      // Phase 5: 하르트 보스 군단 통신 깃발 & 보고서 두루마리 다발 실루엣
      this._renderHartOverlay(ctx, hb, x, y, hbSz, time, flip);

      if (hb.engaged) {
        const [barX, barY] = w2s(hb.x, hb.y - 1.2);
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fillRect(barX - 25, barY, 50, 4);
        ctx.fillStyle = '#4a90c9';
        ctx.fillRect(barX - 25, barY, 50 * Math.max(0, hb.hp / hb.maxHp), 4);
      }
    }
  }

  _renderPlayer(ctx, engine, w2s) {
    const p = engine.player;
    const sz = this.scale;
    const time = engine.time;
    const [x, y] = w2s(p.x - 0.5, p.y - 0.8);

    const isMoving = engine.input.moveX !== 0 || engine.input.moveY !== 0;
    const state = p.rolling ? 'run' : isMoving ? 'run' : 'idle';
    const flip = p.facing > Math.PI / 2 || p.facing < -Math.PI / 2;

    ctx.save();
    if (p.rolling) {
      ctx.globalAlpha = 0.8;
      try { ctx.filter = 'drop-shadow(0 0 4px #8fd0ff)'; } catch (_) {}
    } else if (p.guarding) {
      try { ctx.filter = 'drop-shadow(0 0 4px #5a7ad0)'; } catch (_) {}
    } else if (p.lampActiveUntil > engine.time) {
      try { ctx.filter = 'drop-shadow(0 0 6px #F3D586)'; } catch (_) {}
    }

    const drew = spriteAtlas.drawEntity(ctx, 'player', state, time, x, y, sz, sz, flip, 0, 1.0);
    if (!drew) {
      ctx.fillStyle = '#e6dcc5';
      ctx.fillRect(x, y, sz, sz);
    }
    ctx.restore();

    if (p.lampActiveUntil > engine.time) {
      const [centerScrX, centerScrY] = w2s(p.x, p.y);
      const pulse = Math.sin(time * 5) * 2;
      ctx.save();
      ctx.strokeStyle = 'rgba(243, 213, 134, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(centerScrX, centerScrY, 14 + pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 무기 및 회전 스윙 / 가드 렌더링
    const [centerScrX, centerScrY] = w2s(p.x, p.y);
    ctx.save();
    ctx.translate(centerScrX, centerScrY);
    ctx.rotate(p.facing);

    if (p.attackSwingT > 0) {
      // 휘두르기 호 시각화
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 24, -0.6, 0.6);
      ctx.stroke();

      // 무기 회전 배치
      spriteAtlas.draw(ctx, 'weapon_sword', 14, -8, 16, 16);
    } else if (p.guarding) {
      // 가드 방어막 호 시각화 (푸른빛 방어 아크)
      ctx.strokeStyle = 'rgba(90, 160, 240, 0.9)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, 18, -0.75, 0.75);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(200, 230, 255, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 21, -0.65, 0.65);
      ctx.stroke();

      // 수비 자세 무기
      spriteAtlas.draw(ctx, 'weapon_sword', 6, -6, 12, 12);
    } else {
      // 일반 소지 상태 무기
      spriteAtlas.draw(ctx, 'weapon_sword', 6, -4, 12, 12);
    }
    ctx.restore();
  }

  _renderProjectiles(ctx, engine, w2s) {
    for (const pr of engine.projectiles) {
      const [x, y] = w2s(pr.x, pr.y);
      ctx.fillStyle = '#ffea79';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#d88622';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // ==========================================================================
  // Phase 5: 왕실 행렬 벽화 5단계 (얼굴이 지워지고 심장만 남는 변화)
  // ==========================================================================
  _renderWallMural(ctx, sx, sy, sz, floorNum, _tx, _ty) {
    ctx.save();
    const mx = sx + sz * 0.2;
    const my = sy + sz * 0.2;
    const mw = sz * 0.6;
    const mh = sz * 0.6;

    if (floorNum === 1) {
      // 1층: 선명한 왕실 행렬 — 금빛 왕관과 근위병 윤곽
      ctx.strokeStyle = CORE_PALETTE.OLD_GOLD;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(mx + 2, my + 4);
      ctx.lineTo(mx + 4, my);
      ctx.lineTo(mx + 6, my + 4);
      ctx.lineTo(mx + 8, my);
      ctx.lineTo(mx + 10, my + 4);
      ctx.stroke();
      ctx.fillStyle = CORE_PALETTE.HOLY_LIGHT;
      ctx.fillRect(mx + 3, my + 6, 6, 5);
    } else if (floorNum === 2) {
      // 2층: 균열 발생, 인물의 눈 부분이 녹아내림
      ctx.strokeStyle = CORE_PALETTE.WEATHERED_WOOD;
      ctx.lineWidth = 1;
      ctx.strokeRect(mx + 2, my + 3, 8, 8);
      ctx.strokeStyle = '#0A0806';
      ctx.beginPath();
      ctx.moveTo(mx + 2, my + 2);
      ctx.lineTo(mx + 6, my + 7);
      ctx.lineTo(mx + 10, my + 5);
      ctx.stroke();
    } else if (floorNum === 3) {
      // 3층: 눈코입 소멸, 매끄러운 양피지 형체만 남음
      ctx.fillStyle = 'rgba(141, 90, 145, 0.45)';
      ctx.beginPath();
      ctx.arc(mx + mw / 2, my + mh / 2, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (floorNum === 4) {
      // 4층: 흉곽 열림, 갈비뼈 노출
      ctx.strokeStyle = CORE_PALETTE.RUST_BROWN;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(mx + mw / 2, my + 1);
      ctx.lineTo(mx + mw / 2, my + mh - 1);
      for (let r = 0; r < 3; r++) {
        const ry = my + 3 + r * 3;
        ctx.moveTo(mx + 1, ry);
        ctx.lineTo(mx + mw - 1, ry);
      }
      ctx.stroke();
    } else if (floorNum >= 5) {
      // 5층: 인물 소멸, 붉은 심장과 섬모 혈관만 박동
      const pulse = Math.sin(Date.now() * 0.006) * 1.2;
      ctx.fillStyle = CORE_PALETTE.ALARM_VERMILION;
      ctx.beginPath();
      ctx.arc(mx + mw / 2, my + mh / 2, 3.5 + pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = CORE_PALETTE.COAGULATED_RED;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(mx + mw / 2, my + mh / 2);
      ctx.lineTo(mx + mw, my);
      ctx.moveTo(mx + mw / 2, my + mh / 2);
      ctx.lineTo(mx, my + mh);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ==========================================================================
  // Phase 5: 층별 랜드마크 5종 (11 §5 층별 아트 키)
  // ==========================================================================
  _renderLandmark(ctx, engine, w2s) {
    if (!engine.landmark) return;
    const { type, x, y } = engine.landmark;
    const [sx, sy] = w2s(x, y);
    const sz = this.scale;
    const time = engine.time;

    ctx.save();
    if (type === 'customs_crane_vault') {
      // 1층 보상방 중앙: 어색했던 거대 기중기/원형 도형 대신 바닥에 품격 있게 깔린 왕실 보물창고 융단(Carpet)
      const rw = sz * 2.6;
      const rh = sz * 1.8;
      const rx = sx - rw / 2;
      const ry = sy - rh / 2;

      // 융단 바닥 그림자
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(rx + 2, ry + 2, rw, rh);

      // 고급 벨벳 버건디 바탕
      ctx.fillStyle = '#240A0E';
      ctx.fillRect(rx, ry, rw, rh);

      // 앤틱 골드 외곽 테두리
      ctx.strokeStyle = '#B88E3E';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(rx + 2, ry + 2, rw - 4, rh - 4);

      // 내부 앤틱 인레이 라인
      ctx.strokeStyle = '#5E461A';
      ctx.lineWidth = 1;
      ctx.strokeRect(rx + 5, ry + 5, rw - 10, rh - 10);

      // 중앙 다이아몬드 문양
      ctx.fillStyle = '#341016';
      ctx.beginPath();
      ctx.moveTo(sx, ry + 7);
      ctx.lineTo(sx + 18, sy);
      ctx.lineTo(sx, ry + rh - 7);
      ctx.lineTo(sx - 18, sy);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#B88E3E';
      ctx.lineWidth = 1;
      ctx.stroke();

      // 중앙 작은 금빛 장식점
      ctx.fillStyle = '#D8B45C';
      ctx.beginPath();
      ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === 'bone_stable_tower') {
      // 2층: 뼈 마구간 탑
      ctx.fillStyle = '#C5B99F';
      ctx.strokeStyle = '#3A2F1E';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - sz * 0.8, sy + sz);
      ctx.lineTo(sx - sz * 0.4, sy - sz * 1.8);
      ctx.lineTo(sx + sz * 0.4, sy - sz * 1.8);
      ctx.lineTo(sx + sz * 0.8, sy + sz);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const by = sy - sz * 1.4 + i * sz * 0.6;
        ctx.beginPath();
        ctx.arc(sx, by, sz * 0.4, 0, Math.PI);
        ctx.stroke();
      }
    } else if (type === 'inverted_bell') {
      // 3층: 뒤집힌 청동 대종 & 제단
      ctx.fillStyle = '#3A4235';
      ctx.strokeStyle = CORE_PALETTE.HOLY_LIGHT;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - sz * 1.2, sy - sz * 1.5);
      ctx.quadraticCurveTo(sx - sz * 1.4, sy, sx - sz * 0.6, sy + sz * 0.8);
      ctx.lineTo(sx + sz * 0.6, sy + sz * 0.8);
      ctx.quadraticCurveTo(sx + sz * 1.4, sy, sx + sz * 1.2, sy - sz * 1.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = CORE_PALETTE.HOLY_LIGHT;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy - sz * 0.8);
      ctx.lineTo(sx + 4, sy - sz * 0.2);
      ctx.lineTo(sx - 3, sy + sz * 0.4);
      ctx.stroke();
    } else if (type === 'tilted_coronation_hall') {
      // 4층: 기울어진 대관 회랑
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(0.35);
      ctx.fillStyle = '#4A2A22';
      ctx.strokeStyle = '#D8B45C';
      ctx.lineWidth = 2;
      ctx.fillRect(-sz * 0.5, -sz * 1.8, sz, sz * 2.6);
      ctx.strokeRect(-sz * 0.5, -sz * 1.8, sz, sz * 2.6);
      ctx.fillRect(-sz * 0.8, -sz * 2.0, sz * 1.6, sz * 0.3);
      ctx.strokeRect(-sz * 0.8, -sz * 2.0, sz * 1.6, sz * 0.3);
      ctx.restore();
    } else if (type === 'heart_throne') {
      // 5층: 심장 왕좌
      ctx.fillStyle = '#0E0B08';
      ctx.strokeStyle = '#3A2F1E';
      ctx.lineWidth = 3;
      ctx.fillRect(sx - sz * 1.0, sy - sz * 1.5, sz * 2.0, sz * 2.2);
      ctx.strokeRect(sx - sz * 1.0, sy - sz * 1.5, sz * 2.0, sz * 2.2);

      const heartPulse = Math.sin(time * 6) * 3;
      ctx.fillStyle = CORE_PALETTE.ALARM_VERMILION;
      ctx.beginPath();
      ctx.arc(sx, sy - sz * 0.4, sz * 0.8 + heartPulse, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = CORE_PALETTE.COAGULATED_RED;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy - sz * 0.4);
      ctx.lineTo(sx - sz * 1.3, sy + sz * 0.8);
      ctx.moveTo(sx, sy - sz * 0.4);
      ctx.lineTo(sx + sz * 1.3, sy + sz * 0.8);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ==========================================================================
  // Phase 5: 감시자 보스 3단계 페이즈 외형 변화
  // ==========================================================================
  _renderWardenPhaseOverlay(ctx, b, x, y, bSz, time, flip, _w2s) {
    ctx.save();
    const cx = x + bSz / 2;
    const cy = y + bSz / 2;

    if (b.phaseIdx === 0) {
      // P1: 봉인 집행관 수직 인간
      ctx.strokeStyle = CORE_PALETTE.OLD_GOLD;
      ctx.fillStyle = CORE_PALETTE.HOLY_LIGHT;
      ctx.lineWidth = 2;
      ctx.fillRect(cx - 8, cy - bSz * 0.3, 16, 4);
      ctx.beginPath();
      ctx.moveTo(cx, cy - bSz * 0.25);
      ctx.lineTo(cx, cy - bSz * 0.1);
      ctx.moveTo(cx - 5, cy - bSz * 0.2);
      ctx.lineTo(cx + 5, cy - bSz * 0.2);
      ctx.stroke();

      const swordX = flip ? cx - bSz * 0.35 : cx + bSz * 0.35;
      ctx.strokeStyle = CORE_PALETTE.HOLY_LIGHT;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(swordX, cy + bSz * 0.2);
      ctx.lineTo(swordX, cy - bSz * 0.45);
      ctx.stroke();
    } else if (b.phaseIdx === 1) {
      // P2: 오른팔 위액 창 변형 & 비대칭 침식
      const armX = flip ? cx - bSz * 0.2 : cx + bSz * 0.2;
      ctx.strokeStyle = CORE_PALETTE.BILE_GREEN;
      ctx.fillStyle = 'rgba(120, 168, 61, 0.4)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(armX, cy - 2);
      const lanceTipX = flip ? armX - bSz * 0.6 : armX + bSz * 0.6;
      ctx.lineTo(lanceTipX, cy + bSz * 0.3);
      ctx.stroke();

      ctx.fillStyle = CORE_PALETTE.BILE_GREEN;
      const drip = (time * 60) % 20;
      ctx.beginPath();
      ctx.arc(lanceTipX, cy + bSz * 0.3 + drip * 0.5, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (b.phaseIdx >= 2) {
      // P3: 완전 융합 벽 고정 동심원 기관 & 흉부 노출 심장
      ctx.strokeStyle = CORE_PALETTE.BRUISED_PURPLE;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      for (let r = 1; r <= 3; r++) {
        ctx.beginPath();
        ctx.arc(cx, cy, bSz * 0.35 + r * 12, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      const pulse = Math.sin(time * 8) * 3;
      ctx.fillStyle = CORE_PALETTE.ALARM_VERMILION;
      ctx.beginPath();
      ctx.arc(cx, cy - 4, 8 + pulse, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#E6DCC5';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx - 10, cy - 4, 10, -0.6, 0.6);
      ctx.arc(cx + 10, cy - 4, 10, Math.PI - 0.6, Math.PI + 0.6);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ==========================================================================
  // Phase 5: 하르트 보스 통신 깃발 및 보고서 두루마리 실루엣
  // ==========================================================================
  _renderHartOverlay(ctx, hb, x, y, hbSz, time, flip) {
    ctx.save();
    const cx = x + hbSz / 2;
    const cy = y + hbSz / 2;

    const poleX = flip ? cx + hbSz * 0.25 : cx - hbSz * 0.25;
    ctx.strokeStyle = '#3A2F1E';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(poleX, cy + hbSz * 0.3);
    ctx.lineTo(poleX, cy - hbSz * 0.6);
    ctx.stroke();

    const flutter = Math.sin(time * 6) * 5;
    const flagW = hbSz * 0.45;
    const flagH = hbSz * 0.25;
    const flagDir = flip ? -1 : 1;
    ctx.fillStyle = CORE_PALETTE.RUST_BROWN;
    ctx.strokeStyle = CORE_PALETTE.OLD_GOLD;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(poleX, cy - hbSz * 0.58);
    ctx.lineTo(poleX + flagDir * flagW, cy - hbSz * 0.58 + flutter);
    ctx.lineTo(poleX + flagDir * (flagW * 0.7), cy - hbSz * 0.58 + flagH / 2 + flutter);
    ctx.lineTo(poleX + flagDir * flagW, cy - hbSz * 0.58 + flagH + flutter);
    ctx.lineTo(poleX, cy - hbSz * 0.58 + flagH);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = CORE_PALETTE.PARCHMENT_LIGHT;
    ctx.strokeStyle = '#3A2F1E';
    ctx.lineWidth = 1;
    for (let s = 0; s < 3; s++) {
      const sx = cx - 8 + s * 7;
      const sy = cy + hbSz * 0.12;
      ctx.fillRect(sx, sy, 5, 10);
      ctx.strokeRect(sx, sy, 5, 10);
      ctx.fillStyle = CORE_PALETTE.COAGULATED_RED;
      ctx.fillRect(sx + 1, sy + 4, 3, 2);
      ctx.fillStyle = CORE_PALETTE.PARCHMENT_LIGHT;
    }
    ctx.restore();
  }
}
