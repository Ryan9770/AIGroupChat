/**
 * DUNGEON OF THE ABYSS - Enhanced Roguelite RPG Engine (v2.0 Masterpiece Edition)
 * Featuring:
 * - 3 Distinct Character Classes with 4 Unique Active Skills Each
 * - 5 Dungeon Biomes with Atmospheric Floor Palette & Dynamic Lighting
 * - Deep Status Effect System (Burn, Poison, Freeze, Stun, Shield, AtkBuff, Dodge)
 * - Interactive Dungeon Shrines & Traps
 * - Relics & Passive Blessings Engine
 * - Multi-phase Boss Mechanics & Mini-Boss (Death Knight & Shadow Drake)
 * - Canvas 2D Particle System & Screen Shake Effects
 * - Bestiary & Codex System
 * - High-Fidelity Retro Web Audio API Synthesizer
 */

// =============================================================================
// 0. Upgrade Rules & Audio Catalogs (U-01, U-02, U-03, U-04)
// =============================================================================
const FEATURE_RULES = Object.freeze({
  merchantFloors: [2, 4],
  mimicChance: 0.15,
  secretRoomChance: 0.55,
  maxSecretRoomsPerFloor: 1,
});

const SHOP_RULES = Object.freeze({
  guaranteedFloors: [2, 4],
  offersPerShop: 5,
  stealTriggersBoss: true,
});

const BGM_TRACKS = Object.freeze({
  lobby: {
    id: 'lobby',
    bpm: 104,
    stepsPerBeat: 4,
    rootHz: 220,
    scale: [1, 9 / 8, 6 / 5, 4 / 3, 3 / 2, 8 / 5, 9 / 5, 2],
    channels: [
      { wave: 'square', octave: 1, gain: 0.04, pattern: [0, 2, 4, 7, 4, 2, 4, 2, 0, 3, 4, 7, 4, 3, 2, 0] },
      { wave: 'triangle', octave: -1, gain: 0.08, pattern: [0, null, null, null, 0, null, null, null, 3, null, null, null, 4, null, null, null], gate: 0.85 },
    ],
  },
  crypt: {
    id: 'crypt',
    bpm: 84,
    stepsPerBeat: 4,
    rootHz: 110,
    scale: [1, 9 / 8, 6 / 5, 4 / 3, 3 / 2, 8 / 5, 9 / 5, 2],
    channels: [
      { wave: 'square', octave: 1, gain: 0.04, pattern: [0, null, 2, null, 1, null, 0, null, 4, null, 3, null, 2, 1, 0, null] },
      { wave: 'triangle', octave: 0, gain: 0.07, pattern: [0, null, null, null, 0, null, null, null, 4, null, null, null, 3, null, null, null], gate: 0.8 },
    ],
  },
  fungal: {
    id: 'fungal',
    bpm: 92,
    stepsPerBeat: 4,
    rootHz: 98,
    scale: [1, 16 / 15, 6 / 5, 4 / 3, 3 / 2, 8 / 5, 9 / 5, 2],
    channels: [
      { wave: 'sawtooth', octave: 0, gain: 0.04, pattern: [0, 1, 2, null, 1, 0, null, 2, 3, null, 2, 1, 0, null, null, null] },
      { wave: 'triangle', octave: -1, gain: 0.08, pattern: [0, 0, 0, 0, 4, 4, 4, 4, 3, 3, 3, 3, 0, 0, 0, 0], gate: 0.95 },
    ],
  },
  boss_b3: {
    id: 'boss_b3',
    bpm: 128,
    stepsPerBeat: 4,
    rootHz: 130.81,
    scale: [1, 9 / 8, 6 / 5, 4 / 3, 3 / 2, 8 / 5, 7 / 4, 2],
    channels: [
      { wave: 'sawtooth', octave: 1, gain: 0.05, pattern: [0, 0, 3, 0, 4, 0, 3, 0, 5, 0, 4, 0, 3, 2, 0, 2] },
      { wave: 'square', octave: 0, gain: 0.05, pattern: [0, null, 0, null, 4, null, 3, null, 0, null, 0, null, 5, null, 4, null] },
      { wave: 'noise', octave: 0, gain: 0.04, pattern: [0, null, null, null, 0, null, null, null, 0, null, null, null, 0, 0, null, null], gate: 0.25 },
    ],
  },
  inferno: {
    id: 'inferno',
    bpm: 116,
    stepsPerBeat: 4,
    rootHz: 146.83,
    scale: [1, 16 / 15, 5 / 4, 4 / 3, 3 / 2, 8 / 5, 15 / 8, 2],
    channels: [
      { wave: 'square', octave: 1, gain: 0.04, pattern: [0, 2, 4, 6, 7, 4, 2, 0, 6, 4, 1, 3, 5, 3, 1, 0] },
      { wave: 'triangle', octave: -1, gain: 0.07, pattern: [0, null, 0, null, 3, null, null, 0, 4, null, null, 3, 0, null, 0, null] },
    ],
  },
  boss_b5: {
    id: 'boss_b5',
    bpm: 140,
    stepsPerBeat: 4,
    rootHz: 164.81,
    scale: [1, 16 / 15, 6 / 5, 4 / 3, 3 / 2, 8 / 5, 9 / 5, 2],
    channels: [
      { wave: 'sawtooth', octave: 1, gain: 0.05, pattern: [0, 2, 3, 5, 7, 5, 3, 2, 7, 5, 3, 2, 3, 2, 0, 1] },
      { wave: 'square', octave: 0, gain: 0.05, pattern: [0, 0, null, 0, 3, 3, null, 3, 5, 5, null, 5, 2, 2, 3, 3] },
      { wave: 'noise', octave: 0, gain: 0.04, pattern: [0, null, 0, null, 0, null, 0, 0, 0, null, 0, null, 0, 0, 0, null], gate: 0.2 },
    ],
  },
});

// =============================================================================
// 1. Retro 8-bit Audio Synthesizer (Web Audio API)
// =============================================================================
class RetroAudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.masterGain = null;
    this.sfxGain = null;
    this.bgmGain = null;
    this.requestedTrackId = null;
    this.currentTrackId = null;
    this.bgmStep = 0;
    this.nextStepAt = 0;
    this.schedulerId = null;
    this.scheduledSources = new Set();
    this.lookAheadMs = 25;
    this.scheduleAheadSec = 0.12;

    if (typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem('DOTA_AUDIO_SETTINGS_V1');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (typeof parsed.enabled === 'boolean') {
            this.enabled = parsed.enabled;
          }
        }
      } catch {}
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.stopBgm({ fadeMs: 50, preserveRequest: true });
        } else if (this.enabled && this.requestedTrackId) {
          this.startBgm(this.requestedTrackId, { restart: true });
        }
      });
    }
  }

  init() {
    if (!this.ctx) {
      const AudioContextClass = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
      if (AudioContextClass) {
        this.ctx = new AudioContextClass();
      }
    }
    if (this.ctx) {
      if (!this.masterGain) {
        this.masterGain = this.ctx.createGain();
        this.sfxGain = this.ctx.createGain();
        this.bgmGain = this.ctx.createGain();

        this.sfxGain.connect(this.masterGain);
        this.bgmGain.connect(this.masterGain);
        this.masterGain.connect(this.ctx.destination);

        this.masterGain.gain.setValueAtTime(this.enabled ? 1.0 : 0.0, this.ctx.currentTime);
        this.sfxGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
        this.bgmGain.gain.setValueAtTime(0.4, this.ctx.currentTime);
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      if (this.enabled && this.requestedTrackId && !this.currentTrackId) {
        this.startBgm(this.requestedTrackId);
      }
    }
  }

  setEnabled(enabled, { persist = true } = {}) {
    this.enabled = enabled;
    if (persist && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('DOTA_AUDIO_SETTINGS_V1', JSON.stringify({ enabled }));
      } catch {}
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(enabled ? 1.0 : 0.0, this.ctx.currentTime);
    }
    if (!enabled) {
      this.stopBgm({ fadeMs: 0, preserveRequest: true });
    } else {
      if (this.requestedTrackId) {
        this.startBgm(this.requestedTrackId, { restart: false });
      }
    }
    return this.enabled;
  }

  startBgm(trackId, { fadeMs = 180, restart = false } = {}) {
    this.requestedTrackId = trackId;
    if (!this.enabled || !BGM_TRACKS[trackId]) return false;
    if (!this.ctx) return false;

    if (this.currentTrackId === trackId && !restart && this.schedulerId) {
      return true;
    }

    this.stopBgm({ fadeMs, preserveRequest: true });
    this.requestedTrackId = trackId;
    this.currentTrackId = trackId;
    this.bgmStep = 0;
    this.nextStepAt = this.ctx.currentTime + 0.05;

    this.scheduleBgmWindow();
    this.schedulerId = setInterval(() => {
      this.scheduleBgmWindow();
    }, this.lookAheadMs);

    return true;
  }

  stopBgm({ fadeMs = 120, preserveRequest = false } = {}) {
    if (!preserveRequest) {
      this.requestedTrackId = null;
    }
    this.currentTrackId = null;
    if (this.schedulerId) {
      clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
    for (const src of this.scheduledSources) {
      try {
        src.stop();
      } catch {}
    }
    this.scheduledSources.clear();
  }

  setScene(scene, { floorNumber } = {}) {
    let trackId = null;
    if (scene === 'LOBBY') {
      trackId = 'lobby';
    } else if (scene === 'BOSS') {
      trackId = floorNumber === 5 ? 'boss_b5' : 'boss_b3';
    } else if (scene === 'FLOOR') {
      if (floorNumber === 1) trackId = 'crypt';
      else if (floorNumber === 2) trackId = 'fungal';
      else if (floorNumber === 3) trackId = 'boss_b3';
      else if (floorNumber === 4) trackId = 'inferno';
      else if (floorNumber === 5) trackId = 'boss_b5';
      else trackId = 'crypt';
    } else if (scene === 'GAME_OVER' || scene === 'VICTORY') {
      this.stopBgm({ fadeMs: 500 });
      return null;
    }

    if (trackId) {
      this.startBgm(trackId);
    }
    return trackId;
  }

  scheduleBgmWindow() {
    if (!this.ctx || !this.currentTrackId) return;
    const track = BGM_TRACKS[this.currentTrackId];
    if (!track) return;
    const secondsPerBeat = 60 / track.bpm;
    const secondsPerStep = secondsPerBeat / track.stepsPerBeat;
    const maxPatternLen = Math.max(...track.channels.map((c) => c.pattern.length));

    while (this.nextStepAt < this.ctx.currentTime + this.scheduleAheadSec) {
      this.scheduleBgmStep(track, this.bgmStep, this.nextStepAt);
      this.bgmStep = (this.bgmStep + 1) % maxPatternLen;
      this.nextStepAt += secondsPerStep;
    }
  }

  scheduleBgmStep(track, stepIndex, when) {
    const secondsPerBeat = 60 / track.bpm;
    const secondsPerStep = secondsPerBeat / track.stepsPerBeat;

    track.channels.forEach((ch) => {
      const note = ch.pattern[stepIndex % ch.pattern.length];
      if (note === null || note === undefined) return;
      const gate = ch.gate ?? 0.72;
      const dur = secondsPerStep * gate;
      if (ch.wave === 'noise') {
        this.createNoiseVoice(when, dur, ch.gain, this.bgmGain);
      } else {
        const ratio = track.scale[note] || 1.0;
        const freq = track.rootHz * (2 ** ch.octave) * ratio;
        this.createVoice(freq, ch.wave, when, dur, ch.gain, this.bgmGain);
      }
    });
  }

  createVoice(freq, wave, when, duration, gainVal, destination) {
    if (!this.ctx) return null;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(freq, when);

      gain.gain.setValueAtTime(gainVal, when);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

      osc.connect(gain);
      gain.connect(destination || this.bgmGain || this.masterGain || this.ctx.destination);

      osc.start(when);
      osc.stop(when + duration);

      this.scheduledSources.add(osc);
      osc.onended = () => {
        this.scheduledSources.delete(osc);
      };
      return osc;
    } catch {
      return null;
    }
  }

  createNoiseVoice(when, duration, gainVal, destination) {
    if (!this.ctx) return null;
    try {
      const sampleRate = this.ctx.sampleRate || 44100;
      const bufferSize = Math.max(1, Math.floor(sampleRate * duration));
      const buffer = this.ctx.createBuffer(1, bufferSize, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(gainVal, when);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

      noise.connect(gain);
      gain.connect(destination || this.bgmGain || this.masterGain || this.ctx.destination);

      noise.start(when);
      noise.stop(when + duration);

      this.scheduledSources.add(noise);
      noise.onended = () => {
        this.scheduledSources.delete(noise);
      };
      return noise;
    } catch {
      return null;
    }
  }

  playTone(freq, type = 'square', duration = 0.1, gainVal = 0.15) {
    if (!this.enabled || !this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

      gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.sfxGain || this.masterGain || this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch {
      // AudioContext policy
    }
  }

  playHit() {
    this.init();
    this.playTone(130, 'sawtooth', 0.12, 0.25);
    setTimeout(() => this.playTone(80, 'triangle', 0.1, 0.2), 30);
  }

  playPlayerAttack() {
    this.init();
    this.playTone(320, 'square', 0.08, 0.12);
  }

  playCrit() {
    this.init();
    this.playTone(480, 'sawtooth', 0.15, 0.32);
    setTimeout(() => this.playTone(240, 'square', 0.2, 0.25), 50);
  }

  playPotion() {
    this.init();
    [260, 330, 390, 520].forEach((freq, idx) => {
      setTimeout(() => this.playTone(freq, 'sine', 0.12, 0.15), idx * 55);
    });
  }

  playLevelUp() {
    this.init();
    [330, 392, 493, 587, 659, 784].forEach((freq, idx) => {
      setTimeout(() => this.playTone(freq, 'triangle', 0.18, 0.22), idx * 80);
    });
  }

  playStairs() {
    this.init();
    [300, 240, 180, 120].forEach((freq, idx) => {
      setTimeout(() => this.playTone(freq, 'sawtooth', 0.15, 0.2), idx * 70);
    });
  }

  playDeath() {
    this.init();
    [220, 180, 140, 90, 60].forEach((freq, idx) => {
      setTimeout(() => this.playTone(freq, 'sawtooth', 0.2, 0.3), idx * 110);
    });
  }

  playItemPickup() {
    this.init();
    this.playTone(600, 'sine', 0.08, 0.12);
    setTimeout(() => this.playTone(850, 'sine', 0.12, 0.15), 50);
  }

  playSkill() {
    this.init();
    this.playTone(220, 'sawtooth', 0.15, 0.3);
    setTimeout(() => this.playTone(440, 'square', 0.2, 0.25), 40);
  }

  playBossRoar() {
    this.init();
    [120, 95, 70, 50, 40].forEach((freq, idx) => {
      setTimeout(() => this.playTone(freq, 'sawtooth', 0.25, 0.38), idx * 110);
    });
  }

  playTrap() {
    this.init();
    this.playTone(180, 'sawtooth', 0.06, 0.25);
    setTimeout(() => this.playTone(90, 'square', 0.15, 0.3), 30);
  }

  playShrine() {
    this.init();
    [220, 277, 330, 440, 554].forEach((freq, idx) => {
      setTimeout(() => this.playTone(freq, 'sine', 0.3, 0.18), idx * 80);
    });
  }

  playFreeze() {
    this.init();
    [600, 750, 920, 1100].forEach((freq, idx) => {
      setTimeout(() => this.playTone(freq, 'sine', 0.08, 0.15), idx * 40);
    });
  }

  playShield() {
    this.init();
    [300, 400, 500].forEach((freq, idx) => {
      setTimeout(() => this.playTone(freq, 'triangle', 0.15, 0.2), idx * 50);
    });
  }

  playWhirlwind() {
    this.init();
    [280, 240, 200, 320, 380].forEach((freq, idx) => {
      setTimeout(() => this.playTone(freq, 'sawtooth', 0.07, 0.2), idx * 35);
    });
  }
}

// =============================================================================
// 2. Constants & Data Catalogs
// =============================================================================
const MAP_WIDTH = 55;
const MAP_HEIGHT = 36;
const TILE_SIZE = 28;
const MAX_FLOORS = 5;

// Floor Themes & Biome Ambience (LORE_AND_ART_GUIDE Spec)
const FLOOR_THEMES = {
  1: {
    name: '잊혀진 납골당 (Sunken Crypts)',
    rune: '𐌀',
    runeName: 'NA (기억과 이름)',
    narration: '첫 번째 깊이, 이름을 삼킨 물의 묘지. 이곳에서 죽은 자는 잠들지 못한다. 불러 줄 이름을 잃었으므로.',
    subtitle: '수만 유골의 원혼과 지워진 장례 명부가 가라앉은 물의 묘역',
    wall: '#373247',
    wallTop: '#4e4764',
    floor: '#161424',
    border: '#252233',
    fog: '#0d0c14',
    ambientColor: 'rgba(143, 175, 209, 0.12)',
    particleColor: 'rgba(143, 175, 209, 0.5)',
    particleType: 'mist_drop',
  },
  2: {
    name: '독기 서린 버섯 동굴 (Fungal Caverns)',
    rune: 'ᛖ',
    runeName: 'ETH (숨과 생명)',
    narration: '두 번째 깊이, 숨 쉬는 정원. 포자는 죽은 이의 꿈을 피워 내고, 달콤한 향기 아래에서 기억은 썩어 간다.',
    subtitle: '리시아 공주의 기억을 배양하던 황실 온실과 유독한 균사 군락',
    wall: '#263b2c',
    wallTop: '#37543f',
    floor: '#122016',
    border: '#1f3024',
    fog: '#0a120c',
    ambientColor: 'rgba(46, 204, 113, 0.12)',
    particleColor: 'rgba(46, 204, 113, 0.55)',
    particleType: 'spore',
  },
  3: {
    name: '저주받은 해골 묘실 (Accursed Catacombs)',
    rune: 'ᚲ',
    runeName: 'KA (맹세와 결속)',
    narration: '세 번째 깊이, 맹세가 형벌이 된 묘실. 충성은 기록에서 반역이 되었고, 억울한 검은 아직 주인을 기다린다.',
    subtitle: '황제에게 배신당해 생매장된 기사단장 에드릭의 원한이 서린 묘실',
    wall: '#3e324c',
    wallTop: '#58476c',
    floor: '#1a1426',
    border: '#2b2138',
    fog: '#0f0c14',
    ambientColor: 'rgba(155, 89, 182, 0.15)',
    particleColor: 'rgba(155, 89, 182, 0.6)',
    particleType: 'wraith_ember',
  },
  4: {
    name: '심연의 용암 회랑 (Magma Hall)',
    rune: 'ᚱ',
    runeName: 'RHA (피와 대가)',
    narration: '네 번째 깊이, 피를 불로 바꾼 회랑. 제국의 찬란한 밤은 이름 없는 심장들을 태워 빛났다.',
    subtitle: '백성들의 영혼을 액화하여 검은 성배를 벼려내던 황실 지열 제련소',
    wall: '#4a2420',
    wallTop: '#6b342e',
    floor: '#220f0d',
    border: '#351815',
    fog: '#130807',
    ambientColor: 'rgba(230, 126, 34, 0.16)',
    particleColor: 'rgba(255, 120, 20, 0.65)',
    particleType: 'lava_spark',
  },
  5: {
    name: '공허의 옥좌 (Void Throne)',
    rune: 'ᛇ',
    runeName: 'EL (선택과 진명)',
    narration: '다섯 번째 깊이, 선택이 잠든 옥좌. 용은 천 년 동안 세계의 문을 막았고, 세계는 그를 괴물이라 기억했다.',
    subtitle: '뒤집힌 황실 알현실과 황제의 집착에 속박된 수호룡 녹티라크',
    wall: '#291b45',
    wallTop: '#3f2a6b',
    floor: '#100720',
    border: '#201238',
    fog: '#090511',
    ambientColor: 'rgba(190, 80, 255, 0.20)',
    particleColor: 'rgba(190, 80, 255, 0.6)',
    particleType: 'void_mote',
  },
};

// Abyss Chronicles Lore Catalog (Codex Tab - Full Lore Bible Spec)
const CHRONICLES_CATALOG = [
  {
    id: 'origin_abyss',
    category: 'origin',
    categoryLabel: '🏛️ 심연의 기원',
    title: '제1장: 무명시대와 네메시스 심연의 탄생',
    quote: '“빛이 닿지 않는 가능성들은 검은 바다가 되어 사람의 기억을 탐하기 시작했다.”',
    text: '세계가 굳지 않았던 무명시대, 창조신들은 태어나지 못한 생명, 선택되지 않은 미래, 불리지 못한 이름을 대지 아래에 묻었습니다. 이 잔여 의식들은 사람의 기억을 먹어 현실을 모방하는 검은 바다, 즉 네메시스 심연이 되었습니다. 신들은 심연 위에 다섯 겹의 봉인을 세우고, 별의 불에서 태어난 수호룡 녹티라크에게 마지막 문을 맡겼습니다.'
  },
  {
    id: 'origin_empire',
    category: 'origin',
    categoryLabel: '🏛️ 제국의 몰락',
    title: '제2장: 에레보스 황제와 검은 성배의 파멸',
    quote: '“딸을 살리겠다는 명분은 불멸의 제국을 향한 맹목적 탐욕으로 변질되었다.”',
    text: '수천 년 뒤 에레보스 제국의 마지막 황제 오렐리우스 3세는 역병으로 죽어가는 딸 리시아 공주를 살리기 위해 심연의 기억 재생력을 연구했습니다. 황제는 다섯 봉인을 행정·장례·생명·동력·왕권 시설로 위장해 훼손했고, 수만 백성의 영혼을 수호룡에게 접목하는 검은 성배 의식을 강행했습니다. 의식이 실패한 밤 수도 전체가 함몰되었고, 녹티라크는 수만 백성의 공포와 황제의 집착을 떠안은 채 섀도우 드레이크라는 괴수가 되었습니다.'
  },
  {
    id: 'hero_gawain',
    category: 'heroes',
    categoryLabel: '⚔️ 영웅 열전',
    title: '철벽의 기사 가웨인 (Gawain): 속죄와 진실의 방패',
    quote: '“오늘은 방패 뒤에 숨지 않는다. 에드릭 경, 늦었지만 당신의 이름을 돌려드리겠습니다.”',
    text: '빛의 서약 기사단의 수호자 가웨인은 과거 단장 에드릭이 반역자로 타락했다는 교단의 공식 기록을 믿고, 기사 명부 복원 사업에서 그의 이름을 제외하도록 결재한 장본인입니다. 그는 명령에 복종한 것을 충성이라 포장해 왔으나, 진실을 마주하기 위해 심연으로 내려왔습니다. 그의 방패는 동료를 지킬 뿐 아니라, 지워진 진실을 세상에 밝히는 굳건한 벽이 될 것입니다.'
  },
  {
    id: 'hero_valeria',
    category: 'heroes',
    categoryLabel: '⚔️ 영웅 열전',
    title: '그림자 암살자 발레리아 (Valeria): 폭로와 단죄의 쌍단검',
    quote: '“비밀은 묻히지 않아. 묻은 자를 기다릴 뿐. 용서를 바라지 않겠다. 네 이름은 남기겠다.”',
    text: '밤의 칼날단 최정예 암살자 발레리아는 길드를 심연에 팔아넘긴 의뢰주 "흰 가면"의 정체와 황실 계약 원본을 쫓고 있습니다. 그녀는 배신당한 생존자인 동시에, 과거 제국의 실험 증인들을 제거해 진실을 은폐했던 가해자이기도 합니다. 복수 뒤에 숨은 죄책감을 직시한 그녀는, 이제 진실을 폭로하여 어둠의 사슬을 영원히 끊어내고자 합니다.'
  },
  {
    id: 'hero_eldrian',
    category: 'heroes',
    categoryLabel: '⚔️ 영웅 열전',
    title: '공허의 현자 엘드리안 (Eldrian): 이해와 인간성의 지혜',
    quote: '“미지수는 공포가 아니다. 아직 듣지 못한 답이다. 정답이 우리를 구한 것이 아니라, 서로의 선택이 구했다.”',
    text: '별빛 아카데미의 대마법사 엘드리안은 심연의 팽창을 계산해 지상 붕괴까지 남은 시한 내에 차원 균열을 봉합하려 합니다. 그는 학문을 위해 감정을 배제해 왔고, 실종된 스승 세라피온의 구조 요청조차 단순 관측 자료로 취급했던 과거의 차가운 오만을 후회하고 있습니다. 그는 차가운 공식을 내려놓고, 불완전하지만 따뜻한 인간성의 선택으로 심연의 상처를 치유하려 합니다.'
  },
  {
    id: 'floor_b1',
    category: 'floors',
    categoryLabel: '🗺️ 층별 비록',
    title: 'B1F 잊혀진 납골당: 지워진 장례 명부와 NA 룬',
    quote: '“기억되는 한 두 번 죽지 않는다.”',
    text: '제국의 공동묘지이자 첫 번째 봉인 "이름"을 관리하던 장소입니다. 수도 함몰 당시 강물이 들이쳐 장례 명부의 먹물이 풀리면서 망자들은 이름을 잃어버렸습니다. 슬라임은 방부액에서, 역병 쥐는 장례선의 짐승에서 번식했습니다. 훼손된 명부의 빈 칸에 병사의 인장, 아이의 목마, 묘지기의 열쇠를 복원하면 첫 번째 룬 NA(기억)가 깨어납니다.'
  },
  {
    id: 'floor_b2',
    category: 'floors',
    categoryLabel: '🗺️ 층별 비록',
    title: 'B2F 독기 서린 버섯 동굴: 리시아의 온실과 ETH 룬',
    quote: '“포자는 죽은 이의 꿈을 피워 내고, 달콤한 향기 아래에서 기억은 썩어 간다.”',
    text: '황실 식물원과 기억 배양 연구소가 내려앉은 두 번째 봉인 "숨"의 계층입니다. 식물학자들은 어린 리시아 공주의 기억을 균사에 이식하려 했고, 포자는 연구원들의 마지막 감정을 계절처럼 되풀이 재생합니다. 온실 유리에는 공주가 그린 수호룡 녹티라크의 그림이 남아 있습니다. 정화의 불꽃을 밝혀 호흡을 다스리면 두 번째 룬 ETH(숨)를 얻게 됩니다.'
  },
  {
    id: 'floor_b3',
    category: 'floors',
    categoryLabel: '🗺️ 층별 비록',
    title: 'B3F 저주받은 해골 묘실: 에드릭의 비극과 KA 룬',
    quote: '“충성은 기록에서 반역이 되었고, 억울한 검은 아직 주인을 기다린다.”',
    text: '황실 영웅 묘역이자 세 번째 봉인 "맹세"의 층입니다. 기사단장 에드릭은 황제의 미친 의식을 저지하려 했으나 반역자로 조작되어 동료들과 생매장되었습니다. 사령술사들은 그의 분노를 봉인의 동력으로 악용했고, 천 년의 고통 끝에 그는 적과 아군을 구분하지 못하는 데스 나이트가 되었습니다. 판결문의 진실을 밝히고 투구를 벗기면 세 번째 룬 KA(맹세)가 해방됩니다.'
  },
  {
    id: 'floor_b4',
    category: 'floors',
    categoryLabel: '🗺️ 층별 비록',
    title: 'B4F 심연의 용암 회랑: 영혼 제련소와 RHA 룬',
    quote: '“제국의 찬란한 밤은 이름 없는 심장들을 태워 빛났다.”',
    text: '제국의 지열 동력로이자 네 번째 봉인 "피"의 층입니다. 황제는 시민들의 영혼을 액화하여 검은 성배로 보내는 거대한 용광로를 세웠습니다. 붉은 용암은 불탄 금속과 영혼 찌꺼기의 혼합물이며, 벽에 박힌 거대한 쇠사슬은 수호룡 녹티라크의 날개를 결박했던 구속구입니다. 사슬을 끊고 용광로를 냉각하면 네 번째 룬 RHA(피)를 제련할 수 있습니다.'
  },
  {
    id: 'floor_b5',
    category: 'floors',
    categoryLabel: '🗺️ 층별 비록',
    title: 'B5F 공허의 옥좌: 수호룡 녹티라크와 EL 룬',
    quote: '“용은 천 년 동안 세계의 문을 막았고, 세계는 그를 괴물이라 기억했다.”',
    text: '황실 알현실과 최초 봉인이 뒤집혀 맞붙은 다섯 번째 봉인 "선택"의 층입니다. 중력은 옥좌를 향하고, 부서진 궁전 잔해가 검은 바다 위에 떠 있습니다. 섀도우 드레이크의 가슴에는 황제의 사념이 기생하고 있으며, 왼쪽 뿔에는 어린 공주가 걸어 준 은방울이 매달려 있습니다. 마지막 봉인에서 왕관을 거부할 때 다섯 번째 룬 EL(선택)이 모습을 드러냅니다.'
  },
  {
    id: 'lore_runes',
    category: 'runes',
    categoryLabel: '🪨 고대 룬 문자',
    title: '다섯 애도의 룬과 수호룡의 진명 (NA·ETH·KA·RHA·EL)',
    quote: '“다섯 음절이 맞춰질 때, 괴물은 비로소 별의 수호자로 되돌아온다.”',
    text: '다섯 룬은 봉인의 열쇠인 동시에 수호룡 녹티라크의 진명을 이루는 음절입니다. NA(기억), ETH(숨), KA(맹세), RHA(피), EL(선택). 이 다섯 룬을 온전히 공명시켜 진명 \'NA-ETH-KA-RHA-EL\'을 완성할 때, 황제의 검은 성배와 수호룡을 분리하고 천 년 동안 괴물로 불린 존재에게 진정한 해방을 선물할 수 있습니다.'
  },
  {
    id: 'lore_endings',
    category: 'runes',
    categoryLabel: '🪨 윤회의 갈림길',
    title: '영혼의 성소와 두 개의 결말 (새로운 문지기 vs 이름을 돌려주는 새벽)',
    quote: '“마지막 승리는 괴물을 죽인 순간이 아니라, 그에게 선택을 돌려준 순간이어야 한다.”',
    text: '노멀 엔딩 《새로운 문지기》에서는 드레이크를 처치하여 평화를 얻지만 영웅 자신이 새 봉인의 파수꾼으로 남거나 불완전한 봉인에 갇히게 됩니다. 반면 다섯 비석을 모두 복원하고 에드릭을 구원하여 진명을 부르는 진엔딩 《이름을 돌려주는 새벽》에서는 황제의 의지를 분리해 녹티라크에게 자유를 되돌려주며, 성소의 사망과 부활이라는 저주받은 윤회를 영원히 종식시키게 됩니다.'
  }
];

// Monsters Catalog
const MONSTER_TEMPLATES = {
  slime: {
    name: '녹색 슬라임',
    char: 's',
    color: '#2ecc71',
    hp: 26,
    atk: 7,
    def: 1,
    exp: 16,
    gold: 6,
    souls: 2,
    minFloor: 1,
    desc: '던전의 유독한 점액질로 뭉쳐진 하급 마물.',
  },
  bat: {
    name: '심연의 박쥐',
    char: 'b',
    color: '#a55eea',
    hp: 20,
    atk: 9,
    def: 0,
    exp: 18,
    gold: 8,
    souls: 3,
    minFloor: 1,
    desc: '초음파로 먹이를 감지하고 급습하는 동굴 박쥐.',
  },
  rat: {
    name: '역병 쥐',
    char: 'r',
    color: '#fed330',
    hp: 24,
    atk: 8,
    def: 1,
    exp: 20,
    gold: 9,
    souls: 3,
    minFloor: 1,
    poisonChance: 0.25,
    desc: '물린 상처에 치명적인 독을 퍼뜨리는 심연의 쥐.',
  },
  goblin: {
    name: '고블린 독궁수',
    char: 'g',
    color: '#fa8231',
    hp: 44,
    atk: 12,
    def: 2,
    exp: 35,
    gold: 16,
    souls: 5,
    minFloor: 2,
    ranged: true,
    poisonChance: 0.25,
    desc: '원거리에서 독화살을 쏘아대는 교활한 고블린.',
  },
  spore: {
    name: '포자 분출체',
    char: 'p',
    color: '#26de81',
    hp: 38,
    atk: 11,
    def: 3,
    exp: 32,
    gold: 14,
    souls: 5,
    minFloor: 2,
    ranged: true,
    poisonChance: 0.4,
    desc: '주변에 독성 포자를 뿜어내는 기괴한 식물 마물.',
  },
  spider: {
    name: '동굴 맹독거미',
    char: 'x',
    color: '#eb3b5a',
    hp: 48,
    atk: 15,
    def: 2,
    exp: 42,
    gold: 20,
    souls: 6,
    minFloor: 2,
    poisonChance: 0.35,
    desc: '독니로 희생자를 중독시키는 거대 거미.',
  },
  skeleton: {
    name: '스켈레톤 가디언',
    char: 'k',
    color: '#d1d8e0',
    hp: 70,
    atk: 17,
    def: 5,
    exp: 55,
    gold: 26,
    souls: 8,
    minFloor: 3,
    desc: '녹슨 강철 방패와 검을 든 고대 묘지의 해골 파수꾼.',
  },
  necromancer: {
    name: '사령술사',
    char: 'N',
    color: '#8854d0',
    hp: 60,
    atk: 15,
    def: 3,
    exp: 72,
    gold: 36,
    souls: 14,
    minFloor: 3,
    ranged: true,
    isNecromancer: true,
    desc: '어둠의 비전으로 스켈레톤을 소환하는 타락한 마법사.',
  },
  death_knight: {
    name: '데스 나이트',
    char: 'K',
    color: '#fc5c65',
    hp: 230,
    atk: 24,
    def: 8,
    exp: 200,
    gold: 100,
    souls: 40,
    minFloor: 3,
    isMiniBoss: true,
    stunChance: 0.25,
    desc: '3층 묘실을 지배하는 불사의 흑기사 단장.',
  },
  imp: {
    name: '지옥불 임프',
    char: 'i',
    color: '#ff3838',
    hp: 64,
    atk: 20,
    def: 3,
    exp: 80,
    gold: 40,
    souls: 15,
    minFloor: 4,
    ranged: true,
    burnChance: 0.45,
    desc: '지옥불을 날려 적을 불사르는 화염 악마.',
  },
  hound: {
    name: '헬하운드',
    char: 'h',
    color: '#c56cf0',
    hp: 90,
    atk: 24,
    def: 4,
    exp: 95,
    gold: 48,
    souls: 18,
    minFloor: 4,
    burnChance: 0.3,
    desc: '심연의 용암에 길들여진 흉포한 불꽃 사냥개.',
  },
  golem: {
    name: '마그마 골렘',
    char: 'G',
    color: '#ff9f1a',
    hp: 150,
    atk: 28,
    def: 10,
    exp: 130,
    gold: 65,
    souls: 24,
    minFloor: 4,
    desc: '녹아내리는 고열 암석으로 뭉쳐진 거대한 수호 거수.',
  },
  void_hatchling: {
    name: '공허의 해츨링',
    char: 'd',
    color: '#a55eea',
    hp: 55,
    atk: 19,
    def: 4,
    exp: 55,
    gold: 25,
    souls: 10,
    minFloor: 5,
    desc: '드레이크의 숨결에서 태어난 공허의 새끼 용.',
  },
  boss: {
    name: '심연의 군주 섀도우 드레이크',
    char: 'D',
    color: '#e74c3c',
    hp: 550,
    atk: 32,
    def: 12,
    exp: 650,
    gold: 400,
    souls: 120,
    minFloor: 5,
    isBoss: true,
    ranged: true,
    desc: '심연 최심부 5층 옥좌를 지배하는 고대 암흑용.',
  },
  shop_guard: {
    name: '분노한 상인 그리드',
    char: '🧙',
    color: '#f39c12',
    hp: 300,
    atk: 28,
    def: 8,
    exp: 300,
    gold: 150,
    souls: 50,
    minFloor: 2,
    isBoss: true,
    desc: '도벽을 부린 자를 처단하기 위해 각성한 암시장의 거상.',
  },
  mimic: {
    name: '식인 미믹',
    char: 'M',
    color: '#e67e22',
    hp: 85,
    atk: 22,
    def: 4,
    exp: 80,
    gold: 45,
    souls: 15,
    minFloor: 1,
    isMimic: true,
    desc: '보물상자로 위장하여 방심한 모험가를 집어삼키는 흉포한 마물.',
  },
};

// Class Archetypes Definitions
const CLASS_DEFINITIONS = {
  warrior: {
    id: 'warrior',
    name: '철벽의 기사',
    title: '워리어',
    icon: '🗡️',
    baseMaxHp: 130,
    maxMp: 25,
    baseAtk: 14,
    baseDef: 6,
    baseCrit: 8,
    fov: 8,
    passiveDesc: '강철의 육체: 받는 모든 피해 15% 감소',
    startingWeapon: { id: 'wp_broadsword', name: '강철 브로드소드', type: 'weapon', icon: '⚔️', desc: '공격력 +8, 치명타 +4%', stats: { atk: 8, crit: 4 }, rarity: 'common' },
    startingArmor: { id: 'ar_chain', name: '기사의 사슬갑옷', type: 'armor', icon: '🛡️', desc: '방어력 +5, 최대 체력 +25', stats: { def: 5, maxHp: 25 }, rarity: 'common' },
    skills: [
      { id: 'power_strike', name: '강타', icon: '💥', cost: 8, desc: '인접한 적에게 2.4배 피해 및 1턴 기절' },
      { id: 'iron_bulwark', name: '철벽', icon: '🛡️', cost: 10, desc: '5턴간 피해를 35 흡수하는 보호막 생성' },
      { id: 'whirlwind', name: '휠윈드', icon: '🌪️', cost: 14, desc: '주변 8칸 모든 적에게 1.6배 광역 피해' },
      { id: 'battle_cry', name: '함성', icon: '📯', cost: 16, desc: '디버프 정화, 35 HP 회복, 6턴 공격력 +6' },
    ],
  },
  rogue: {
    id: 'rogue',
    name: '그림자 암살자',
    title: '도적',
    icon: '🥷',
    baseMaxHp: 95,
    maxMp: 35,
    baseAtk: 16,
    baseDef: 3,
    baseCrit: 25,
    fov: 8,
    passiveDesc: '은밀한 발걸음: 치명타율 +10%, 15% 확률로 공격 완전 회피',
    startingWeapon: { id: 'wp_dagger', name: '암살자의 쌍단검', type: 'weapon', icon: '🗡️', desc: '공격력 +9, 치명타 +12%', stats: { atk: 9, crit: 12 }, rarity: 'common' },
    startingArmor: { id: 'ar_leather', name: '그림자 가죽망토', type: 'armor', icon: '🥻', desc: '방어력 +3, 치명타 +5%', stats: { def: 3, crit: 5 }, rarity: 'common' },
    skills: [
      { id: 'viper_strike', name: '독침', icon: '🗡️', cost: 8, desc: '1.8배 피해 및 4턴간 맹독(턴당 8 피해)' },
      { id: 'shadow_step', name: '도약', icon: '👣', cost: 10, desc: '적 배후로 도약하여 100% 치명타 기습' },
      { id: 'toxin_bomb', name: '독안개', icon: '🧪', cost: 12, desc: '반경 2칸 내 모든 적 22 피해 & 중독' },
      { id: 'smoke_veil', name: '연막', icon: '💨', cost: 14, desc: '2턴간 100% 회피율 및 25 HP 회복' },
    ],
  },
  mage: {
    id: 'mage',
    name: '공허의 현자',
    title: '마법사',
    icon: '🧙‍♂️',
    baseMaxHp: 85,
    maxMp: 65,
    baseAtk: 11,
    baseDef: 2,
    baseCrit: 12,
    fov: 9,
    passiveDesc: '마력 순환: 매 턴 MP +1 자연 회복, 주문 데미지 +20%',
    startingWeapon: { id: 'wp_staff', name: '비전 마법봉', type: 'weapon', icon: '🪄', desc: '공격력 +7, 최대 마나 +20', stats: { atk: 7, maxMp: 20 }, rarity: 'common' },
    startingArmor: { id: 'ar_robe', name: '별빛 학자의 로브', type: 'armor', icon: '👘', desc: '방어력 +3, 최대 마나 +15', stats: { def: 3, maxMp: 15 }, rarity: 'common' },
    skills: [
      { id: 'fireball', name: '화염구', icon: '🔥', cost: 10, desc: '원거리 36 화염 피해 및 3턴 화상' },
      { id: 'blizzard', name: '눈보라', icon: '❄️', cost: 16, desc: '시야 내 모든 적 2턴 빙결 & 26 피해' },
      { id: 'arcane_warp', name: '왜곡', icon: '🌀', cost: 12, desc: '안전한 위치로 순간이동 & 18 충격파' },
      { id: 'celestial_heal', name: '치유', icon: '✨', cost: 18, desc: '55 HP 즉시 회복 및 상태이상 완치' },
    ],
  },
};

// Item Catalog
const ITEM_CATALOG = [
  // Consumables
  { id: 'hp_pot', name: '치유 물약', type: 'potion', icon: '🧪', desc: '체력을 45 회복합니다.', effect: { healHp: 45 }, rarity: 'common' },
  { id: 'mp_pot', name: '마나 물약', type: 'potion', icon: '🍶', desc: '마나를 30 회복합니다.', effect: { healMp: 30 }, rarity: 'common' },
  { id: 'antidote', name: '성스러운 해독제', type: 'potion', icon: '🍵', desc: '모든 상태이상을 해제하고 20 HP를 회복합니다.', effect: { healHp: 20, cleanse: true }, rarity: 'common' },
  { id: 'elixir', name: '영웅의 엘릭서', type: 'potion', icon: '🍷', desc: '체력 100, 마나 60을 즉시 회복합니다.', effect: { healHp: 100, healMp: 60, cleanse: true }, rarity: 'rare' },
  { id: 'invisibility_pot', name: '투명화 물약', type: 'potion', icon: '🧪', desc: '4턴 동안 투명화되어 적이 플레이어를 감지하지 못합니다.', effect: { invisibility: 4 }, rarity: 'rare', shopPrice: 60 },
  { id: 'invulnerability_pot', name: '무적 물약', type: 'potion', icon: '🧪', desc: '3턴 동안 모든 피해를 무효화합니다.', effect: { invulnerable: 3 }, rarity: 'epic', shopPrice: 110 },
  { id: 'blast_bomb', name: '폭발 폭탄', type: 'bomb', icon: '💣', desc: '벽의 균열을 파괴할 수 있는 강력한 폭탄입니다.', effect: { wallDamage: 99 }, rarity: 'common', shopPrice: 25 },

  // Spell Scrolls
  { id: 'sc_fire', name: '화염구 스크롤', type: 'scroll', icon: '📜', desc: '시야 내 모든 적에게 45의 화염 피해를 입힙니다.', effect: { aoeDamage: 45, applyBurn: true }, rarity: 'rare' },
  { id: 'sc_tele', name: '전위 스크롤', type: 'scroll', icon: '🌀', desc: '던전의 안전한 빈 방으로 즉시 순간이동합니다.', effect: { teleport: true }, rarity: 'common' },
  { id: 'sc_bless', name: '성소의 축복서', type: 'scroll', icon: '✨', desc: '8턴간 보호막 40 및 공격력 +6을 얻습니다.', effect: { buffShield: 40, buffAtk: 6, buffTurns: 8 }, rarity: 'epic' },

  // Weapons
  { id: 'wp_iron', name: '녹슨 숏소드', type: 'weapon', icon: '🗡️', desc: '공격력 +5, 치명타 +2%', stats: { atk: 5, crit: 2 }, rarity: 'common' },
  { id: 'wp_broadsword', name: '강철 브로드소드', type: 'weapon', icon: '⚔️', desc: '공격력 +8, 치명타 +4%', stats: { atk: 8, crit: 4 }, rarity: 'common' },
  { id: 'wp_rapier', name: '은빛 세검', type: 'weapon', icon: '🤺', desc: '공격력 +12, 치명타 +12%', stats: { atk: 12, crit: 12 }, rarity: 'rare' },
  { id: 'wp_drake', name: '용살자의 대검', type: 'weapon', icon: '🔱', desc: '공격력 +25, 치명타 +18%', stats: { atk: 25, crit: 18 }, rarity: 'legendary' },

  // Armors
  { id: 'ar_leather', name: '그림자 가죽망토', type: 'armor', icon: '🥻', desc: '방어력 +3, 치명타 +5%', stats: { def: 3, crit: 5 }, rarity: 'common' },
  { id: 'ar_chain', name: '기사의 사슬갑옷', type: 'armor', icon: '🛡️', desc: '방어력 +5, 최대 체력 +25', stats: { def: 5, maxHp: 25 }, rarity: 'common' },
  { id: 'ar_mithril', name: '미스릴 플레이트', type: 'armor', icon: '🎽', desc: '방어력 +12, 최대 체력 +55', stats: { def: 12, maxHp: 55 }, rarity: 'rare' },
  { id: 'ar_dragon', name: '드래곤 스케일 아머', type: 'armor', icon: '🐲', desc: '방어력 +18, 최대 체력 +90', stats: { def: 18, maxHp: 90 }, rarity: 'legendary' },

  // Rings
  { id: 'rg_vital', name: '생명의 반지', type: 'ring', icon: '💍', desc: '최대 체력 +40', stats: { maxHp: 40 }, rarity: 'rare' },
  { id: 'rg_mana', name: '비전의 인장 반지', type: 'ring', icon: '🔮', desc: '최대 마나 +25, 공격력 +4', stats: { maxMp: 25, atk: 4 }, rarity: 'rare' },
  { id: 'rg_might', name: '패왕의 반지', type: 'ring', icon: '💎', desc: '공격력 +7, 방어력 +4, 치명타 +6%', stats: { atk: 7, def: 4, crit: 6 }, rarity: 'epic' },
];

// Relics Catalog
const RELIC_CATALOG = [
  { id: 'vampire_fang', name: '흡혈의 송곳니', icon: '🧛', desc: '치명타 적중 시 입힌 피해의 25%만큼 체력을 회복합니다.', shopPrice: 160 },
  { id: 'mana_core', name: '마력 핵', icon: '💠', desc: '몬스터를 처치할 때마다 MP를 4 즉시 회복합니다.', shopPrice: 160 },
  { id: 'golden_scarab', name: '황금 풍뎅이', icon: '🪲', desc: '몬스터가 드롭하는 골드가 50% 증가합니다.', shopPrice: 160 },
  { id: 'phoenix_feather', name: '불사조의 깃털', icon: '🪶', desc: '사망 시 1회에 한하여 최대 체력의 50%로 즉시 부활합니다.', shopPrice: 160 },
  { id: 'thorn_cloak', name: '가시 망토', icon: '🦔', desc: '근접 공격을 받을 때마다 적에게 8의 반사 피해를 입힙니다.', shopPrice: 160 },
  // U-04 Relic Synergies Additions
  { id: 'void_talisman', name: '공허의 부적', icon: '🧿', desc: '공허의 기운을 담은 부적. 암흑 제국의 유산 세트 유물.', shopPrice: 160 },
  { id: 'emperor_signet', name: '황제의 인장', icon: '👑', desc: '고대 에레보스 황실의 인장. 암흑 제국의 유산 세트 유물.', shopPrice: 160 },
  { id: 'sun_medal', name: '태양의 메달', icon: '☀️', desc: '꺼지지 않는 여명의 불꽃. 불사조의 맹세 세트 유물.', shopPrice: 160 },
  { id: 'blood_chalice', name: '피의 성배', icon: '🍷', desc: '치명타 적중 시 적에게 2턴간 출혈(턴당 4 피해)을 부여합니다. 흡혈귀의 연회 세트 유물.', shopPrice: 160 },
];

// Relic 2-Set Synergies Catalog (U-04)
const RELIC_SYNERGY_CATALOG = Object.freeze([
  {
    id: 'dark_empire_legacy',
    name: '암흑 제국의 유산',
    requiredRelicIds: ['void_talisman', 'emperor_signet'],
    threshold: 2,
    description: '공격 적중 시 20% 확률로 15 암흑 추가 피해',
  },
  {
    id: 'phoenix_oath',
    name: '불사조의 맹세',
    requiredRelicIds: ['phoenix_feather', 'sun_medal'],
    threshold: 2,
    description: '부활 시 HP 100%, 주변 모든 적에게 50 화염 피해',
  },
  {
    id: 'vampire_feast',
    name: '흡혈귀의 연회',
    requiredRelicIds: ['vampire_fang', 'blood_chalice'],
    threshold: 2,
    description: '출혈 중인 적 대상 흡혈량 2배',
  },
]);

/**
 * 보유 유물에 따라 활성화된 시너지 ID Set을 반환한다.
 * @param {Iterable<string>} ownedRelicIds
 * @returns {Set<string>}
 */
function computeActiveSynergies(ownedRelicIds) {
  const owned = ownedRelicIds instanceof Set ? ownedRelicIds : new Set(ownedRelicIds);
  const active = new Set();
  for (const syn of RELIC_SYNERGY_CATALOG) {
    if (syn.requiredRelicIds.every((id) => owned.has(id))) {
      active.add(syn.id);
    }
  }
  return active;
}

/**
 * 현재 런의 보유 유물과 층을 반영하되 게임 상태를 변경하지 않는다.
 * @param {number} floorNumber
 * @param {{ownedRelicIds?:Set<string>, rng?:()=>number}} context
 * @returns {ShopOffer[]}
 */
function createMerchantStock(floorNumber, { ownedRelicIds = new Set(), rng = Math.random } = {}) {
  const stock = [];
  const pickedIds = new Set();

  function getPrice(entry, isRelic) {
    if (entry.shopPrice) return entry.shopPrice;
    if (isRelic) return 160;
    switch (entry.rarity) {
      case 'legendary': return 180;
      case 'epic': return 110;
      case 'rare': return 60;
      case 'common':
      default: return 25;
    }
  }

  // 1. Unowned relics candidate pool
  const unownedRelics = RELIC_CATALOG.filter((r) => !ownedRelicIds.has(r.id));
  const availableRelics = [...unownedRelics];

  // At least 1 unowned relic if available
  if (availableRelics.length > 0) {
    const idx = Math.floor(rng() * availableRelics.length);
    const chosenRelic = availableRelics.splice(idx, 1)[0];
    pickedIds.add(chosenRelic.id);
    stock.push({
      offerId: `offer_${floorNumber}_${stock.length}_${chosenRelic.id}`,
      kind: 'relic',
      catalogId: chosenRelic.id,
      price: getPrice(chosenRelic, true),
      sold: false,
    });
  }

  // 2. Guaranteed consumable/potion/bomb
  const consumables = ITEM_CATALOG.filter((i) => (i.type === 'potion' || i.type === 'bomb' || i.type === 'scroll') && !pickedIds.has(i.id));
  if (consumables.length > 0) {
    const idx = Math.floor(rng() * consumables.length);
    const chosen = consumables[idx];
    pickedIds.add(chosen.id);
    stock.push({
      offerId: `offer_${floorNumber}_${stock.length}_${chosen.id}`,
      kind: 'item',
      catalogId: chosen.id,
      price: getPrice(chosen, false),
      sold: false,
    });
  }

  // 3. Fill the remaining up to SHOP_RULES.offersPerShop (5)
  const remainingCandidates = [];
  availableRelics.forEach((r) => {
    if (!pickedIds.has(r.id)) remainingCandidates.push({ kind: 'relic', entry: r });
  });
  ITEM_CATALOG.forEach((item) => {
    if (!pickedIds.has(item.id)) remainingCandidates.push({ kind: 'item', entry: item });
  });

  while (stock.length < SHOP_RULES.offersPerShop && remainingCandidates.length > 0) {
    const idx = Math.floor(rng() * remainingCandidates.length);
    const picked = remainingCandidates.splice(idx, 1)[0];
    pickedIds.add(picked.entry.id);
    stock.push({
      offerId: `offer_${floorNumber}_${stock.length}_${picked.entry.id}`,
      kind: picked.kind,
      catalogId: picked.entry.id,
      price: getPrice(picked.entry, picked.kind === 'relic'),
      sold: false,
    });
  }

  return stock;
}

// Shrines Catalog
const SHRINE_TEMPLATES = [
  {
    type: 'blood_altar',
    name: '피의 제단 (Blood Altar)',
    icon: '🩸',
    lore: '고대 제단에서 어두운 피의 기운이 피어오릅니다. 당신의 생명력을 대가로 미지의 힘을 제안합니다.',
    choices: [
      { text: '생명력 25를 바쳐 영구 공격력 +4 획득', hpCost: 25, grantAtk: 4 },
      { text: '생명력 40을 바쳐 전설급 장비 1종 소환', hpCost: 40, grantItem: 'ar_dragon' },
    ],
  },
  {
    type: 'fountain_of_life',
    name: '생명의 샘 (Fountain of Life)',
    icon: '⛲',
    lore: '푸른 빛을 내뿜는 맑은 샘물이 솟아납니다. 지친 영혼과 육신을 온전히 정화할 수 있습니다.',
    choices: [
      { text: '성수를 마셔 HP & MP 완전 회복 및 상태이상 완치', fullHeal: true },
      { text: '성수를 병에 담아 영웅의 엘릭서 1개 획득', grantItem: 'elixir' },
    ],
  },
  {
    type: 'obelisk_of_souls',
    name: '영혼의 비석 (Obelisk of Souls)',
    icon: '🔮',
    lore: '수많은 심연 방랑자들의 영혼이 속삭이는 신비로운 고대 비석입니다.',
    choices: [
      { text: '영혼의 조각 35개를 성소로 즉시 회수', grantSouls: 35 },
      { text: '비석의 공명으로 무작위 유물 1종 획득', grantRandomRelic: true },
    ],
  },
  {
    type: 'blacksmith_anvil',
    name: '드워프의 모루 (Blacksmith Anvil)',
    icon: '🔨',
    lore: '지하 깊은 곳 대장장이의 불꽃이 모루 위에 아직 은은하게 타오르고 있습니다.',
    choices: [
      { text: '주 무기를 벼려 기본 공격력 +3 강화', grantAtk: 3 },
      { text: '방어구를 단련하여 기본 방어력 +2 & 체력 +20 강화', grantDef: 2, grantMaxHp: 20 },
    ],
  },
];

// Traps Catalog
const TRAP_TEMPLATES = [
  { type: 'spike', name: '가시 함정', icon: '⚙️', dmg: 14, status: 'stun', statusTurns: 1, desc: '날카로운 가시가 솟구쳐 피해와 기절을 입힙니다.' },
  { type: 'gas', name: '독가스 분출구', icon: '🧪', dmg: 8, status: 'poison', statusTurns: 3, statusVal: 6, desc: '유독한 가스가 뿜어져 나와 중독 피해를 줍니다.' },
  { type: 'mana_rune', name: '마력 폭주 룬', icon: '⚡', dmg: 12, manaDrain: 15, desc: '번개 룬이 방전되어 마나를 소각합니다.' },
];

// =============================================================================
// 3. Dungeon Map & Generation
// =============================================================================
class DungeonFloor {
  constructor(floorNumber) {
    this.floorNumber = floorNumber;
    this.width = MAP_WIDTH;
    this.height = MAP_HEIGHT;
    this.tiles = []; // 0: Wall, 1: Floor
    this.explored = [];
    this.visible = [];
    this.rooms = [];
    this.stairsPos = { x: 0, y: 0 };
    this.playerStart = { x: 0, y: 0 };
    this.shrines = [];
    this.traps = [];
    this.secretRooms = [];
    this.crackedWalls = [];
    this.chests = [];
    this.merchant = null;

    this.generate();
  }

  generate() {
    this.tiles = Array.from({ length: this.height }, () => Array(this.width).fill(0));
    this.explored = Array.from({ length: this.height }, () => Array(this.width).fill(false));
    this.visible = Array.from({ length: this.height }, () => Array(this.width).fill(false));

    if (typeof ROT !== 'undefined' && ROT.Map && ROT.Map.Digger) {
      const digger = new ROT.Map.Digger(this.width, this.height, {
        roomWidth: [5, 11],
        roomHeight: [4, 9],
        corridorLength: [2, 6],
        dugPercentage: 0.28,
      });

      digger.create((x, y, value) => {
        this.tiles[y][x] = value === 0 ? 1 : 0;
      });

      const rotRooms = digger.getRooms();
      this.rooms = rotRooms.map((r) => ({
        x1: r.getLeft(),
        y1: r.getTop(),
        x2: r.getRight(),
        y2: r.getBottom(),
        cx: Math.floor((r.getLeft() + r.getRight()) / 2),
        cy: Math.floor((r.getTop() + r.getBottom()) / 2),
      }));
    } else {
      this.generateFallbackRooms();
    }

    if (this.rooms.length > 0) {
      const startRoom = this.rooms[0];
      this.playerStart = { x: startRoom.cx, y: startRoom.cy };

      const endRoom = this.rooms[this.rooms.length - 1];
      this.stairsPos = { x: endRoom.cx, y: endRoom.cy };
    } else {
      this.playerStart = { x: Math.floor(this.width / 2), y: Math.floor(this.height / 2) };
      this.stairsPos = { x: this.playerStart.x + 5, y: this.playerStart.y + 5 };
      this.tiles[this.playerStart.y][this.playerStart.x] = 1;
      this.tiles[this.stairsPos.y][this.stairsPos.x] = 1;
    }

    this.placeShrinesAndTraps();
  }

  generateSecretRoom(rng = Math.random) {
    if (this.floorNumber >= 5) return null;
    if (this.secretRooms.length >= FEATURE_RULES.maxSecretRoomsPerFloor) return null;
    if (rng() >= FEATURE_RULES.secretRoomChance) return null;

    const rw = 4;
    const rh = 4;
    const candidates = [];

    for (let y = 3; y < this.height - rh - 3; y += 2) {
      for (let x = 3; x < this.width - rw - 3; x += 2) {
        let allWalls = true;
        for (let ry = y; ry < y + rh; ry++) {
          for (let rx = x; rx < x + rw; rx++) {
            if (this.tiles[ry][rx] !== 0) {
              allWalls = false;
              break;
            }
          }
          if (!allWalls) break;
        }
        if (!allWalls) continue;

        const connections = [];

        // Check top edge
        for (let rx = x; rx < x + rw; rx++) {
          if (this.tiles[y - 1]?.[rx] === 0 && this.tiles[y - 2]?.[rx] === 1) {
            connections.push({ ex: rx, ey: y - 1 });
          }
        }
        // Check bottom edge
        for (let rx = x; rx < x + rw; rx++) {
          if (this.tiles[y + rh]?.[rx] === 0 && this.tiles[y + rh + 1]?.[rx] === 1) {
            connections.push({ ex: rx, ey: y + rh });
          }
        }
        // Check left edge
        for (let ry = y; ry < y + rh; ry++) {
          if (this.tiles[ry]?.[x - 1] === 0 && this.tiles[ry]?.[x - 2] === 1) {
            connections.push({ ex: x - 1, ey: ry });
          }
        }
        // Check right edge
        for (let ry = y; ry < y + rh; ry++) {
          if (this.tiles[ry]?.[x + rw] === 0 && this.tiles[ry]?.[x + rw + 1] === 1) {
            connections.push({ ex: x + rw, ey: ry });
          }
        }

        if (connections.length === 1) {
          candidates.push({ x, y, entrance: connections[0] });
        }
      }
    }

    if (candidates.length === 0) return null;

    const chosen = candidates[Math.floor(rng() * candidates.length)];
    const x1 = chosen.x;
    const y1 = chosen.y;
    const x2 = chosen.x + rw - 1;
    const y2 = chosen.y + rh - 1;

    for (let ry = y1; ry <= y2; ry++) {
      for (let rx = x1; rx <= x2; rx++) {
        this.tiles[ry][rx] = 1;
      }
    }
    this.tiles[chosen.entrance.ey][chosen.entrance.ex] = 0;

    const srId = `secret_room_f${this.floorNumber}_${this.secretRooms.length}`;
    const secretRoom = {
      id: srId,
      x1,
      y1,
      x2,
      y2,
      entrance: { x: chosen.entrance.ex, y: chosen.entrance.ey },
      revealed: false,
      lootClaimed: false,
    };

    const crackedWall = {
      id: `cracked_wall_f${this.floorNumber}_${this.crackedWalls.length}`,
      x: chosen.entrance.ex,
      y: chosen.entrance.ey,
      hp: 1,
      revealed: false,
      destroyed: false,
      secretRoomId: srId,
    };

    const chest = {
      id: `chest_secret_f${this.floorNumber}`,
      x: Math.floor((x1 + x2) / 2),
      y: Math.floor((y1 + y2) / 2),
      source: 'secret',
      opened: false,
      resolved: false,
      mimicRoll: null,
    };

    this.secretRooms.push(secretRoom);
    this.crackedWalls.push(crackedWall);
    this.chests.push(chest);

    return secretRoom;
  }

  placeMerchant({ ownedRelicIds = new Set(), rng = Math.random } = {}) {
    if (!FEATURE_RULES.merchantFloors.includes(this.floorNumber)) {
      this.merchant = null;
      return null;
    }

    const eligibleRooms = this.rooms.filter((r, idx) => idx > 0 && idx < this.rooms.length - 1);
    const room = eligibleRooms.length > 0
      ? eligibleRooms[Math.floor(rng() * eligibleRooms.length)]
      : (this.rooms.length > 1 ? this.rooms[1] : this.rooms[0]);

    if (!room) return null;

    let mx = room.cx;
    let my = room.cy;

    if (this.isTileReserved(mx, my)) {
      for (let ry = room.y1 + 1; ry < room.y2; ry++) {
        for (let rx = room.x1 + 1; rx < room.x2; rx++) {
          if (this.tiles[ry]?.[rx] === 1 && !this.isTileReserved(rx, ry)) {
            mx = rx;
            my = ry;
            break;
          }
        }
      }
    }

    const stock = createMerchantStock(this.floorNumber, { ownedRelicIds, rng });
    this.merchant = {
      id: `merchant_b${this.floorNumber}`,
      floorNumber: this.floorNumber,
      x: mx,
      y: my,
      state: 'friendly',
      theftAttempted: false,
      stock,
    };

    return this.merchant;
  }

  placeTreasureChests(rng = Math.random) {
    if (this.floorNumber >= 5) return;
    const count = this.floorNumber === 1 ? 1 : 2;
    const eligibleRooms = this.rooms.filter((r, idx) => idx > 0 && idx < this.rooms.length - 1);

    for (let i = 0; i < count && eligibleRooms.length > 0; i++) {
      const room = eligibleRooms[(i + Math.floor(rng() * eligibleRooms.length)) % eligibleRooms.length];
      const tx = Math.floor(rng() * (room.x2 - room.x1 - 2)) + room.x1 + 1;
      const ty = Math.floor(rng() * (room.y2 - room.y1 - 2)) + room.y1 + 1;

      if (this.tiles[ty]?.[tx] === 1 && !this.isTileReserved(tx, ty)) {
        this.chests.push({
          id: `chest_norm_f${this.floorNumber}_${this.chests.length}`,
          x: tx,
          y: ty,
          source: 'normal',
          opened: false,
          resolved: false,
          mimicRoll: null,
        });
      }
    }
  }

  isTileReserved(x, y) {
    if (this.stairsPos && x === this.stairsPos.x && y === this.stairsPos.y) return true;
    if (this.playerStart && x === this.playerStart.x && y === this.playerStart.y) return true;
    if (this.shrines && this.shrines.some((s) => s.x === x && s.y === y)) return true;
    if (this.traps && this.traps.some((t) => t.x === x && t.y === y)) return true;
    if (this.merchant && this.merchant.x === x && this.merchant.y === y) return true;
    if (this.chests && this.chests.some((c) => c.x === x && c.y === y)) return true;
    if (this.crackedWalls && this.crackedWalls.some((w) => w.x === x && w.y === y)) return true;
    return false;
  }

  isWalkable(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
    const wall = this.crackedWalls?.find((w) => w.x === x && w.y === y && !w.destroyed);
    if (wall) return false;
    const chest = this.chests?.find((c) => c.x === x && c.y === y && !c.opened);
    if (chest) return false;
    const merchant = this.merchant && this.merchant.x === x && this.merchant.y === y && this.merchant.state === 'friendly';
    if (merchant) return false;
    return this.tiles[y][x] === 1;
  }

  isOpaque(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return true;
    const wall = this.crackedWalls?.find((w) => w.x === x && w.y === y && !w.destroyed);
    if (wall) return true;
    if (this.secretRooms && this.secretRooms.length > 0) {
      for (const sr of this.secretRooms) {
        if (!sr.revealed && x >= sr.x1 && x <= sr.x2 && y >= sr.y1 && y <= sr.y2) {
          return true;
        }
      }
    }
    return this.tiles[y][x] === 0;
  }

  getCrackedWallAt(x, y) {
    return this.crackedWalls ? this.crackedWalls.find((w) => w.x === x && w.y === y && !w.destroyed) : null;
  }

  getChestAt(x, y) {
    return this.chests ? this.chests.find((c) => c.x === x && c.y === y) : null;
  }

  generateFallbackRooms() {
    const numRooms = 8;
    this.rooms = [];

    for (let i = 0; i < numRooms; i++) {
      const rw = Math.floor(Math.random() * 6) + 5;
      const rh = Math.floor(Math.random() * 5) + 4;
      const rx = Math.floor(Math.random() * (this.width - rw - 4)) + 2;
      const ry = Math.floor(Math.random() * (this.height - rh - 4)) + 2;

      for (let y = ry; y < ry + rh; y++) {
        for (let x = rx; x < rx + rw; x++) {
          this.tiles[y][x] = 1;
        }
      }

      const newRoom = {
        x1: rx, y1: ry, x2: rx + rw, y2: ry + rh,
        cx: Math.floor(rx + rw / 2),
        cy: Math.floor(ry + rh / 2),
      };

      if (this.rooms.length > 0) {
        const prev = this.rooms[this.rooms.length - 1];
        let cx = prev.cx;
        let cy = prev.cy;

        while (cx !== newRoom.cx) {
          this.tiles[cy][cx] = 1;
          cx += cx < newRoom.cx ? 1 : -1;
        }
        while (cy !== newRoom.cy) {
          this.tiles[cy][cx] = 1;
          cy += cy < newRoom.cy ? 1 : -1;
        }
      }

      this.rooms.push(newRoom);
    }
  }

  placeShrinesAndTraps() {
    this.shrines = [];
    this.traps = [];

    // 1 Shrine per floor (except Floor 5 Boss Floor)
    if (this.floorNumber < 5 && this.rooms.length > 2) {
      const shrineRoomIdx = Math.floor(this.rooms.length / 2);
      const room = this.rooms[shrineRoomIdx];
      const tmpl = SHRINE_TEMPLATES[Math.floor(Math.random() * SHRINE_TEMPLATES.length)];
      this.shrines.push({
        ...tmpl,
        x: room.cx,
        y: room.cy,
        used: false,
      });
    }

    // 2~4 Traps per floor
    const trapCount = Math.min(4, Math.floor(this.floorNumber * 1.2) + 1);
    for (let i = 1; i < this.rooms.length - 1; i++) {
      if (this.traps.length >= trapCount) break;
      const room = this.rooms[i];
      const tx = Math.floor(Math.random() * (room.x2 - room.x1 - 2)) + room.x1 + 1;
      const ty = Math.floor(Math.random() * (room.y2 - room.y1 - 2)) + room.y1 + 1;

      if (this.isWalkable(tx, ty) && !(tx === this.playerStart.x && ty === this.playerStart.y)) {
        const tmpl = TRAP_TEMPLATES[Math.floor(Math.random() * TRAP_TEMPLATES.length)];
        this.traps.push({
          ...tmpl,
          x: tx,
          y: ty,
          revealed: false,
        });
      }
    }
  }

  calculateFOV(px, py, radius = 8) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.visible[y][x] = false;
      }
    }

    if (typeof ROT !== 'undefined' && ROT.FOV && ROT.FOV.PreciseShadowcasting) {
      const fov = new ROT.FOV.PreciseShadowcasting((x, y) => {
        return !this.isOpaque(x, y);
      });

      fov.compute(px, py, radius, (x, y, r, visibility) => {
        if (x >= 0 && x < this.width && y >= 0 && y < this.height && visibility > 0) {
          this.visible[y][x] = true;
          this.explored[y][x] = true;
        }
      });
    } else {
      for (let a = 0; a < 360; a += 3) {
        const rad = (a * Math.PI) / 180;
        const dx = Math.cos(rad);
        const dy = Math.sin(rad);

        let currX = px;
        let currY = py;

        for (let r = 0; r <= radius; r++) {
          const tx = Math.round(currX);
          const ty = Math.round(currY);

          if (tx >= 0 && tx < this.width && ty >= 0 && ty < this.height) {
            this.visible[ty][tx] = true;
            this.explored[ty][tx] = true;
            if (this.isOpaque(tx, ty)) break;
          }

          currX += dx;
          currY += dy;
        }
      }
    }
  }
}

// =============================================================================
// 4. Main Roguelite Game Controller
// =============================================================================
class RogueliteGame {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.minimapCanvas = document.getElementById('minimapCanvas');
    this.minimapCtx = this.minimapCanvas.getContext('2d');

    this.audio = new RetroAudioEngine();

    // State Machine: 'PLAYING' | 'VICTORY' | 'GAME_OVER' | 'LEVEL_UP' | 'SHRINE_EVENT' | 'CLASS_SELECT'
    this.gameState = 'PLAYING';

    // Current Class
    this.selectedClassId = 'warrior';

    // Persistent Roguelite Meta-Upgrades
    this.metaData = this.loadMetaData();

    // Session State
    this.floorNumber = 1;
    this.turns = 1;
    this.kills = 0;
    this.dungeon = null;
    this.monsters = [];
    this.itemsOnFloor = [];
    this.floatingTexts = [];
    this.particles = [];
    this.relics = [];
    this.bossEnraged = false;
    this.phoenixUsed = false;
    this.bossDialogueSeen = { floor3: false, floor5_start: false, floor5_enrage: false };
    this.floorBannerTimer = null;
    this.bossDialogueTimer = null;
    this.ambientParticleTimer = 0;

    // Active Shrine Event Data
    this.currentShrine = null;

    // Viewport Camera & Torchlight
    this.camera = { x: 0, y: 0 };
    this.ambientTorchTime = 0;

    // Player Object
    this.player = null;

    this.initDOM();
    this.startNewRun('warrior');

    this.lastFrameTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  loadMetaData() {
    const defaultMeta = {
      souls: 0,
      upgrades: {
        maxHp: 0,
        atk: 0,
        def: 0,
        soulBoost: 0,
      },
      bestiary: {},
    };

    const saved = localStorage.getItem('DOTA_ROGUELITE_DATA_V2') || localStorage.getItem('DOTA_ROGUELITE_DATA');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          souls: Number(parsed.souls) || 0,
          upgrades: {
            maxHp: Number(parsed.upgrades?.maxHp) || 0,
            atk: Number(parsed.upgrades?.atk) || 0,
            def: Number(parsed.upgrades?.def) || 0,
            soulBoost: Number(parsed.upgrades?.soulBoost) || 0,
          },
          bestiary: parsed.bestiary || {},
        };
      } catch {
        return defaultMeta;
      }
    }
    return defaultMeta;
  }

  saveMetaData() {
    localStorage.setItem('DOTA_ROGUELITE_DATA_V2', JSON.stringify(this.metaData));
    this.updateHUD();
  }

  startNewRun(classId = 'warrior') {
    this.gameState = 'PLAYING';
    this.selectedClassId = classId;
    this.floorNumber = 1;
    this.turns = 1;
    this.kills = 0;
    this.bossEnraged = false;
    this.phoenixUsed = false;
    this.bossDialogueSeen = { floor3: false, floor5_start: false, floor5_enrage: false };
    this.relics = [];
    this.particles = [];
    this.floatingTexts = [];

    const classData = CLASS_DEFINITIONS[classId] || CLASS_DEFINITIONS.warrior;

    // Permanent Meta Buffs
    const bonusHp = this.metaData.upgrades.maxHp * 15;
    const bonusAtk = this.metaData.upgrades.atk * 3;
    const bonusDef = this.metaData.upgrades.def * 2;

    this.player = {
      x: 0,
      y: 0,
      classId: classData.id,
      name: classData.name,
      title: classData.title,
      icon: classData.icon,
      level: 1,
      exp: 0,
      maxExp: 50,
      baseMaxHp: classData.baseMaxHp + bonusHp,
      hp: classData.baseMaxHp + bonusHp,
      baseMaxMp: classData.maxMp,
      maxMp: classData.maxMp,
      mp: classData.maxMp,
      baseAtk: classData.baseAtk + bonusAtk,
      baseDef: classData.baseDef + bonusDef,
      baseCrit: classData.baseCrit,
      fov: classData.fov,
      gold: 0,
      runSouls: 0,
      statusEffects: {
        burn: 0,
        poison: 0,
        freeze: 0,
        stun: 0,
        shield: 0,
        atkBuff: 0,
        dodge: 0,
      },
      equipment: {
        weapon: { ...classData.startingWeapon },
        armor: { ...classData.startingArmor },
        ring: null,
      },
      inventory: [
        { ...ITEM_CATALOG.find((i) => i.id === 'hp_pot'), qty: 2 },
        { ...ITEM_CATALOG.find((i) => i.id === 'mp_pot'), qty: 1 },
      ],
      skills: classData.skills,
    };

    // Ensure HP matches derived max
    this.player.hp = this.getTotalMaxHp();

    // Update Player Avatar & Profile in DOM
    const avatarEl = document.getElementById('hudPlayerAvatar');
    const nameEl = document.getElementById('hudPlayerName');
    const classEl = document.getElementById('hudPlayerClass');
    if (avatarEl) avatarEl.textContent = classData.icon;
    if (nameEl) nameEl.textContent = classData.name;
    if (classEl) classEl.textContent = classData.title;

    this.updateSkillButtons();
    this.updateRelicsUI();
    this.loadFloor(1);
    this.log(`🎭 [${classData.name}] 영웅이 심연 1층의 어둠에 강하했습니다.`, 'log-system');
  }

  updateSkillButtons() {
    const skills = this.player.skills;
    for (let i = 0; i < 4; i++) {
      const sk = skills[i];
      const btn = document.getElementById(`btnSkill${i + 1}`);
      const icon = document.getElementById(`iconSkill${i + 1}`);
      const name = document.getElementById(`nameSkill${i + 1}`);
      const cost = document.getElementById(`costSkill${i + 1}`);

      if (sk && btn) {
        if (icon) icon.textContent = sk.icon;
        if (name) name.textContent = sk.name;
        if (cost) cost.textContent = `${sk.cost} MP`;
        btn.title = `[${i + 1}번 키] ${sk.name} (${sk.cost} MP)\n${sk.desc}`;
      }
    }
  }

  loadFloor(floorNum) {
    this.floorNumber = floorNum;
    this.dungeon = new DungeonFloor(floorNum);
    this.player.x = this.dungeon.playerStart.x;
    this.player.y = this.dungeon.playerStart.y;

    this.monsters = [];
    this.itemsOnFloor = [];
    this.floatingTexts = [];
    this.bossEnraged = false;

    this.spawnEntities();
    this.dungeon.calculateFOV(this.player.x, this.player.y, this.player.fov);
    this.centerCamera();
    this.updateHUD();
    this.render();

    const theme = FLOOR_THEMES[floorNum] || FLOOR_THEMES[1];
    this.log(`📍 심연 ${floorNum}층: [${theme.name}]에 도달했습니다.`, 'log-system');
    this.showFloorBanner(floorNum);
  }

  spawnEntities() {
    const rooms = this.dungeon.rooms;
    if (rooms.length === 0) return;

    // Floor 5: Final Boss Chamber (The Shadow Drake)
    if (this.floorNumber === 5) {
      const bossRoom = rooms[rooms.length - 1];
      this.spawnMonster('boss', bossRoom.cx, bossRoom.cy);

      // Boss initial hatchlings
      const offsets = [[-2, -1], [2, -1], [-2, 1], [2, 1]];
      for (const [ox, oy] of offsets) {
        const mx = bossRoom.cx + ox;
        const my = bossRoom.cy + oy;
        if (this.dungeon.isWalkable(mx, my)) {
          this.spawnMonster('void_hatchling', mx, my);
        }
      }
    }

    // Floor 3: Death Knight Mini-boss Chamber
    if (this.floorNumber === 3 && rooms.length >= 3) {
      const miniBossRoom = rooms[rooms.length - 2];
      this.spawnMonster('death_knight', miniBossRoom.cx, miniBossRoom.cy);
    }

    // Spawn regular monsters in other rooms
    for (let i = 1; i < rooms.length; i++) {
      if (this.floorNumber === 5 && i === rooms.length - 1) continue;
      const room = rooms[i];

      const count = Math.floor(Math.random() * 2) + 1;
      for (let c = 0; c < count; c++) {
        const mx = Math.floor(Math.random() * (room.x2 - room.x1 - 1)) + room.x1 + 1;
        const my = Math.floor(Math.random() * (room.y2 - room.y1 - 1)) + room.y1 + 1;

        if (this.dungeon.isWalkable(mx, my)) {
          const type = this.pickMonsterType();
          this.spawnMonster(type, mx, my);
        }
      }

      // Chance of item drop in room
      if (Math.random() < 0.65) {
        const ix = Math.floor(Math.random() * (room.x2 - room.x1 - 1)) + room.x1 + 1;
        const iy = Math.floor(Math.random() * (room.y2 - room.y1 - 1)) + room.y1 + 1;
        if (this.dungeon.isWalkable(ix, iy)) {
          this.spawnItem(ix, iy);
        }
      }
    }
  }

  pickMonsterType() {
    const f = this.floorNumber;
    if (f === 1) {
      const r = Math.random();
      if (r < 0.45) return 'slime';
      if (r < 0.75) return 'bat';
      return 'rat';
    } else if (f === 2) {
      const r = Math.random();
      if (r < 0.35) return 'goblin';
      if (r < 0.7) return 'spore';
      return 'spider';
    } else if (f === 3) {
      const r = Math.random();
      if (r < 0.5) return 'skeleton';
      if (r < 0.8) return 'spider';
      return 'necromancer';
    } else if (f === 4) {
      const r = Math.random();
      if (r < 0.4) return 'imp';
      if (r < 0.75) return 'hound';
      return 'golem';
    } else {
      return Math.random() < 0.55 ? 'imp' : 'golem';
    }
  }

  spawnMonster(typeKey, x, y) {
    const tmpl = MONSTER_TEMPLATES[typeKey];
    if (!tmpl) return;

    if (x === this.player.x && y === this.player.y) return;
    if (this.monsters.some((m) => m.x === x && m.y === y)) return;

    this.monsters.push({
      id: `${typeKey}_${Date.now()}_${Math.random()}`,
      type: typeKey,
      name: tmpl.name,
      char: tmpl.char,
      color: tmpl.color,
      hp: tmpl.hp,
      maxHp: tmpl.hp,
      atk: tmpl.atk,
      def: tmpl.def,
      exp: tmpl.exp,
      gold: tmpl.gold,
      souls: tmpl.souls,
      ranged: tmpl.ranged || false,
      isBoss: tmpl.isBoss || false,
      isMiniBoss: tmpl.isMiniBoss || false,
      isNecromancer: tmpl.isNecromancer || false,
      poisonChance: tmpl.poisonChance || 0,
      burnChance: tmpl.burnChance || 0,
      stunChance: tmpl.stunChance || 0,
      cooldown: 0,
      statusEffects: {
        burn: 0,
        poison: 0,
        freeze: 0,
        stun: 0,
      },
      x,
      y,
    });
  }

  spawnItem(x, y) {
    if (this.itemsOnFloor.some((i) => i.x === x && i.y === y)) return;

    const available = ITEM_CATALOG.filter((item) => {
      if (this.floorNumber < 2 && item.rarity === 'legendary') return false;
      if (this.floorNumber < 3 && item.rarity === 'epic') return false;
      return true;
    });

    const item = available[Math.floor(Math.random() * available.length)];
    this.itemsOnFloor.push({
      ...item,
      x,
      y,
    });
  }

  // =============================================================================
  // Turn Engine & Combat Mechanics
  // =============================================================================
  handlePlayerMove(dx, dy) {
    if (this.gameState !== 'PLAYING') return;

    // Check Freeze / Stun on Player
    if (this.player.statusEffects.freeze > 0 || this.player.statusEffects.stun > 0) {
      this.log('몸이 얼어붙거나 기절하여 행동할 수 없습니다!', 'log-system');
      this.endTurn();
      return;
    }

    const targetX = this.player.x + dx;
    const targetY = this.player.y + dy;

    // Check Monster Target
    const targetMonster = this.monsters.find((m) => m.x === targetX && m.y === targetY);
    if (targetMonster) {
      this.playerAttack(targetMonster);
      this.endTurn();
      return;
    }

    // Walk to Walkable Tile
    if (this.dungeon.isWalkable(targetX, targetY)) {
      this.player.x = targetX;
      this.player.y = targetY;

      // Item pickup check
      const itemIndex = this.itemsOnFloor.findIndex((i) => i.x === targetX && i.y === targetY);
      if (itemIndex >= 0) {
        const item = this.itemsOnFloor[itemIndex];
        const added = this.addItemToInventory(item);
        if (added) {
          this.itemsOnFloor.splice(itemIndex, 1);
          this.audio.playItemPickup();
          this.log(`바닥에서 [${item.name}]을(를) 획득했습니다.`, 'log-item');
        }
      }

      // Shrine check
      const shrine = this.dungeon.shrines.find((s) => s.x === targetX && s.y === targetY && !s.used);
      if (shrine) {
        this.openShrineModal(shrine);
      }

      // Trap check
      const trap = this.dungeon.traps.find((t) => t.x === targetX && t.y === targetY);
      if (trap) {
        this.triggerTrap(trap, this.player);
      }

      // Stairs hint check
      if (targetX === this.dungeon.stairsPos.x && targetY === this.dungeon.stairsPos.y) {
        this.log('심연 깊숙이 이어지는 돌계단입니다. [E] 또는 [>] 키로 하강하세요.', 'log-system');
      }

      this.dungeon.calculateFOV(this.player.x, this.player.y, this.player.fov);
      this.centerCamera();
      this.endTurn();
    }
  }

  playerAttack(monster, multiplier = 1.0, guaranteedCrit = false) {
    const totalAtk = this.getTotalAtk();
    const critRate = this.getTotalCrit();
    const isCrit = guaranteedCrit || (Math.random() * 100 < critRate);
    let dmg = Math.max(1, Math.floor((totalAtk + (Math.random() * 4 - 2)) * multiplier) - monster.def);

    if (isCrit) {
      dmg = Math.floor(dmg * 1.8);
      this.audio.playCrit();
      this.triggerScreenShake();
      this.addFloatingText(monster.x, monster.y, `CRIT! -${dmg}`, '#f1c40f');
      this.createParticles(monster.x, monster.y, '#f1c40f', 12);
      this.log(`💥 치명타! ${monster.name}에게 ${dmg}의 회심의 일격을 가했습니다!`, 'log-attack');

      // Relic: Vampire Fang (25% lifesteal on crit)
      if (this.hasRelic('vampire_fang')) {
        const healAmt = Math.max(1, Math.floor(dmg * 0.25));
        this.player.hp = Math.min(this.getTotalMaxHp(), this.player.hp + healAmt);
        this.addFloatingText(this.player.x, this.player.y, `+${healAmt} HP`, '#2ecc71');
      }
    } else {
      this.audio.playPlayerAttack();
      this.addFloatingText(monster.x, monster.y, `-${dmg}`, '#e74c3c');
      this.createParticles(monster.x, monster.y, '#e74c3c', 6);
      this.log(`${monster.name}을(를) 공격하여 ${dmg}의 피해를 입혔습니다.`, 'log-attack');
    }

    monster.hp -= dmg;

    if (monster.hp <= 0) {
      this.handleMonsterDeath(monster);
    }
  }

  triggerTrap(trap, target) {
    trap.revealed = true;
    this.audio.playTrap();
    this.triggerScreenShake();
    this.log(`⚠️ 찰칵! [${trap.name}]이(가) 발동되었습니다!`, 'log-damage');

    if (target === this.player) {
      let dmg = trap.dmg;
      if (this.player.statusEffects.shield > 0) {
        const absorbed = Math.min(this.player.statusEffects.shield, dmg);
        this.player.statusEffects.shield -= absorbed;
        dmg -= absorbed;
      }
      this.player.hp -= dmg;
      this.addFloatingText(this.player.x, this.player.y, `-${trap.dmg}`, '#ff7675');

      if (trap.status === 'poison') {
        this.player.statusEffects.poison = Math.max(this.player.statusEffects.poison, trap.statusTurns);
        this.log('독가스에 노출되어 중독 상태가 되었습니다!', 'log-damage');
      } else if (trap.status === 'stun') {
        this.player.statusEffects.stun = Math.max(this.player.statusEffects.stun, trap.statusTurns);
        this.log('가시에 찔려 일시적으로 기절했습니다!', 'log-damage');
      } else if (trap.manaDrain) {
        this.player.mp = Math.max(0, this.player.mp - trap.manaDrain);
        this.log(`마력 룬 폭주로 마나 ${trap.manaDrain}이 소각되었습니다!`, 'log-damage');
      }
    }
  }

  handleMonsterDeath(monster) {
    this.kills += 1;
    const soulMult = 1 + this.metaData.upgrades.soulBoost * 0.25;
    const gainedSouls = Math.round(monster.souls * soulMult);

    let goldGained = monster.gold;
    if (this.hasRelic('golden_scarab')) {
      goldGained = Math.round(goldGained * 1.5);
    }

    this.player.exp += monster.exp;
    this.player.gold += goldGained;
    this.player.runSouls += gainedSouls;
    this.metaData.souls += gainedSouls;

    // Track Bestiary
    this.metaData.bestiary[monster.type] = (this.metaData.bestiary[monster.type] || 0) + 1;
    this.saveMetaData();

    // Relic: Mana Core (gain 4 MP on kill)
    if (this.hasRelic('mana_core')) {
      this.player.mp = Math.min(this.player.maxMp, this.player.mp + 4);
    }

    this.audio.playHit();
    this.createParticles(monster.x, monster.y, '#00f0ff', 16);
    this.log(`💀 ${monster.name}을(를) 처치했습니다! (+${monster.exp} EXP, +${goldGained} G, +${gainedSouls} Souls)`, 'log-kill');
    this.addFloatingText(monster.x, monster.y, `+${gainedSouls} 👻`, '#00f0ff');

    this.monsters = this.monsters.filter((m) => m.id !== monster.id);

    // Final Boss Defeat: Victory Transition
    if (monster.isBoss) {
      this.triggerVictory();
      return;
    }

    // Check Level Up
    if (this.player.exp >= this.player.maxExp) {
      this.triggerLevelUp();
    }
  }

  endTurn() {
    if (this.gameState !== 'PLAYING') return;

    this.turns += 1;

    // Mage passive: natural +1 MP regen per turn
    if (this.player.classId === 'mage') {
      this.player.mp = Math.min(this.player.maxMp, this.player.mp + 1);
    }

    // Process Status Effects on Player
    this.processPlayerStatusEffects();

    // Process Monsters turns
    for (const m of [...this.monsters]) {
      if (this.gameState !== 'PLAYING') break;
      this.processMonsterStatusEffects(m);
      if (m.hp > 0) {
        this.monsterTurn(m);
      }
    }

    this.updateHUD();
    this.render();

    // Check Player Death with Phoenix Feather check
    if (this.player.hp <= 0 && this.gameState === 'PLAYING') {
      if (this.hasRelic('phoenix_feather') && !this.phoenixUsed) {
        this.phoenixUsed = true;
        const reviveHp = Math.floor(this.getTotalMaxHp() * 0.5);
        this.player.hp = reviveHp;
        this.audio.playLevelUp();
        this.triggerScreenShake();
        this.createParticles(this.player.x, this.player.y, '#f1c40f', 30);
        this.log('🪶 [불사조의 깃털]이 불타오르며 생명을 되살렸습니다! (50% HP 부활)', 'log-heal');
        this.updateHUD();
        return;
      }
      this.triggerGameOver();
    }
  }

  processPlayerStatusEffects() {
    const se = this.player.statusEffects;

    if (se.burn > 0) {
      const burnDmg = 8;
      this.player.hp -= burnDmg;
      this.addFloatingText(this.player.x, this.player.y, `🔥 -${burnDmg}`, '#ff7675');
      this.createParticles(this.player.x, this.player.y, '#ff7675', 4);
      se.burn -= 1;
      this.log(`🔥 화상 피해를 입었습니다! (-${burnDmg} HP)`, 'log-damage');
    }

    if (se.poison > 0) {
      const poisonDmg = 6;
      this.player.hp -= poisonDmg;
      this.addFloatingText(this.player.x, this.player.y, `🧪 -${poisonDmg}`, '#55efc4');
      this.createParticles(this.player.x, this.player.y, '#55efc4', 4);
      se.poison -= 1;
      this.log(`🧪 독기 피해를 입었습니다! (-${poisonDmg} HP)`, 'log-damage');
    }

    if (se.freeze > 0) se.freeze -= 1;
    if (se.stun > 0) se.stun -= 1;
    if (se.atkBuff > 0) se.atkBuff -= 1;
    if (se.dodge > 0) se.dodge -= 1;
  }

  processMonsterStatusEffects(m) {
    const se = m.statusEffects;
    if (!se) return;

    if (se.burn > 0) {
      const burnDmg = 10;
      m.hp -= burnDmg;
      this.addFloatingText(m.x, m.y, `🔥 -${burnDmg}`, '#ff7675');
      this.createParticles(m.x, m.y, '#ff7675', 4);
      se.burn -= 1;
      if (m.hp <= 0) {
        this.handleMonsterDeath(m);
        return;
      }
    }

    if (se.poison > 0) {
      const poisonDmg = 8;
      m.hp -= poisonDmg;
      this.addFloatingText(m.x, m.y, `🧪 -${poisonDmg}`, '#55efc4');
      this.createParticles(m.x, m.y, '#55efc4', 4);
      se.poison -= 1;
      if (m.hp <= 0) {
        this.handleMonsterDeath(m);
        return;
      }
    }

    if (se.freeze > 0) se.freeze -= 1;
    if (se.stun > 0) se.stun -= 1;
  }

  monsterTurn(monster) {
    if (monster.hp <= 0) return;

    // Freeze or Stun skip
    if (monster.statusEffects.freeze > 0 || monster.statusEffects.stun > 0) {
      return;
    }

    const dist = Math.hypot(monster.x - this.player.x, monster.y - this.player.y);
    const isVisible = this.dungeon.visible[monster.y] && this.dungeon.visible[monster.y][monster.x];

    // Final Boss Special Script
    if (monster.isBoss) {
      // Enrage check at 50% HP
      if (monster.hp < monster.maxHp * 0.5 && !this.bossEnraged) {
        this.bossEnraged = true;
        this.bossDialogueSeen.floor5_enrage = true;
        this.showBossDialogue(
          '분노한 섀도우 드레이크',
          '🔥',
          '어리석은 필멸자여! 감히 나의 비늘을 꿰뚫다니... 공허의 불꽃으로 뼈까지 불태워주마!!',
          5000
        );
        this.audio.playBossRoar();
        this.triggerScreenShake();
        this.log('🔥 섀도우 드레이크가 포효하며 분노 모드로 돌입합니다! (공격력 +8 & 새끼용 소환)', 'log-damage');
        monster.atk += 8;

        // Summon Hatchlings
        const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [ox, oy] of offsets) {
          const hx = monster.x + ox;
          const hy = monster.y + oy;
          if (this.dungeon.isWalkable(hx, hy)) {
            this.spawnMonster('void_hatchling', hx, hy);
          }
        }
      }

      monster.cooldown = (monster.cooldown || 0) + 1;
      if (monster.cooldown >= 3 && isVisible) {
        monster.cooldown = 0;
        this.audio.playBossRoar();
        this.triggerScreenShake();
        const breathDmg = Math.max(12, Math.floor(monster.atk * 1.3) - this.getTotalDef());
        this.damagePlayer(breathDmg, '🔥 섀도우 드레이크의 암흑 화염 브레스!');
        this.player.statusEffects.burn = 3;
        return;
      }
    }

    // Necromancer minion summon
    if (monster.isNecromancer && isVisible && Math.random() < 0.25) {
      const emptyTile = this.findNearbyEmptyTile(monster.x, monster.y);
      if (emptyTile) {
        this.spawnMonster('skeleton', emptyTile.x, emptyTile.y);
        this.audio.playSkill();
        this.log('💀 사령술사가 해골 전사를 소환했습니다!', 'log-attack');
        return;
      }
    }

    // Adjacent Melee Attack
    if (Math.abs(monster.x - this.player.x) <= 1 && Math.abs(monster.y - this.player.y) <= 1) {
      // Rogue passive or smoke evasion
      if (this.player.statusEffects.dodge > 0 || (this.player.classId === 'rogue' && Math.random() < 0.15)) {
        this.addFloatingText(this.player.x, this.player.y, 'MISS!', '#00f0ff');
        this.log(`💨 ${monster.name}의 공격을 유연하게 회피했습니다!`, 'log-system');
        return;
      }

      let dmg = Math.max(1, Math.floor(monster.atk + (Math.random() * 3 - 1)) - this.getTotalDef());

      // Warrior passive: 15% physical damage reduction
      if (this.player.classId === 'warrior') {
        dmg = Math.max(1, Math.floor(dmg * 0.85));
      }

      this.damagePlayer(dmg, `⚠️ ${monster.name}의 근접 공격!`);

      // Relic: Thorn Cloak (reflect 8 damage)
      if (this.hasRelic('thorn_cloak')) {
        monster.hp -= 8;
        this.addFloatingText(monster.x, monster.y, '-8 🦔', '#f39c12');
        if (monster.hp <= 0) this.handleMonsterDeath(monster);
      }

      // On-hit status effects
      if (monster.poisonChance && Math.random() < monster.poisonChance) {
        this.player.statusEffects.poison = 3;
      }
      if (monster.burnChance && Math.random() < monster.burnChance) {
        this.player.statusEffects.burn = 3;
      }
      if (monster.stunChance && Math.random() < monster.stunChance) {
        this.player.statusEffects.stun = 1;
      }
      return;
    }

    // Ranged Attack
    if (monster.ranged && isVisible && dist <= 4 && dist > 1.5) {
      if (this.player.statusEffects.dodge > 0 || (this.player.classId === 'rogue' && Math.random() < 0.15)) {
        this.addFloatingText(this.player.x, this.player.y, 'MISS!', '#00f0ff');
        this.log(`💨 ${monster.name}의 원거리 탄환을 회피했습니다!`, 'log-system');
        return;
      }

      let dmg = Math.max(1, Math.floor(monster.atk * 0.85) - this.getTotalDef());
      if (this.player.classId === 'warrior') {
        dmg = Math.max(1, Math.floor(dmg * 0.85));
      }

      this.damagePlayer(dmg, `🏹 ${monster.name}의 원거리 공격!`);

      if (monster.poisonChance && Math.random() < monster.poisonChance) {
        this.player.statusEffects.poison = 3;
      }
      if (monster.burnChance && Math.random() < monster.burnChance) {
        this.player.statusEffects.burn = 3;
      }
      return;
    }

    // Movement toward player
    if (isVisible && dist < 12) {
      const dx = Math.sign(this.player.x - monster.x);
      const dy = Math.sign(this.player.y - monster.y);

      let nextX = monster.x + dx;
      let nextY = monster.y + dy;

      if (!this.canMonsterMove(nextX, nextY)) {
        if (this.canMonsterMove(monster.x + dx, monster.y)) {
          nextX = monster.x + dx;
          nextY = monster.y;
        } else if (this.canMonsterMove(monster.x, monster.y + dy)) {
          nextX = monster.x;
          nextY = monster.y + dy;
        }
      }

      if (this.canMonsterMove(nextX, nextY)) {
        monster.x = nextX;
        monster.y = nextY;

        // Check if monster steps on trap
        const trap = this.dungeon.traps.find((t) => t.x === nextX && t.y === nextY);
        if (trap) {
          trap.revealed = true;
          monster.hp -= trap.dmg;
          this.addFloatingText(monster.x, monster.y, `-${trap.dmg}`, '#ff7675');
          this.log(`⚙️ 몬스터 ${monster.name}이(가) [${trap.name}]을 밟았습니다!`, 'log-attack');
          if (monster.hp <= 0) this.handleMonsterDeath(monster);
        }
      }
    }
  }

  damagePlayer(amount, messagePrefix) {
    let finalDmg = amount;

    // Shield absorption
    if (this.player.statusEffects.shield > 0) {
      const absorbed = Math.min(this.player.statusEffects.shield, finalDmg);
      this.player.statusEffects.shield -= absorbed;
      finalDmg -= absorbed;
      this.addFloatingText(this.player.x, this.player.y, `🛡️ -${absorbed}`, '#a29bfe');
    }

    if (finalDmg > 0) {
      this.player.hp -= finalDmg;
      this.audio.playHit();
      this.addFloatingText(this.player.x, this.player.y, `-${finalDmg}`, '#e74c3c');
      this.createParticles(this.player.x, this.player.y, '#e74c3c', 6);
      this.log(`${messagePrefix} (${finalDmg} 피해)`, 'log-damage');
    }
  }

  findNearbyEmptyTile(x, y) {
    const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [ox, oy] of offsets) {
      const tx = x + ox;
      const ty = y + oy;
      if (this.canMonsterMove(tx, ty)) {
        return { x: tx, y: ty };
      }
    }
    return null;
  }

  canMonsterMove(x, y) {
    if (!this.dungeon.isWalkable(x, y)) return false;
    if (x === this.player.x && y === this.player.y) return false;
    return !this.monsters.some((m) => m.x === x && m.y === y);
  }

  descendStairs() {
    if (this.gameState !== 'PLAYING') return;

    if (this.player.x === this.dungeon.stairsPos.x && this.player.y === this.dungeon.stairsPos.y) {
      if (this.floorNumber >= MAX_FLOORS) {
        this.log('심연의 가장 깊은 곳입니다. 최종 보스를 처치해야 합니다!', 'log-system');
        return;
      }
      this.audio.playStairs();
      const nextFloor = this.floorNumber + 1;
      this.log(`돌계단을 딛고 심연 ${nextFloor}층으로 하강합니다...`, 'log-system');
      this.loadFloor(nextFloor);
    } else {
      this.log('계단(`>`) 위에 서 있지 않습니다.', 'log-system');
    }
  }

  // =============================================================================
  // 4 Class Skills System (1 ~ 4)
  // =============================================================================
  useSkill(skillIndex) {
    if (this.gameState !== 'PLAYING') return;

    const classId = this.player.classId;
    const skills = this.player.skills;
    const sk = skills[skillIndex - 1];

    if (!sk) return;

    if (this.player.mp < sk.cost) {
      this.log(`마나가 부족합니다! (필요 MP: ${sk.cost})`, 'log-system');
      return;
    }

    // 1. WARRIOR SKILLS
    if (classId === 'warrior') {
      if (skillIndex === 1) { // 강타 (Power Strike)
        const target = this.monsters.find((m) => Math.abs(m.x - this.player.x) <= 1 && Math.abs(m.y - this.player.y) <= 1);
        if (!target) {
          this.log('강타를 가할 인접한 적이 없습니다.', 'log-system');
          return;
        }
        this.player.mp -= sk.cost;
        this.audio.playSkill();
        target.statusEffects.stun = 1;
        this.log('💥 [강타] 강력한 충격파로 적을 기절시킵니다!', 'log-attack');
        this.playerAttack(target, 2.4);
        this.endTurn();
      } else if (skillIndex === 2) { // 철벽 (Iron Bulwark)
        this.player.mp -= sk.cost;
        this.player.statusEffects.shield = 35;
        this.audio.playShield();
        this.createParticles(this.player.x, this.player.y, '#9b59b6', 15);
        this.addFloatingText(this.player.x, this.player.y, '+35 SHIELD', '#a29bfe');
        this.log('🛡️ [철벽 방어] 견고한 보호막이 형성되어 35 피해를 흡수합니다.', 'log-heal');
        this.endTurn();
      } else if (skillIndex === 3) { // 휠윈드 (Whirlwind)
        const adjacent = this.monsters.filter((m) => Math.abs(m.x - this.player.x) <= 1 && Math.abs(m.y - this.player.y) <= 1);
        if (adjacent.length === 0) {
          this.log('휠윈드를 시전할 인접한 적이 없습니다.', 'log-system');
          return;
        }
        this.player.mp -= sk.cost;
        this.audio.playWhirlwind();
        this.triggerScreenShake();
        this.createParticles(this.player.x, this.player.y, '#f1c40f', 24);
        this.log(`🌪️ [휠윈드] 대검을 크게 휘둘러 ${adjacent.length}마리의 적을 동시 타격합니다!`, 'log-attack');
        adjacent.forEach((m) => this.playerAttack(m, 1.6));
        this.endTurn();
      } else if (skillIndex === 4) { // 전장의 함성 (Battle Cry)
        this.player.mp -= sk.cost;
        this.player.statusEffects.burn = 0;
        this.player.statusEffects.poison = 0;
        this.player.statusEffects.atkBuff = 6;
        const heal = 35;
        this.player.hp = Math.min(this.getTotalMaxHp(), this.player.hp + heal);
        this.audio.playPotion();
        this.createParticles(this.player.x, this.player.y, '#00f0ff', 20);
        this.addFloatingText(this.player.x, this.player.y, `+${heal} HP & ATK+6`, '#2ecc71');
        this.log(`📯 [전장의 함성] 모든 디버프가 해제되고 공격력 버프와 생명력을 얻습니다!`, 'log-heal');
        this.endTurn();
      }
    }

    // 2. ROGUE SKILLS
    else if (classId === 'rogue') {
      if (skillIndex === 1) { // 독침 찌르기 (Viper Strike)
        const target = this.monsters.find((m) => Math.abs(m.x - this.player.x) <= 1 && Math.abs(m.y - this.player.y) <= 1);
        if (!target) {
          this.log('공격할 인접한 적이 없습니다.', 'log-system');
          return;
        }
        this.player.mp -= sk.cost;
        this.audio.playSkill();
        target.statusEffects.poison = 4;
        this.log('🗡️ [독침 찌르기] 맹독을 주입하여 지속 피해를 입힙니다!', 'log-attack');
        this.playerAttack(target, 1.8);
        this.endTurn();
      } else if (skillIndex === 2) { // 그림자 도약 (Shadow Step)
        const visibleMonsters = this.monsters.filter((m) => this.dungeon.visible[m.y] && this.dungeon.visible[m.y][m.x]);
        if (visibleMonsters.length === 0) {
          this.log('도약할 시야 내 적이 없습니다.', 'log-system');
          return;
        }
        visibleMonsters.sort((a, b) => Math.hypot(a.x - this.player.x, a.y - this.player.y) - Math.hypot(b.x - this.player.x, b.y - this.player.y));
        const target = visibleMonsters[0];
        const emptyTile = this.findNearbyEmptyTile(target.x, target.y);
        if (!emptyTile) {
          this.log('적 주변에 착지할 공간이 없습니다.', 'log-system');
          return;
        }
        this.player.mp -= sk.cost;
        this.player.x = emptyTile.x;
        this.player.y = emptyTile.y;
        this.audio.playSkill();
        this.log(`👣 [그림자 도약] ${target.name}의 배후로 순간이동하여 치명적 기습을 가합니다!`, 'log-attack');
        this.playerAttack(target, 2.0, true);
        this.dungeon.calculateFOV(this.player.x, this.player.y, this.player.fov);
        this.centerCamera();
        this.endTurn();
      } else if (skillIndex === 3) { // 독안개 폭탄 (Toxin Bomb)
        const targets = this.monsters.filter((m) => Math.hypot(m.x - this.player.x, m.y - this.player.y) <= 3 && this.dungeon.visible[m.y] && this.dungeon.visible[m.y][m.x]);
        if (targets.length === 0) {
          this.log('폭탄 범위 내에 적이 없습니다.', 'log-system');
          return;
        }
        this.player.mp -= sk.cost;
        this.audio.playSkill();
        this.createParticles(this.player.x, this.player.y, '#2ecc71', 20);
        this.log(`🧪 [독안개 폭탄] 반경 내 ${targets.length}마리의 적을 맹독에 빠뜨립니다!`, 'log-attack');
        targets.forEach((m) => {
          m.hp -= 22;
          m.statusEffects.poison = 3;
          this.addFloatingText(m.x, m.y, '-22 🧪', '#55efc4');
          if (m.hp <= 0) this.handleMonsterDeath(m);
        });
        this.endTurn();
      } else if (skillIndex === 4) { // 연막 회피 (Smoke Veil)
        this.player.mp -= sk.cost;
        this.player.statusEffects.dodge = 2;
        const heal = 25;
        this.player.hp = Math.min(this.getTotalMaxHp(), this.player.hp + heal);
        this.audio.playPotion();
        this.addFloatingText(this.player.x, this.player.y, '100% DODGE', '#00f0ff');
        this.log('💨 [연막 회피] 짙은 안개 속에 몸을 숨겨 2턴간 모든 공격을 회피합니다!', 'log-system');
        this.endTurn();
      }
    }

    // 3. MAGE SKILLS
    else if (classId === 'mage') {
      if (skillIndex === 1) { // 화염 폭발 (Fireball)
        const visibleMonsters = this.monsters.filter((m) => this.dungeon.visible[m.y] && this.dungeon.visible[m.y][m.x]);
        if (visibleMonsters.length === 0) {
          this.log('화염구를 날릴 시야 내 적이 없습니다.', 'log-system');
          return;
        }
        visibleMonsters.sort((a, b) => Math.hypot(a.x - this.player.x, a.y - this.player.y) - Math.hypot(b.x - this.player.x, b.y - this.player.y));
        const target = visibleMonsters[0];
        this.player.mp -= sk.cost;
        this.audio.playSkill();
        this.createParticles(target.x, target.y, '#e67e22', 15);
        const dmg = 38;
        target.hp -= dmg;
        target.statusEffects.burn = 3;
        this.addFloatingText(target.x, target.y, `🔥 -${dmg}`, '#e67e22');
        this.log(`🔥 [화염 폭발] ${target.name}에게 ${dmg}의 불꽃 피해와 화상을 입혔습니다!`, 'log-attack');
        if (target.hp <= 0) this.handleMonsterDeath(target);
        this.endTurn();
      } else if (skillIndex === 2) { // 눈보라 (Blizzard)
        const targets = this.monsters.filter((m) => this.dungeon.visible[m.y] && this.dungeon.visible[m.y][m.x]);
        if (targets.length === 0) {
          this.log('눈보라를 맞출 시야 내 적이 없습니다.', 'log-system');
          return;
        }
        this.player.mp -= sk.cost;
        this.audio.playFreeze();
        this.createParticles(this.player.x, this.player.y, '#74b9ff', 25);
        this.log(`❄️ [눈보라] 시야 내 ${targets.length}마리의 적을 2턴간 얼어붙게 만듭니다!`, 'log-attack');
        targets.forEach((m) => {
          m.hp -= 26;
          m.statusEffects.freeze = 2;
          this.addFloatingText(m.x, m.y, '❄️ -26 FROZEN', '#74b9ff');
          if (m.hp <= 0) this.handleMonsterDeath(m);
        });
        this.endTurn();
      } else if (skillIndex === 3) { // 비전 왜곡 (Arcane Warp)
        const room = this.dungeon.rooms[Math.floor(Math.random() * this.dungeon.rooms.length)];
        this.player.x = room.cx;
        this.player.y = room.cy;
        this.player.mp -= sk.cost;
        this.audio.playSkill();
        this.createParticles(this.player.x, this.player.y, '#9b59b6', 20);
        this.log('🌀 [비전 왜곡] 공간을 찢고 안전한 방으로 전이했습니다!', 'log-system');
        this.dungeon.calculateFOV(this.player.x, this.player.y, this.player.fov);
        this.centerCamera();
        this.endTurn();
      } else if (skillIndex === 4) { // 천상의 치유 (Celestial Heal)
        this.player.mp -= sk.cost;
        this.player.statusEffects.burn = 0;
        this.player.statusEffects.poison = 0;
        const heal = 55;
        this.player.hp = Math.min(this.getTotalMaxHp(), this.player.hp + heal);
        this.audio.playPotion();
        this.createParticles(this.player.x, this.player.y, '#2ecc71', 20);
        this.addFloatingText(this.player.x, this.player.y, `+${heal} HP`, '#2ecc71');
        this.log(`✨ [천상의 치유] 찬란한 성광이 상처를 아물게 하고 모든 상태이상을 완치합니다!`, 'log-heal');
        this.endTurn();
      }
    }
  }

  // =============================================================================
  // Inventory, Items & Relics Management
  // =============================================================================
  addItemToInventory(item) {
    if (item.type === 'potion') {
      const existing = this.player.inventory.find((i) => i.id === item.id);
      if (existing) {
        existing.qty = (existing.qty || 1) + 1;
        return true;
      }
    }

    if (this.player.inventory.length >= 16) {
      this.log('가방이 가득 차서 아이템을 주울 수 없습니다.', 'log-system');
      return false;
    }

    this.player.inventory.push({ ...item, qty: 1 });
    return true;
  }

  useItem(itemIndex) {
    if (this.gameState !== 'PLAYING') return;

    const item = this.player.inventory[itemIndex];
    if (!item) return;

    if (item.type === 'potion') {
      const maxHp = this.getTotalMaxHp();
      if (item.effect.healHp) {
        this.player.hp = Math.min(maxHp, this.player.hp + item.effect.healHp);
      }
      if (item.effect.healMp) {
        this.player.mp = Math.min(this.player.maxMp, this.player.mp + item.effect.healMp);
      }
      if (item.effect.cleanse) {
        this.player.statusEffects.burn = 0;
        this.player.statusEffects.poison = 0;
      }

      this.audio.playPotion();
      this.log(`[${item.name}]을(를) 마셨습니다.`, 'log-heal');

      if (item.qty > 1) {
        item.qty -= 1;
      } else {
        this.player.inventory.splice(itemIndex, 1);
      }
      this.endTurn();
    } else if (item.type === 'scroll') {
      if (item.effect.aoeDamage) {
        let count = 0;
        this.monsters.forEach((m) => {
          if (this.dungeon.visible[m.y] && this.dungeon.visible[m.y][m.x]) {
            m.hp -= item.effect.aoeDamage;
            if (item.effect.applyBurn) m.statusEffects.burn = 3;
            this.addFloatingText(m.x, m.y, `-${item.effect.aoeDamage}`, '#e67e22');
            count++;
          }
        });
        this.audio.playSkill();
        this.log(`🔥 [화염구 스크롤] 시야 내 ${count}마리의 적에게 화염 폭풍을 퍼부었습니다!`, 'log-attack');
        this.monsters = this.monsters.filter((m) => {
          if (m.hp <= 0) {
            this.handleMonsterDeath(m);
            return false;
          }
          return true;
        });
      } else if (item.effect.teleport) {
        const randRoom = this.dungeon.rooms[Math.floor(Math.random() * this.dungeon.rooms.length)];
        this.player.x = randRoom.cx;
        this.player.y = randRoom.cy;
        this.dungeon.calculateFOV(this.player.x, this.player.y, this.player.fov);
        this.centerCamera();
        this.audio.playSkill();
        this.log('🌀 [전위 스크롤] 던전의 다른 방으로 순간이동했습니다!', 'log-system');
      } else if (item.effect.buffShield) {
        this.player.statusEffects.shield = (this.player.statusEffects.shield || 0) + item.effect.buffShield;
        this.player.statusEffects.atkBuff = (this.player.statusEffects.atkBuff || 0) + item.effect.buffAtk;
        this.audio.playShield();
        this.log('✨ [축복서] 강력한 보호막과 무력 강화 축복을 얻었습니다!', 'log-heal');
      }

      this.player.inventory.splice(itemIndex, 1);
      this.endTurn();
    } else if (item.type === 'weapon' || item.type === 'armor' || item.type === 'ring') {
      const oldEquip = this.player.equipment[item.type];
      this.player.equipment[item.type] = item;
      this.player.inventory.splice(itemIndex, 1);
      if (oldEquip) {
        this.player.inventory.push(oldEquip);
      }
      this.audio.playItemPickup();
      this.log(`[${item.name}]을(를) 장착했습니다.`, 'log-system');

      this.player.hp = Math.min(this.player.hp, this.getTotalMaxHp());
      this.updateHUD();
    }

    this.renderInventoryModal();
  }

  addRelic(relic) {
    if (this.relics.some((r) => r.id === relic.id)) {
      this.log(`이미 보유 중인 유물 [${relic.name}]입니다. 영혼 20개로 환원됩니다.`, 'log-item');
      this.metaData.souls += 20;
      this.saveMetaData();
      return;
    }
    this.relics.push(relic);
    this.audio.playLevelUp();
    this.log(`💎 전설의 유물 [${relic.name}]을(를) 획득했습니다! (${relic.desc})`, 'log-kill');
    this.updateRelicsUI();
  }

  hasRelic(relicId) {
    return this.relics.some((r) => r.id === relicId);
  }

  updateRelicsUI() {
    const container = document.getElementById('relicsList');
    if (!container) return;

    if (this.relics.length === 0) {
      container.innerHTML = '<span class="relic-empty">획득한 유물이 없습니다.</span>';
      return;
    }

    container.innerHTML = this.relics
      .map((r) => `<span class="relic-badge" title="${r.desc}">${r.icon} ${r.name}</span>`)
      .join('');
  }

  // Unified Derived Stats
  getTotalMaxHp() {
    let hp = this.player.baseMaxHp;
    if (this.player.equipment.armor) hp += this.player.equipment.armor.stats.maxHp || 0;
    if (this.player.equipment.ring) hp += this.player.equipment.ring.stats.maxHp || 0;
    return hp;
  }

  getTotalAtk() {
    let atk = this.player.baseAtk;
    if (this.player.equipment.weapon) atk += this.player.equipment.weapon.stats.atk || 0;
    if (this.player.equipment.ring) atk += this.player.equipment.ring.stats.atk || 0;
    if (this.player.statusEffects.atkBuff > 0) atk += 6;
    return atk;
  }

  getTotalDef() {
    let def = this.player.baseDef;
    if (this.player.equipment.armor) def += this.player.equipment.armor.stats.def || 0;
    if (this.player.equipment.ring) def += this.player.equipment.ring.stats.def || 0;
    return def;
  }

  getTotalCrit() {
    let crit = this.player.baseCrit;
    if (this.player.equipment.weapon) crit += this.player.equipment.weapon.stats.crit || 0;
    if (this.player.equipment.armor) crit += this.player.equipment.armor.stats.crit || 0;
    if (this.player.equipment.ring) crit += this.player.equipment.ring.stats.crit || 0;
    return crit;
  }

  // Level Up
  triggerLevelUp() {
    this.gameState = 'LEVEL_UP';
    this.player.level += 1;
    this.player.exp -= this.player.maxExp;
    this.player.maxExp = Math.floor(this.player.maxExp * 1.5);
    this.audio.playLevelUp();
    this.log(`⭐ LEVEL UP! 레벨 ${this.player.level}에 도달했습니다!`, 'log-kill');

    document.getElementById('lvlUpNum').textContent = this.player.level;
    this.openModal('modalLevelUp');
  }

  applyLevelUpChoice(choice) {
    if (choice === 'hp') {
      this.player.baseMaxHp += 25;
      this.player.hp = this.getTotalMaxHp();
      this.log('최대 체력이 25 증가하고 생명력이 완전히 회복되었습니다.', 'log-heal');
    } else if (choice === 'atk') {
      this.player.baseAtk += 3;
      this.player.baseCrit += 3;
      this.log('기본 공격력 +3, 치명타율 +3% 강화되었습니다.', 'log-attack');
    } else if (choice === 'def') {
      this.player.baseDef += 2;
      this.player.maxMp += 10;
      this.player.mp = this.player.maxMp;
      this.log('기본 방어력 +2, 최대 마나 +10 강화되었습니다.', 'log-system');
    }
    this.closeModal('modalLevelUp');
    this.gameState = 'PLAYING';
    this.updateHUD();
  }

  // Shrine Event Modal
  openShrineModal(shrine) {
    this.currentShrine = shrine;
    this.gameState = 'SHRINE_EVENT';
    this.audio.playShrine();

    document.getElementById('shrineTitle').textContent = shrine.name;
    document.getElementById('shrineIcon').textContent = shrine.icon;
    document.getElementById('shrineName').textContent = shrine.name;
    document.getElementById('shrineLore').textContent = shrine.lore;

    const choicesContainer = document.getElementById('shrineChoices');
    choicesContainer.innerHTML = '';

    shrine.choices.forEach((choice) => {
      const btn = document.createElement('button');
      btn.className = 'shrine-choice-btn';
      btn.innerHTML = `
        <span>${choice.text}</span>
        <span class="choice-effect">선택 ➔</span>
      `;
      btn.addEventListener('click', () => this.applyShrineChoice(choice));
      choicesContainer.appendChild(btn);
    });

    this.openModal('modalShrine');
  }

  applyShrineChoice(choice) {
    if (!this.currentShrine) return;

    if (choice.hpCost) {
      if (this.player.hp <= choice.hpCost) {
        this.log('생명력이 부족하여 대가를 치를 수 없습니다!', 'log-system');
        return;
      }
      this.player.hp -= choice.hpCost;
      this.addFloatingText(this.player.x, this.player.y, `-${choice.hpCost} HP`, '#e74c3c');
    }

    if (choice.grantAtk) {
      this.player.baseAtk += choice.grantAtk;
      this.log(`피의 대가로 기본 공격력이 +${choice.grantAtk} 증가했습니다!`, 'log-kill');
    }

    if (choice.grantDef) {
      this.player.baseDef += choice.grantDef;
      this.log(`모루의 단련으로 기본 방어력이 +${choice.grantDef} 증가했습니다!`, 'log-kill');
    }

    if (choice.grantMaxHp) {
      this.player.baseMaxHp += choice.grantMaxHp;
      this.player.hp = Math.min(this.getTotalMaxHp(), this.player.hp + choice.grantMaxHp);
    }

    if (choice.fullHeal) {
      this.player.hp = this.getTotalMaxHp();
      this.player.mp = this.player.maxMp;
      this.player.statusEffects.burn = 0;
      this.player.statusEffects.poison = 0;
      this.audio.playPotion();
      this.log('성수가 온몸을 채워 생명력과 마나가 완전히 회복되었습니다.', 'log-heal');
    }

    if (choice.grantSouls) {
      this.metaData.souls += choice.grantSouls;
      this.player.runSouls += choice.grantSouls;
      this.saveMetaData();
      this.audio.playItemPickup();
      this.log(`비석의 영혼 ${choice.grantSouls}개를 성소로 회수했습니다.`, 'log-item');
    }

    if (choice.grantRandomRelic) {
      const available = RELIC_CATALOG.filter((r) => !this.hasRelic(r.id));
      if (available.length > 0) {
        const relic = available[Math.floor(Math.random() * available.length)];
        this.addRelic(relic);
      } else {
        this.metaData.souls += 30;
        this.saveMetaData();
      }
    }

    if (choice.grantItem) {
      const item = ITEM_CATALOG.find((i) => i.id === choice.grantItem);
      if (item) {
        this.addItemToInventory(item);
        this.audio.playItemPickup();
        this.log(`제단의 축복으로 [${item.name}]을(를) 얻었습니다!`, 'log-item');
      }
    }

    this.currentShrine.used = true;
    this.closeModal('modalShrine');
    this.gameState = 'PLAYING';
    this.updateHUD();
    this.render();
  }

  // Atomic Game Over & Victory
  triggerGameOver() {
    if (this.gameState === 'GAME_OVER' || this.gameState === 'VICTORY') return;
    this.gameState = 'GAME_OVER';

    this.audio.playDeath();
    document.getElementById('endFloor').textContent = `B${this.floorNumber}F`;
    document.getElementById('endTurns').textContent = this.turns;
    document.getElementById('endKills').textContent = this.kills;
    document.getElementById('endSouls').textContent = `+${this.player.runSouls}`;
    this.openModal('modalGameOver');
  }

  triggerVictory() {
    if (this.gameState === 'VICTORY' || this.gameState === 'GAME_OVER') return;
    this.gameState = 'VICTORY';

    this.audio.playLevelUp();
    document.getElementById('vicGold').textContent = this.player.gold;
    document.getElementById('vicSouls').textContent = this.player.runSouls;
    document.getElementById('vicTurns').textContent = this.turns;
    document.getElementById('vicKills').textContent = this.kills;

    // Narrative Epilogue
    const vicLoreTitle = document.getElementById('vicLoreTitle');
    const vicLoreText = document.getElementById('vicLoreText');
    if (vicLoreTitle && vicLoreText) {
      const classTitles = {
        warrior: '타락을 씻어낸 심연의 수호자',
        mage: '공허의 비의를 깨우친 대마법사',
        rogue: '그림자 제국의 새로운 지배자',
      };
      const classEpilogues = {
        warrior: '가웨인은 피로 물든 검을 칼집에 꽂으며, 마침내 안식에 든 전우들의 원혼을 향해 묵념했습니다. 에레보스의 망령들은 성스러운 불꽃 앞에 성불하였고, 그는 심연의 심장을 봉인하여 지상 세계에 오랜 평화를 되찾아 주었습니다.',
        mage: '발레리아는 공허의 옥좌에 서린 태초의 지식을 마도서에 모두 기록하였습니다. 금지된 공허의 마력은 그녀의 지팡이 끝에서 정제되었으며, 이제 에레보스의 모든 고대 지식은 그녀의 영원한 연구 표본이 되었습니다.',
        rogue: '엘드리안은 어둠 속에서 차갑게 미소 지었습니다. 제국의 비밀 금고와 그림자 드레이크의 정수를 모두 거머쥔 그는, 이제 지하 심연을 발판 삼아 그림자로부터 지상 세계를 호령할 보이지 않는 군주로 거듭났습니다.',
      };

      const title = classTitles[this.player.classId] || '심연의 정복자';
      const epilogue = classEpilogues[this.player.classId] || '당신은 심연의 공포를 무찌르고 승리를 쟁취했습니다.';

      vicLoreTitle.textContent = `👑 [에필로그: ${title}]`;
      vicLoreText.textContent = epilogue;
    }

    this.openModal('modalVictory');
  }

  showFloorBanner(floorNum) {
    const banner = document.getElementById('floorBanner');
    const title = document.getElementById('floorBannerTitle');
    const sub = document.getElementById('floorBannerSub');
    if (!banner || !title || !sub) return;

    const theme = FLOOR_THEMES[floorNum] || FLOOR_THEMES[1];
    title.textContent = `B${floorNum}F: ${theme.name}`;
    sub.textContent = theme.subtitle || '심연의 심장을 향해 나아가십시오.';

    banner.classList.remove('active');
    void banner.offsetWidth; // Force CSS animation reflow
    banner.classList.add('active');

    if (this.floorBannerTimer) clearTimeout(this.floorBannerTimer);
    this.floorBannerTimer = setTimeout(() => {
      banner.classList.remove('active');
    }, 4500);
  }

  showBossDialogue(speaker, portrait, text, duration = 4500) {
    const banner = document.getElementById('bossDialogueBanner');
    const spk = document.getElementById('bossSpeaker');
    const prt = document.getElementById('bossPortrait');
    const txt = document.getElementById('bossText');
    if (!banner || !spk || !prt || !txt) return;

    spk.textContent = speaker;
    prt.textContent = portrait;
    txt.textContent = text;

    banner.classList.remove('active');
    void banner.offsetWidth; // Force reflow
    banner.classList.add('active');
    this.triggerScreenShake();
    this.audio.playBossRoar();

    if (this.bossDialogueTimer) clearTimeout(this.bossDialogueTimer);
    this.bossDialogueTimer = setTimeout(() => {
      banner.classList.remove('active');
    }, duration);
  }

  checkBossDialogue() {
    if (!this.dungeon || !this.dungeon.visible || !this.monsters) return;

    for (const m of this.monsters) {
      if (m.hp <= 0) continue;
      const isVisible = this.dungeon.visible[m.y] && this.dungeon.visible[m.y][m.x];
      if (!isVisible) continue;

      if (m.id === 'death_knight' && !this.bossDialogueSeen.floor3) {
        this.bossDialogueSeen.floor3 = true;
        this.showBossDialogue(
          '죽음의 기사 에드릭',
          '💀',
          '빛의 서약 따위... 이곳에선 한 줌의 재일 뿐이다! 너 또한 이 차가운 묘실의 뼈무더기가 될 운명이다!'
        );
        break;
      }

      if (m.isBoss && !this.bossDialogueSeen.floor5_start) {
        this.bossDialogueSeen.floor5_start = true;
        this.showBossDialogue(
          '공허의 용 섀도우 드레이크',
          '🐉',
          '크하하하... 천 년 만에 찾아온 새로운 산제물이로구나! 네 영혼을 공허의 옥좌에 바쳐라!'
        );
        break;
      }
    }
  }

  // =============================================================================
  // Screen Shake & Particle FX Engine
  // =============================================================================
  triggerScreenShake() {
    const container = document.getElementById('canvasContainer');
    if (!container) return;
    container.classList.remove('screen-shake');
    void container.offsetWidth; // Force reflow
    container.classList.add('screen-shake');
    setTimeout(() => container.classList.remove('screen-shake'), 300);
  }

  createParticles(tileX, tileY, color = '#ffffff', count = 8) {
    const px = tileX * TILE_SIZE + TILE_SIZE / 2;
    const py = tileY * TILE_SIZE + TILE_SIZE / 2;

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 60 + 20;
      this.particles.push({
        x: px,
        y: py,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: Math.random() * 3 + 2,
        color,
        life: 0.6,
        maxLife: 0.6,
      });
    }
  }

  // =============================================================================
  // Canvas 2D Rendering Engine
  // =============================================================================
  centerCamera() {
    this.camera.x = this.player.x * TILE_SIZE - this.canvas.width / 2 + TILE_SIZE / 2;
    this.camera.y = this.player.y * TILE_SIZE - this.canvas.height / 2 + TILE_SIZE / 2;
  }

  render() {
    this.checkBossDialogue();
    const ctx = this.ctx;
    const theme = FLOOR_THEMES[this.floorNumber] || FLOOR_THEMES[1];
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    ctx.translate(-Math.floor(this.camera.x), -Math.floor(this.camera.y));

    // 1. Map Tiles (Biomes & Walls)
    for (let y = 0; y < this.dungeon.height; y++) {
      for (let x = 0; x < this.dungeon.width; x++) {
        const isExplored = this.dungeon.explored[y][x];
        const isVisible = this.dungeon.visible[y][x];

        if (!isExplored) continue;

        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;
        const isWalkable = this.dungeon.tiles[y][x] === 1;

        if (isWalkable) {
          ctx.fillStyle = isVisible ? theme.floor : theme.fog;
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

          ctx.strokeStyle = isVisible ? theme.border : '#111018';
          ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
        } else {
          // Wall with 3D Depth
          ctx.fillStyle = isVisible ? theme.wall : '#161420';
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

          ctx.fillStyle = isVisible ? theme.wallTop : '#262234';
          ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, 4);
        }

        // Stairs
        if (x === this.dungeon.stairsPos.x && y === this.dungeon.stairsPos.y) {
          ctx.fillStyle = isVisible ? '#2ecc71' : '#166534';
          ctx.font = 'bold 20px Cinzel, serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('>', px + TILE_SIZE / 2, py + TILE_SIZE / 2);
        }
      }
    }

    // 2. Traps (if revealed)
    this.dungeon.traps.forEach((trap) => {
      if (trap.revealed && this.dungeon.visible[trap.y] && this.dungeon.visible[trap.y][trap.x]) {
        const px = trap.x * TILE_SIZE;
        const py = trap.y * TILE_SIZE;
        ctx.font = '16px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(trap.icon, px + TILE_SIZE / 2, py + TILE_SIZE / 2);
      }
    });

    // 3. Shrines
    this.dungeon.shrines.forEach((shrine) => {
      if (this.dungeon.explored[shrine.y][shrine.x]) {
        const px = shrine.x * TILE_SIZE;
        const py = shrine.y * TILE_SIZE;
        const isVisible = this.dungeon.visible[shrine.y][shrine.x];

        // Shrine Aura Glow
        if (isVisible && !shrine.used) {
          ctx.fillStyle = 'rgba(155, 89, 182, 0.25)';
          ctx.beginPath();
          ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE * 0.9, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.font = '18px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(shrine.used ? '🪨' : shrine.icon, px + TILE_SIZE / 2, py + TILE_SIZE / 2);
      }
    });

    // 4. Items on Floor
    this.itemsOnFloor.forEach((item) => {
      if (this.dungeon.visible[item.y] && this.dungeon.visible[item.y][item.x]) {
        const px = item.x * TILE_SIZE;
        const py = item.y * TILE_SIZE;

        ctx.font = '16px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.icon, px + TILE_SIZE / 2, py + TILE_SIZE / 2);
      }
    });

    // 5. Monsters
    this.monsters.forEach((m) => {
      if (this.dungeon.visible[m.y] && this.dungeon.visible[m.y][m.x]) {
        const px = m.x * TILE_SIZE;
        const py = m.y * TILE_SIZE;

        // Boss or MiniBoss Aura
        if (m.isBoss || m.isMiniBoss) {
          ctx.fillStyle = m.isBoss ? 'rgba(231, 76, 60, 0.35)' : 'rgba(155, 89, 182, 0.3)';
          ctx.beginPath();
          ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE * (m.isBoss ? 1.1 : 0.8), 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = m.color;
        ctx.font = m.isBoss ? 'bold 24px Cinzel, serif' : 'bold 18px Press Start 2P, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(m.char, px + TILE_SIZE / 2, py + TILE_SIZE / 2);

        // Status Effects indicator above monster
        let statusEmoji = '';
        if (m.statusEffects.freeze > 0) statusEmoji = '❄️';
        else if (m.statusEffects.stun > 0) statusEmoji = '⚡';
        else if (m.statusEffects.burn > 0) statusEmoji = '🔥';
        else if (m.statusEffects.poison > 0) statusEmoji = '🧪';

        if (statusEmoji) {
          ctx.font = '12px serif';
          ctx.fillText(statusEmoji, px + TILE_SIZE / 2, py - 8);
        }

        // Health Bar
        const barW = TILE_SIZE - 4;
        const barH = 3;
        ctx.fillStyle = '#111';
        ctx.fillRect(px + 2, py - 4, barW, barH);
        ctx.fillStyle = m.isBoss ? '#e74c3c' : '#2ecc71';
        ctx.fillRect(px + 2, py - 4, Math.max(0, barW * (m.hp / m.maxHp)), barH);
      }
    });

    // 6. Player
    const ppx = this.player.x * TILE_SIZE;
    const ppy = this.player.y * TILE_SIZE;

    // Dynamic Flickering Torchlight Ambient Aura
    const flicker = Math.sin(this.ambientTorchTime) * 3;
    const grad = ctx.createRadialGradient(
      ppx + TILE_SIZE / 2, ppy + TILE_SIZE / 2, 4,
      ppx + TILE_SIZE / 2, ppy + TILE_SIZE / 2, TILE_SIZE + flicker
    );
    grad.addColorStop(0, 'rgba(241, 196, 15, 0.45)');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(ppx + TILE_SIZE / 2, ppy + TILE_SIZE / 2, TILE_SIZE + flicker, 0, Math.PI * 2);
    ctx.fill();

    // Shield Aura if active
    if (this.player.statusEffects.shield > 0) {
      ctx.strokeStyle = 'rgba(155, 89, 182, 0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ppx + TILE_SIZE / 2, ppy + TILE_SIZE / 2, TILE_SIZE * 0.65, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = '#f1c40f';
    ctx.font = 'bold 20px Press Start 2P, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('@', ppx + TILE_SIZE / 2, ppy + TILE_SIZE / 2);

    // 7. Particles
    this.particles.forEach((p) => {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillRect(p.x, p.y, p.size, p.size);
    });
    ctx.globalAlpha = 1.0;

    // 8. Floating Texts
    this.floatingTexts.forEach((ft) => {
      ctx.fillStyle = ft.color;
      ctx.font = 'bold 13px Cinzel, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(ft.text, ft.x, ft.y);
    });

    ctx.restore();

    this.renderMinimap();
  }

  renderMinimap() {
    const mctx = this.minimapCtx;
    mctx.clearRect(0, 0, this.minimapCanvas.width, this.minimapCanvas.height);

    const scaleX = this.minimapCanvas.width / this.dungeon.width;
    const scaleY = this.minimapCanvas.height / this.dungeon.height;

    for (let y = 0; y < this.dungeon.height; y++) {
      for (let x = 0; x < this.dungeon.width; x++) {
        if (this.dungeon.explored[y][x]) {
          mctx.fillStyle = this.dungeon.tiles[y][x] === 1 ? '#3a3648' : '#14131d';
          mctx.fillRect(x * scaleX, y * scaleY, scaleX + 0.5, scaleY + 0.5);
        }
      }
    }

    // Shrines on Radar
    this.dungeon.shrines.forEach((s) => {
      if (this.dungeon.explored[s.y][s.x] && !s.used) {
        mctx.fillStyle = '#9b59b6';
        mctx.fillRect(s.x * scaleX, s.y * scaleY, 4, 4);
      }
    });

    // Stairs
    if (this.dungeon.explored[this.dungeon.stairsPos.y][this.dungeon.stairsPos.x]) {
      mctx.fillStyle = '#2ecc71';
      mctx.fillRect(this.dungeon.stairsPos.x * scaleX, this.dungeon.stairsPos.y * scaleY, 4, 4);
    }

    // Items
    this.itemsOnFloor.forEach((i) => {
      if (this.dungeon.visible[i.y] && this.dungeon.visible[i.y][i.x]) {
        mctx.fillStyle = '#3498db';
        mctx.fillRect(i.x * scaleX, i.y * scaleY, 3, 3);
      }
    });

    // Monsters
    this.monsters.forEach((m) => {
      if (this.dungeon.visible[m.y] && this.dungeon.visible[m.y][m.x]) {
        mctx.fillStyle = m.isBoss ? '#f1c40f' : '#e74c3c';
        mctx.fillRect(m.x * scaleX, m.y * scaleY, m.isBoss ? 5 : 4, m.isBoss ? 5 : 4);
      }
    });

    // Player
    mctx.fillStyle = '#00f0ff';
    mctx.fillRect(this.player.x * scaleX - 1, this.player.y * scaleY - 1, 5, 5);
  }

  addFloatingText(tileX, tileY, text, color = '#ffffff') {
    this.floatingTexts.push({
      x: tileX * TILE_SIZE + TILE_SIZE / 2,
      y: tileY * TILE_SIZE,
      text,
      color,
      life: 1.0,
    });
  }

  loop(currentTime) {
    const dt = (currentTime - this.lastFrameTime) / 1000;
    this.lastFrameTime = currentTime;
    this.ambientTorchTime += dt * 3.5;

    let needsRender = false;

    // Floating text update
    if (this.floatingTexts.length > 0) {
      this.floatingTexts.forEach((ft) => {
        ft.y -= 25 * dt;
        ft.life -= dt;
      });
      this.floatingTexts = this.floatingTexts.filter((ft) => ft.life > 0);
      needsRender = true;
    }

    // Particle system update
    if (this.particles.length > 0) {
      this.particles.forEach((p) => {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
      });
      this.particles = this.particles.filter((p) => p.life > 0);
      needsRender = true;
    }

    // Ambient floating particles matching floor biome palette
    this.ambientParticleTimer = (this.ambientParticleTimer || 0) + dt;
    if (this.ambientParticleTimer > 0.25 && this.gameState === 'PLAYING' && this.dungeon) {
      this.ambientParticleTimer = 0;
      const theme = FLOOR_THEMES[this.floorNumber] || FLOOR_THEMES[1];
      if (this.particles.length < 35) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 14 + 6;
        const spawnX = this.camera.x + Math.random() * this.canvas.width;
        const spawnY = this.camera.y + Math.random() * this.canvas.height;
        this.particles.push({
          x: spawnX,
          y: spawnY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 12,
          size: Math.random() * 2.5 + 1.2,
          color: theme.particleColor || 'rgba(255, 255, 255, 0.3)',
          life: 2.2,
          maxLife: 2.2,
        });
        needsRender = true;
      }
    }

    if (needsRender && this.gameState === 'PLAYING') {
      this.render();
    }

    requestAnimationFrame((t) => this.loop(t));
  }

  // =============================================================================
  // UI & HUD Manager
  // =============================================================================
  updateHUD() {
    if (!this.player) return;

    const maxHp = this.getTotalMaxHp();
    const atk = this.getTotalAtk();
    const def = this.getTotalDef();
    const crit = this.getTotalCrit();

    document.getElementById('hudFloor').textContent = `B${this.floorNumber}F`;
    document.getElementById('hudTurns').textContent = this.turns;
    document.getElementById('hudSouls').textContent = this.metaData.souls;
    document.getElementById('hudGold').textContent = this.player.gold;
    document.getElementById('hudLevel').textContent = this.player.level;

    document.getElementById('txtHp').textContent = `${this.player.hp} / ${maxHp}`;
    document.getElementById('barHp').style.width = `${Math.max(0, (this.player.hp / maxHp) * 100)}%`;

    document.getElementById('txtMp').textContent = `${this.player.mp} / ${this.player.maxMp}`;
    document.getElementById('barMp').style.width = `${Math.max(0, (this.player.mp / this.player.maxMp) * 100)}%`;

    document.getElementById('txtExp').textContent = `${this.player.exp} / ${this.player.maxExp}`;
    document.getElementById('barExp').style.width = `${Math.min(100, (this.player.exp / this.player.maxExp) * 100)}%`;

    document.getElementById('statAtk').textContent = atk;
    document.getElementById('statDef').textContent = def;
    document.getElementById('statCrit').textContent = `${crit}%`;
    document.getElementById('statFov').textContent = `${this.player.fov}칸`;

    const eq = this.player.equipment;
    document.getElementById('nameWeapon').textContent = eq.weapon ? eq.weapon.name : '(장착 안 됨)';
    document.getElementById('nameArmor').textContent = eq.armor ? eq.armor.name : '(장착 안 됨)';
    document.getElementById('nameRing').textContent = eq.ring ? eq.ring.name : '(장착 안 됨)';

    // Update 4 Skills active state based on MP
    this.player.skills.forEach((sk, idx) => {
      const btn = document.getElementById(`btnSkill${idx + 1}`);
      if (btn) btn.disabled = this.player.mp < sk.cost;
    });

    // Update Status Effects Badges
    this.renderStatusEffects();
  }

  renderStatusEffects() {
    const list = document.getElementById('statusEffectsList');
    if (!list) return;

    const se = this.player.statusEffects;
    const badges = [];

    if (se.burn > 0) badges.push(`<span class="status-badge status-badge--burn">🔥 화상 (${se.burn}T)</span>`);
    if (se.poison > 0) badges.push(`<span class="status-badge status-badge--poison">🧪 중독 (${se.poison}T)</span>`);
    if (se.freeze > 0) badges.push(`<span class="status-badge status-badge--freeze">❄️ 빙결 (${se.freeze}T)</span>`);
    if (se.stun > 0) badges.push(`<span class="status-badge status-badge--stun">⚡ 기절 (${se.stun}T)</span>`);
    if (se.shield > 0) badges.push(`<span class="status-badge status-badge--shield">🛡️ 보호막 (+${se.shield})</span>`);
    if (se.atkBuff > 0) badges.push(`<span class="status-badge status-badge--buff">⚔️ 공격력+6 (${se.atkBuff}T)</span>`);
    if (se.dodge > 0) badges.push(`<span class="status-badge status-badge--buff">💨 완전회피 (${se.dodge}T)</span>`);

    list.innerHTML = badges.join('');
  }

  log(msg, className = '') {
    const container = document.getElementById('logContainer');
    const entry = document.createElement('div');
    entry.className = `log-entry ${className}`;
    entry.textContent = `[T${this.turns}] ${msg}`;
    container.appendChild(entry);
    container.scrollTop = container.scrollHeight;
  }

  openModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.add('active');
    if (modalId === 'modalInventory') this.renderInventoryModal();
    if (modalId === 'modalMetaShop') this.renderMetaShopModal();
    if (modalId === 'modalCodex') this.renderCodexModal('monsters');
  }

  closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.remove('active');
  }

  renderInventoryModal() {
    const grid = document.getElementById('inventoryGrid');
    grid.innerHTML = '';
    document.getElementById('invCount').textContent = this.player.inventory.length;

    for (let i = 0; i < 16; i++) {
      const slot = document.createElement('div');
      slot.className = 'inv-slot';
      const item = this.player.inventory[i];

      if (item) {
        slot.innerHTML = `
          <div class="inv-slot__icon">${item.icon}</div>
          ${item.qty && item.qty > 1 ? `<div class="inv-slot__qty">${item.qty}</div>` : ''}
        `;
        slot.addEventListener('click', () => this.selectInventoryItem(i));
      }
      grid.appendChild(slot);
    }
    this.selectInventoryItem(0);
  }

  selectInventoryItem(index) {
    const card = document.getElementById('itemDetailCard');
    const item = this.player.inventory[index];

    document.querySelectorAll('.inv-slot').forEach((el, idx) => {
      el.classList.toggle('selected', idx === index);
    });

    if (!item) {
      card.innerHTML = '<div class="item-detail-card__empty">아이템을 선택하면 상세 정보가 표시됩니다.</div>';
      return;
    }

    const actionText = item.type === 'potion' || item.type === 'scroll' ? '사용하기' : '장착하기';
    card.innerHTML = `
      <div class="item-detail__name">${item.name}</div>
      <div class="item-detail__desc">${item.desc}</div>
      <div class="item-detail__actions">
        <button class="btn btn--primary" id="btnUseItem">${actionText}</button>
      </div>
    `;

    document.getElementById('btnUseItem').addEventListener('click', () => {
      this.useItem(index);
    });
  }

  renderMetaShopModal() {
    document.getElementById('shopSoulsCount').textContent = this.metaData.souls;
    const container = document.getElementById('upgradeCards');
    container.innerHTML = '';

    const upgradesList = [
      {
        id: 'maxHp',
        title: '강인한 신체 (Max HP)',
        desc: '탐험 시작 시 최대 체력을 영구적으로 +15 증가시킵니다.',
        level: this.metaData.upgrades.maxHp,
        cost: 10 + this.metaData.upgrades.maxHp * 15,
      },
      {
        id: 'atk',
        title: '날카로운 검술 (Base ATK)',
        desc: '기본 공격력을 영구적으로 +3 증가시킵니다.',
        level: this.metaData.upgrades.atk,
        cost: 15 + this.metaData.upgrades.atk * 20,
      },
      {
        id: 'def',
        title: '단단한 수호 (Base DEF)',
        desc: '기본 방어력을 영구적으로 +2 증가시킵니다.',
        level: this.metaData.upgrades.def,
        cost: 15 + this.metaData.upgrades.def * 20,
      },
      {
        id: 'soulBoost',
        title: '영혼 탐식자 (Soul Magnet)',
        desc: '몬스터 처치 시 획득하는 영혼 조각을 +25% 증가시킵니다.',
        level: this.metaData.upgrades.soulBoost,
        cost: 20 + this.metaData.upgrades.soulBoost * 30,
      },
    ];

    upgradesList.forEach((upg) => {
      const card = document.createElement('div');
      card.className = 'upgrade-card';
      const canAfford = this.metaData.souls >= upg.cost;

      card.innerHTML = `
        <div class="upgrade-card__head">
          <span class="upgrade-card__title">${upg.title}</span>
          <span class="upgrade-card__level">Lv. ${upg.level}</span>
        </div>
        <p class="upgrade-card__desc">${upg.desc}</p>
        <button class="btn btn--gold upgrade-card__btn" ${canAfford ? '' : 'disabled'}>
          강화하기 (${upg.cost} Souls)
        </button>
      `;

      card.querySelector('button').addEventListener('click', () => {
        if (this.metaData.souls >= upg.cost) {
          this.metaData.souls -= upg.cost;
          this.metaData.upgrades[upg.id] += 1;
          this.saveMetaData();
          this.audio.playLevelUp();
          this.renderMetaShopModal();
          this.log(`🏛️ [성소 강화] ${upg.title}이(가) 레벨 ${this.metaData.upgrades[upg.id]}로 강화되었습니다!`, 'log-kill');
        }
      });

      container.appendChild(card);
    });
  }

  // Codex & Bestiary Render
  renderCodexModal(activeTab = 'monsters') {
    const container = document.getElementById('codexContent');
    container.innerHTML = '';

    document.querySelectorAll('.codex-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.tab === activeTab);
    });

    if (activeTab === 'monsters') {
      Object.entries(MONSTER_TEMPLATES).forEach(([key, m]) => {
        const killCount = this.metaData.bestiary[key] || 0;
        const entry = document.createElement('div');
        entry.className = 'codex-entry';
        entry.innerHTML = `
          <div class="codex-entry__icon" style="color: ${m.color}; font-family: 'Press Start 2P', monospace;">${m.char}</div>
          <div class="codex-entry__info">
            <div class="codex-entry__title">
              <span>${m.name}</span>
              <span class="codex-kills">처치: ${killCount}회</span>
            </div>
            <div class="codex-entry__desc">${m.desc}</div>
            <div class="codex-entry__stats">
              <span>❤️ HP: ${m.hp}</span>
              <span>⚔️ ATK: ${m.atk}</span>
              <span>🛡️ DEF: ${m.def}</span>
              <span>👻 Souls: ${m.souls}</span>
              <span>출현: B${m.minFloor}F+</span>
            </div>
          </div>
        `;
        container.appendChild(entry);
      });
    } else if (activeTab === 'relics') {
      RELIC_CATALOG.forEach((r) => {
        const hasIt = this.hasRelic(r.id);
        const entry = document.createElement('div');
        entry.className = 'codex-entry';
        entry.innerHTML = `
          <div class="codex-entry__icon">${r.icon}</div>
          <div class="codex-entry__info">
            <div class="codex-entry__title">
              <span>${r.name}</span>
              <span class="codex-kills" style="color: ${hasIt ? '#2ecc71' : '#888'};">${hasIt ? '보유 중' : '미보유'}</span>
            </div>
            <div class="codex-entry__desc">${r.desc}</div>
          </div>
        `;
        container.appendChild(entry);
      });
    } else if (activeTab === 'floors') {
      Object.entries(FLOOR_THEMES).forEach(([floorNum, theme]) => {
        const entry = document.createElement('div');
        entry.className = 'codex-entry';
        entry.innerHTML = `
          <div class="codex-entry__icon">B${floorNum}F</div>
          <div class="codex-entry__info">
            <div class="codex-entry__title">${theme.name}</div>
            <div class="codex-entry__desc">
              ${theme.subtitle || (floorNum === '5' ? '심연의 최종 지배자 섀도우 드레이크가 도사리는 옥좌.' : '위험천만한 마물들과 고대의 제단이 숨겨진 심연의 층계.')}
            </div>
          </div>
        `;
        container.appendChild(entry);
      });
    } else if (activeTab === 'chronicles') {
      CHRONICLES_CATALOG.forEach((c) => {
        const card = document.createElement('div');
        card.className = 'chronicle-card';
        card.innerHTML = `
          <div class="chronicle-title">${c.title}</div>
          <div class="chronicle-quote">${c.quote}</div>
          <div class="chronicle-body">${c.text}</div>
        `;
        container.appendChild(card);
      });
    }
  }

  // =============================================================================
  // User Input Listeners
  // =============================================================================
  initDOM() {
    window.addEventListener('keydown', (e) => {
      this.audio.init();

      // Check active modals
      const hasActiveModal = document.querySelector('.modal.active');
      if (hasActiveModal && e.key !== 'Escape') {
        return;
      }

      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        this.handlePlayerMove(0, -1);
      } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        e.preventDefault();
        this.handlePlayerMove(0, 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        this.handlePlayerMove(-1, 0);
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        this.handlePlayerMove(1, 0);
      } else if (e.key === ' ' || e.key === '5') {
        e.preventDefault();
        if (this.gameState === 'PLAYING') {
          this.log('한 턴을 대기하며 기력을 회복합니다.', 'log-system');
          this.endTurn();
        }
      } else if (e.key === '1') {
        this.useSkill(1);
      } else if (e.key === '2') {
        this.useSkill(2);
      } else if (e.key === '3') {
        this.useSkill(3);
      } else if (e.key === '4') {
        this.useSkill(4);
      } else if (e.key === 'i' || e.key === 'I' || e.key === 'b' || e.key === 'B') {
        this.openModal('modalInventory');
      } else if (e.key === 'c' || e.key === 'C') {
        this.openModal('modalCodex');
      } else if (e.key === 'e' || e.key === 'E' || e.key === '>') {
        this.descendStairs();
      } else if (e.key === 'Escape') {
        if (this.gameState === 'PLAYING') {
          document.querySelectorAll('.modal.active').forEach((m) => {
            if (m.id !== 'modalGameOver' && m.id !== 'modalVictory' && m.id !== 'modalLevelUp') {
              m.classList.remove('active');
            }
          });
        }
      }
    });

    // Touch D-Pad buttons
    document.querySelectorAll('.dpad-btn[data-dir]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.audio.init();
        if (this.gameState !== 'PLAYING') return;
        const [dx, dy] = btn.dataset.dir.split(',').map(Number);
        this.handlePlayerMove(dx, dy);
      });
    });

    document.getElementById('btnWait').addEventListener('click', () => {
      this.audio.init();
      if (this.gameState === 'PLAYING') {
        this.log('한 턴을 대기합니다.', 'log-system');
        this.endTurn();
      }
    });

    document.getElementById('btnTouchInventory').addEventListener('click', () => {
      this.openModal('modalInventory');
    });

    document.getElementById('btnTouchStairs').addEventListener('click', () => {
      this.descendStairs();
    });

    document.querySelectorAll('[data-close]').forEach((el) => {
      el.addEventListener('click', () => {
        this.closeModal(el.dataset.close);
      });
    });

    document.getElementById('btnSoundToggle').addEventListener('click', () => {
      this.audio.enabled = !this.audio.enabled;
      document.getElementById('btnSoundToggle').textContent = this.audio.enabled ? '🔊' : '🔇';
    });

    document.getElementById('btnHelp').addEventListener('click', () => {
      this.openModal('modalHelp');
    });

    const prologueBtnHeader = document.getElementById('btnPrologue');
    if (prologueBtnHeader) {
      prologueBtnHeader.addEventListener('click', () => this.openModal('modalPrologue'));
    }

    // Auto-open prologue on first launch if not seen
    const seenPrologue = localStorage.getItem('DOTA_PROLOGUE_SEEN');
    if (!seenPrologue) {
      localStorage.setItem('DOTA_PROLOGUE_SEEN', 'true');
      this.openModal('modalPrologue');
    }

    const codexBtnHeader = document.getElementById('btnCodex');
    if (codexBtnHeader) {
      codexBtnHeader.addEventListener('click', () => this.openModal('modalCodex'));
    }

    const codexBtnFooter = document.getElementById('btnOpenCodex');
    if (codexBtnFooter) {
      codexBtnFooter.addEventListener('click', () => this.openModal('modalCodex'));
    }

    const classSelectBtn = document.getElementById('btnClassSelect');
    if (classSelectBtn) {
      classSelectBtn.addEventListener('click', () => this.openModal('modalClassSelect'));
    }

    document.getElementById('btnOpenInventory').addEventListener('click', () => {
      this.openModal('modalInventory');
    });

    document.getElementById('btnOpenMetaShop').addEventListener('click', () => {
      this.openModal('modalMetaShop');
    });

    ['slotWeapon', 'slotArmor', 'slotRing'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', () => this.openModal('modalInventory'));
    });

    // Skills buttons
    [1, 2, 3, 4].forEach((num) => {
      const btn = document.getElementById(`btnSkill${num}`);
      if (btn) btn.addEventListener('click', () => this.useSkill(num));
    });

    // Level up choices
    document.querySelectorAll('.levelup-card').forEach((card) => {
      card.addEventListener('click', () => {
        this.applyLevelUpChoice(card.dataset.choice);
      });
    });

    // Class selection choices
    document.querySelectorAll('.class-select-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const classId = btn.dataset.class;
        this.closeModal('modalClassSelect');
        this.startNewRun(classId);
      });
    });

    document.querySelectorAll('.class-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.tagName.toLowerCase() === 'button') return;
        document.querySelectorAll('.class-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
      });
    });

    // Codex tabs
    document.querySelectorAll('.codex-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.renderCodexModal(tab.dataset.tab);
      });
    });

    document.getElementById('btnShopAfterDeath').addEventListener('click', () => {
      this.closeModal('modalGameOver');
      this.openModal('modalMetaShop');
    });

    document.getElementById('btnRestartGame').addEventListener('click', () => {
      this.closeModal('modalGameOver');
      this.startNewRun(this.selectedClassId);
    });

    document.getElementById('btnNewRunPlus').addEventListener('click', () => {
      this.closeModal('modalVictory');
      this.startNewRun(this.selectedClassId);
    });

    document.getElementById('btnClearLog').addEventListener('click', () => {
      document.getElementById('logContainer').innerHTML = '';
    });
  }
}

// Start Game on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.game = new RogueliteGame();
});
