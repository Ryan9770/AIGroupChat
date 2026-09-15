// ============================================================================
// 거점 장면 (HubScene) — 잿빛 야영지
// 상점/환전, 제단, 대장간, 의뢰판, 저장고, 기억의 제단(메타 진행)
// P0 소모품 구매 데이터(effect/amount) 보존 및 세관 1회 공제 정합성 확보
// ============================================================================

import { ECONOMY, CONSUMABLES, UPGRADE_TABLE, DIALOGUE } from '../data/data.js';
import { addItem, removeItem, canFit, totalValue, usedSlots, INV_SLOTS } from '../systems/inventory.js';
import { SFX } from '../systems/audio.js';
import * as ui from '../systems/ui.js';
import { saveState, commitState, resetState } from '../systems/save.js';
import { calculateCustoms, calculatePayout } from '../core/economy.js';
import { rollMetaRng } from '../core/rng.js';
import { menuSystem } from '../systems/menuSystem.js';

import { META_UNLOCKS_12 } from '../data/metaUnlocks.js';
import { QUEST_DEFS } from '../data/quests.js';

const TIER_LABEL = {
  common: '일반',
  uncommon: '언코먼',
  rare: '레어',
  epic: '에픽',
  quest: '퀘스트',
  consumable: '소모품',
};

export const META_UNLOCKS = META_UNLOCKS_12;

export class HubScene {
  constructor(canvas, ctx, save, opts = {}) {
    if (canvas && typeof canvas === 'object' && ('gold' in canvas || 'inventory' in canvas)) {
      opts = ctx || {};
      save = canvas;
      ctx = null;
      canvas = null;
    }
    this.canvas = canvas;
    this.ctx = ctx;
    this.save = save;
    this.onEnterDungeon = opts.onEnterDungeon ?? (() => {});
    this.speedMul = opts.speedMul ?? 1;
    this.activeTab = 'main';
    this._t = 0;
    this._firstVisit = opts.firstVisit ?? false;
    this._bound = this._onClick.bind(this);
    ui.panelRoot()?.addEventListener('click', this._bound);
    this.render();

    if (this._firstVisit) {
      const d = DIALOGUE.hub_enter_first[0];
      ui.showDialogue(d.speaker, d.text.replace('{gold}', this.save.gold), 5000);
    }
    ui.showNotify('잿빛 야영지 — WASD 없이 UI로 조작합니다. 메뉴를 선택하세요.', 40);
  }

  destroy() {
    ui.panelRoot()?.removeEventListener('click', this._bound);
    ui.clearPanel();
    ui.clearHUD();
  }

  update(dt) {
    this._t += dt;
    const ctx = this.ctx;
    if (!ctx || !this.canvas) return;
    const w = this.canvas.width, h = this.canvas.height;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#120d09');
    grad.addColorStop(1, '#050403');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#3a2f1e';
    for (let i = 0; i < 6; i++) {
      const x = 80 + i * 210;
      ctx.fillRect(x, h - 260, 10, 260);
    }
    for (let i = 0; i < 6; i++) {
      const x = 80 + i * 210 + 5;
      const flick = 0.6 + 0.4 * Math.sin(this._t * 6 + i * 1.7);
      const grad2 = ctx.createRadialGradient(x, h - 270, 2, x, h - 270, 46 * flick);
      grad2.addColorStop(0, `rgba(255,170,60,${0.55 * flick})`);
      grad2.addColorStop(1, 'rgba(255,120,30,0)');
      ctx.fillStyle = grad2;
      ctx.beginPath();
      ctx.arc(x, h - 270, 46 * flick, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#8a7c5e';
    ctx.font = '28px Georgia';
    ctx.textAlign = 'center';
    ctx.fillText('잿빛 야영지 — The Ashen Camp', w / 2, 70);
    ctx.font = '13px Georgia';
    ctx.fillStyle = '#5a4f3a';
    ctx.fillText('"구멍 밖으로 나온 것만 세상의 물건이다."', w / 2, 96);
  }

  _onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const arg = btn.dataset.arg;
    this[act]?.(arg);
  }

  setTab(tab) {
    this.activeTab = tab;
    this.render();
  }

  // P0 수정: 소모품 구매 시 effect와 amount를 완전하게 보존하여 생성 (commitState로 원자적 저장)
  buyItem(id) {
    const def = CONSUMABLES[id];
    if (!def) return;
    if (this.save.gold < def.price) {
      ui.showNotify('골드가 부족하다', 40);
      return;
    }
    const item = {
      id: `${id}_${Date.now()}_${this.save.metaRngStep ?? 0}`,
      tier: 'consumable',
      name: def.name,
      value: 0,
      slot: def.slot,
      consumableId: id,
      effect: def.effect,
      amount: def.amount,
      desc: def.desc,
    };
    if (!canFit(this.save.inventory, item)) {
      ui.showNotify('가방이 가득 찼다', 40);
      return;
    }

    const res = commitState(this.save, (draft) => {
      draft.gold -= def.price;
      addItem(draft.inventory, item);
    });

    if (!res.success) return;

    SFX.goldChime();
    if (id === 'holyWater') {
      const d = DIALOGUE.holy_water_buy[0];
      ui.showDialogue(d.speaker, d.text);
    } else {
      const d = DIALOGUE.shop_open[0];
      ui.showDialogue(d.speaker, d.text);
    }
    this.render();
  }

  // P0 환전 정합성: 허브 환전에서만 1회 공제 후 골드 지급, 가방에서 제거 (commitState로 원자적 저장)
  sellItem(itemId) {
    const item = this.save.inventory.find(i => i.id === itemId);
    if (!item || item.tier === 'quest' || item.tier === 'consumable') {
      ui.showNotify('환전할 수 없는 물건이다', 40);
      return;
    }
    const customs = calculateCustoms(item.value, this.save);
    const payout = calculatePayout(item.value, this.save);

    const res = commitState(this.save, (draft) => {
      removeItem(draft.inventory, itemId);
      draft.gold += payout;
    });

    if (!res.success) return;

    SFX.goldChime();
    const d = DIALOGUE.item_sell[0];
    ui.showDialogue(d.speaker, `${item.name}, ${payout}골드 (세관 ${customs} 공제). ${d.text}`);
    this.render();
  }

  storeItem(itemId) {
    const item = this.save.inventory.find(i => i.id === itemId);
    if (!item) return;

    const res = commitState(this.save, (draft) => {
      const removed = removeItem(draft.inventory, itemId);
      if (!removed) return;
      draft.storage = draft.storage ?? [];
      draft.storage.push(removed);
    });

    if (!res.success) return;
    this.render();
  }

  retrieveItem(itemId) {
    const idx = (this.save.storage ?? []).findIndex(i => i.id === itemId);
    if (idx === -1) return;
    const item = this.save.storage[idx];
    if (!canFit(this.save.inventory, item)) {
      ui.showNotify('가방이 가득 찼다', 40);
      return;
    }

    const res = commitState(this.save, (draft) => {
      const sIdx = (draft.storage ?? []).findIndex(i => i.id === itemId);
      if (sIdx === -1) return;
      const [retrieved] = draft.storage.splice(sIdx, 1);
      addItem(draft.inventory, retrieved);
    });

    if (!res.success) return;
    this.render();
  }

  // P0-03 & P0-01: 결정론적 메타 RNG 기반 강화 도박 및 commitState
  upgrade() {
    const lvl = this.save.weaponLevel;
    if (lvl >= 5) {
      ui.showNotify('이미 최대 강화 단계다', 40);
      return;
    }
    const cost = 30 * (lvl + 1);
    if (this.save.gold < cost) {
      ui.showNotify(`강화 비용 ${cost}골드가 부족하다`, 40);
      return;
    }

    let upgradeOutcome = null;

    const res = commitState(this.save, (draft) => {
      draft.gold -= cost;
      const row = UPGRADE_TABLE[lvl];
      const bonus = (lvl <= 2 && draft.unlockedNodes?.includes('tolen_friendship')) ? 0.05 : 0;
      const successRate = Math.min(1.0, row.success + bonus);
      const roll = rollMetaRng(draft);

      if (roll < successRate) {
        draft.weaponLevel += 1;
        upgradeOutcome = { type: 'success', lvl: draft.weaponLevel };
      } else if (row.onFail === 'none') {
        upgradeOutcome = { type: 'fail_none' };
      } else if (row.onFail === 'downgrade') {
        draft.weaponLevel = Math.max(0, draft.weaponLevel - 1);
        upgradeOutcome = { type: 'fail_downgrade', lvl: draft.weaponLevel };
      } else if (row.onFail === 'destroy') {
        const destroyRoll = rollMetaRng(draft);
        if (destroyRoll < row.destroyChance) {
          if (draft.sq01_destroyProtection) {
            draft.sq01_destroyProtection = false;
            draft.weaponLevel = Math.max(0, draft.weaponLevel - 1);
            upgradeOutcome = { type: 'protect', lvl: draft.weaponLevel };
          } else {
            draft.weaponLevel = 0;
            upgradeOutcome = { type: 'destroy' };
          }
        } else {
          draft.weaponLevel = Math.max(0, draft.weaponLevel - 1);
          upgradeOutcome = { type: 'fail_downgrade', lvl: draft.weaponLevel };
        }
      }
    });

    if (!res.success || !upgradeOutcome) return;

    if (upgradeOutcome.type === 'success') {
      SFX.upgradeSuccess();
      ui.showNotify(`강화 성공! +${upgradeOutcome.lvl}`, 40);
    } else if (upgradeOutcome.type === 'fail_none') {
      SFX.upgradeFail();
      ui.showNotify('강화 실패 (변화 없음)', 40);
    } else if (upgradeOutcome.type === 'fail_downgrade') {
      SFX.upgradeFail();
      ui.showNotify(`강화 실패 — 강화도 하락 (+${upgradeOutcome.lvl})`, 40);
    } else if (upgradeOutcome.type === 'protect') {
      SFX.upgradeFail();
      ui.showNotify(`파괴 대신 안전판 발동! (톨렌의 약속) — 강화도 -1 (+${upgradeOutcome.lvl})`, 60);
    } else if (upgradeOutcome.type === 'destroy') {
      SFX.destroy();
      ui.showNotify('무기가 파괴되었다! (+0으로 초기화)', 40);
    }
    this.render();
  }

  unlockMetaNode(nodeId) {
    const node = META_UNLOCKS.find(n => n.id === nodeId);
    if (!node) return;
    if (this.save.unlockedNodes?.includes(nodeId)) return;
    if (node.req && !this.save.unlockedNodes?.includes(node.req)) {
      ui.showNotify(`선행 노드(${node.req}) 해금이 필요합니다`, 40);
      return;
    }
    if ((this.save.accountXp ?? 0) < node.cost) {
      ui.showNotify(`기억 파편(경험치) ${node.cost} 필요`, 40);
      return;
    }

    const res = commitState(this.save, (draft) => {
      draft.unlockedNodes = draft.unlockedNodes ?? [];
      draft.accountXp -= node.cost;
      draft.unlockedNodes.push(nodeId);
    });

    if (!res.success) return;

    SFX.upgradeSuccess();
    ui.showNotify(`해금 완료: ${node.name}`, 40);
    this.render();
  }

  acceptQuest(id) {
    const q = this.save.quests?.[id];
    if (!q || q.state !== 'not_started') return;

    const res = commitState(this.save, (draft) => {
      draft.quests[id].state = 'active';
    });

    if (!res.success) return;

    const def = QUEST_DEFS[id];
    const label = def?.title ?? id;
    ui.showNotify(`의뢰 수주: ${label}`, 40);
    this.render();
  }

  deliverBlade() {
    const q = this.save.quests?.blade_fragment;
    if (!q || q.state !== 'ready_to_turn_in') return;

    const res = commitState(this.save, (draft) => {
      const qItem = draft.inventory.find(i => i.questItem === 'blade_fragment');
      if (qItem) removeItem(draft.inventory, qItem.id);
      draft.quests.blade_fragment.state = 'complete';
      draft.sq01_destroyProtection = true;
      draft.factionRep.guild += 3;
    });

    if (!res.success) return;

    SFX.questComplete();
    const d = DIALOGUE.sq01_deliver[0];
    ui.showDialogue(d.speaker, d.text, 6000);
    ui.showNotify('강화 파괴 면제 1회 획득, 길드 신뢰 +3', 40);
    this.render();
  }

  sellBlade() {
    const q = this.save.quests?.blade_fragment;
    if (!q || q.state !== 'ready_to_turn_in') return;

    const res = commitState(this.save, (draft) => {
      const qItem = draft.inventory.find(i => i.questItem === 'blade_fragment');
      if (qItem) removeItem(draft.inventory, qItem.id);
      draft.quests.blade_fragment.state = 'complete';
      draft.gold += 180;
    });

    if (!res.success) return;

    SFX.goldChime();
    const d = DIALOGUE.sq01_sell[0];
    ui.showDialogue(d.speaker, d.text, 6000);
    ui.showNotify('+180골드', 40);
    this.render();
  }

  turnInQuest(id) {
    const q = this.save.quests?.[id];
    if (!q || q.state !== 'ready_to_turn_in') return;
    const def = QUEST_DEFS[id];

    const res = commitState(this.save, (draft) => {
      const qItem = draft.inventory.find(i => i.questItem === id || (def?.targetItem && i.questItem === def.targetItem));
      if (qItem) removeItem(draft.inventory, qItem.id);
      draft.quests[id].state = 'complete';

      const rew = def?.rewards;
      if (rew) {
        if (rew.gold) draft.gold += rew.gold;
        if (rew.accountXp) draft.accountXp = (draft.accountXp ?? 0) + rew.accountXp;
        if (rew.reportTurnIn?.accountXp) draft.accountXp = (draft.accountXp ?? 0) + rew.reportTurnIn.accountXp;
      } else {
        draft.gold += 150;
      }
      draft.factionRep.guild += 5;
    });

    if (!res.success) return;

    SFX.questComplete();
    if (id === 'sergeant_ring') {
      const d = DIALOGUE.quest_complete_ring[0];
      ui.showDialogue(d.speaker, d.text, 6000);
    }
    const rew = def?.rewards;
    const gRew = rew?.gold ?? 150;
    const xpRew = rew?.accountXp ?? (rew?.reportTurnIn?.accountXp ?? 50);
    ui.showNotify(`의뢰 완료! +${gRew}골드, +${xpRew}XP`, 40);
    this.render();
  }

  setSpeed(v) {
    this.speedMul = Number(v);
    this.render();
  }

  enterDungeon() {
    // 해금된 시작 지원 아이템 지급
    if (this.save.unlockedNodes?.includes('starter_water')) {
      const def = CONSUMABLES.holyWater;
      const item = { id: `hw_start_${Date.now()}`, tier: 'consumable', name: def.name, value: 0, slot: 1, consumableId: 'holyWater', effect: def.effect, amount: def.amount, desc: def.desc };
      if (canFit(this.save.inventory, item) && !this.save.inventory.some(i => i.id.startsWith('hw_start_'))) {
        addItem(this.save.inventory, item);
      }
    }
    if (this.save.unlockedNodes?.includes('starter_potion')) {
      const def = CONSUMABLES.potion;
      const item = { id: `pot_start_${Date.now()}`, tier: 'consumable', name: def.name, value: 0, slot: 1, consumableId: 'potion', effect: def.effect, amount: def.amount, desc: def.desc };
      if (canFit(this.save.inventory, item) && !this.save.inventory.some(i => i.id.startsWith('pot_start_'))) {
        addItem(this.save.inventory, item);
      }
    }

    saveState(this.save);
    this.destroy();
    this.onEnterDungeon(this.speedMul);
  }

  devReset() {
    if (!confirm('저장 데이터를 초기화할까요? (골드/인벤토리/퀘스트/기록 전부 삭제)')) return;
    Object.assign(this.save, resetState());
    this.render();
  }

  render() {
    const s = this.save;
    ui.setPanel(`
      <div class="panel" style="left:20px; top:20px; width:260px;">
        <h2>브로카의 장부</h2>
        <div class="row"><span>골드</span><span class="gold">${s.gold} G</span></div>
        <div class="row"><span>무기 강화도</span><span>+${s.weaponLevel}</span></div>
        <div class="row"><span>가방</span><span>${usedSlots(s.inventory)}/${INV_SLOTS} 슬롯 (${totalValue(s.inventory)}G)</span></div>
        <div class="row"><span>저장고</span><span>${(s.storage ?? []).length}개 보관중</span></div>
        <div class="row"><span>원정 성공률</span><span>${s.stats.runs > 0 ? Math.round((s.stats.extractions / s.stats.runs) * 100) : 0}% (${s.stats.extractions}/${s.stats.runs})</span></div>
        <div class="row"><span>기억 파편(XP)</span><span class="gold">${s.accountXp ?? 0}</span></div>
        <div class="row"><span>계정 레벨</span><span>Lv.${s.accountLevel ?? 1}</span></div>
        <h3>던전 시간 배속</h3>
        <select id="speedSel" class="btn" style="width:100%; margin-top:6px;">
          <option value="1" ${this.speedMul === 1 ? 'selected' : ''}>1x (정확)</option>
          <option value="3" ${this.speedMul === 3 ? 'selected' : ''}>3x</option>
          <option value="6" ${this.speedMul === 6 ? 'selected' : ''}>6x</option>
        </select>
        <button type="button" class="btn primary" style="width:100%; text-align:center; margin-top:14px;" data-act="enterDungeon">⚔ 던전 진입 (1층 주화 해안)</button>
        <div style="display:flex; gap:6px; margin-top:10px;">
          <button type="button" class="btn" style="flex:1;" data-act="openSettings">⚙️ 설정</button>
          <button type="button" class="btn" style="flex:1;" data-act="openCredits">📜 크레딧</button>
        </div>
        <button type="button" class="btn" style="width:100%; margin-top:6px;" data-act="openTutorial">🎯 연습 굴 (튜토리얼)</button>
        <button type="button" class="muted" style="background:none; border:none; margin-top:10px; cursor:pointer; font-size:12px; width:100%; text-align:center;" data-act="devReset">저장 초기화(디버그)</button>
      </div>
      <div class="panel" style="left:300px; top:20px; width:660px; min-height:500px;">
        <div>
          ${this._tabBtn('main', '거점')}
          ${this._tabBtn('shop', '브로카 상점/환전')}
          ${this._tabBtn('serena', '세레나 (성수)')}
          ${this._tabBtn('forge', '톨렌 대장간')}
          ${this._tabBtn('quest', '의뢰판')}
          ${this._tabBtn('storage', '저장고')}
          ${this._tabBtn('altar', '기억의 제단(해금)')}
        </div>
        <div style="margin-top:14px;">${this._tabContent()}</div>
      </div>
    `);

    const sel = typeof document !== 'undefined' ? document.getElementById('speedSel') : null;
    if (sel) sel.onchange = (e) => this.setSpeed(e.target.value);
  }

  openSettings() {
    menuSystem.showSettingsModal(this.save, () => this.render());
  }

  openCredits() {
    menuSystem.showCreditsModal(() => this.render());
  }

  openTutorial() {
    this.enterDungeon();
  }

  _tabBtn(id, label) {
    return `<button type="button" class="btn ${this.activeTab === id ? 'disabled' : ''}" data-act="setTab" data-arg="${id}">${label}</button>`;
  }

  _tabContent() {
    if (this.activeTab === 'shop') return this._shopTab();
    if (this.activeTab === 'serena') return this._serenaTab();
    if (this.activeTab === 'forge') return this._forgeTab();
    if (this.activeTab === 'quest') return this._questTab();
    if (this.activeTab === 'storage') return this._storageTab();
    if (this.activeTab === 'altar') return this._altarTab();
    return this._mainTab();
  }

  _mainTab() {
    return `
      <h3>강탈자 길드 '뚫린 주머니' 거점</h3>
      <p class="muted">브로카(상점/환전), 세레나(제단/성수), 톨렌(강화), 의뢰판, 저장고를 이용할 수 있습니다.<br/>
      던전에서 무사히 탈출한 전리품은 이곳 브로카 상점에서 환전하거나 저장고에 보관하세요.</p>
      <h3>현재 가방 내용물</h3>
      ${this._invList(this.save.inventory, 'none')}
    `;
  }

  _shopTab() {
    return `
      <h3>구매 — 브로카/세레나 위탁 물품</h3>
      ${Object.values(CONSUMABLES).map(c => `
        <div class="row"><span>${c.name} — ${c.desc}</span>
          <span><span class="gold">${c.price}G</span> <button type="button" class="btn" data-act="buyItem" data-arg="${c.id}">구매</button></span>
        </div>`).join('')}
      <h3>환전 — 가방 속 약탈품 (세관 ${this.save.unlockedNodes?.includes('customs_favor') ? 8 : Math.round(ECONOMY.customsRate * 100)}% 공제)</h3>
      <p class="muted">탈출 시 가방에 보존된 약탈품을 브로카에게 넘겨 골드로 정산받습니다.</p>
      ${this._invList(this.save.inventory.filter(i => i.tier !== 'quest' && i.tier !== 'consumable'), 'sell')}
    `;
  }

  _serenaTab() {
    return `
      <h3>감시관 세레나 — 잿빛 등</h3>
      <p class="muted">"빛을 받으십시오. 대가는 없습니다." 성수병은 던전 내 시선을 즉시 30 낮춥니다.
      던전 안 빛의 제단(2곳)에서는 무료로 시선을 40 낮출 수 있습니다.</p>
      <div class="row"><span>성수병 — ${CONSUMABLES.holyWater.desc}</span>
        <span><span class="gold">${CONSUMABLES.holyWater.price}G</span> <button type="button" class="btn" data-act="buyItem" data-arg="holyWater">구매</button></span>
      </div>
    `;
  }

  _forgeTab() {
    const lvl = this.save.weaponLevel;
    const row = UPGRADE_TABLE[lvl];
    const cost = 30 * (lvl + 1);
    const bonus = (lvl <= 2 && this.save.unlockedNodes?.includes('tolen_friendship')) ? 0.05 : 0;
    return `
      <h3>톨렌 대장장이 — 강화 도박</h3>
      <div class="row"><span>현재 무기 강화도</span><span>+${lvl}</span></div>
      <div class="row"><span>파괴 면제(SQ-01 '톨렌의 첫 주문' 보상)</span><span>${this.save.sq01_destroyProtection ? '보유 중 (1회)' : '없음'}</span></div>
      ${lvl < 5 ? `
        <div class="row"><span>다음 단계 (+${lvl + 1}) 성공률</span><span>${Math.round((row.success + bonus) * 100)}%${bonus > 0 ? ' (+5%p 톨렌의 배려)' : ''}</span></div>
        <div class="row"><span>실패 시</span><span>${row.onFail === 'none' ? '변화 없음' : row.onFail === 'downgrade' ? '강화도 -1' : `파괴 ${Math.round(row.destroyChance * 100)}% / 강화도 -1 ${Math.round((1 - row.destroyChance) * 100)}%`}</span></div>
        <div class="row"><span>비용</span><span class="gold">${cost}G</span></div>
        <button type="button" class="btn primary" data-act="upgrade" style="margin-top:8px;">강화 시도</button>
      ` : `<div class="muted">최대 강화 단계(+5)에 도달했습니다.</div>`}
    `;
  }

  _questTab() {
    const mainQuests = ['sergeant_ring', 'act2_sixty_one'];
    const sideQuests = ['blade_fragment', 'sq02_missing_watcher'];
    const tutorialQuests = ['tq_first_step', 'tq_gaze_cleanse', 'tq_tide_escape'];

    return `
      <h3>길드 의뢰판</h3>
      <p class="muted">"의뢰는 욕심부리지 말고 순서대로 밟아라. 구멍 밖으로 온전히 들고나온 자만 보상을 받는다." — 브로카</p>

      <h4 style="margin: 12px 0 6px 0; color: #D8B45C;">📜 메인 원정 의뢰</h4>
      ${mainQuests.map(id => this._renderQuestRow(id)).join('')}

      <h4 style="margin: 14px 0 6px 0; color: #CFE6FF;">⚔ 사이드 특별 의뢰</h4>
      ${sideQuests.map(id => this._renderQuestRow(id)).join('')}

      <h4 style="margin: 14px 0 6px 0; color: #78A83D;">🎯 길드 튜토리얼 수칙</h4>
      ${tutorialQuests.map(id => this._renderQuestRow(id)).join('')}
    `;
  }

  _renderQuestRow(id) {
    const def = QUEST_DEFS[id];
    if (!def) return '';
    const qState = this.save.quests?.[id]?.state ?? 'not_started';

    if (id === 'blade_fragment' && qState === 'ready_to_turn_in') {
      return `
        <div class="row">
          <span><strong>${def.title}</strong><br><small class="muted">${def.desc}</small></span>
          <span>
            <button type="button" class="btn" data-act="deliverBlade" style="margin-right:6px;">톨렌 인도 (파괴 면제)</button>
            <button type="button" class="btn" data-act="sellBlade">즉시 환전 (180G)</button>
          </span>
        </div>
      `;
    }

    let actionHtml;
    if (qState === 'not_started') {
      actionHtml = `<button type="button" class="btn" data-act="acceptQuest" data-arg="${id}">수주</button>`;
    } else if (qState === 'active') {
      actionHtml = `<span class="muted">진행 중</span>`;
    } else if (qState === 'ready_to_turn_in') {
      actionHtml = `<button type="button" class="btn primary" data-act="turnInQuest" data-arg="${id}">완료 보고</button>`;
    } else {
      actionHtml = `<span class="muted">✓ 완료됨</span>`;
    }

    return `
      <div class="row">
        <span><strong>${def.title}</strong><br><small class="muted">${def.desc}</small></span>
        <span>${actionHtml}</span>
      </div>
    `;
  }

  _storageTab() {
    return `
      <h3>왕실 몰수품 보관소 (무료 보관)</h3>
      <div class="row"><span>가방 → 저장고</span></div>
      ${this._invList(this.save.inventory.filter(i => i.tier !== 'consumable' && i.tier !== 'quest'), 'store')}
      <h3 style="margin-top:16px;">저장고 → 가방</h3>
      ${this._invList(this.save.storage ?? [], 'retrieve')}
    `;
  }

  _altarTab() {
    const unlocked = this.save.unlockedNodes ?? [];
    return `
      <h3>기억의 제단 — 영구 메타 진행 (12개 해금 노드)</h3>
      <p class="muted">던전 탐색과 탈출/전투를 통해 모은 기억 파편(XP)으로 영구적인 유틸리티와 지원을 해금합니다. (계정 레벨 Lv.${this.save.accountLevel ?? 1} / 10)</p>
      <div class="row"><span>보유 기억 파편</span><span class="gold">${this.save.accountXp ?? 0} 파편</span></div>
      <div style="margin-top:12px;">
        ${META_UNLOCKS.map(node => {
          const isUnlocked = unlocked.includes(node.id);
          const hasReq = !node.req || unlocked.includes(node.req);
          return `
            <div class="row">
              <span><strong>${node.name}</strong> — ${node.desc}${node.req && !hasReq ? ` <small class="muted">(${node.req} 선행 필요)</small>` : ''}</span>
              <span>
                ${isUnlocked
                  ? '<span class="muted">✓ 해금됨</span>'
                  : hasReq
                    ? `<span class="gold">${node.cost}XP</span> <button type="button" class="btn" data-act="unlockMetaNode" data-arg="${node.id}">해금</button>`
                    : '<span class="muted">잠김</span>'}
              </span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  _invList(list, mode) {
    if (!list.length) return `<div class="muted">비어 있음</div>`;
    return list.map(i => `
      <div class="row"><span class="tier-${i.tier}">[${TIER_LABEL[i.tier] ?? i.tier}] ${i.name}${i.value ? ` (${i.value}G)` : ''}</span>
        <span>${mode === 'sell' ? `<button type="button" class="btn" data-act="sellItem" data-arg="${i.id}">환전</button>` : ''}
        ${mode === 'store' ? `<button type="button" class="btn" data-act="storeItem" data-arg="${i.id}">보관</button>` : ''}
        ${mode === 'retrieve' ? `<button type="button" class="btn" data-act="retrieveItem" data-arg="${i.id}">회수</button>` : ''}</span>
      </div>`).join('');
  }
}
