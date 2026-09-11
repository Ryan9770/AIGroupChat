/**
 * Afterimage Wireman (잔상 배선공: 6초 시간 하이스트) - Web Engine
 * Implements deterministic 6-second time loop heist action puzzle.
 */

const PHYSICS_TPS = 60;
const LOOP_TICKS = 360; // 6.0 seconds
const MAX_TRACKS = 2;   // 2 ghosts recorded + 1 live player
const SPEED_PER_TICK = 4;
const ACTOR_HALF_SIZE = 14;
const INTERACT_RADIUS = 44;

const CMD_NONE = 0;
const CMD_UP = 1;
const CMD_DOWN = 2;
const CMD_LEFT = 4;
const CMD_RIGHT = 8;
const CMD_INTERACT = 16;

const WORLD_RECT = { x: 40, y: 140, w: 1200, h: 520 };
const SPAWN_POS = { x: 140, y: 410 };
const EXIT_RECT = { x: 1110, y: 350, w: 90, h: 120 };

const TRACK_COLORS = ['#ffb300', '#00e676']; // Ghost 1 Amber, Ghost 2 Green
const LIVE_COLOR = '#00e5ff'; // Live player Cyan

class Rect2 {
  constructor(x, y, w, h) { this.x = x; this.y = y; this.w = w; this.h = h; }
  intersects(r) {
    return !(r.x > this.x + this.w || r.x + r.w < this.x ||
             r.y > this.y + this.h || r.y + r.h < this.y);
  }
  hasPoint(px, py) {
    return px >= this.x && px <= this.x + this.w && py >= this.y && py <= this.y + this.h;
  }
}

class AfterimageGame {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.audio = new ChronoAudioManager();

    this.currentRoom = 0;
    this.totalRooms = 5;

    // Time Loop State
    this.tracks = [[], []];        // Track 0, Track 1 command arrays
    this.trackHashes = [[], []];
    this.committed = [false, false];
    this.activeTrack = 0;          // 0, 1, or 2 (live)
    this.currentTick = 0;
    this.cycleRunning = false;
    this.paused = false;

    // Actors
    this.playerPosition = { ...SPAWN_POS };
    this.playerFacing = { x: 1, y: 0 };
    this.ghostPositions = [{ ...SPAWN_POS }, { ...SPAWN_POS }];
    this.ghostFacings = [{ x: 1, y: 0 }, { x: 1, y: 0 }];

    // Interactive Items & Gimmicks
    this.itemPresent = false;
    this.itemName = '';
    this.itemPos = { x: 0, y: 0 };
    this.itemCarrier = -1; // -1: None, 0: Player, 1: Ghost 0, 2: Ghost 1
    this.itemInSocket = false;

    this.terminalPos = { x: 0, y: 0 };
    this.terminalActive = false;
    this.terminalPos2 = { x: 0, y: 0 }; // for dual terminal room
    this.terminalActive2 = false;

    this.reactorPos = { x: 0, y: 0 };
    this.decoyTimer = 0;

    // Room Layout
    this.obstacles = [];
    this.gateRect = new Rect2(0, 0, 0, 0);
    this.gateOpen = false;
    this.laserRect = new Rect2(0, 0, 0, 0);

    // Heist Status
    this.stageCleared = false;
    this.stageFailed = false;
    this.statusMessage = '';
    this.desyncDetected = false;
    this.clearStars = '';
    this.clearTimeSec = 0;

    // Juice & FX
    this.screenFlash = 0;
    this.alarmPulse = 0;
    this.slowMoTimer = 0;
    this.interactBuffered = false;
    this.showDiagnostics = false;

    // Tick Accumulator
    this.lastTime = performance.now();
    this.tickAccumulator = 0;

    this.initDOM();
    this.setupInputHandlers();
    this.loadRoom(0);
  }

  initDOM() {
    this.uiTimerVal = document.getElementById('timer-val');
    this.uiTimerFill = document.getElementById('timer-fill');
    this.uiLoopBadge = document.getElementById('loop-badge');
    this.uiRoomName = document.getElementById('room-name');
    this.uiRoomDesc = document.getElementById('room-desc');
    this.uiBanner = document.getElementById('status-banner');
    this.uiAlarmOverlay = document.getElementById('alarm-overlay');
    this.f3Panel = document.getElementById('f3-panel');

    this.trackElements = [
      document.getElementById('track-0'),
      document.getElementById('track-1'),
      document.getElementById('track-live')
    ];

    document.getElementById('btn-mute').onclick = (e) => {
      const isMuted = this.audio.toggleMute();
      e.target.innerText = isMuted ? "소리: OFF" : "소리: ON";
    };

    document.getElementById('btn-help').onclick = () => this.toggleModal('modal-help');
    document.getElementById('btn-close-help').onclick = () => this.toggleModal('modal-help');
    document.getElementById('btn-retry').onclick = () => this.resetRoom();

    document.getElementById('btn-victory-next').onclick = () => {
      this.toggleModal('modal-victory');
      this.loadRoom((this.currentRoom + 1) % this.totalRooms);
    };

    // Set internal canvas resolution
    this.canvas.width = 1280;
    this.canvas.height = 720;
  }

  toggleModal(id) {
    document.getElementById(id).classList.toggle('active');
  }

  showBanner(msg, type = 'normal') {
    this.uiBanner.innerText = msg;
    this.uiBanner.className = `show ${type}`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => { this.uiBanner.className = ''; }, 3000);
  }

  setupInputHandlers() {
    window.addEventListener('keydown', (e) => {
      this.audio.ensureContext();

      if (e.code === 'KeyE') {
        this.interactBuffered = true;
      }

      if (e.code === 'Space' || e.code === 'Enter') {
        if (this.stageCleared) {
          this.loadRoom((this.currentRoom + 1) % this.totalRooms);
        } else if (this.stageFailed) {
          this.resetRoom();
        } else if (this.activeTrack < MAX_TRACKS && this.tracks[this.activeTrack].length > 0) {
          // Commit early and launch next loop!
          this.finishCycle();
        }
      }

      if (e.code === 'KeyR') {
        this.resetRoom();
      }

      if (e.code === 'Digit1') this.loadRoom(0);
      if (e.code === 'Digit2') this.loadRoom(1);
      if (e.code === 'Digit3') this.loadRoom(2);
      if (e.code === 'Digit4') this.loadRoom(3);
      if (e.code === 'Digit5') this.loadRoom(4);

      if (e.code === 'KeyP' || e.code === 'Tab') {
        if (!this.stageCleared && !this.stageFailed) {
          this.paused = !this.paused;
          this.showBanner(this.paused ? "일시 정지 ([ / ] 타임라인 스크러빙)" : "진행 재개");
        }
      }

      if (this.paused) {
        if (e.code === 'BracketLeft') this.scrubTo(this.currentTick - 15);
        if (e.code === 'BracketRight') this.scrubTo(this.currentTick + 15);
      }

      if (e.code === 'F3') {
        e.preventDefault();
        this.showDiagnostics = !this.showDiagnostics;
        this.f3Panel.classList.toggle('active', this.showDiagnostics);
      }
    });

    this.keys = {};
    window.addEventListener('keydown', (e) => { this.keys[e.code] = true; });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
  }

  readLiveCommand() {
    let cmd = CMD_NONE;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) cmd |= CMD_UP;
    else if (this.keys['KeyS'] || this.keys['ArrowDown']) cmd |= CMD_DOWN;

    if (this.keys['KeyA'] || this.keys['ArrowLeft']) cmd |= CMD_LEFT;
    else if (this.keys['KeyD'] || this.keys['ArrowRight']) cmd |= CMD_RIGHT;

    if (this.interactBuffered) {
      cmd |= CMD_INTERACT;
      this.interactBuffered = false;
    }
    return cmd;
  }

  cmdToDirection(cmd) {
    const dir = { x: 0, y: 0 };
    if (cmd & CMD_UP) dir.y -= 1;
    else if (cmd & CMD_DOWN) dir.y += 1;

    if (cmd & CMD_LEFT) dir.x -= 1;
    else if (cmd & CMD_RIGHT) dir.x += 1;
    return dir;
  }

  moveActor(pos, dir) {
    if (dir.x === 0 && dir.y === 0) return pos;
    let nextX = pos.x + dir.x * SPEED_PER_TICK;
    let nextY = pos.y + dir.y * SPEED_PER_TICK;

    // Clamp to world boundaries
    nextX = Math.max(WORLD_RECT.x + ACTOR_HALF_SIZE, Math.min(WORLD_RECT.x + WORLD_RECT.w - ACTOR_HALF_SIZE, nextX));
    nextY = Math.max(WORLD_RECT.y + ACTOR_HALF_SIZE, Math.min(WORLD_RECT.y + WORLD_RECT.h - ACTOR_HALF_SIZE, nextY));

    const candidate = { x: nextX, y: nextY };
    if (this.actorIsBlocked(candidate)) {
      return pos;
    }
    return candidate;
  }

  actorIsBlocked(pos) {
    const hitbox = new Rect2(
      pos.x - ACTOR_HALF_SIZE,
      pos.y - ACTOR_HALF_SIZE,
      ACTOR_HALF_SIZE * 2,
      ACTOR_HALF_SIZE * 2
    );

    for (const obs of this.obstacles) {
      if (obs.intersects(hitbox)) return true;
    }

    if (!this.gateOpen && this.gateRect.w > 0 && this.gateRect.intersects(hitbox)) {
      return true;
    }
    return false;
  }

  processActorInteract(carrierId, actorPos, cmd) {
    if ((cmd & CMD_INTERACT) === 0 || !this.itemPresent || this.itemInSocket) return;

    if (this.itemCarrier === carrierId) {
      // Drop or insert into reactor
      const dToReactor = Math.hypot(actorPos.x - this.reactorPos.x, actorPos.y - this.reactorPos.y);
      if (this.reactorPos.x > 0 && dToReactor <= INTERACT_RADIUS) {
        this.itemInSocket = true;
        this.itemCarrier = -1;
        this.itemPos = { ...this.reactorPos };
        this.audio.playSocket();
        this.showBanner("반응로에 셀 삽입 완료! 전원 격벽 개방.", "success");
      } else {
        // Drop on floor
        this.itemCarrier = -1;
        this.itemPos = { ...actorPos };
        this.audio.playInteract();
      }
    } else if (this.itemCarrier === -1) {
      // Pick up item from floor
      const dToItem = Math.hypot(actorPos.x - this.itemPos.x, actorPos.y - this.itemPos.y);
      if (dToItem <= INTERACT_RADIUS) {
        this.itemCarrier = carrierId;
        this.audio.playInteract();
      }
    }
  }

  updateItemCarrierPos() {
    if (!this.itemPresent || this.itemInSocket) return;
    if (this.itemCarrier === 0) {
      this.itemPos = {
        x: this.playerPosition.x + this.playerFacing.x * 18,
        y: this.playerPosition.y + this.playerFacing.y * 18
      };
    } else if (this.itemCarrier === 1) {
      this.itemPos = {
        x: this.ghostPositions[0].x + this.ghostFacings[0].x * 18,
        y: this.ghostPositions[0].y + this.ghostFacings[0].y * 18
      };
    } else if (this.itemCarrier === 2) {
      this.itemPos = {
        x: this.ghostPositions[1].x + this.ghostFacings[1].x * 18,
        y: this.ghostPositions[1].y + this.ghostFacings[1].y * 18
      };
    }
  }

  updateRoomSimulation() {
    if (this.currentRoom === 0) { // ROOM_DOOR
      let active = false;
      if (Math.hypot(this.playerPosition.x - this.terminalPos.x, this.playerPosition.y - this.terminalPos.y) <= 38) {
        active = true;
      }
      for (let g = 0; g < MAX_TRACKS; g++) {
        if (this.committed[g] && Math.hypot(this.ghostPositions[g].x - this.terminalPos.x, this.ghostPositions[g].y - this.terminalPos.y) <= 38) {
          active = true;
        }
      }
      if (active !== this.terminalActive) {
        this.terminalActive = active;
        this.gateOpen = active;
        if (active) this.audio.playSwitch();
      }

    } else if (this.currentRoom === 1) { // ROOM_RELAY
      this.gateOpen = this.itemInSocket;

    } else if (this.currentRoom === 2) { // ROOM_LURE
      if (this.decoyTimer > 0) this.decoyTimer--;
      let nearTerminal = (Math.hypot(this.playerPosition.x - this.terminalPos.x, this.playerPosition.y - this.terminalPos.y) <= 38);
      for (let g = 0; g < MAX_TRACKS; g++) {
        if (this.committed[g] && Math.hypot(this.ghostPositions[g].x - this.terminalPos.x, this.ghostPositions[g].y - this.terminalPos.y) <= 38) {
          nearTerminal = true;
        }
      }
      if (nearTerminal) {
        this.decoyTimer = 180; // 3.0 seconds disable
      }
      this.gateOpen = true;

    } else if (this.currentRoom === 3) { // ROOM_DUAL
      let term1 = (Math.hypot(this.playerPosition.x - this.terminalPos.x, this.playerPosition.y - this.terminalPos.y) <= 38);
      let term2 = (Math.hypot(this.playerPosition.x - this.terminalPos2.x, this.playerPosition.y - this.terminalPos2.y) <= 38);
      for (let g = 0; g < MAX_TRACKS; g++) {
        if (this.committed[g]) {
          if (Math.hypot(this.ghostPositions[g].x - this.terminalPos.x, this.ghostPositions[g].y - this.terminalPos.y) <= 38) term1 = true;
          if (Math.hypot(this.ghostPositions[g].x - this.terminalPos2.x, this.ghostPositions[g].y - this.terminalPos2.y) <= 38) term2 = true;
        }
      }
      this.terminalActive = term1;
      this.terminalActive2 = term2;
      this.gateOpen = (term1 && term2);

    } else if (this.currentRoom === 4) { // ROOM_GRAND
      if (this.decoyTimer > 0) this.decoyTimer--;
      let nearDecoy = (Math.hypot(this.playerPosition.x - this.terminalPos.x, this.playerPosition.y - this.terminalPos.y) <= 38);
      for (let g = 0; g < MAX_TRACKS; g++) {
        if (this.committed[g] && Math.hypot(this.ghostPositions[g].x - this.terminalPos.x, this.ghostPositions[g].y - this.terminalPos.y) <= 38) nearDecoy = true;
      }
      if (nearDecoy) this.decoyTimer = 180;
      this.gateOpen = this.itemInSocket;
    }
  }

  checkLaserViolation() {
    if ((this.currentRoom === 2 || this.currentRoom === 4) && this.decoyTimer <= 0) {
      const hitbox = new Rect2(
        this.playerPosition.x - ACTOR_HALF_SIZE,
        this.playerPosition.y - ACTOR_HALF_SIZE,
        ACTOR_HALF_SIZE * 2,
        ACTOR_HALF_SIZE * 2
      );
      return this.laserRect.intersects(hitbox);
    }
    return false;
  }

  checkWinCondition() {
    const exitArea = new Rect2(EXIT_RECT.x, EXIT_RECT.y, EXIT_RECT.w, EXIT_RECT.h);
    if (!exitArea.hasPoint(this.playerPosition.x, this.playerPosition.y)) return false;

    if (this.currentRoom === 0) return this.gateOpen;
    if (this.currentRoom === 1) return this.itemInSocket;
    if (this.currentRoom === 2) return this.itemCarrier === 0; // Escaped carrying core
    if (this.currentRoom === 3) return this.gateOpen;
    if (this.currentRoom === 4) return this.itemInSocket;
    return false;
  }

  // ==========================================
  // ROOM DEFINITIONS & LEVEL SETUP
  // ==========================================
  loadRoom(roomId) {
    this.currentRoom = roomId;
    this.obstacles = [];
    this.gateRect = new Rect2(0, 0, 0, 0);
    this.laserRect = new Rect2(0, 0, 0, 0);
    this.terminalPos2 = { x: 0, y: 0 };
    this.decoyTimer = 0;

    if (roomId === 0) {
      // Room 1: Blast Gate Cooperation
      this.uiRoomName.innerText = "제1구역: 격벽 협업 (Blast Gate Cooperation)";
      this.uiRoomDesc.innerText = "임무: 상단 제어 스위치를 잔상으로 누르고 있는 동안, 개방된 격벽을 질주 돌파하십시오.";
      this.terminalPos = { x: 420, y: 260 };
      this.gateRect = new Rect2(600, 320, 30, 180);
      this.itemPresent = false;
      this.reactorPos = { x: 0, y: 0 };

      // Central divider wall
      this.obstacles.push(new Rect2(600, 140, 30, 180));
      this.obstacles.push(new Rect2(600, 500, 30, 160));

    } else if (roomId === 1) {
      // Room 2: Energy Cell Time Relay
      this.uiRoomName.innerText = "제2구역: 에너지 셀 시간 전달 (Energy Cell Relay)";
      this.uiRoomDesc.innerText = "임무: 잔상이 저장소에서 에너지 셀을 집어[E] 중앙에 투하[E], 라이브 플레이어가 가로채 반응로에 삽입하십시오.";
      this.itemPresent = true;
      this.itemName = "에너지 셀";
      this.itemPos = { x: 250, y: 250 };
      this.reactorPos = { x: 880, y: 240 };
      this.gateRect = new Rect2(1000, 320, 30, 180);
      this.terminalPos = { x: 0, y: 0 };

      // Divider partition
      this.obstacles.push(new Rect2(520, 140, 30, 200));
      this.obstacles.push(new Rect2(1000, 140, 30, 180));
      this.obstacles.push(new Rect2(1000, 500, 30, 160));

    } else if (roomId === 2) {
      // Room 3: Laser & Security Lure
      this.uiRoomName.innerText = "제3구역: 레이저 & 경비 유인 (Laser & Security Lure)";
      this.uiRoomDesc.innerText = "임무: 잔상이 기만 콘솔을 작동시켜 레이저를 무력화하는 사이, 코어를 탈취[E]하여 탈출하십시오.";
      this.terminalPos = { x: 450, y: 230 };
      this.laserRect = new Rect2(700, 140, 24, 520);
      this.itemPresent = true;
      this.itemName = "금고 코어";
      this.itemPos = { x: 920, y: 410 };
      this.reactorPos = { x: 0, y: 0 };
      this.gateRect = new Rect2(0, 0, 0, 0);

    } else if (roomId === 3) {
      // Room 4: Dual Circuit Synchronizer
      this.uiRoomName.innerText = "제4구역: 이중 회로 동기화 (Dual Circuit Synchronizer)";
      this.uiRoomDesc.innerText = "임무: 두 개의 원격 단말기를 2개의 잔상이 동시에 누르고 있어야만 중앙 보안문이 개방됩니다.";
      this.terminalPos = { x: 440, y: 230 };
      this.terminalPos2 = { x: 440, y: 560 };
      this.gateRect = new Rect2(750, 320, 30, 180);
      this.itemPresent = false;
      this.reactorPos = { x: 0, y: 0 };

      this.obstacles.push(new Rect2(750, 140, 30, 180));
      this.obstacles.push(new Rect2(750, 500, 30, 160));

    } else if (roomId === 4) {
      // Room 5: Grand Vault Heist
      this.uiRoomName.innerText = "제5구역: 궁극의 하이스트 (Grand Vault Heist)";
      this.uiRoomDesc.innerText = "임무: 기만 콘솔 무력화, 에너지 셀 전달 및 반응로 가동을 3개의 잔상과 완벽히 공조하십시오.";
      this.terminalPos = { x: 420, y: 220 };
      this.laserRect = new Rect2(620, 140, 24, 520);
      this.itemPresent = true;
      this.itemName = "에너지 셀";
      this.itemPos = { x: 740, y: 410 };
      this.reactorPos = { x: 920, y: 220 };
      this.gateRect = new Rect2(1000, 320, 30, 180);

      this.obstacles.push(new Rect2(1000, 140, 30, 180));
      this.obstacles.push(new Rect2(1000, 500, 30, 160));
    }

    this.resetCycle(true);
    this.showBanner(`${this.uiRoomName.innerText} 시작. 6.0초 루프 가동.`);
  }

  resetRoom() {
    this.resetCycle(true);
    this.showBanner("룸 초기화 완료. 첫 번째 시도를 시작하세요.");
  }

  resetCycle(clearCommitted) {
    this.currentTick = 0;
    this.cycleRunning = false;
    this.paused = false;
    this.stageCleared = false;
    this.stageFailed = false;

    this.playerPosition = { ...SPAWN_POS };
    this.playerFacing = { x: 1, y: 0 };
    this.ghostPositions = [{ ...SPAWN_POS }, { ...SPAWN_POS }];
    this.ghostFacings = [{ x: 1, y: 0 }, { x: 1, y: 0 }];

    this.itemCarrier = -1;
    this.itemInSocket = false;
    this.decoyTimer = 0;
    this.terminalActive = false;
    this.terminalActive2 = false;
    this.gateOpen = false;
    this.alarmPulse = 0;

    if (clearCommitted) {
      this.tracks = [[], []];
      this.trackHashes = [[], []];
      this.committed = [false, false];
      this.activeTrack = 0;
    }

    // Reset item pos
    if (this.currentRoom === 1) this.itemPos = { x: 250, y: 250 };
    if (this.currentRoom === 2) this.itemPos = { x: 920, y: 410 };
    if (this.currentRoom === 4) this.itemPos = { x: 740, y: 410 };

    this.updateHUD();
  }

  finishCycle() {
    if (this.activeTrack < MAX_TRACKS) {
      if (this.tracks[this.activeTrack].length === 0) return;
      this.committed[this.activeTrack] = true;
      const doneTrack = this.activeTrack;
      this.activeTrack++;

      this.audio.playLoopStart();
      this.showBanner(`루프 ${doneTrack + 1} 완료! 과거 잔상 확정. [WASD] 다음 침투 시작!`);
      this.resetCycle(false);
    } else {
      this.failCycle("루프 종료 (6.0초): 모든 잔상 소진 — 제한 시간 내 탈출 실패!");
    }
  }

  failCycle(reason) {
    this.stageFailed = true;
    this.cycleRunning = false;
    this.alarmPulse = 1.0;
    this.audio.playAlarm();
    this.showBanner(`${reason} — [R] 즉시 재시도`, 'danger');
  }

  completeStage() {
    this.stageCleared = true;
    this.cycleRunning = false;
    this.screenFlash = 1.0;
    this.slowMoTimer = 0.5;
    this.clearTimeSec = this.currentTick / PHYSICS_TPS;

    if (this.activeTrack === 1 && this.clearTimeSec <= 4.8) {
      this.clearStars = "★★★";
    } else if (this.activeTrack <= 1) {
      this.clearStars = "★★☆";
    } else {
      this.clearStars = "★☆☆";
    }

    this.audio.playClear();
    this.showBanner(
      `★ 하이스트 성공! 클리어: ${this.clearTimeSec.toFixed(2)}초 (루프 ${this.activeTrack + 1}회) ${this.clearStars} — [Space] 다음 룸`,
      'success'
    );

    document.getElementById('victory-time').innerText = `${this.clearTimeSec.toFixed(2)}초`;
    document.getElementById('victory-attempts').innerText = `${this.activeTrack + 1}회`;
    document.getElementById('victory-stars-display').innerText = this.clearStars;
    this.toggleModal('modal-victory');
  }

  // ==========================================
  // TICK ENGINE (60Hz Deterministic)
  // ==========================================
  tick() {
    if (this.paused || this.stageCleared || this.stageFailed) return;

    const liveCmd = this.readLiveCommand();
    if (!this.cycleRunning && liveCmd !== CMD_NONE) {
      this.cycleRunning = true;
    }
    if (!this.cycleRunning) return;

    // 1. Playback Ghosts from Committed Tracks
    for (let g = 0; g < MAX_TRACKS; g++) {
      if (this.committed[g]) {
        const ghostCmd = (this.currentTick < this.tracks[g].length) ? this.tracks[g][this.currentTick] : CMD_NONE;
        const ghostDir = this.cmdToDirection(ghostCmd);
        if (ghostDir.x !== 0 || ghostDir.y !== 0) {
          this.ghostFacings[g] = ghostDir;
        }
        this.ghostPositions[g] = this.moveActor(this.ghostPositions[g], ghostDir);
        this.processActorInteract(g + 1, this.ghostPositions[g], ghostCmd);
      }
    }

    // 2. Record and Move Live Player
    const playerDir = this.cmdToDirection(liveCmd);
    if (playerDir.x !== 0 || playerDir.y !== 0) {
      this.playerFacing = playerDir;
    }

    if (this.activeTrack < MAX_TRACKS) {
      this.tracks[this.activeTrack].push(liveCmd);
      this.playerPosition = this.moveActor(this.playerPosition, playerDir);
      this.processActorInteract(0, this.playerPosition, liveCmd);
    } else {
      this.playerPosition = this.moveActor(this.playerPosition, playerDir);
      this.processActorInteract(0, this.playerPosition, liveCmd);
    }

    // 3. Update Carried Items & Gimmick Simulation
    this.updateItemCarrierPos();
    this.updateRoomSimulation();

    // 4. Collision & Win/Loss Conditions
    if (this.checkLaserViolation()) {
      this.failCycle("보안 레이저 감지! 경보 작동 — 잔상으로 기만 콘솔을 유인하십시오.");
      return;
    }

    if (this.checkWinCondition()) {
      this.completeStage();
      return;
    }

    // 5. Loop Tick Increment
    this.currentTick++;
    if (this.currentTick >= LOOP_TICKS) {
      this.finishCycle();
    }
  }

  scrubTo(targetTick) {
    targetTick = Math.max(0, Math.min(LOOP_TICKS, targetTick));
    this.currentTick = targetTick;
    this.showBanner(`타임라인 스크러빙: ${(targetTick / PHYSICS_TPS).toFixed(2)}s`);
  }

  updateHUD() {
    const elapsed = this.currentTick / PHYSICS_TPS;
    const remaining = Math.max(0, 6.0 - elapsed);
    this.uiTimerVal.innerText = `${remaining.toFixed(2)}s`;
    this.uiTimerFill.style.width = `${(remaining / 6.0) * 100}%`;

    this.uiLoopBadge.innerText = `루프 ${this.activeTrack + 1} / 3`;

    this.trackElements.forEach((el, idx) => {
      el.classList.toggle('active', idx === this.activeTrack);
    });

    if (this.alarmPulse > 0) {
      this.uiAlarmOverlay.classList.add('active');
    } else {
      this.uiAlarmOverlay.classList.remove('active');
    }

    if (this.showDiagnostics) {
      this.f3Panel.innerHTML = `
        <strong>[F3 기술 진단 패널]</strong><br>
        Physics Tick: ${this.currentTick} / ${LOOP_TICKS}<br>
        Live Pos: (${this.playerPosition.x}, ${this.playerPosition.y})<br>
        Ghost 0 Pos: (${this.ghostPositions[0].x}, ${this.ghostPositions[0].y})<br>
        Ghost 1 Pos: (${this.ghostPositions[1].x}, ${this.ghostPositions[1].y})<br>
        Gate Open: ${this.gateOpen} | Laser Safe: ${this.decoyTimer > 0}<br>
        Item Carrier: ${this.itemCarrier} | Socketed: ${this.itemInSocket}
      `;
    }
  }

  // ==========================================
  // RENDER ENGINE
  // ==========================================
  draw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 1. Draw Arena Floor & Grid
    this.ctx.fillStyle = '#161b22';
    this.ctx.fillRect(WORLD_RECT.x, WORLD_RECT.y, WORLD_RECT.w, WORLD_RECT.h);

    this.ctx.strokeStyle = '#21262d';
    this.ctx.lineWidth = 1;
    for (let x = WORLD_RECT.x; x <= WORLD_RECT.x + WORLD_RECT.w; x += 40) {
      this.ctx.beginPath(); this.ctx.moveTo(x, WORLD_RECT.y); this.ctx.lineTo(x, WORLD_RECT.y + WORLD_RECT.h); this.ctx.stroke();
    }
    for (let y = WORLD_RECT.y; y <= WORLD_RECT.y + WORLD_RECT.h; y += 40) {
      this.ctx.beginPath(); this.ctx.moveTo(WORLD_RECT.x, y); this.ctx.lineTo(WORLD_RECT.x + WORLD_RECT.w, y); this.ctx.stroke();
    }

    // World Boundary Walls
    this.ctx.strokeStyle = '#30363d';
    this.ctx.lineWidth = 4;
    this.ctx.strokeRect(WORLD_RECT.x, WORLD_RECT.y, WORLD_RECT.w, WORLD_RECT.h);

    // 2. Spawn & Exit Zones
    this.ctx.fillStyle = 'rgba(0, 229, 255, 0.08)';
    this.ctx.fillRect(SPAWN_POS.x - 30, SPAWN_POS.y - 30, 60, 60);
    this.ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
    this.ctx.strokeRect(SPAWN_POS.x - 30, SPAWN_POS.y - 30, 60, 60);

    this.ctx.fillStyle = 'rgba(0, 230, 118, 0.15)';
    this.ctx.fillRect(EXIT_RECT.x, EXIT_RECT.y, EXIT_RECT.w, EXIT_RECT.h);
    this.ctx.strokeStyle = '#00e676';
    this.ctx.strokeRect(EXIT_RECT.x, EXIT_RECT.y, EXIT_RECT.w, EXIT_RECT.h);
    this.ctx.fillStyle = '#64ffda';
    this.ctx.font = 'bold 13px monospace';
    this.ctx.textAlign = 'center';
    this.ctx.fillText("탈출구 (EXIT)", EXIT_RECT.x + EXIT_RECT.w / 2, EXIT_RECT.y + EXIT_RECT.h / 2);

    // 3. Obstacles
    this.ctx.fillStyle = '#30363d';
    this.ctx.strokeStyle = '#484f58';
    this.ctx.lineWidth = 2;
    for (const obs of this.obstacles) {
      this.ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
      this.ctx.strokeRect(obs.x, obs.y, obs.w, obs.h);
    }

    // 4. Terminals & Switches
    if (this.terminalPos.x > 0) {
      this.ctx.fillStyle = this.terminalActive || (this.decoyTimer > 0) ? '#00e676' : '#ffb300';
      this.ctx.beginPath();
      this.ctx.arc(this.terminalPos.x, this.terminalPos.y, 22, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.strokeStyle = '#fff';
      this.ctx.stroke();

      this.ctx.fillStyle = '#0d1117';
      this.ctx.font = 'bold 11px monospace';
      this.ctx.fillText(this.currentRoom === 2 || this.currentRoom === 4 ? "기만" : "제어", this.terminalPos.x, this.terminalPos.y + 4);
    }

    if (this.terminalPos2.x > 0) {
      this.ctx.fillStyle = this.terminalActive2 ? '#00e676' : '#ffb300';
      this.ctx.beginPath();
      this.ctx.arc(this.terminalPos2.x, this.terminalPos2.y, 22, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.strokeStyle = '#fff';
      this.ctx.stroke();
      this.ctx.fillStyle = '#0d1117';
      this.ctx.font = 'bold 11px monospace';
      this.ctx.fillText("제어2", this.terminalPos2.x, this.terminalPos2.y + 4);
    }

    // 5. Reactor Socket
    if (this.reactorPos.x > 0) {
      this.ctx.fillStyle = this.itemInSocket ? '#00e676' : '#21262d';
      this.ctx.strokeStyle = this.itemInSocket ? '#64ffda' : '#8b949e';
      this.ctx.lineWidth = 3;
      this.ctx.strokeRect(this.reactorPos.x - 20, this.reactorPos.y - 20, 40, 40);
      this.ctx.fillStyle = '#f0f6fc';
      this.ctx.font = '10px monospace';
      this.ctx.fillText("반응로", this.reactorPos.x, this.reactorPos.y + 4);
    }

    // 6. Security Laser
    if (this.laserRect.w > 0) {
      const laserActive = (this.decoyTimer <= 0);
      this.ctx.fillStyle = laserActive ? 'rgba(255, 82, 99, 0.4)' : 'rgba(0, 230, 118, 0.1)';
      this.ctx.fillRect(this.laserRect.x, this.laserRect.y, this.laserRect.w, this.laserRect.h);

      if (laserActive) {
        this.ctx.strokeStyle = '#ff5263';
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.moveTo(this.laserRect.x + this.laserRect.w / 2, this.laserRect.y);
        this.ctx.lineTo(this.laserRect.x + this.laserRect.w / 2, this.laserRect.y + this.laserRect.h);
        this.ctx.stroke();
      }
    }

    // 7. Blast Gate
    if (this.gateRect.w > 0) {
      if (this.gateOpen) {
        this.ctx.strokeStyle = 'rgba(0, 230, 118, 0.5)';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([4, 4]);
        this.ctx.strokeRect(this.gateRect.x, this.gateRect.y, this.gateRect.w, this.gateRect.h);
        this.ctx.setLineDash([]);
      } else {
        this.ctx.fillStyle = '#ff5263';
        this.ctx.fillRect(this.gateRect.x, this.gateRect.y, this.gateRect.w, this.gateRect.h);
        this.ctx.strokeStyle = '#ff7b72';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(this.gateRect.x, this.gateRect.y, this.gateRect.w, this.gateRect.h);
      }
    }

    // 8. Interactive Items (Energy Cell / Vault Core)
    if (this.itemPresent && !this.itemInSocket) {
      this.ctx.fillStyle = '#ffb300';
      this.ctx.strokeStyle = '#fff';
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.arc(this.itemPos.x, this.itemPos.y, 10, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.stroke();
    }

    // 9. Past Ghosts (Recorded Tracks)
    for (let g = 0; g < MAX_TRACKS; g++) {
      if (this.committed[g]) {
        this.ctx.save();
        this.ctx.globalAlpha = 0.75;
        this.ctx.fillStyle = TRACK_COLORS[g];
        this.ctx.strokeStyle = '#fff';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(this.ghostPositions[g].x, this.ghostPositions[g].y, ACTOR_HALF_SIZE, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();

        // Facing indicator
        this.ctx.fillStyle = '#fff';
        this.ctx.fillRect(
          this.ghostPositions[g].x + this.ghostFacings[g].x * 12 - 2,
          this.ghostPositions[g].y + this.ghostFacings[g].y * 12 - 2,
          5, 5
        );
        this.ctx.restore();
      }
    }

    // 10. Live Player
    this.ctx.fillStyle = LIVE_COLOR;
    this.ctx.strokeStyle = '#fff';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(this.playerPosition.x, this.playerPosition.y, ACTOR_HALF_SIZE, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.stroke();

    // Facing indicator
    this.ctx.fillStyle = '#fff';
    this.ctx.fillRect(
      this.playerPosition.x + this.playerFacing.x * 12 - 2,
      this.playerPosition.y + this.playerFacing.y * 12 - 2,
      5, 5
    );
  }

  // ==========================================
  // MAIN ANIMATION LOOP
  // ==========================================
  run() {
    const now = performance.now();
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // Fixed 60Hz physics accumulator
    this.tickAccumulator += dt;
    while (this.tickAccumulator >= 1 / PHYSICS_TPS) {
      this.tick();
      this.tickAccumulator -= 1 / PHYSICS_TPS;
    }

    if (this.alarmPulse > 0) this.alarmPulse = Math.max(0, this.alarmPulse - dt * 2.0);

    this.updateHUD();
    this.draw();

    requestAnimationFrame(() => this.run());
  }
}

window.addEventListener('load', () => {
  const game = new AfterimageGame();
  window.gameInstance = game;
  game.run();
});
