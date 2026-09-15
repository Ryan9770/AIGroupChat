// ============================================================================
// 던전 장면 오케스트레이터 (DungeonScene)
// RunEngine(규칙) + InputController(입력) + DungeonRenderer(캔버스) + HudRenderer(DOM)
// P1-02: D-12 모듈 분리 완료, 기존 API 100% 호환성 유지
// ============================================================================

import { RunEngine } from '../run/RunEngine.js';
import { InputController } from '../input/InputController.js';
import { TouchControls } from '../input/TouchControls.js';
import { DungeonRenderer } from '../render/DungeonRenderer.js';
import { HudRenderer } from '../render/HudRenderer.js';
import { SFX } from '../systems/audio.js';
import { audioManager } from '../systems/audioManager.js';
import * as ui from '../systems/ui.js';
import { menuSystem } from '../systems/menuSystem.js';

export class DungeonScene {
  constructor(canvas, ctx, saveState, opts = {}) {
    this.canvas = canvas ?? { width: 1280, height: 720 };
    this.ctx = ctx ?? null;
    this.save = saveState;
    this.speedMul = opts.speedMultiplier ?? 1;
    this.onEnd = opts.onEnd ?? (() => {});
    this.paused = false;

    // 엔진 인스턴스화
    this.engine = new RunEngine(saveState, {
      ...opts,
      onEnd: (result) => {
        this.destroy();
        this.onEnd(result);
      },
      onNotify: (text, dur) => ui.showNotify(text, dur),
      onDialogue: (speaker, text, dur) => ui.showDialogue(speaker, text, dur),
      onSFX: (sfxKey, x, y, extra) => {
        if (x !== undefined && y !== undefined && this.engine?.player) {
          const px = this.engine.player.x;
          const py = this.engine.player.y;
          if (sfxKey.startsWith('footstep_')) {
            const mat = sfxKey.replace('footstep_', '');
            audioManager.playFootstep(mat, x, y, px, py, extra ?? 0.5);
          } else if (sfxKey.startsWith('telegraph_')) {
            const type = sfxKey.replace('telegraph_', '');
            audioManager.playTelegraph(type, x, y, px, py);
          } else {
            audioManager.playSpatialSFX(sfxKey, x, y, px, py);
          }
        } else if (sfxKey.startsWith('rhythm_')) {
          const cue = sfxKey.replace('rhythm_', '');
          audioManager.playRhythmCue(cue);
        } else if (typeof SFX[sfxKey] === 'function') {
          SFX[sfxKey]();
        } else {
          audioManager.playSFX(sfxKey);
        }
      },
      onBlessingPrompt: (options, level) => {
        this.hud.showBlessingModal(options, level, (idx) => {
          this.engine.chooseBlessing(idx);
        });
      },
    });

    this.input = new InputController(this.canvas);
    this.touchControls = new TouchControls(this.input, {
      mode: this.save?.settings?.touchControls ?? 'auto',
      onPause: () => {
        if (this.paused) return;
        if (this.engine.blessingSelectionActive) {
          this.engine.chooseBlessing(null);
          ui.clearPanel();
          return;
        }
        this.paused = true;
        menuSystem.showPauseMenu({
          onResume: () => { this.paused = false; },
          onSettings: (cb) => { menuSystem.showSettingsModal(this.save, cb); },
          onAbandon: () => {
            this.engine.damagePlayer(9999, 'abandon');
          },
        });
      },
      onToggleInventory: () => {
        this.engine.player.invOpen = !this.engine.player.invOpen;
      },
    });
    this.renderer = this.ctx ? new DungeonRenderer(this.canvas, this.ctx) : null;
    this.hud = new HudRenderer();

    audioManager.startAmbience();
    if (this.engine.floorDef) {
      ui.showNotify(`${this.engine.floorDef.name} 진입 — 시드: ${this.engine.seed}`, 40);
    }
  }

  update(dtReal) {
    const inputSnapshot = this.input.poll();

    // ESC 일시정지 메뉴 처리 (축복 선택 중일 때는 선택 건너뛰기)
    if (inputSnapshot.keys?.has('Escape') && !this.paused) {
      if (this.engine.blessingSelectionActive) {
        this.engine.chooseBlessing(null);
        ui.clearPanel();
        return;
      }
      this.paused = true;
      menuSystem.showPauseMenu({
        onResume: () => { this.paused = false; },
        onSettings: (cb) => { menuSystem.showSettingsModal(this.save, cb); },
        onAbandon: () => {
          this.engine.damagePlayer(9999, 'abandon');
        },
      });
      return;
    }

    if (this.paused) return;

    // 마우스 월드 좌표 및 조준 각도 계산 (방 고정 카메라 최신 위치 반영)
    if (this.renderer && this.canvas) {
      this.renderer.updateCamera(this.engine, dtReal);
      const worldMouse = this.renderer.screenToWorld(inputSnapshot.mouseX, inputSnapshot.mouseY);
      inputSnapshot.worldMouseX = worldMouse.x;
      inputSnapshot.worldMouseY = worldMouse.y;
      if (this.input.isTouchMoving && (inputSnapshot.moveX !== 0 || inputSnapshot.moveY !== 0)) {
        inputSnapshot.facing = Math.atan2(inputSnapshot.moveY, inputSnapshot.moveX);
      } else {
        inputSnapshot.facing = Math.atan2(worldMouse.y - this.engine.player.y, worldMouse.x - this.engine.player.x);
      }
    }

    this.engine.update(dtReal, inputSnapshot);

    // 심장박동 및 속삭임 레이어 갱신
    audioManager.updateHeartbeat(dtReal, this.engine.player.gaze, this.engine.tideStageIdx);
    audioManager.updateWhispers(dtReal, this.engine.player.gaze);

    if (this.ctx && this.renderer) {
      this.renderer.render(this.engine, dtReal);
      this.hud.render(this.engine);
    }
  }

  snapshotHash() {
    return this.engine.snapshotHash();
  }

  destroy() {
    this.touchControls?.destroy();
    this.input.destroy();
    audioManager.stopAmbience();
    audioManager.stopHeartbeat();
    ui.clearHUD();
    ui.clearPanel();
  }

  // ---------- 하위 호환성 프록시 속성 및 메서드 ----------
  get player() { return this.engine.player; }
  get enemies() { return this.engine.enemies; }
  set enemies(v) { this.engine.enemies = v; }
  get projectiles() { return this.engine.projectiles; }
  set projectiles(v) { this.engine.projectiles = v; }
  get chests() { return this.engine.chests; }
  get altars() { return this.engine.altars; }
  get gates() { return this.engine.gates; }
  get stairs() { return this.engine.stairs; }
  get prevStairs() { return this.engine.prevStairs; }
  get boss() { return this.engine.boss; }
  get sideBoss() { return this.engine.sideBoss; }
  get roomGraph() { return this.engine.roomGraph; }
  get tilemap() { return this.engine.tilemap; }
  get visitedRooms() { return this.engine.visitedRooms; }
  get currentRoomId() { return this.engine.currentRoomId; }
  get floorNum() { return this.engine.floorNum; }
  get floorDef() { return this.engine.floorDef; }
  get time() { return this.engine.time; }
  set time(v) { this.engine.time = v; }
  get seed() { return this.engine.seed; }
  get runXp() { return this.engine.runXp; }
  get blessingLevel() { return this.engine.blessingLevel; }
  get activeBlessings() { return this.engine.activeBlessings; }
  get ended() { return this.engine.ended; }
  get settlement() { return this.engine.settlement; }
  get noiseEvents() { return this.engine.noiseEvents; }
  get groundItems() { return this.engine.groundItems; }

  addRunXp(amount) { return this.engine.addRunXp(amount); }
  damagePlayer(dmg, source, isDot = false) { return this.engine.damagePlayer(dmg, source, isDot); }
  onNoise(x, y, kind, radius) { return this.engine.onNoise(x, y, kind, radius); }
  isNoiseAudible(entity, r) { return this.engine.isNoiseAudible(entity, r); }
  showVoice(text) { return this.engine.showVoice(text); }
  spawnProjectile(shooter, target, dmg) { return this.engine.spawnProjectile(shooter, target, dmg); }
  onEnemyDeath(enemy) { return this.engine.onEnemyDeath(enemy); }
}
