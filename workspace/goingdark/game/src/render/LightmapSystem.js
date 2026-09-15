// ============================================================================
// 조명 및 어둠 시스템 (LightmapSystem)
// 오프스크린 캔버스 라이트맵, 반경 데이터화 방사형 광원, 시선 및 조수 연동
// P2-02: "아비그라는 어둠으로 본다" 게임 정체성 핵심 조명 구현
// ============================================================================

export class LightmapSystem {
  constructor(width = 640, height = 360) {
    this.width = width;
    this.height = height;
    this.canvas = null;
    this.ctx = null;
    this._initCanvas();
  }

  _initCanvas() {
    if (typeof document === 'undefined') return;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d');
  }

  resize(width, height) {
    this.width = Math.floor(width / 2);
    this.height = Math.floor(height / 2);
    if (this.canvas) {
      this.canvas.width = this.width;
      this.canvas.height = this.height;
    }
  }

  /**
   * 라이트맵 렌더링 및 메인 캔버스에 합성
   * @param {CanvasRenderingContext2D} mainCtx 메인 캔버스 2D 컨텍스트
   * @param {RunEngine} engine 런 엔진 상태
   * @param {Function} w2s 월드 좌표 -> 메인 화면 좌표 변환 함수
   * @param {number} scale 픽셀 스케일
   */
  render(mainCtx, engine, w2s, scale) {
    if (!this.ctx || !mainCtx || !engine) return;

    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const p = engine.player;

    const mainW = mainCtx.canvas ? mainCtx.canvas.width : w;
    const mainH = mainCtx.canvas ? mainCtx.canvas.height : h;
    const scaleX = w / mainW;
    const scaleY = h / mainH;

    // 메인 화면 좌표 -> 라이트맵 오프스크린 캔버스 좌표 및 반경 변환
    const toLightX = (screenX) => screenX * scaleX;
    const toLightY = (screenY) => screenY * scaleY;
    const toLightR = (r) => r * scaleX;

    // 1. 기본 어둠 채우기 (시인성 대폭 개선: 0.88~0.95 -> 0.40~0.52로 밝기 향상)
    ctx.globalCompositeOperation = 'source-over';
    const baseDarkness = engine.floorNum >= 4 ? 0.52 : engine.floorNum >= 2 ? 0.46 : 0.40;
    ctx.fillStyle = `rgba(10, 8, 6, ${baseDarkness})`;
    ctx.fillRect(0, 0, w, h);

    // 2. destination-out 모드로 광원 뚫기
    ctx.globalCompositeOperation = 'destination-out';

    // (0) 현재 활성 방 부드러운 주변광 (Sephiria 스타일 룸 엠비언트 라이트)
    const curRoom = engine.roomGraph?.rooms?.find(r => r.id === (engine.currentRoomId ?? 0));
    if (curRoom) {
      const [rx, ry] = w2s(curRoom.centerX, curRoom.centerY);
      const lx = toLightX(rx);
      const ly = toLightY(ry);
      const roomRadius = toLightR(Math.max(curRoom.w, curRoom.h) * 0.72 * scale);

      const roomGrad = ctx.createRadialGradient(
        lx, ly, roomRadius * 0.15,
        lx, ly, roomRadius
      );
      roomGrad.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
      roomGrad.addColorStop(0.55, 'rgba(0, 0, 0, 0.65)');
      roomGrad.addColorStop(0.85, 'rgba(0, 0, 0, 0.30)');
      roomGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = roomGrad;
      ctx.beginPath();
      ctx.arc(lx, ly, roomRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    // (A) 플레이어 등불 광원
    const [pScrX, pScrY] = w2s(p.x, p.y);
    const pLx = toLightX(pScrX);
    const pLy = toLightY(pScrY);

    // 시선 31+ 광원 오프셋 (그림자가 플레이어 쪽으로 드리워지도록 광원이 반대로 기움)
    let lightOffsetX = 0;
    let lightOffsetY = 0;
    if (p.gaze >= 31) {
      const gazeT = (p.gaze - 31) / 69;
      const angle = p.facing + Math.PI;
      lightOffsetX = Math.cos(angle) * gazeT * 8 * scaleX;
      lightOffsetY = Math.sin(angle) * gazeT * 8 * scaleY;
    }

    // 등불 반경 계산 (기본 8.0m, 성수 등불 활성화 시 13.0m 대폭 확장)
    let lampRadius = p.lampActiveUntil > engine.time ? 13.0 : 8.0;
    if (engine.tideStageIdx === 2) {
      lampRadius *= 0.85; // 조수 3단계 시야 축소 시에도 쾌적한 기본 시야 확보
    }
    const lampPixelR = toLightR(lampRadius * scale);

    const lampGrad = ctx.createRadialGradient(
      pLx + lightOffsetX, pLy + lightOffsetY, lampPixelR * 0.15,
      pLx + lightOffsetX, pLy + lightOffsetY, lampPixelR
    );
    lampGrad.addColorStop(0, 'rgba(0, 0, 0, 1.0)');
    lampGrad.addColorStop(0.65, 'rgba(0, 0, 0, 0.96)');
    lampGrad.addColorStop(0.88, 'rgba(0, 0, 0, 0.65)');
    lampGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = lampGrad;
    ctx.beginPath();
    ctx.arc(pLx + lightOffsetX, pLy + lightOffsetY, lampPixelR, 0, Math.PI * 2);
    ctx.fill();

    // (A-2) 미개봉 상자 온기 광원
    for (const c of (engine.chests || [])) {
      if (c.opened) continue;
      const [cx, cy] = w2s(c.x, c.y);
      const lx = toLightX(cx);
      const ly = toLightY(cy);
      const r = toLightR(2.5 * scale);
      const cGrad = ctx.createRadialGradient(lx, ly, r * 0.1, lx, ly, r);
      cGrad.addColorStop(0, 'rgba(0, 0, 0, 0.70)');
      cGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = cGrad;
      ctx.beginPath();
      ctx.arc(lx, ly, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // (B) 제단 광원 (청백광 #CFE6FF, 상시 유지)
    for (const a of engine.altars) {
      const [ax, ay] = w2s(a.x, a.y);
      const lx = toLightX(ax);
      const ly = toLightY(ay);
      const r = toLightR(4.5 * scale);

      const altarGrad = ctx.createRadialGradient(lx, ly, r * 0.1, lx, ly, r);
      altarGrad.addColorStop(0, 'rgba(0, 0, 0, 0.95)');
      altarGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = altarGrad;
      ctx.beginPath();
      ctx.arc(lx, ly, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // (C) 탈출 게이트 광원 (조수 3에서도 절대 가려지지 않음)
    for (const g of engine.gates) {
      const [gx, gy] = w2s(g.x, g.y);
      const lx = toLightX(gx);
      const ly = toLightY(gy);
      const r = toLightR(5.5 * scale);

      const gateGrad = ctx.createRadialGradient(lx, ly, r * 0.15, lx, ly, r);
      gateGrad.addColorStop(0, 'rgba(0, 0, 0, 1.0)');
      gateGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = gateGrad;
      ctx.beginPath();
      ctx.arc(lx, ly, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // (D) 계단 광원
    if (engine.stairs) {
      const [sx, sy] = w2s(engine.stairs.x, engine.stairs.y);
      const lx = toLightX(sx);
      const ly = toLightY(sy);
      const r = toLightR(3.0 * scale);
      const stairsGrad = ctx.createRadialGradient(lx, ly, r * 0.1, lx, ly, r);
      stairsGrad.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
      stairsGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = stairsGrad;
      ctx.beginPath();
      ctx.arc(lx, ly, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (engine.prevStairs) {
      const [psx, psy] = w2s(engine.prevStairs.x, engine.prevStairs.y);
      const lx = toLightX(psx);
      const ly = toLightY(psy);
      const r = toLightR(3.0 * scale);
      const stairsGrad = ctx.createRadialGradient(lx, ly, r * 0.1, lx, ly, r);
      stairsGrad.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
      stairsGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = stairsGrad;
      ctx.beginPath();
      ctx.arc(lx, ly, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2.4 상시 따뜻한 호박색 등불 광채 (소프트 앰비언트)
    ctx.globalCompositeOperation = 'source-over';
    const warmGrad = ctx.createRadialGradient(pLx, pLy, 0, pLx, pLy, lampPixelR * 0.85);
    warmGrad.addColorStop(0, 'rgba(255, 225, 150, 0.14)');
    warmGrad.addColorStop(0.5, 'rgba(255, 185, 100, 0.06)');
    warmGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = warmGrad;
    ctx.beginPath();
    ctx.arc(pLx, pLy, lampPixelR * 0.85, 0, Math.PI * 2);
    ctx.fill();

    // 2.5 성수 등불 활성화 시 성스러운 호박/청백 광원 틴트
    if (p.lampActiveUntil > engine.time) {
      ctx.globalCompositeOperation = 'source-over';
      const holyGrad = ctx.createRadialGradient(
        pLx, pLy, 0,
        pLx, pLy, lampPixelR * 0.85
      );
      holyGrad.addColorStop(0, 'rgba(255, 240, 180, 0.22)');
      holyGrad.addColorStop(0.6, 'rgba(200, 235, 255, 0.10)');
      holyGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = holyGrad;
      ctx.beginPath();
      ctx.arc(pLx, pLy, lampPixelR * 0.85, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. 시선 연동 잔상 / 탐조등 효과
    // (A) 61+ 자주색 (#8D5A91) 펄스 가짜 광원
    if (p.gaze >= 61) {
      ctx.globalCompositeOperation = 'source-over';
      const pulse = Math.sin(engine.time * 3) * 0.5 + 0.5;
      const phantomX = pLx + Math.cos(engine.time * 1.5) * 40 * scaleX;
      const phantomY = pLy + Math.sin(engine.time * 1.5) * 40 * scaleY;
      const pr = toLightR(30);
      const pGrad = ctx.createRadialGradient(phantomX, phantomY, 0, phantomX, phantomY, pr);
      pGrad.addColorStop(0, `rgba(141, 90, 145, ${0.25 * pulse})`);
      pGrad.addColorStop(1, 'rgba(141, 90, 145, 0)');
      ctx.fillStyle = pGrad;
      ctx.beginPath();
      ctx.arc(phantomX, phantomY, pr, 0, Math.PI * 2);
      ctx.fill();
    }

    // (B) 91+ 주홍색 (#E6503C) 수색대 탐조등 빔
    if (p.gaze >= 91) {
      ctx.globalCompositeOperation = 'source-over';
      const sweepAngle = engine.time * 2;
      const beamLen = toLightR(120);
      const beamX = pLx + Math.cos(sweepAngle) * beamLen;
      const beamY = pLy + Math.sin(sweepAngle) * beamLen;
      const beamR = toLightR(45);

      const beamGrad = ctx.createRadialGradient(beamX, beamY, 0, beamX, beamY, beamR);
      beamGrad.addColorStop(0, 'rgba(230, 80, 60, 0.35)');
      beamGrad.addColorStop(1, 'rgba(230, 80, 60, 0)');
      ctx.fillStyle = beamGrad;
      ctx.beginPath();
      ctx.arc(beamX, beamY, beamR, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. 조수(Tide) 연동 담즙 녹색 (#78A83D) 바닥 안개 레이어 (시인성을 위해 부드럽게 조정)
    if (engine.tideStageIdx >= 0) {
      ctx.globalCompositeOperation = 'source-over';
      const stageAlpha = [0.08, 0.15, 0.22][engine.tideStageIdx] ?? 0.08;
      ctx.fillStyle = `rgba(120, 168, 61, ${stageAlpha})`;
      ctx.fillRect(0, 0, w, h);
    }

    // 5. 완성된 라이트맵을 메인 캔버스에 업스케일 합성
    mainCtx.save();
    mainCtx.drawImage(this.canvas, 0, 0, mainW, mainH);
    mainCtx.restore();
  }
}
