/**
 * Pixel Momentum Print (픽셀 관성 인쇄) - Procedural Web Audio Engine
 * Pure Web Audio API synthesis for kinetic impact, momentum stamps, and time dilation.
 */
class MomentumAudioManager {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.masterGain = null;
    this.ambientOsc = null;
    this.ambientFilter = null;
    this.isInitialized = false;
    this.inSlowMo = false;
  }

  init() {
    if (this.isInitialized) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.7, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
      this.isInitialized = true;
      this.setupAmbientHum();
    } catch (e) {
      console.warn("Web Audio API not supported or blocked:", e);
    }
  }

  ensureContext() {
    if (!this.isInitialized) this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.7, this.ctx.currentTime);
    }
    return this.isMuted;
  }

  setupAmbientHum() {
    if (!this.ctx || this.ambientOsc) return;
    this.ambientOsc = this.ctx.createOscillator();
    this.ambientOsc.type = 'triangle';
    this.ambientOsc.frequency.setValueAtTime(65.4, this.ctx.currentTime); // C2

    this.ambientFilter = this.ctx.createBiquadFilter();
    this.ambientFilter.type = 'lowpass';
    this.ambientFilter.frequency.setValueAtTime(180, this.ctx.currentTime);

    const droneGain = this.ctx.createGain();
    droneGain.gain.setValueAtTime(0.08, this.ctx.currentTime);

    this.ambientOsc.connect(this.ambientFilter);
    this.ambientFilter.connect(droneGain);
    droneGain.connect(this.masterGain);

    this.ambientOsc.start();
  }

  setSlowMoAudio(isSlowMo) {
    if (!this.ctx || !this.ambientFilter || this.inSlowMo === isSlowMo) return;
    this.inSlowMo = isSlowMo;
    const now = this.ctx.currentTime;
    if (isSlowMo) {
      // Muffler / time slow effect
      this.ambientFilter.frequency.setTargetAtTime(90, now, 0.1);
      this.playWhoosh(false);
    } else {
      this.ambientFilter.frequency.setTargetAtTime(180, now, 0.1);
      this.playWhoosh(true);
    }
  }

  playWhoosh(pitchUp = true) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';

    if (pitchUp) {
      osc.frequency.setValueAtTime(120, now);
      osc.frequency.exponentialRampToValueAtTime(320, now + 0.12);
    } else {
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.12);
    }

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  // 1. Vector Extraction / Collect
  playCollect() {
    this.ensureContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(350, now);
    osc.frequency.exponentialRampToValueAtTime(950, now + 0.15);

    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  // 2. Momentum Stamp Printing
  playPrint(magnitude = 1) {
    this.ensureContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Stamp mechanical click
    const click = this.ctx.createOscillator();
    const clickGain = this.ctx.createGain();
    click.type = 'triangle';
    click.frequency.setValueAtTime(1200, now);
    click.frequency.exponentialRampToValueAtTime(150, now + 0.08);
    clickGain.gain.setValueAtTime(0.5, now);
    clickGain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

    click.connect(clickGain);
    clickGain.connect(this.masterGain);
    click.start(now);
    click.stop(now + 0.08);

    // Kinetic blast bass
    const bass = this.ctx.createOscillator();
    const bassGain = this.ctx.createGain();
    bass.type = 'sine';
    const baseFreq = 80 + magnitude * 40;
    bass.frequency.setValueAtTime(baseFreq, now);
    bass.frequency.exponentialRampToValueAtTime(30, now + 0.22);

    const bassVol = 0.3 + magnitude * 0.18;
    bassGain.gain.setValueAtTime(bassVol, now);
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    bass.connect(bassGain);
    bassGain.connect(this.masterGain);
    bass.start(now);
    bass.stop(now + 0.22);
  }

  // 3. Collision / Kinetic Impact
  playImpact(strength = 1) {
    this.ensureContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140 * strength, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.16);

    gain.gain.setValueAtTime(Math.min(0.6, 0.25 * strength), now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.16);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  // 4. Deflection / Bumper Bounce
  playDeflect() {
    this.ensureContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  // 5. Switch / Gate Activation
  playSwitch() {
    this.ensureContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const freqs = [440, 554.37, 659.25]; // A major
    freqs.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + i * 0.04);
      gain.gain.setValueAtTime(0.25, now + i * 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.04 + 0.3);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + i * 0.04);
      osc.stop(now + i * 0.04 + 0.3);
    });
  }

  // 6. Level Clear Fanfare
  playVictory() {
    this.ensureContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const melody = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    melody.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);
      gain.gain.setValueAtTime(0.35, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.4);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.4);
    });
  }

  // 7. Hazard Hit
  playHazard() {
    this.ensureContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.linearRampToValueAtTime(70, now + 0.25);
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.25);
  }
}

window.MomentumAudioManager = MomentumAudioManager;
