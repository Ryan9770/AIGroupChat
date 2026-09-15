// ============================================================================
// 에셋 매니페스트 로더 (AssetLoader)
// 이미지 및 AudioBuffer 사전 디코드, 그룹별 프리로드, 진행률 및 실패 목록 수집
// P0-05: 매니페스트 기반 프리로드 및 캐시 저장소
// ============================================================================

export class AssetRepository {
  constructor() {
    this.manifest = null;
    this.images = new Map();
    this.audioBuffers = new Map();
    this.failed = [];
    this.loadedGroups = new Set();
  }

  async loadManifest(url = 'assets/manifest.json') {
    if (typeof fetch === 'undefined') {
      this.manifest = {
        version: '1.0.0',
        assets: [
          { key: 'image.tileset_0x72', type: 'image', src: 'assets/sprites/0x72_DungeonTilesetII_v1.7.png', group: 'boot' },
          { key: 'sfx.sword_swing', type: 'audio', src: 'assets/audio/knife_slice.ogg', group: 'boot' },
          { key: 'sfx.sword_hit', type: 'audio', src: 'assets/audio/chop.ogg', group: 'boot' },
          { key: 'sfx.gold_chime', type: 'audio', src: 'assets/audio/handle_coins.ogg', group: 'boot' },
          { key: 'amb.floor1_base', type: 'audio', src: 'assets/audio/dungeon_ambience.ogg', group: 'boot' },
        ],
      };
      return this.manifest;
    }

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.manifest = await res.json();
      return this.manifest;
    } catch (err) {
      console.warn('Failed to load asset manifest, using fallback manifest', err);
      this.manifest = {
        version: '1.0.0',
        assets: [
          { key: 'image.tileset_0x72', type: 'image', src: 'assets/sprites/0x72_DungeonTilesetII_v1.7.png', group: 'boot' },
          { key: 'sfx.sword_swing', type: 'audio', src: 'assets/audio/knife_slice.ogg', group: 'boot' },
          { key: 'sfx.sword_hit', type: 'audio', src: 'assets/audio/chop.ogg', group: 'boot' },
          { key: 'sfx.gold_chime', type: 'audio', src: 'assets/audio/handle_coins.ogg', group: 'boot' },
          { key: 'amb.floor1_base', type: 'audio', src: 'assets/audio/dungeon_ambience.ogg', group: 'boot' },
        ],
      };
      return this.manifest;
    }
  }

  async preloadGroup(group = 'boot', audioContext = null, onProgress = null) {
    if (!this.manifest) {
      await this.loadManifest();
    }

    const items = this.manifest.assets.filter(a => a.group === group);
    if (items.length === 0) return { total: 0, loaded: 0, failed: [] };

    let loadedCount = 0;
    const total = items.length;

    const loadPromises = items.map(async (item) => {
      try {
        if (item.type === 'image') {
          await this._loadImage(item.key, item.src);
        } else if (item.type === 'audio') {
          await this._loadAudio(item.key, item.src, audioContext);
        }
      } catch (err) {
        console.warn(`[AssetLoader] Failed to load ${item.key} (${item.src})`, err);
        this.failed.push({ key: item.key, src: item.src, error: err });
      } finally {
        loadedCount++;
        if (onProgress) {
          onProgress(loadedCount / total, item);
        }
      }
    });

    await Promise.all(loadPromises);
    this.loadedGroups.add(group);

    return {
      total,
      loaded: loadedCount - this.failed.length,
      failed: this.failed,
    };
  }

  _loadImage(key, src) {
    return new Promise((resolve, reject) => {
      if (typeof Image === 'undefined') {
        this.images.set(key, { src, width: 16, height: 16 });
        return resolve();
      }
      const img = new Image();
      img.onload = () => {
        this.images.set(key, img);
        resolve(img);
      };
      img.onerror = () => reject(new Error(`Image load error for ${src}`));
      img.src = src;
    });
  }

  async _loadAudio(key, src, audioContext) {
    if (typeof fetch === 'undefined') {
      this.audioBuffers.set(key, { duration: 1, sampleRate: 44100 });
      return;
    }

    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();

    if (audioContext && typeof audioContext.decodeAudioData === 'function') {
      const audioBuffer = await new Promise((resolve, reject) => {
        audioContext.decodeAudioData(arrayBuffer, resolve, reject);
      });
      this.audioBuffers.set(key, audioBuffer);
    } else {
      this.audioBuffers.set(key, arrayBuffer);
    }
  }

  get(key) {
    if (this.images.has(key)) return this.images.get(key);
    if (this.audioBuffers.has(key)) return this.audioBuffers.get(key);
    return null;
  }

  has(key) {
    return this.images.has(key) || this.audioBuffers.has(key);
  }

  getImage(key) {
    return this.images.get(key) ?? null;
  }

  getAudioBuffer(key) {
    return this.audioBuffers.get(key) ?? null;
  }
}

export const assets = new AssetRepository();
