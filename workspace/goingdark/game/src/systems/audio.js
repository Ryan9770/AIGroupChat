// ============================================================================
// 신시사이징 오디오 생성기 (src/systems/audio.js)
// Web Audio API 순수 신시사이징 SFX (P3-01: 전조음, 4개 리듬, 발소리 변주, 심장박동)
// ============================================================================

let ctx = null;
export function getCtx() {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!ctx) ctx = new AudioCtx();
  return ctx;
}

function envGain(ac, t0, attack, decay, peak = 0.5) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + attack + decay);
  return g;
}

export function tone(freq, dur, type = 'sine', peak = 0.4, freqEnd = null, destNode = null) {
  const ac = getCtx();
  if (!ac) return;
  const t0 = ac.currentTime;
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
  const g = envGain(ac, t0, 0.005, dur, peak);
  osc.connect(g).connect(destNode || ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export function noiseBurst(dur, peak = 0.3, filterFreq = 2000, filterType = 'bandpass', destNode = null) {
  const ac = getCtx();
  if (!ac) return;
  const t0 = ac.currentTime;
  const bufferSize = Math.floor(ac.sampleRate * dur);
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = filterFreq;
  const g = envGain(ac, t0, 0.005, dur, peak);
  src.connect(filter).connect(g).connect(destNode || ac.destination);
  src.start(t0);
}

export const SFX = {
  // 기본 전투 SFX
  swordHit: () => { tone(180, 0.12, 'sawtooth', 0.35, 90); noiseBurst(0.08, 0.2, 3000); },
  swordSwing: () => noiseBurst(0.09, 0.12, 4500),
  shieldBlock: () => { tone(320, 0.15, 'square', 0.3, 220); noiseBurst(0.05, 0.15, 1200); },
  crossbowFire: () => { tone(900, 0.08, 'triangle', 0.25, 300); noiseBurst(0.05, 0.15, 6000); },
  golemSmash: () => { tone(70, 0.4, 'sine', 0.5, 40); noiseBurst(0.3, 0.35, 400); },
  hitPlayer: () => tone(140, 0.18, 'sawtooth', 0.3, 60),
  holyBell: () => { tone(880, 1.1, 'sine', 0.25, 880); tone(1320, 1.1, 'sine', 0.12, 1320); },
  gateAlarm: () => { tone(220, 0.5, 'square', 0.25, 440); setTimeout(() => tone(220, 0.5, 'square', 0.25, 440), 260); },
  tideHorn: () => tone(90, 1.4, 'sawtooth', 0.35, 60),
  goldChime: () => { tone(1200, 0.08, 'sine', 0.2, 1400); setTimeout(() => tone(1600, 0.08, 'sine', 0.15, 1800), 60); },
  upgradeSuccess: () => { [660, 880, 1100].forEach((f, i) => setTimeout(() => tone(f, 0.2, 'triangle', 0.25), i * 90)); },
  upgradeFail: () => { tone(200, 0.3, 'sawtooth', 0.3, 80); noiseBurst(0.2, 0.2, 800); },
  destroy: () => { noiseBurst(0.5, 0.4, 500); tone(90, 0.5, 'sawtooth', 0.3, 30); },
  roll: () => noiseBurst(0.15, 0.1, 2500),
  step: () => noiseBurst(0.03, 0.03, 1800),
  death: () => tone(120, 1.2, 'sawtooth', 0.35, 40),
  chestOpen: () => { tone(500, 0.15, 'triangle', 0.2, 700); },
  questComplete: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'sine', 0.2), i * 100)); },

  // ==========================================================================
  // P3-01: 적별 0.4초 이상 고유 전조음 세트 (11_creative_direction.md §5.5)
  // ==========================================================================
  // 해골병정: 마른 뼈 딸깍 + 석궁 기계 장전음
  telegraph_skeleton: () => {
    noiseBurst(0.04, 0.25, 3200, 'highpass');
    setTimeout(() => tone(600, 0.15, 'square', 0.18, 1200), 80);
    setTimeout(() => noiseBurst(0.05, 0.2, 4500), 220);
  },
  // 심연충: 젖은 스크래치 군집음
  telegraph_mite: () => {
    noiseBurst(0.12, 0.25, 1400, 'bandpass');
    setTimeout(() => noiseBurst(0.15, 0.28, 1800, 'bandpass'), 70);
    setTimeout(() => tone(220, 0.15, 'sawtooth', 0.15, 110), 160);
  },
  // 수호 골렘: 무거운 사슬 끌림 + 저역 금속 충격음
  telegraph_golem: () => {
    noiseBurst(0.25, 0.3, 800, 'lowpass');
    tone(65, 0.45, 'triangle', 0.4, 35);
    setTimeout(() => tone(130, 0.25, 'sawtooth', 0.25, 60), 120);
  },
  // 왕실 호위 잔재: 정렬된 금속 발구름 2박 (0ms, 180ms)
  telegraph_royalGuard: () => {
    tone(180, 0.12, 'square', 0.3, 90);
    noiseBurst(0.06, 0.25, 2400);
    setTimeout(() => {
      tone(220, 0.14, 'square', 0.35, 110);
      noiseBurst(0.07, 0.3, 2600);
    }, 180);
  },
  // 심연 망령: 역재생 호흡 및 냉기 파문
  telegraph_wraith: () => {
    const ac = getCtx();
    if (!ac) return;
    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t0);
    osc.frequency.exponentialRampToValueAtTime(360, t0 + 0.4);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.01, t0);
    g.gain.linearRampToValueAtTime(0.3, t0 + 0.35);
    g.gain.linearRampToValueAtTime(0.001, t0 + 0.45);
    osc.connect(g).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + 0.5);
  },
  // 감시자 보스: 왜곡된 방송 종소리
  telegraph_warden: () => {
    tone(440, 0.6, 'sawtooth', 0.3, 220);
    tone(880, 0.7, 'sine', 0.2, 440);
    setTimeout(() => tone(220, 0.8, 'triangle', 0.35, 110), 150);
  },
  // 하르트 사이드 보스: 회전 창바람
  telegraph_hart: () => {
    noiseBurst(0.35, 0.3, 1600, 'bandpass');
    tone(300, 0.25, 'sine', 0.2, 600);
  },

  // ==========================================================================
  // P3-01: 게이트 & 조수 4개 고유 리듬 (화면 없이 오디오만으로 판별)
  // ==========================================================================
  // 1. 게이트 개방 및 충전: 3음 상행 차임 (Ding-Ding-Dong, 3박자 왈츠 리듬)
  rhythm_gate_beacon: () => {
    [523, 659, 784].forEach((f, idx) => {
      setTimeout(() => tone(f, 0.25, 'sine', 0.22, f), idx * 160);
    });
  },
  // 2. 조수 1단계: 느린 1박 저역 드론 (15 BPM 펄스, 90Hz)
  rhythm_tide_1: () => {
    tone(90, 0.8, 'sawtooth', 0.25, 75);
  },
  // 3. 조수 2단계: 2박 연속 침수 더블 쿵 (30 BPM 싱코페이션)
  rhythm_tide_2: () => {
    tone(70, 0.3, 'sine', 0.35, 45);
    setTimeout(() => tone(85, 0.35, 'sawtooth', 0.4, 50), 220);
  },
  // 4. 조수 3단계: 긴급 4박 경보 (60 BPM 쿼드러플 비트)
  rhythm_tide_3: () => {
    [0, 160, 320, 480].forEach((delay) => {
      setTimeout(() => {
        tone(350, 0.1, 'square', 0.28, 500);
        noiseBurst(0.06, 0.15, 3000);
      }, delay);
    });
  },

  // ==========================================================================
  // P3-01: 아비그라 심장박동 레이어 (BPM 조절 가능한 2단 lub-dub)
  // ==========================================================================
  heartbeat: () => {
    // 1타: lub (낮은 쿵)
    tone(55, 0.12, 'sine', 0.35, 40);
    // 2타: dub (약간 높은 쿵)
    setTimeout(() => {
      tone(65, 0.14, 'sine', 0.4, 45);
    }, 180);
  },

  // ==========================================================================
  // P3-01: 시선 61+ 속삭임 레이어 (환각 유도 앰비언트)
  // ==========================================================================
  whisper: () => {
    const ac = getCtx();
    if (!ac) return;
    noiseBurst(0.6, 0.12, 1200, 'bandpass');
  },

  // ==========================================================================
  // P3-01: 재질별 발소리 변주 (석재/주화/뼈/육벽)
  // ==========================================================================
  footstep_stone: (pitch = 1.0) => {
    noiseBurst(0.04, 0.08, 1600 * pitch, 'bandpass');
  },
  footstep_coin: (pitch = 1.0) => {
    tone(1400 * pitch, 0.05, 'triangle', 0.1, 1800 * pitch);
    noiseBurst(0.03, 0.06, 3500 * pitch);
  },
  footstep_bone: (pitch = 1.0) => {
    tone(320 * pitch, 0.05, 'sine', 0.15, 120 * pitch);
    noiseBurst(0.02, 0.12, 2800 * pitch);
  },
  footstep_flesh: (pitch = 1.0) => {
    tone(90 * pitch, 0.08, 'sawtooth', 0.18, 50 * pitch);
    noiseBurst(0.04, 0.1, 800 * pitch, 'lowpass');
  },
};

export function ensureAudioResumed() {
  const ac = getCtx();
  if (ac && ac.state === 'suspended') ac.resume();
}
