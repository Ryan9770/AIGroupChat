// ============================================================================
// 세이브 시스템 v2 (SaveRepository)
// 스키마 버전 2, v1 마이그레이션, 필드 유효성 검사, 손상 시 백업 및 안전 복구
// P0-01: commitState 원자적 커밋 및 실패 시 롤백 + 저장 실패 모달
// ============================================================================

import { RULES_VERSION } from '../core/constants.js';
import { showSaveFailureModal } from './ui.js';
import { QUEST_DEFS } from '../data/quests.js';

export const SAVE_KEY_V2 = 'revenant_run_save_v2';
export const SAVE_KEY_V2_BAK_1 = 'revenant_run_save_v2_bak1';
export const SAVE_KEY_V2_BAK_2 = 'revenant_run_save_v2_bak2';
export const SAVE_KEY_V2_BAK_3 = 'revenant_run_save_v2_bak3';
export const SAVE_KEY_V1 = 'revenant_run_save_v1';
export const SAVE_KEY_BACKUP = 'revenant_run_save_v1_backup';

// P6-04: Steamworks 연동 인터페이스 훅
export const steamworksHooks = {
  unlockAchievement: (id) => {
    if (typeof window !== 'undefined' && window.steamAPI?.unlockAchievement) {
      window.steamAPI.unlockAchievement(id);
    }
  },
  setStat: (name, val) => {
    if (typeof window !== 'undefined' && window.steamAPI?.setStat) {
      window.steamAPI.setStat(name, val);
    }
  },
};

export const DEFAULT_STATE_V2 = {
  version: 2,
  rulesVersion: RULES_VERSION,
  metaSeed: 1337,
  metaRngStep: 0,
  gold: 60,
  inventory: [], // { id, tier, name, value, slot, consumableId?, questItem?, effect?, amount? }
  storage: [],
  weaponLevel: 0, // 강화도 (0~5)
  quests: Object.fromEntries(
    Object.keys(QUEST_DEFS).map(id => [id, { state: 'not_started' }])
  ),
  sq01_destroyProtection: false,
  factionRep: { guild: 0, vigil: 0, crown: 0 },
  deathHistory: [],
  deathStreak: 0,
  stats: { runs: 0, extractions: 0, deaths: 0 },
  accountLevel: 1,
  accountXp: 0,
  unlockedNodes: [],
  tutorialCompleted: false,
  settings: {
    soundVolume: 1.0,
    screenShake: true,
    reducedFlash: false,
  },
};

export function validateAndSanitize(data) {
  if (!data || typeof data !== 'object') {
    return structuredClone(DEFAULT_STATE_V2);
  }

  const clean = structuredClone(DEFAULT_STATE_V2);

  clean.rulesVersion = typeof data.rulesVersion === 'string' ? data.rulesVersion : RULES_VERSION;
  if (typeof data.metaSeed === 'number' && !isNaN(data.metaSeed)) {
    clean.metaSeed = Math.floor(data.metaSeed);
  }
  if (typeof data.metaRngStep === 'number' && !isNaN(data.metaRngStep)) {
    clean.metaRngStep = Math.max(0, Math.floor(data.metaRngStep));
  }

  if (typeof data.gold === 'number' && !isNaN(data.gold) && data.gold >= 0) {
    clean.gold = Math.floor(data.gold);
  }
  if (Array.isArray(data.inventory)) {
    clean.inventory = data.inventory.filter(i => i && typeof i === 'object' && i.id);
  }
  if (Array.isArray(data.storage)) {
    clean.storage = data.storage.filter(i => i && typeof i === 'object' && i.id);
  }
  if (typeof data.weaponLevel === 'number' && !isNaN(data.weaponLevel)) {
    clean.weaponLevel = Math.max(0, Math.min(5, Math.floor(data.weaponLevel)));
  }
  clean.quests = {};
  for (const qId of Object.keys(QUEST_DEFS)) {
    clean.quests[qId] = {
      state: data.quests?.[qId]?.state ?? 'not_started',
    };
  }
  clean.sq01_destroyProtection = Boolean(data.sq01_destroyProtection);
  if (data.factionRep && typeof data.factionRep === 'object') {
    clean.factionRep = {
      guild: Number(data.factionRep.guild) || 0,
      vigil: Number(data.factionRep.vigil) || 0,
      crown: Number(data.factionRep.crown) || 0,
    };
  }
  if (Array.isArray(data.deathHistory)) {
    clean.deathHistory = data.deathHistory.slice(0, 20);
  }
  clean.deathStreak = Number(data.deathStreak) || 0;
  if (data.stats && typeof data.stats === 'object') {
    clean.stats = {
      runs: Number(data.stats.runs) || 0,
      extractions: Number(data.stats.extractions) || 0,
      deaths: Number(data.stats.deaths) || 0,
    };
  }
  if (typeof data.accountLevel === 'number') {
    clean.accountLevel = Math.max(1, Math.min(10, Math.floor(data.accountLevel)));
  }
  if (typeof data.accountXp === 'number') {
    clean.accountXp = Math.max(0, Math.floor(data.accountXp));
  }
  if (Array.isArray(data.unlockedNodes)) {
    clean.unlockedNodes = [...data.unlockedNodes];
  }
  clean.tutorialCompleted = Boolean(data.tutorialCompleted);
  if (data.settings && typeof data.settings === 'object') {
    clean.settings = {
      soundVolume: Number(data.settings.soundVolume) || 1.0,
      screenShake: data.settings.screenShake !== false,
      reducedFlash: Boolean(data.settings.reducedFlash),
    };
  }

  clean.version = 2;
  return clean;
}

export function migrateV1ToV2(v1Data) {
  return validateAndSanitize(v1Data);
}

const memoryStorage = new Map();

function getStorage() {
  if (typeof localStorage !== 'undefined') return localStorage;
  return {
    getItem: (k) => memoryStorage.get(k) ?? null,
    setItem: (k, v) => memoryStorage.set(k, String(v)),
    removeItem: (k) => memoryStorage.delete(k),
    clear: () => memoryStorage.clear(),
  };
}

export function loadState() {
  const storage = getStorage();
  if (!storage) return structuredClone(DEFAULT_STATE_V2);

  // 1. v2 저장 확인
  const rawV2 = storage.getItem(SAVE_KEY_V2);
  if (rawV2) {
    try {
      const parsed = JSON.parse(rawV2);
      return validateAndSanitize(parsed);
    } catch (e) {
      console.warn('Corrupted v2 save found, backing up and recovering', e);
      try {
        storage.setItem(`revenant_run_save_corrupted_${Date.now()}`, rawV2);
      } catch (_) {}

      // P6-04: 3세대 자동 백업 순환 복구 시도
      for (const bakKey of [SAVE_KEY_V2_BAK_1, SAVE_KEY_V2_BAK_2, SAVE_KEY_V2_BAK_3]) {
        const bakRaw = storage.getItem(bakKey);
        if (bakRaw) {
          try {
            const bakParsed = JSON.parse(bakRaw);
            return validateAndSanitize(bakParsed);
          } catch (_) {}
        }
      }

      return structuredClone(DEFAULT_STATE_V2);
    }
  }

  // 2. v1 저장 마이그레이션 확인
  const rawV1 = storage.getItem(SAVE_KEY_V1);
  if (rawV1) {
    try {
      // 마이그레이션 전 원본 백업
      storage.setItem(SAVE_KEY_BACKUP, rawV1);
      const parsedV1 = JSON.parse(rawV1);
      const migrated = migrateV1ToV2(parsedV1);
      saveState(migrated);
      return migrated;
    } catch (e) {
      console.warn('Corrupted v1 save found during migration', e);
      return structuredClone(DEFAULT_STATE_V2);
    }
  }

  return structuredClone(DEFAULT_STATE_V2);
}

export function saveState(state) {
  const storage = getStorage();
  if (!storage) return false;

  try {
    const clean = validateAndSanitize(state);
    const serialized = JSON.stringify(clean);

    // P6-04: 3세대 백업 순환 (BAK_1 -> BAK_2 -> BAK_3)
    const prevV2 = storage.getItem(SAVE_KEY_V2);
    if (prevV2) {
      try {
        const bak2 = storage.getItem(SAVE_KEY_V2_BAK_2);
        if (bak2) storage.setItem(SAVE_KEY_V2_BAK_3, bak2);
        const bak1 = storage.getItem(SAVE_KEY_V2_BAK_1);
        if (bak1) storage.setItem(SAVE_KEY_V2_BAK_2, bak1);
        storage.setItem(SAVE_KEY_V2_BAK_1, prevV2);
      } catch (_) {}
    }

    storage.setItem(SAVE_KEY_V2, serialized);
    return true;
  } catch (e) {
    console.warn('saveState failed', e);
    return false;
  }
}

// ----------------------------------------------------------------------------
// P0-01: commitState 원자적 커밋 헬퍼
// 사본(draft)에 mutator 적용 -> saveState 성공 시에만 원본 교체
// 실패 시 원상복구(원본 불변) + 실패 UI 트리거
// ----------------------------------------------------------------------------
let lastSaveFailure = null;
let failureListeners = [];

export function onSaveFailure(listener) {
  failureListeners.push(listener);
  return () => {
    failureListeners = failureListeners.filter(l => l !== listener);
  };
}

export function getLastSaveFailure() {
  return lastSaveFailure;
}

export function clearSaveFailure() {
  lastSaveFailure = null;
}

function triggerSaveFailure(failureInfo) {
  lastSaveFailure = failureInfo;
  for (const listener of failureListeners) {
    try { listener(failureInfo); } catch (_) {}
  }
  try {
    showSaveFailureModal({
      draft: failureInfo.draft,
      targetState: failureInfo.targetState,
      onRetry: () => {
        commitState(failureInfo.targetState, failureInfo.mutator, failureInfo.options);
      },
      onDismiss: () => {
        clearSaveFailure();
      },
    });
  } catch (_) {}
}

export function commitState(targetState, mutator, options = {}) {
  const draft = structuredClone(targetState);
  let mutatorResult;
  try {
    mutatorResult = mutator(draft);
  } catch (err) {
    console.error('mutator threw error in commitState', err);
    triggerSaveFailure({ error: err, draft, targetState, mutator, options });
    return { success: false, error: err, draft };
  }

  const saved = saveState(draft);
  if (saved) {
    for (const k of Object.keys(targetState)) {
      if (!(k in draft)) delete targetState[k];
    }
    Object.assign(targetState, draft);
    clearSaveFailure();
    options.onSuccess?.(targetState, mutatorResult);
    return { success: true, result: mutatorResult, state: targetState };
  } else {
    const err = new Error('saveState failed');
    triggerSaveFailure({ error: err, draft, targetState, mutator, options });
    options.onError?.(err, draft);
    return { success: false, error: err, draft };
  }
}

export function pushDeathHistory(state, entry) {
  if (!Array.isArray(state.deathHistory)) state.deathHistory = [];
  state.deathHistory.unshift(entry);
  if (state.deathHistory.length > 20) state.deathHistory.length = 20;
}

export function resetState() {
  const storage = getStorage();
  if (storage) {
    storage.removeItem(SAVE_KEY_V2);
    storage.removeItem(SAVE_KEY_V1);
  }
  return structuredClone(DEFAULT_STATE_V2);
}

export function exportSaveString(state) {
  return JSON.stringify(validateAndSanitize(state), null, 2);
}

export function importSaveString(jsonString) {
  const parsed = JSON.parse(jsonString);
  const clean = validateAndSanitize(parsed);
  saveState(clean);
  return clean;
}
