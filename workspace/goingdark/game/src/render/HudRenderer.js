// ============================================================================
// HUD 렌더러 (HudRenderer)
// P4-01 "강탈자의 장부" UI 리스킨: 상시 5대 정보, 4단 시선 눈금, 3단 조수 수위,
// 8슬롯 2칸 점유(무게추 ⚖) & 희귀도 홈(Notch 1/2/3/4)
// ============================================================================

import { GATE_OPEN_AT_SEC, PLAYER_BASE, gazeBand } from '../data/data.js';
import { INV_SLOTS, usedSlots, totalValue } from '../systems/inventory.js';
import * as ui from '../systems/ui.js';
import { CORE_PALETTE } from '../data/palette.js';

const NOTCH_SYMBOLS = {
  common: '▪',
  uncommon: '▪▪',
  rare: '▪▪▪',
  epic: '▪▪▪▪',
};

export class HudRenderer {
  constructor() {
    this._invPanelWasOpen = false;
  }

  render(engine) {
    if (typeof document === 'undefined') return;

    this._renderHUD(engine);
    this._renderInventoryOverlay(engine);
  }

  _renderHUD(engine) {
    const p = engine.player;
    const band = gazeBand(p.gaze);

    // 1. 조수 3단 수위 아이콘
    let tideIcon = '🌊 평수위';
    if (engine.tideStageIdx === 0) tideIcon = '🌊 I (스밈)';
    else if (engine.tideStageIdx === 1) tideIcon = '🌊🌊 II (차오름)';
    else if (engine.tideStageIdx === 2) tideIcon = '🌊🌊🌊 III (침수)';

    // 2. 시선 4단 세그먼트 상태
    const seg0 = p.gaze >= 0 ? 'active-0' : '';
    const seg31 = p.gaze >= 31 ? 'active-31' : '';
    const seg61 = p.gaze >= 61 ? 'active-61' : '';
    const seg91 = p.gaze >= 91 ? 'active-91' : '';

    // 3. 하단 8슬롯 인벤토리 퀵 바 렌더링
    let slotCells = '';
    let slotIdx = 0;
    const inv = p.inventory || [];
    let itemIdx = 0;

    while (slotIdx < INV_SLOTS) {
      const item = inv[itemIdx++];
      if (item) {
        const isTwoSlot = item.slot === 2;
        const notch = NOTCH_SYMBOLS[item.tier] ?? '';
        const tierClass = `notch-${item.tier === 'epic' ? 4 : item.tier === 'rare' ? 3 : item.tier === 'uncommon' ? 2 : 1}`;
        const weightTag = isTwoSlot ? '<span class="weight-badge">⚖2</span>' : '';

        slotCells += `
          <div class="inv-slot ${isTwoSlot ? 'two-slot' : ''} ${tierClass}" style="width:${isTwoSlot ? 110 : 54}px; height:54px;">
            ${weightTag}
            <div style="font-size:10px; font-weight:bold; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;"><span class="tier-notch">${notch}</span> ${item.name}</div>
            <div style="font-size:9px; color:#D8B45C;">${item.value ? item.value + 'G' : '소모'}</div>
          </div>
        `;
        slotIdx += item.slot ?? 1;
      } else {
        slotCells += `
          <div class="inv-slot empty" style="width:54px; height:54px;">
            <div style="text-align:center; color:#555; line-height:46px;">${slotIdx + 1}</div>
          </div>
        `;
        slotIdx += 1;
      }
    }

    // 3.5. 등불(Q) 스킬 게이지 & 상태
    const lampActive = p.lampActiveUntil > engine.time;
    const lampRemaining = lampActive ? (p.lampActiveUntil - engine.time).toFixed(1) : 0;
    const lampCd = Math.ceil(p.lampCd || 0);
    let lampHtml;
    if (lampActive) {
      lampHtml = `
        <div style="display:inline-flex; align-items:center; gap:6px; background:rgba(216,180,92,0.25); border:1px solid #D8B45C; border-radius:4px; padding:3px 8px;">
          <span style="color:#FFF0BA; font-weight:bold; font-size:11px;">✨ Q 성수 등불: 점등 중 (${lampRemaining}s)</span>
        </div>
      `;
    } else if (lampCd > 0) {
      lampHtml = `
        <div style="display:inline-flex; align-items:center; gap:6px; background:rgba(40,30,20,0.65); border:1px solid #58472E; border-radius:4px; padding:3px 8px;">
          <span style="color:#8A7C5E; font-size:11px;">⏳ Q 성수 등불: 대기 (${lampCd}s)</span>
        </div>
      `;
    } else {
      lampHtml = `
        <div style="display:inline-flex; align-items:center; gap:6px; background:rgba(10,8,6,0.75); border:1px solid #D8B45C; border-radius:4px; padding:3px 8px;">
          <span style="color:#D8B45C; font-weight:bold; font-size:11px;">💡 Q 성수 등불 [사용 가능]</span>
        </div>
      `;
    }

    const minimapHtml = this._renderMinimap(engine);

    ui.setHUD(`
      <!-- 1. HP 바 -->
      <div class="hud-label" style="top:14px; font-size:12px;">HP ${Math.ceil(p.hp)} / ${p.maxHp}</div>
      <div class="hud-bar-wrap" style="top:32px;">
        <div class="hud-bar-fill" style="width:${Math.max(0, (p.hp / p.maxHp) * 100)}%; background:${CORE_PALETTE.COAGULATED_RED};"></div>
      </div>

      <!-- 2. 스태미나 바 -->
      <div class="hud-label" style="top:56px; font-size:12px;">STAMINA ${Math.floor(p.stamina)} / ${p.maxStamina}</div>
      <div class="hud-bar-wrap" style="top:74px;">
        <div class="hud-bar-fill" style="width:${(p.stamina / p.maxStamina) * 100}%; background:#3A8A5A;"></div>
      </div>

      <!-- 3. 시선 (숫자 + 4단 눈금) -->
      <div class="hud-label" style="top:98px; font-size:12px; color:${band.min >= 91 ? '#E6503C' : band.min >= 61 ? '#8D5A91' : '#D9CDB8'};">
        GAZE ${Math.floor(p.gaze)} / 100 [${band.label}]
      </div>
      <div class="gaze-gauge" style="top:116px;">
        <div class="gaze-segment ${seg0}"></div>
        <div class="gaze-segment ${seg31}"></div>
        <div class="gaze-segment ${seg61}"></div>
        <div class="gaze-segment ${seg91}"></div>
      </div>

      <!-- 3.5 성수 등불 스킬 상태 -->
      <div style="position:absolute; left:24px; top:138px; pointer-events:none;">
        ${lampHtml}
      </div>

      <!-- 4. 시간 및 조수 수위 (우상단) -->
      <div class="hud-label" style="right:24px; top:14px; left:auto; text-align:right; width:340px; font-size:15px; color:#D8B45C;">
        ${engine.floorNum}층 · ${engine.floorDef?.name ?? ''}
      </div>
      <div class="hud-label" style="right:24px; top:36px; left:auto; text-align:right; width:340px; font-size:13px;">
        ⏱ ${ui.fmtTime(engine.time)} · ${tideIcon}
      </div>
      <div class="hud-label" style="right:24px; top:58px; left:auto; text-align:right; width:340px; font-size:13px; color:#CFE6FF;">
        ${engine.time >= GATE_OPEN_AT_SEC ? '⚡ 탈출 게이트 개방됨' : '🔒 게이트 잠김 (18분 개방)'}
      </div>

      <!-- 4.5 층 미니맵 -->
      ${minimapHtml}

      <!-- 4.8 게이트 탈출 충전 프로그레스 바 -->
      ${(p.charging || (p.gateCharge && p.gateCharge > 0)) ? `
        <div style="position:absolute; left:50%; bottom:82px; transform:translateX(-50%); width:300px; background:rgba(10,8,6,0.92); border:1.5px solid #3AAFA9; border-radius:6px; padding:8px 12px; text-align:center; pointer-events:none; box-shadow:0 0 16px rgba(58,175,169,0.45); z-index:15;">
          <div style="font-size:13px; font-weight:bold; color:#7FFFD4; margin-bottom:5px; display:flex; justify-content:space-between;">
            <span>🌀 탈출 게이트 조율 중... [F]</span>
            <span>${Math.min(PLAYER_BASE.gateChargeTime, p.gateCharge || 0).toFixed(1)} / ${PLAYER_BASE.gateChargeTime}s</span>
          </div>
          <div style="width:100%; height:10px; background:#182625; border-radius:4px; overflow:hidden; border:1px solid #2B7A78;">
            <div style="width:${Math.min(100, ((p.gateCharge || 0) / PLAYER_BASE.gateChargeTime) * 100)}%; height:100%; background:linear-gradient(90deg, #2B7A78, #4EECD5); transition:width 0.05s linear;"></div>
          </div>
          <div style="font-size:10px; color:#A8DADC; margin-top:4px;">※ 피격 시에도 귀환 게이지가 유지됩니다</div>
        </div>
      ` : ''}

      <!-- 5. 8슬롯 인벤토리 퀵 바 (하단 중앙) -->
      <div style="position:absolute; left:50%; bottom:14px; transform:translateX(-50%); display:flex; gap:6px; background:rgba(10,8,6,0.85); padding:6px 12px; border:1px solid #3A2F1E; border-radius:4px; pointer-events:none;">
        ${slotCells}
      </div>

      <!-- 조작 가이드 안내 -->
      <div class="hud-label" style="left:24px; bottom:16px; top:auto; font-size:11px; color:#8A7C5E;">
        WASD 이동 · 좌클릭 공격 · 우클릭 가드 · Space 구르기 · Q 등불 · E 상호작용 · Tab 장부 · F 게이트(8초)
      </div>
    `);
  }

  _renderMinimap(engine) {
    if (!engine.roomGraph || !engine.roomGraph.rooms) return '';
    const rooms = engine.roomGraph.rooms;
    const visited = engine.visitedRooms || new Set([0]);
    const curId = engine.currentRoomId ?? 0;

    let minGx = 0, maxGx = 0, minGy = 0, maxGy = 0;
    for (const r of rooms) {
      if (r.gx < minGx) minGx = r.gx;
      if (r.gx > maxGx) maxGx = r.gx;
      if (r.gy < minGy) minGy = r.gy;
      if (r.gy > maxGy) maxGy = r.gy;
    }

    const spanX = Math.max(1, maxGx - minGx);
    const spanY = Math.max(1, maxGy - minGy);
    const cellW = Math.min(15, Math.floor(96 / (spanX + 1)));
    const cellH = Math.min(13, Math.floor(46 / (spanY + 1)));
    const cellSize = Math.max(8, Math.min(cellW, cellH));

    const offX = 58 - ((spanX * (cellSize + 4)) / 2);
    const offY = 28 - ((spanY * (cellSize + 4)) / 2);

    let corridorsSvg = '';
    let roomsSvg = '';

    for (const r of rooms) {
      if (!visited.has(r.id)) continue;
      const x1 = offX + (r.gx - minGx) * (cellSize + 4) + cellSize / 2;
      const y1 = offY + (r.gy - minGy) * (cellSize + 4) + cellSize / 2;
      for (const n of (r.neighbors || [])) {
        if (n.id > r.id && (visited.has(n.id) || r.id === curId)) {
          const x2 = offX + (n.gx - minGx) * (cellSize + 4) + cellSize / 2;
          const y2 = offY + (n.gy - minGy) * (cellSize + 4) + cellSize / 2;
          corridorsSvg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#58472E" stroke-width="2" />`;
        }
      }
    }

    for (const r of rooms) {
      const isVisited = visited.has(r.id);
      const isCurrent = r.id === curId;
      const isAdjacent = (r.neighbors || []).some(n => n.id === curId);
      if (!isVisited && !isAdjacent) continue;

      const rx = offX + (r.gx - minGx) * (cellSize + 4);
      const ry = offY + (r.gy - minGy) * (cellSize + 4);

      let fill = '#1a1612';
      let stroke;
      if (isVisited) {
        if (r.type === 'start') fill = '#2E4733';
        else if (r.type === 'treasure') fill = '#7A622A';
        else if (r.type === 'boss' || r.type === 'elite') fill = '#5E1D1D';
        else if (r.type === 'altar') fill = '#244566';
        else if (r.type === 'stairs' || r.type === 'gate') fill = '#3D5E29';
        else fill = '#3A2F1E';
        stroke = isCurrent ? '#F3D586' : '#8A7C5E';
      } else {
        stroke = '#443522';
      }

      const strokeW = isCurrent ? 2 : 1;
      roomsSvg += `<rect x="${rx}" y="${ry}" width="${cellSize}" height="${cellSize}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" />`;
      if (isCurrent) {
        roomsSvg += `<circle cx="${rx + cellSize / 2}" cy="${ry + cellSize / 2}" r="2" fill="#F3D586" />`;
      }
    }

    return `
      <div style="position:absolute; right:24px; top:84px; width:130px; background:rgba(10,8,6,0.85); border:1px solid #3A2F1E; border-radius:4px; padding:5px; pointer-events:none;">
        <div style="font-size:10px; color:#D8B45C; margin-bottom:3px; display:flex; justify-content:space-between;">
          <span>방 탐색도</span>
          <span style="color:#8A7C5E;">${visited.size}/${rooms.length}</span>
        </div>
        <svg width="118" height="50" viewBox="0 0 118 50">
          ${corridorsSvg}
          ${roomsSvg}
        </svg>
      </div>
    `;
  }

  _renderInventoryOverlay(engine) {
    if (!engine.player.invOpen) {
      if (this._invPanelWasOpen) ui.clearPanel();
      this._invPanelWasOpen = false;
      return;
    }
    this._invPanelWasOpen = true;
    const inv = engine.player.inventory;

    // 8슬롯 그리드 상세 슬롯
    let gridSlots = '';
    let currentSlot = 0;
    let iIdx = 0;

    while (currentSlot < INV_SLOTS) {
      const it = inv[iIdx++];
      if (it) {
        const isTwo = it.slot === 2;
        const notch = NOTCH_SYMBOLS[it.tier] ?? '';
        gridSlots += `
          <div class="inv-slot ${isTwo ? 'two-slot' : ''}" style="width:${isTwo ? 160 : 76}px; height:76px; grid-column:${isTwo ? 'span 2' : 'span 1'};">
            ${isTwo ? '<span class="weight-badge">⚖ 2슬롯 (무게 추)</span>' : ''}
            <div style="position:absolute; top:2px; right:4px; font-size:11px; color:#D8B45C;">${notch}</div>
            <div style="font-weight:bold; font-size:12px; margin-top:14px; color:${it.tier === 'epic' ? '#C76FBF' : it.tier === 'rare' ? '#6F9DBF' : it.tier === 'uncommon' ? '#6FBF6F' : '#B3A077'};">${it.name}</div>
            <div style="font-size:11px; color:#E8C86A;">${it.value ? it.value + 'G' : (it.consumableId ? '소모품' : '')}</div>
          </div>
        `;
        currentSlot += it.slot ?? 1;
      } else {
        gridSlots += `
          <div class="inv-slot empty">
            <div style="text-align:center; color:#444; line-height:68px;">${currentSlot + 1}</div>
          </div>
        `;
        currentSlot += 1;
      }
    }

    ui.setPanel(`
      <div class="panel ledger-panel center-modal" style="width:520px; max-width:92vw; text-align:left;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid var(--c-stone); margin-bottom:12px; padding-bottom:8px;">
          <h2 class="ledger-title" style="margin:0; border:none; padding:0;">📜 강탈자의 장부 (Tab)</h2>
          <button id="btn-close-inv" class="btn" style="padding:4px 12px; font-size:13px; margin:0; background:#241C14; border:1px solid #58472E;">✕ 닫기</button>
        </div>
        <div class="row">
          <span>점유 슬롯: <strong>${usedSlots(inv)} / ${INV_SLOTS}</strong></span>
          <span>가방 가치: <strong class="gold">${totalValue(inv)} G</strong></span>
        </div>
        <p class="muted" style="font-size:13px; margin:6px 0 12px;">
          ※ 보물을 많이 소지할수록 심연이 당신을 더 선명하게 봅니다. (시선 상승 가속)
        </p>

        <div class="inv-grid" style="grid-template-columns: repeat(4, 76px); justify-content:center;">
          ${gridSlots}
        </div>

        <div style="margin-top:16px; border-top:1px solid #3A2F1E; padding-top:10px; font-size:13px; color:#9E8E72;">
          <div style="margin-bottom:6px;"><strong>소모품 사용 (터치 또는 1~4):</strong></div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button type="button" class="btn" data-use-consumable="holyWater" style="padding:4px 10px; font-size:12px;">💧 성수병 (시선-30)</button>
            <button type="button" class="btn" data-use-consumable="potion" style="padding:4px 10px; font-size:12px;">🧪 치유 물약 (HP+40)</button>
            <button type="button" class="btn" data-use-consumable="bandage" style="padding:4px 10px; font-size:12px;">🩹 붕대 (지속 회복)</button>
            <button type="button" class="btn" data-use-consumable="lampOil" style="padding:4px 10px; font-size:12px;">🪔 등불 기름 (쿨 초기화)</button>
          </div>
        </div>
      </div>
    `);

    const closeBtn = document.getElementById('btn-close-inv');
    if (closeBtn) {
      closeBtn.onclick = () => {
        engine.player.invOpen = false;
        ui.clearPanel();
      };
    }

    const panel = ui.panelRoot();
    if (panel) {
      const consumableBtns = panel.querySelectorAll('[data-use-consumable]');
      consumableBtns.forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const cid = btn.dataset.useConsumable;
          engine.useConsumable(cid);
        };
      });
    }
  }

  showBlessingModal(options, level, onSelect) {
    if (typeof document === 'undefined') return;

    const optionCards = options.map((b, idx) => {
      let effectHtml;
      if (b.tradeOff && (b.positive || b.penalty)) {
        effectHtml = `
          <div style="margin-top:8px; font-size:12px; line-height:1.45; text-align:left;">
            <div style="background:rgba(86,211,100,0.12); border-left:3px solid #56d364; border-radius:3px; padding:6px 8px; margin-bottom:6px;">
              <strong style="color:#56d364;">긍정 :</strong> <span style="color:#aff5b4;">${b.positive}</span>
            </div>
            <div style="background:rgba(255,123,114,0.12); border-left:3px solid #ff7b72; border-radius:3px; padding:6px 8px;">
              <strong style="color:#ff7b72;">부정 :</strong> <span style="color:#ffd1cd;">${b.penalty}</span>
            </div>
          </div>
        `;
      } else {
        effectHtml = `
          <div style="margin-top:8px; font-size:12px; line-height:1.45; text-align:left;">
            <div style="background:rgba(110,180,240,0.10); border-left:3px solid #6eb4f0; border-radius:3px; padding:6px 8px;">
              <strong style="color:#79c0ff;">효과 :</strong> <span style="color:#d2e7ff;">${b.desc}</span>
            </div>
          </div>
        `;
      }

      return `
        <div class="blessing-card ${b.tradeOff ? 'trade-off' : 'standard'}" data-blessing-idx="${idx}" tabindex="0">
          <div>
            <div style="font-weight:bold; font-size:15px; color:${b.tradeOff ? '#ff8585' : '#85c2ff'}; margin-bottom:4px; font-family:var(--font-title, sans-serif);">
              [${idx + 1}] ${b.name}
            </div>
            <div style="font-size:11px; margin-bottom:6px; color:#aaa; letter-spacing:0.5px;">
              ${b.category.toUpperCase()} · ${b.tier}
            </div>
            ${effectHtml}
          </div>
          <button class="btn" style="margin-top:14px; width:100%; text-align:center; pointer-events:none;">선택 [${idx + 1}]</button>
        </div>
      `;
    }).join('');

    ui.setPanel(`
      <div class="panel ledger-panel center-modal" style="width:720px; max-width:95vw; text-align:center; padding:24px 20px;">
        <h2 class="ledger-title" style="margin-top:0; font-size:18px;">✨ 기억 파편 공명 — 축복 선택 (${level}단계)</h2>
        <p class="muted" style="margin:4px 0 16px; font-size:12px;">심연에서 깨달은 기억을 선택해 빌드를 완성하십시오. (1, 2, 3 키 또는 클릭)</p>
        <div class="blessing-cards-container">${optionCards}</div>
        <div style="margin-top:18px; padding-top:14px; border-top:1px solid #3A2F1E; display:flex; justify-content:center;">
          <button id="btn-skip-blessing" class="btn" style="background:rgba(28,20,15,0.95); border:1px solid #58472E; color:#B5A690; padding:8px 24px; font-size:13px; border-radius:4px; cursor:pointer; transition:all 0.15s ease;">
            ✕ 선택하지 않음 (건너뛰기) [0 또는 ESC]
          </button>
        </div>
      </div>
    `);

    const panel = ui.panelRoot();
    let cleanup = null;

    const select = (idx) => {
      if (cleanup) cleanup();
      ui.clearPanel();
      onSelect(idx);
    };

    const clickHandler = (e) => {
      if (e.target.closest('#btn-skip-blessing')) {
        select(null);
        return;
      }
      const card = e.target.closest('[data-blessing-idx]');
      if (card) {
        const idx = Number(card.dataset.blessingIdx);
        if (!isNaN(idx) && idx >= 0 && idx < options.length) {
          select(idx);
        }
      }
    };

    const keyHandler = (e) => {
      if (e.code === 'Digit1' || e.code === 'Numpad1' || e.key === '1') {
        if (options[0]) { e.preventDefault(); select(0); }
      } else if (e.code === 'Digit2' || e.code === 'Numpad2' || e.key === '2') {
        if (options[1]) { e.preventDefault(); select(1); }
      } else if (e.code === 'Digit3' || e.code === 'Numpad3' || e.key === '3') {
        if (options[2]) { e.preventDefault(); select(2); }
      } else if (e.code === 'Digit0' || e.code === 'Numpad0' || e.key === '0' || e.code === 'Escape' || e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        select(null);
      }
    };

    cleanup = () => {
      panel.removeEventListener('click', clickHandler);
      window.removeEventListener('keydown', keyHandler);
    };

    panel.addEventListener('click', clickHandler);
    window.addEventListener('keydown', keyHandler);
  }
}
