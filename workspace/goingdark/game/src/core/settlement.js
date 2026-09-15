// ============================================================================
// 런 정산 상태 머신 (RunSettlement)
// IN_RUN -> EXTRACTED | DEAD -> COMMITTED
// 중복 호출 방지 및 멱등 정산 보장
// P0-01: commitState 기반 원자적 정산 (저장 실패 시 원상복구)
// P0-02: getCustomsRate 세관 정책 단일화 적용
// ============================================================================

import { totalValue } from '../systems/inventory.js';
import { makeDeathHistoryEntry } from '../data/data.js';
import { pushDeathHistory, commitState } from '../systems/save.js';
import { getCustomsRate, calculateCustoms, calculatePayout } from './economy.js';
import { QUEST_DEFS } from '../data/quests.js';

export const RUN_STATUS = {
  IN_RUN: 'IN_RUN',
  EXTRACTED: 'EXTRACTED',
  DEAD: 'DEAD',
  COMMITTED: 'COMMITTED',
};

export class RunSettlement {
  constructor(saveState, sessionId = `s_${Date.now()}`) {
    this.save = saveState;
    this.sessionId = sessionId;
    this.status = RUN_STATUS.IN_RUN;
    this.committedResult = null;
  }

  settleExtract(runData) {
    const { floor = 1, inventory = [], seed = 0, time = 0, blessings = {} } = runData;

    if (this.status === RUN_STATUS.COMMITTED) {
      return this.committedResult;
    }

    this.status = RUN_STATUS.EXTRACTED;

    const grossValue = totalValue(inventory);
    const customsRate = getCustomsRate(this.save);
    const customs = calculateCustoms(grossValue, this.save);
    const expectedPayout = calculatePayout(grossValue, this.save);
    const xpGained = Math.round(floor * 40 + grossValue * 0.2);

    const commitRes = commitState(this.save, (draft) => {
      draft.stats.runs = (draft.stats.runs ?? 0) + 1;
      draft.stats.extractions = (draft.stats.extractions ?? 0) + 1;
      draft.deathStreak = 0;

      // 퀘스트 완료 조건 동적 검사 (QUEST_DEFS)
      for (const [qId, qDef] of Object.entries(QUEST_DEFS)) {
        if (draft.quests?.[qId]?.state === 'active') {
          const hasTarget = qDef.targetItem && inventory.some(i => i.questItem === qDef.targetItem || i.id?.startsWith(qDef.targetItem));
          const sessionMeta = { ...runData, inventory, extracted: true, timeElapsed: time };
          const passed = qDef.progressCheck ? qDef.progressCheck(null, sessionMeta) : hasTarget;
          if (passed) {
            draft.quests[qId].state = 'ready_to_turn_in';
          }
        }
      }

      // 메타 계정 경험치 정산
      draft.accountXp = (draft.accountXp ?? 0) + xpGained;
      while (draft.accountXp >= (draft.accountLevel ?? 1) * 100 && (draft.accountLevel ?? 1) < 10) {
        draft.accountXp -= (draft.accountLevel ?? 1) * 100;
        draft.accountLevel = (draft.accountLevel ?? 1) + 1;
      }
    });

    if (!commitRes.success) {
      return {
        success: false,
        type: 'extract',
        error: commitRes.error,
        grossValue,
        customs,
        customsRate,
        payout: expectedPayout,
        floor,
        time,
        seed,
        blessings,
        xpGained: 0,
      };
    }

    this.status = RUN_STATUS.COMMITTED;
    this.committedResult = {
      success: true,
      type: 'extract',
      grossValue,
      customs,
      customsRate,
      payout: expectedPayout,
      floor,
      time,
      seed,
      blessings,
      xpGained,
    };

    return this.committedResult;
  }

  settleDeath({ floor, cause, inventory, weaponLevel = 0, seed, time, blessings = {} }) {
    if (this.status === RUN_STATUS.COMMITTED) {
      return this.committedResult;
    }

    this.status = RUN_STATUS.DEAD;

    const lostItems = [...inventory];
    const lostValue = totalValue(lostItems);
    const xpGained = Math.round(floor * 15);

    const commitRes = commitState(this.save, (draft) => {
      // 사망 시 런 인벤토리는 전량 로스트, 저장고와 영구 해금은 보존
      draft.inventory.length = 0;

      draft.stats.runs = (draft.stats.runs ?? 0) + 1;
      draft.stats.deaths = (draft.stats.deaths ?? 0) + 1;
      draft.deathStreak = (draft.deathStreak ?? 0) + 1;

      pushDeathHistory(draft, makeDeathHistoryEntry({
        sessionId: this.sessionId,
        floor,
        loadoutHash: `lv${weaponLevel}`,
        lootSnapshot: lostItems.map(i => ({ item_id: i.id, tier: i.tier, name: i.name })),
        cause,
      }));

      draft.accountXp = (draft.accountXp ?? 0) + xpGained;
      while (draft.accountXp >= (draft.accountLevel ?? 1) * 100 && (draft.accountLevel ?? 1) < 10) {
        draft.accountXp -= (draft.accountLevel ?? 1) * 100;
        draft.accountLevel = (draft.accountLevel ?? 1) + 1;
      }
    });

    if (!commitRes.success) {
      return {
        success: false,
        type: 'death',
        error: commitRes.error,
        cause,
        lostValue,
        floor,
        time,
        seed,
        blessings,
        xpGained: 0,
      };
    }

    // 런타임 인벤토리는 저장 성공 시에만 비움
    inventory.length = 0;
    this.status = RUN_STATUS.COMMITTED;
    this.committedResult = {
      success: true,
      type: 'death',
      cause,
      lostValue,
      floor,
      time,
      seed,
      blessings,
      xpGained,
    };

    return this.committedResult;
  }
}
