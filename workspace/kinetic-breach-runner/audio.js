/**
 * Kinetic Breach Runner (절개항해) - Procedural Web Audio Engine
 * Pure Web Audio API procedural synthesis with zero external audio assets.
 */
class AudioManager {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.masterGain = null;
    this.ambientDrone = null;
    this.alarmOsc = null;
    this.alarmGain = null;
    this.isInitialized = false;
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
    if (!this.isInitialized) {
      this.init();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.7, this.ctx.currentTime);
    }
    return this.isMuted;
  }

  setupAmbientHum() {
    if (!this.ctx || this.ambientDrone) return;

    // Dual low drone oscillators for reactor rumble
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const subOsc = this.ctx.createOscillator();

    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(55, this.ctx.currentTime); // A1
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(55.6, this.ctx.currentTime); // Slight detune for phasing
    subOsc.type = 'triangle';
    subOsc.frequency.setValueAtTime(27.5, this.ctx.currentTime); // A0 sub

    // Lowpass filter controlled by pressure
    this.droneFilter = this.ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.setValueAtTime(140, this.ctx.currentTime);
    this.droneFilter.Q.setValueAtTime(2.0, this.ctx.currentTime);

    this.droneGain = this.ctx.createGain();
    this.droneGain.gain.setValueAtTime(0.12, this.ctx.currentTime);

    osc1.connect(this.droneFilter);
    osc2.connect(this.droneFilter);
    subOsc.connect(this.droneFilter);
    this.droneFilter.connect(this.droneGain);
    this.droneGain.connect(this.masterGain);

    osc1.start();
    osc2.start();
    subOsc.start();

    this.ambientDrone = { osc1, osc2, subOsc };

    // Emergency alarm synthesizer
    this.alarmOsc = this.ctx.createOscillator();
    this.alarmOsc.type = 'sawtooth';
    this.alarmOsc.frequency.setValueAtTime(880, this.ctx.currentTime);

    this.alarmFilter = this.ctx.createBiquadFilter();
    this.alarmFilter.type = 'bandpass';
    this.alarmFilter.frequency.setValueAtTime(950, this.ctx.currentTime);
    this.alarmFilter.Q.setValueAtTime(4.0, this.ctx.currentTime);

    this.alarmGain = this.ctx.createGain();
    this.alarmGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

    this.alarmOsc.connect(this.alarmFilter);
    this.alarmFilter.connect(this.alarmGain);
    this.alarmGain.connect(this.masterGain);

    this.alarmOsc.start();
  }

  // Updates ambient pressure audio dynamically
  updatePressure(pressureRatio) {
    if (!this.ctx || !this.droneFilter) return;
    const now = this.ctx.currentTime;
    const clamped = Math.max(0, Math.min(1, pressureRatio));

    // Open filter cutoff as pressure rises: 140Hz -> 650Hz
    const targetCutoff = 140 + clamped * 550;
    this.droneFilter.frequency.setTargetAtTime(targetCutoff, now, 0.2);

    // Increase drone presence slightly
    if (this.droneGain) {
      const targetGain = 0.12 + clamped * 0.15;
      this.droneGain.gain.setTargetAtTime(targetGain, now, 0.2);
    }

    // Alarm triggers if pressure >= 0.75 (Critical)
    if (this.alarmGain && this.alarmOsc) {
      if (clamped >= 0.75) {
        // Fast pulsed alarm
        const pulse = (Math.sin(now * 8) + 1) * 0.5;
        const alarmVolume = (clamped - 0.75) * 4 * 0.15 * pulse;
        this.alarmGain.gain.setTargetAtTime(alarmVolume, now, 0.05);
        this.alarmOsc.frequency.setValueAtTime(800 + pulse * 250, now);
      } else {
        this.alarmGain.gain.setTargetAtTime(0, now, 0.1);
      }
    }
  }

  // 1. Cut / Breach Slash Sound
  playCut() {
    this.ensureContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // High frequency plasma slice
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.14);

    gain.gain.setValueAtTime(0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.14);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.14);

    // Noise burst for mechanical fracture
    this.playNoise(0.12, 1200, 0.35);
  }

  // 2. Kinetic Recoil Thruster Impulse
  playRecoil() {
    this.ensureContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.25);

    gain.gain.setValueAtTime(0.6, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.25);

    // Low thruster whoosh
    this.playNoise(0.22, 280, 0.4);
  }

  // 3. Wall Shatter / Debris Cracking
  playShatter() {
    this.ensureContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Sharp ping
    const ping = this.ctx.createOscillator();
    const pingGain = this.ctx.createGain();
    ping.type = 'sawtooth';
    ping.frequency.setValueAtTime(600 + Math.random() * 300, now);
    ping.frequency.exponentialRampToValueAtTime(120, now + 0.18);
    pingGain.gain.setValueAtTime(0.4, now);
    pingGain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
    ping.connect(pingGain);
    pingGain.connect(this.masterGain);
    ping.start(now);
    ping.stop(now + 0.18);

    this.playNoise(0.2, 800 + Math.random() * 400, 0.45);
  }

  // 4. Nanite Foam Seal Spray & Pop
  playSeal() {
    this.ensureContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // High hiss spray
    this.playNoise(0.25, 2400, 0.35);

    // Curing pop sound
    setTimeout(() => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const pop = this.ctx.createOscillator();
      const popGain = this.ctx.createGain();
      pop.type = 'sine';
      pop.frequency.setValueAtTime(320, t);
      pop.frequency.exponentialRampToValueAtTime(800, t + 0.08);
      popGain.gain.setValueAtTime(0.35, t);
      popGain.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
      pop.connect(popGain);
      popGain.connect(this.masterGain);
      pop.start(t);
      pop.stop(t + 0.08);
    }, 120);
  }

  // 5. Specimen Pod Collect Chime
  playCollect() {
    this.ensureContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6

    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.05);

      gain.gain.setValueAtTime(0.28, now + idx * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.05 + 0.25);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + idx * 0.05);
      osc.stop(now + idx * 0.05 + 0.25);
    });
  }

  // 6. Sealant / Item Pickup
  playItemPickup() {
    this.ensureContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  // 7. Hazard Hit / Damage Sound
  playDamage() {
    this.ensureContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.22);

    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.22);

    this.playNoise(0.2, 500, 0.4);
  }

  // 8. Airlock Depressurization & Chamber Eject Chime
  playAirlock() {
    this.ensureContext();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // Steam whoosh
    this.playNoise(0.5, 450, 0.3);

    // Harmonic airlock chime
    const chords = [440, 554.37, 659.25]; // A major
    chords.forEach(freq => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + 0.2);

      gain.gain.setValueAtTime(0.2, now + 0.2);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now + 0.2);
      osc.stop(now + 0.8);
    });
  }

  // 9. Procedural Filtered Noise Generator
  playNoise(duration, cutoffHz, volume = 0.3) {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoffHz, this.ctx.currentTime);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

    whiteNoise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    whiteNoise.start();
  }
}

window.AudioManager = AudioManager;
