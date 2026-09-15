// ============================================================================
// 결정론적 시드 난수 생성기 (Seeded RNG)
// Mulberry32 알고리즘 기반, 독립 명명 스트림 지원 (map, spawn, loot, combat, meta)
// ============================================================================

export function hashString(str) {
  const s = String(str);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

export function createMulberry32(seed) {
  let state = (typeof seed === 'number' ? seed : hashString(seed)) >>> 0;
  return function next() {
    let t = (state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSeed() {
  return Math.floor(Math.random() * 1e9);
}

export function rollMetaRng(save) {
  if (!save) return 0.5;
  const seed = typeof save.metaSeed === 'number' ? save.metaSeed : 1337;
  const step = typeof save.metaRngStep === 'number' ? save.metaRngStep : 0;
  save.metaRngStep = step + 1;
  const streamSeed = hashString(`${seed}:meta:${step}`);
  const nextFn = createMulberry32(streamSeed);
  return nextFn();
}

export class StreamRng {
  constructor(seed) {
    this.initialSeed = seed;
    this._rawNext = createMulberry32(seed);
    this.callCount = 0;
  }

  next() {
    this.callCount++;
    return this._rawNext();
  }

  range(min, max) {
    return min + this.next() * (max - min);
  }

  int(min, max) {
    return Math.floor(min + this.next() * (max - min + 1));
  }

  choice(array) {
    if (!array || array.length === 0) return null;
    const idx = Math.floor(this.next() * array.length);
    return array[idx];
  }

  chance(p) {
    return this.next() < p;
  }

  shuffle(array) {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}

export class SeededRng {
  constructor(masterSeed = 1337) {
    this.masterSeed = masterSeed;
    this.streams = new Map();
  }

  getStream(name) {
    if (!this.streams.has(name)) {
      const streamSeed = hashString(`${this.masterSeed}:${name}`);
      this.streams.set(name, new StreamRng(streamSeed));
    }
    return this.streams.get(name);
  }

  stream(name) {
    return this.getStream(name);
  }

  // 기본 스트림 바로 접근용 편의 속성
  get map() { return this.getStream('map'); }
  get spawn() { return this.getStream('spawn'); }
  get loot() { return this.getStream('loot'); }
  get combat() { return this.getStream('combat'); }
  get perk() { return this.getStream('perk'); }
  get meta() { return this.getStream('meta'); }
}
