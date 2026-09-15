// ============================================================================
// 오디오 매니저 (AudioManager)
// P3-01: 5-버스(Master/SFX/Music/Ambience/UI) 구조 & 마스터 리미터
// 거리 감쇠 및 스테레오 패닝 (플레이어 기준 공간 음향)
// 적별 0.4초 이상 전조음, 재질별 발소리 피치 변주, 게이트/조수 4개 고유 리듬
// 아비그라 심장박동 레이어 (60~120 BPM) & 시선 61+ 속삭임 레이어
// ============================================================================

import { SFX as synthSFX } from './audio.js';
import { assets } from './assets.js';

export const KEY_TO_MANIFEST = {
  swordSwing: 'sfx.sword_swing',
  swordHit: 'sfx.sword_hit',
  shieldBlock: 'sfx.shield_block',
  trapTrigger: 'sfx.trap_trigger',
  goldChime: 'sfx.gold_chime',
  chestOpen: 'sfx.chest_open',
  doorOpen: 'sfx.door_open',
  doorClose: 'sfx.door_close',
  step: 'sfx.footstep_0',
  roll: 'sfx.roll',
  golemSmash: 'sfx.golem_smash',
  blessingCard: 'sfx.card_open',
  ambience: 'amb.floor1_base',

  // 전조음 및 고유 에셋 매핑
  telegraph_skeleton: 'sfx.shield_block', // metal click
  telegraph_golem: 'sfx.golem_smash',
  telegraph_royalGuard: 'sfx.sword_hit',
  footstep_stone: 'sfx.footstep_0',
  footstep_coin: 'sfx.gold_chime',
  footstep_bone: 'sfx.footstep_1',
  footstep_flesh: 'sfx.roll',
};

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.masterBus = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.ambienceBus = null;
    this.uiBus = null;
    this.limiter = null;

    this.activeSfxInstances = new Map(); // key -> Set of source nodes
    this.totalActiveSfxCount = 0;
    this.maxTotalConcurrent = 32; // 동시 재생 상한 32개
    this.maxConcurrentPerKey = 4;  // 키별 동시 재생 상한 4개

    this.bgmSource = null;
    this.heartbeatTimer = 0;
    this.whisperTimer = 0;
    this.whisperAngle = 0;

    this.synthFallbackCount = 0;
    this.warnedKeys = new Set();

    this.volumes = {
      master: 1.0,
      sfx: 0.7,
      music: 0.5,
      ambience: 0.35,
      ui: 0.8,
    };
    this.muted = false;
  }

  _initAudioGraph() {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    this.ctx = new AudioCtx();

    // 마스터 리미터 (32개 동시 재생에서도 0dB 클리핑 절대 방지)
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.setValueAtTime(-3, this.ctx.currentTime); // -3 dBFS
    this.limiter.knee.setValueAtTime(6, this.ctx.currentTime);
    this.limiter.ratio.setValueAtTime(16, this.ctx.currentTime);
    this.limiter.attack.setValueAtTime(0.003, this.ctx.currentTime);
    this.limiter.release.setValueAtTime(0.20, this.ctx.currentTime);

    this.masterBus = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    this.musicBus = this.ctx.createGain();
    this.ambienceBus = this.ctx.createGain();
    this.uiBus = this.ctx.createGain();

    this.sfxBus.connect(this.masterBus);
    this.musicBus.connect(this.masterBus);
    this.ambienceBus.connect(this.masterBus);
    this.uiBus.connect(this.masterBus);

    this.masterBus.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);

    this._updateBusVolumes();
    return this.ctx;
  }

  _updateBusVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const mul = this.muted ? 0 : 1;
    if (this.masterBus) this.masterBus.gain.setValueAtTime(this.volumes.master * mul, t);
    if (this.sfxBus) this.sfxBus.gain.setValueAtTime(this.volumes.sfx, t);
    if (this.musicBus) this.musicBus.gain.setValueAtTime(this.volumes.music, t);
    if (this.ambienceBus) this.ambienceBus.gain.setValueAtTime(this.volumes.ambience, t);
    if (this.uiBus) this.uiBus.gain.setValueAtTime(this.volumes.ui, t);
  }

  async preload(onProgress = null) {
    const ac = this._initAudioGraph();
    return await assets.preloadGroup('boot', ac, onProgress);
  }

  // ==========================================================================
  // 공간 음향 재생 (거리 감쇠 및 스테레오 패닝)
  // ==========================================================================
  playSpatialSFX(key, sourceX, sourceY, listenerX, listenerY, options = {}) {
    if (this.muted) return false;

    // 1. 거리 감쇠 계산
    const dx = sourceX - listenerX;
    const dy = sourceY - listenerY;
    const dist = Math.hypot(dx, dy);
    const maxDist = options.maxDist ?? 22;

    if (dist > maxDist) return false; // 최대 청취 거리 초과

    // 역제곱-선형 혼합 감쇠 모델
    const distanceGain = Math.max(0.04, 1 / (1 + 0.14 * dist));

    // 2. 스테레오 팬 계산 (-1.0 ~ 1.0)
    const panSpread = options.panSpread ?? 10;
    const stereoPan = Math.max(-1.0, Math.min(1.0, dx / panSpread));

    return this.playSFX(key, {
      gain: (options.gain ?? 1.0) * distanceGain,
      pan: stereoPan,
      playbackRate: options.playbackRate ?? 1.0,
    });
  }

  // ==========================================================================
  // 단일 SFX 재생 (AudioBuffer 우선 + 버스 라우팅 + 클리핑 제어)
  // ==========================================================================
  playSFX(key, options = {}) {
    if (this.muted) return false;
    const manifestKey = KEY_TO_MANIFEST[key] ?? key;
    const audioContext = this._initAudioGraph();

    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }

    const buffer = assets.getAudioBuffer(manifestKey);
    const isDecodedBuffer = buffer && (
      (typeof AudioBuffer !== 'undefined' && buffer instanceof AudioBuffer) ||
      (buffer.duration !== undefined && buffer.numberOfChannels !== undefined)
    );

    if (audioContext && isDecodedBuffer) {
      let activeSet = this.activeSfxInstances.get(manifestKey);
      if (!activeSet) {
        activeSet = new Set();
        this.activeSfxInstances.set(manifestKey, activeSet);
      }

      // 1. 전체 동시 재생 상한 (32개) 제어
      if (this.totalActiveSfxCount >= this.maxTotalConcurrent) {
        return false;
      }

      // 2. 동일 사운드 동시 재생 상한 (4개) 초과 시 가장 오래된 인스턴스 중단
      if (activeSet.size >= this.maxConcurrentPerKey) {
        const oldest = activeSet.values().next().value;
        try { oldest.stop(); } catch (_) {}
        activeSet.delete(oldest);
        this.totalActiveSfxCount--;
      }

      try {
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        if (options.playbackRate) {
          source.playbackRate.setValueAtTime(options.playbackRate, audioContext.currentTime);
        }

        // 개별 볼륨 게인 노드
        const gainNode = audioContext.createGain();
        gainNode.gain.setValueAtTime(options.gain ?? 1.0, audioContext.currentTime);

        // 스테레오 팬 노드
        if (typeof audioContext.createStereoPanner === 'function' && options.pan !== undefined) {
          const panner = audioContext.createStereoPanner();
          panner.pan.setValueAtTime(options.pan, audioContext.currentTime);
          source.connect(gainNode);
          gainNode.connect(panner);
          panner.connect(this.sfxBus);
        } else {
          source.connect(gainNode);
          gainNode.connect(this.sfxBus);
        }

        activeSet.add(source);
        this.totalActiveSfxCount++;

        source.onended = () => {
          activeSet.delete(source);
          this.totalActiveSfxCount = Math.max(0, this.totalActiveSfxCount - 1);
        };

        source.start();
        return true;
      } catch (err) {
        console.warn(`[AudioManager] Error playing AudioBuffer for ${key}`, err);
      }
    }

    // 3. 파일 누락 시 신시사이저 폴백
    this.synthFallbackCount++;
    if (!this.warnedKeys.has(key)) {
      this.warnedKeys.add(key);
    }
    this._fallbackSynth(key, options);
    return false;
  }

  _fallbackSynth(key, options = {}) {
    if (synthSFX[key]) {
      try {
        synthSFX[key](options.playbackRate ?? 1.0);
      } catch (_) {}
    }
  }

  // ==========================================================================
  // P3-01: 적별 전조음 공간 음향 디스패처
  // ==========================================================================
  playTelegraph(enemyType, sourceX, sourceY, listenerX, listenerY) {
    let key = `telegraph_${enemyType}`;
    if (enemyType === 'skeletonCaptain') key = 'telegraph_skeleton';
    this.playSpatialSFX(key, sourceX, sourceY, listenerX, listenerY, {
      gain: 1.2,
      panSpread: 8,
    });
  }

  // ==========================================================================
  // P3-01: 재질별 발소리 변주 & 피치 랜덤화 (±5%)
  // ==========================================================================
  playFootstep(material = 'stone', sourceX, sourceY, listenerX, listenerY, rngVal = 0.5) {
    const pitch = 0.95 + (rngVal % 1.0) * 0.10; // ±5% 랜덤 피치
    const key = `footstep_${material}`;
    this.playSpatialSFX(key, sourceX, sourceY, listenerX, listenerY, {
      gain: 0.6,
      playbackRate: pitch,
    });
  }

  // ==========================================================================
  // P3-01: 게이트 & 조수 4개 고유 리듬 트리거
  // ==========================================================================
  playRhythmCue(cueName) {
    const key = `rhythm_${cueName}`;
    this.playSFX(key, { gain: 1.1 });
  }

  // ==========================================================================
  // P3-01: 아비그라 심장박동 레이어 갱신 (60~120 BPM)
  // ==========================================================================
  updateHeartbeat(dt, gaze = 0, tideStage = -1) {
    if (this.muted) return;

    // 조수 단계 및 시선에 따라 BPM 결정
    let targetBpm = 60;
    if (tideStage === 0) targetBpm = 72;
    else if (tideStage === 1) targetBpm = 90;
    else if (tideStage === 2) targetBpm = 120;
    else if (gaze >= 91) targetBpm = 110;
    else if (gaze >= 61) targetBpm = 85;

    const interval = 60 / targetBpm; // 초당 주기
    this.heartbeatTimer += dt;

    if (this.heartbeatTimer >= interval) {
      this.heartbeatTimer -= interval;
      if (synthSFX.heartbeat) {
        try { synthSFX.heartbeat(); } catch (_) {}
      }
    }
  }

  stopHeartbeat() {
    this.heartbeatTimer = 0;
  }

  // ==========================================================================
  // P3-01: 시선 61+ 속삭임 레이어 (환각 유도 공간 음향)
  // 실제 적 발소리/공격음 위조 절대 금지 준수
  // ==========================================================================
  updateWhispers(dt, gaze = 0) {
    if (this.muted || gaze < 61) {
      this.whisperTimer = 0;
      return;
    }

    this.whisperTimer += dt;
    this.whisperAngle += dt * 0.5;

    // 4~6초 주기마다 방향성 속삭임 펄스 발생
    if (this.whisperTimer >= 5.0) {
      this.whisperTimer = 0;
      const pan = Math.sin(this.whisperAngle);
      this.playSFX('whisper', {
        gain: 0.45,
        pan: pan,
      });
    }
  }

  startAmbience() {
    if (this.muted) return;
    const audioContext = this._initAudioGraph();
    if (!audioContext) return;

    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }

    const manifestKey = KEY_TO_MANIFEST.ambience;
    const buffer = assets.getAudioBuffer(manifestKey);
    const isDecodedBuffer = buffer && (
      (typeof AudioBuffer !== 'undefined' && buffer instanceof AudioBuffer) ||
      (buffer.duration !== undefined)
    );

    if (isDecodedBuffer) {
      if (this.bgmSource) {
        try { this.bgmSource.stop(); } catch (_) {}
      }
      try {
        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(this.ambienceBus);
        source.start();
        this.bgmSource = source;
      } catch (_) {}
    }
  }

  stopAmbience() {
    if (this.bgmSource) {
      try { this.bgmSource.stop(); } catch (_) {}
      this.bgmSource = null;
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this._updateBusVolumes();
  }

  setVolume(busName, value) {
    if (this.volumes[busName] !== undefined) {
      this.volumes[busName] = Math.max(0, Math.min(1, Number(value) || 0));
      this._updateBusVolumes();
    }
  }

  getSynthFallbackCount() {
    return this.synthFallbackCount;
  }

  resetSynthFallbackCount() {
    this.synthFallbackCount = 0;
  }
}

export const audioManager = new AudioManager();
