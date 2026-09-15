// ============================================================================
// Phase 3 검증 테스트: 오디오 & 사운드 디자인 (P3-01)
// 14_antigravity_production_brief.md P3-01 준수 검증
// 5-버스 믹서, 마스터 리미터, 공간 음향 감쇠/패닝, 4개 고유 리듬, 심장박동 & 32 SFX 스트레스
// ============================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioManager } from '../src/systems/audioManager.js';
import { SFX } from '../src/systems/audio.js';
import { assets } from '../src/systems/assets.js';

// Web Audio API Mock for Node.js test environment
class MockAudioNode {
  constructor() {
    this.gain = {
      value: 1,
      setValueAtTime: (val) => { this.gain.value = val; },
    };
    this.pan = {
      value: 0,
      setValueAtTime: (val) => { this.pan.value = val; },
    };
    this.threshold = { value: -3, setValueAtTime: (val) => { this.threshold.value = val; } };
    this.knee = { value: 6, setValueAtTime: (val) => { this.knee.value = val; } };
    this.ratio = { value: 16, setValueAtTime: (val) => { this.ratio.value = val; } };
    this.attack = { value: 0.003, setValueAtTime: (val) => { this.attack.value = val; } };
    this.release = { value: 0.2, setValueAtTime: (val) => { this.release.value = val; } };
    this.playbackRate = { value: 1, setValueAtTime: (val) => { this.playbackRate.value = val; } };
  }
  connect(dest) { return dest; }
}

class MockAudioBufferSourceNode extends MockAudioNode {
  constructor() {
    super();
    this.buffer = null;
    this.onended = null;
    this.playing = false;
  }
  start() { this.playing = true; }
  stop() {
    this.playing = false;
    if (this.onended) this.onended();
  }
}

class MockAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = new MockAudioNode();
  }
  createGain() { return new MockAudioNode(); }
  createStereoPanner() { return new MockAudioNode(); }
  createDynamicsCompressor() { return new MockAudioNode(); }
  createBufferSource() { return new MockAudioBufferSourceNode(); }
  async resume() { this.state = 'running'; }
}

test('P3-01. 5-Bus Hierarchy & DynamicsCompressor Limiter', () => {
  const am = new AudioManager();
  // 주입 Mock AudioContext
  globalThis.window = { AudioContext: MockAudioContext };
  am._initAudioGraph();

  // 1. 5개 버스 존재 검증 (Master / SFX / Music / Ambience / UI)
  assert.ok(am.masterBus, 'Master bus must be initialized');
  assert.ok(am.sfxBus, 'SFX bus must be initialized');
  assert.ok(am.musicBus, 'Music bus must be initialized');
  assert.ok(am.ambienceBus, 'Ambience bus must be initialized');
  assert.ok(am.uiBus, 'UI bus must be initialized');

  // 2. 마스터 리미터(피크 컴프레서) 검증
  assert.ok(am.limiter, 'Limiter (DynamicsCompressorNode) must be initialized on master output');
  assert.equal(am.limiter.threshold.value, -3, 'Limiter threshold must be -3 dBFS');

  // 3. 버스별 볼륨 조절 독립성 검증
  am.setVolume('sfx', 0.4);
  assert.equal(am.sfxBus.gain.value, 0.4);
  am.setVolume('music', 0.8);
  assert.equal(am.musicBus.gain.value, 0.8);
  assert.equal(am.sfxBus.gain.value, 0.4, 'SFX bus volume must not be affected by music bus');

  // 4. 음소거 검증
  am.setMuted(true);
  assert.equal(am.masterBus.gain.value, 0, 'Master bus must be 0 when muted');
  am.setMuted(false);
  assert.equal(am.masterBus.gain.value, 1.0, 'Master bus must restore volume when unmuted');
});

test('P3-01. Spatial Audio (Distance Attenuation & Stereo Panning)', () => {
  const am = new AudioManager();
  globalThis.window = { AudioContext: MockAudioContext };
  am._initAudioGraph();

  const mockBuffer = { duration: 0.5, numberOfChannels: 1 };
  assets.audioBuffers.set('sfx.sword_swing', mockBuffer);

  const playerX = 10;
  const playerY = 10;

  // 1. 우측 적 (pan > 0)
  let capturedOptions = null;
  const origPlaySFX = am.playSFX.bind(am);
  am.playSFX = (key, opts) => {
    capturedOptions = opts;
    return origPlaySFX(key, opts);
  };

  am.playSpatialSFX('swordSwing', 15, 10, playerX, playerY);
  assert.ok(capturedOptions, 'Spatial SFX must call playSFX with calculated options');
  assert.ok(capturedOptions.pan > 0, 'Sound to the right of player must have positive pan');
  assert.ok(capturedOptions.gain < 1.0, 'Sound at distance 5m must be attenuated');

  // 2. 좌측 적 (pan < 0)
  am.playSpatialSFX('swordSwing', 4, 10, playerX, playerY);
  assert.ok(capturedOptions.pan < 0, 'Sound to the left of player must have negative pan');

  // 3. 최대 청취 거리(22m) 초과 시 사운드 재생 억제
  const playedFar = am.playSpatialSFX('swordSwing', 50, 50, playerX, playerY);
  assert.equal(playedFar, false, 'Sound beyond max distance must not be played');
});

test('P3-01. 4-Rhythm Indicators for Gate & Tide (Audio-Only Distinction)', () => {
  const am = new AudioManager();
  globalThis.window = { AudioContext: MockAudioContext };
  am._initAudioGraph();

  const cues = ['gate_beacon', 'tide_1', 'tide_2', 'tide_3'];
  const playedCues = [];

  am.playSFX = (key) => {
    playedCues.push(key);
    return true;
  };

  for (const cue of cues) {
    am.playRhythmCue(cue);
  }

  assert.equal(playedCues.length, 4, 'Must trigger 4 distinct cues');
  assert.equal(playedCues[0], 'rhythm_gate_beacon', 'Gate beacon rhythm must be distinct');
  assert.equal(playedCues[1], 'rhythm_tide_1', 'Tide 1 slow drone pulse must be distinct');
  assert.equal(playedCues[2], 'rhythm_tide_2', 'Tide 2 double thud pulse must be distinct');
  assert.equal(playedCues[3], 'rhythm_tide_3', 'Tide 3 urgent quadruple pulse must be distinct');

  // 신시사이저 정의 검증
  assert.equal(typeof SFX.rhythm_gate_beacon, 'function');
  assert.equal(typeof SFX.rhythm_tide_1, 'function');
  assert.equal(typeof SFX.rhythm_tide_2, 'function');
  assert.equal(typeof SFX.rhythm_tide_3, 'function');
});

test('P3-01. Abyss Heartbeat Rate Escalation (60~120 BPM)', () => {
  const am = new AudioManager();
  globalThis.window = { AudioContext: MockAudioContext };
  am._initAudioGraph();

  let heartbeats = 0;
  const origHeartbeat = SFX.heartbeat;
  SFX.heartbeat = () => { heartbeats++; };

  try {
    // 1. 기본 상태: 60 BPM (1초 주기)
    am.updateHeartbeat(0.5, 0, -1);
    assert.equal(heartbeats, 0, 'No heartbeat before interval');
    am.updateHeartbeat(0.6, 0, -1);
    assert.equal(heartbeats, 1, 'Heartbeat must trigger after 1.0s at 60 BPM');

    // 2. 조수 2단계: 120 BPM (0.5초 주기)
    heartbeats = 0;
    am.heartbeatTimer = 0;
    am.updateHeartbeat(0.55, 0, 2);
    assert.equal(heartbeats, 1, 'Heartbeat must trigger at 0.5s interval during Tide 3 (120 BPM)');
  } finally {
    SFX.heartbeat = origHeartbeat;
  }
});

test('P3-01. Whisper Layer at Gaze >= 61 (Never Falsifies Combat Sounds)', () => {
  const am = new AudioManager();
  globalThis.window = { AudioContext: MockAudioContext };
  am._initAudioGraph();

  let whisperPlayed = false;
  am.playSFX = (key) => {
    if (key === 'whisper') whisperPlayed = true;
    return true;
  };

  // 1. 시선 < 61: 속삭임 비활성화
  am.updateWhispers(6.0, 50);
  assert.equal(whisperPlayed, false, 'Whispers must NOT trigger when gaze < 61');

  // 2. 시선 >= 61: 속삭임 주기적 발생
  am.updateWhispers(6.0, 65);
  assert.equal(whisperPlayed, true, 'Whispers must trigger when gaze >= 61');
});

test('P3-01. 32-SFX Concurrency Limit & Anti-Clipping Stress Test', () => {
  const am = new AudioManager();
  globalThis.window = { AudioContext: MockAudioContext };
  am._initAudioGraph();

  const mockBuffer = { duration: 1.0, numberOfChannels: 2 };
  assets.audioBuffers.set('sfx.sword_hit', mockBuffer);
  assets.audioBuffers.set('sfx.sword_swing', mockBuffer);

  // 40개의 SFX를 동시 트리거
  for (let i = 0; i < 40; i++) {
    am.playSFX('swordHit');
  }

  // 단일 키당 최대 인스턴스는 4개 이하로 제한되어야 함
  const activeHits = am.activeSfxInstances.get('sfx.sword_hit');
  assert.ok(activeHits, 'Active instances set must exist');
  assert.ok(activeHits.size <= 4, `Per-key instances (${activeHits.size}) must not exceed maxConcurrentPerKey (4)`);
  assert.ok(am.totalActiveSfxCount <= 32, 'Total active SFX must not exceed 32');
});
