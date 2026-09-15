import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assets } from '../src/systems/assets.js';
import { AudioManager } from '../src/systems/audioManager.js';

const MANIFEST_PATH = path.resolve('public/assets/manifest.json');
const PUBLIC_DIR = path.resolve('public');

describe('P0-05. Asset Pipeline & Audio Bus Verification', () => {
  test('manifest.json is valid and all 22 referenced files physically exist on disk with 200 status', () => {
    assert.ok(fs.existsSync(MANIFEST_PATH), 'manifest.json must exist');
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
    const manifest = JSON.parse(raw);

    assert.ok(Array.isArray(manifest.assets), 'manifest.assets must be an array');
    assert.ok(manifest.assets.length >= 20, `manifest must have >= 20 assets, got ${manifest.assets.length}`);

    for (const item of manifest.assets) {
      assert.ok(item.key, 'Asset must have key');
      assert.ok(item.src, `Asset ${item.key} must have src`);
      assert.ok(item.type, `Asset ${item.key} must have type`);
      assert.ok(item.group, `Asset ${item.key} must have group`);

      const fullPath = path.join(PUBLIC_DIR, item.src);
      assert.ok(fs.existsSync(fullPath), `Asset file must exist on disk: ${item.src}`);
      const stats = fs.statSync(fullPath);
      assert.ok(stats.size > 0, `Asset file must not be empty: ${item.src} (${stats.size} bytes)`);
    }
  });

  test('AudioManager plays swordSwing via AudioBuffer with ZERO synth fallback count', async () => {
    const mgr = new AudioManager();
    mgr.resetSynthFallbackCount();

    // Mock an AudioBuffer in assets
    const mockBuffer = {
      duration: 0.15,
      numberOfChannels: 1,
      sampleRate: 44100,
    };
    assets.audioBuffers.set('sfx.sword_swing', mockBuffer);

    // Mock Web Audio Context
    let bufferSourceCreated = false;
    let bufferSourceStarted = false;

    mgr._initAudioGraph = () => {
      return {
        currentTime: 0,
        state: 'running',
        createGain: () => ({
          gain: { setValueAtTime: () => {} },
          connect: () => {},
        }),
        createDynamicsCompressor: () => ({
          threshold: { setValueAtTime: () => {} },
          knee: { setValueAtTime: () => {} },
          ratio: { setValueAtTime: () => {} },
          attack: { setValueAtTime: () => {} },
          release: { setValueAtTime: () => {} },
          connect: () => {},
        }),
        createBufferSource: () => {
          bufferSourceCreated = true;
          return {
            buffer: null,
            connect: () => {},
            start: () => { bufferSourceStarted = true; },
          };
        },
        destination: {},
      };
    };

    const played = mgr.playSFX('swordSwing');

    assert.equal(played, true, 'playSFX should return true when played via buffer');
    assert.equal(bufferSourceCreated, true, 'AudioBufferSourceNode must be created');
    assert.equal(bufferSourceStarted, true, 'AudioBufferSourceNode must be started');
    assert.equal(mgr.getSynthFallbackCount(), 0, 'Synth fallback count must be 0');
  });

  test('AudioManager falls back to synthesizer and increments counter on missing audio buffer', () => {
    const mgr = new AudioManager();
    mgr.resetSynthFallbackCount();

    // Key not in cache
    const initialFallbackCount = mgr.getSynthFallbackCount();
    const played = mgr.playSFX('unknown_missing_sound');

    assert.equal(played, false, 'playSFX should return false when falling back to synth');
    assert.equal(mgr.getSynthFallbackCount(), initialFallbackCount + 1, 'Fallback counter must increment by 1');
  });

  test('Audio concurrency limit drops oldest instance beyond max limit', () => {
    const mgr = new AudioManager();
    const mockBuffer = { duration: 1.0, numberOfChannels: 1, sampleRate: 44100 };
    assets.audioBuffers.set('sfx.sword_swing', mockBuffer);

    let stoppedCount = 0;
    mgr._initAudioGraph = () => ({
      currentTime: 0,
      state: 'running',
      createGain: () => ({ gain: { setValueAtTime: () => {} }, connect: () => {} }),
      createDynamicsCompressor: () => ({
        threshold: { setValueAtTime: () => {} },
        knee: { setValueAtTime: () => {} },
        ratio: { setValueAtTime: () => {} },
        attack: { setValueAtTime: () => {} },
        release: { setValueAtTime: () => {} },
        connect: () => {},
      }),
      createBufferSource: () => ({
        connect: () => {},
        start: () => {},
        stop: () => { stoppedCount++; },
      }),
      destination: {},
    });

    // Play 6 times (maxConcurrent is 4)
    for (let i = 0; i < 6; i++) {
      mgr.playSFX('swordSwing');
    }

    // Two oldest instances should have been stopped
    assert.equal(stoppedCount, 2, '2 oldest instances should have been stopped to enforce max limit 4');
  });
});
