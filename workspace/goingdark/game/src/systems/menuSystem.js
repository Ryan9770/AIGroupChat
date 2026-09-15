// ============================================================================
// 메뉴 및 UI 시스템 (src/systems/menuSystem.js)
// P4-02: 타이틀, 일시정지(Esc), 설정 모달, 크레딧/법적고지, 런 결산 영수증
// P4-03: 첫 5분 온보딩 튜토리얼 (연습 굴)
// ============================================================================

import * as ui from './ui.js';
import { audioManager } from './audioManager.js';
import { t, setLanguage, getLanguage } from '../core/i18n.js';
import { saveState } from './save.js';

export class MenuSystem {
  constructor() {
    this.isPaused = false;
  }

  // ==========================================================================
  // P4-02: 타이틀 메뉴 화면
  // ==========================================================================
  showTitleScreen({ onContinue, onNewGame, onTutorial, onSettings, onCredits }) {
    ui.clearHUD();
    ui.setPanel(`
      <div class="panel center-modal" style="width: 480px; padding: 32px 24px; text-align: center;">
        <h1 style="font-size: 32px; margin-bottom: 4px; color: #D8B45C; letter-spacing: 2px;">『강탈자들』</h1>
        <div style="font-size: 14px; color: #8A7C5E; margin-bottom: 24px;">Revenant Run · PvE Extraction Crawler</div>

        <p class="muted" style="font-style: italic; margin-bottom: 28px;">
          "${t('game.tagline')}"
        </p>

        <div style="display: flex; flex-direction: column; gap: 10px; width: 280px; margin: 0 auto;">
          <button class="btn primary" id="btnContinue" style="padding: 10px 0; font-size: 16px;">⚔ ${t('menu.continue')}</button>
          <button class="btn" id="btnNewGame" style="padding: 10px 0; font-size: 16px;">📜 ${t('menu.new_game')}</button>
          <button class="btn" id="btnTutorial" style="padding: 10px 0; font-size: 16px;">🎯 ${t('menu.practice')}</button>
          <button class="btn" id="btnSettings" style="padding: 10px 0; font-size: 16px;">⚙️ ${t('menu.settings')}</button>
          <button class="btn" id="btnCredits" style="padding: 10px 0; font-size: 16px;">📜 ${t('menu.credits')}</button>
        </div>
      </div>
    `);

    document.getElementById('btnContinue')?.addEventListener('click', onContinue);
    document.getElementById('btnNewGame')?.addEventListener('click', onNewGame);
    document.getElementById('btnTutorial')?.addEventListener('click', onTutorial);
    document.getElementById('btnSettings')?.addEventListener('click', onSettings);
    document.getElementById('btnCredits')?.addEventListener('click', onCredits);
  }

  // ==========================================================================
  // P4-02: 일시정지 (Esc) 메뉴
  // ==========================================================================
  showPauseMenu({ onResume, onSettings, onAbandon }) {
    this.isPaused = true;
    ui.setPanel(`
      <div class="panel center-modal" style="width: 380px; text-align: center;">
        <h2 style="color: #D8B45C;">⏸ ${t('menu.pause')}</h2>
        <p class="muted" style="margin-bottom: 20px;">심연 탐색이 일시 중지되었습니다.</p>

        <div style="display: flex; flex-direction: column; gap: 10px; width: 240px; margin: 0 auto;">
          <button class="btn primary" id="btnResume" style="padding: 10px 0;">${t('menu.resume')}</button>
          <button class="btn" id="btnPauseSettings" style="padding: 10px 0;">⚙️ ${t('menu.settings')}</button>
          <button class="btn danger" id="btnAbandon" style="padding: 10px 0;">💀 ${t('menu.abandon')}</button>
        </div>
      </div>
    `);

    document.getElementById('btnResume')?.addEventListener('click', () => {
      this.isPaused = false;
      ui.clearPanel();
      onResume();
    });

    document.getElementById('btnPauseSettings')?.addEventListener('click', () => {
      onSettings(() => this.showPauseMenu({ onResume, onSettings, onAbandon }));
    });

    document.getElementById('btnAbandon')?.addEventListener('click', () => {
      if (confirm('정말로 원정을 포기하시겠습니까? (사망 처리되며 소지한 전리품이 전량 소화됩니다!)')) {
        this.isPaused = false;
        ui.clearPanel();
        onAbandon();
      }
    });
  }

  // ==========================================================================
  // P4-02: 환경설정 모달 (사운드 버스, 흔들림, 깜빡임, 색각보조, 언어)
  // ==========================================================================
  showSettingsModal(save, onClose) {
    save.settings = save.settings || {};
    const s = save.settings;

    const masterVol = Math.round((s.masterVolume ?? 1.0) * 100);
    const sfxVol = Math.round((s.sfxVolume ?? 0.7) * 100);
    const musicVol = Math.round((s.musicVolume ?? 0.5) * 100);
    const ambienceVol = Math.round((s.ambienceVolume ?? 0.35) * 100);
    const screenShake = s.screenShake ?? 100;
    const flashReduction = s.flashReduction ?? false;
    const colorblind = s.colorblindMode ?? 'none';
    const touchControls = s.touchControls ?? 'auto';
    const lang = getLanguage();

    ui.setPanel(`
      <div class="panel center-modal" style="width: 520px; text-align: left;">
        <h2>⚙️ ${t('settings.title')}</h2>

        <div class="row">
          <span>${t('settings.master_vol')} (<span id="txtMaster">${masterVol}%</span>)</span>
          <input type="range" id="slMaster" min="0" max="100" value="${masterVol}" style="width: 160px;">
        </div>
        <div class="row">
          <span>${t('settings.sfx_vol')} (<span id="txtSfx">${sfxVol}%</span>)</span>
          <input type="range" id="slSfx" min="0" max="100" value="${sfxVol}" style="width: 160px;">
        </div>
        <div class="row">
          <span>${t('settings.music_vol')} (<span id="txtMusic">${musicVol}%</span>)</span>
          <input type="range" id="slMusic" min="0" max="100" value="${musicVol}" style="width: 160px;">
        </div>
        <div class="row">
          <span>${t('settings.ambience_vol')} (<span id="txtAmbience">${ambienceVol}%</span>)</span>
          <input type="range" id="slAmbience" min="0" max="100" value="${ambienceVol}" style="width: 160px;">
        </div>

        <h3 style="margin-top: 16px;">접근성 및 화면</h3>
        <div class="row">
          <span>${t('settings.screen_shake')} (<span id="txtShake">${screenShake}%</span>)</span>
          <input type="range" id="slShake" min="0" max="100" value="${screenShake}" style="width: 160px;">
        </div>
        <div class="row">
          <span>${t('settings.flash_reduction')}</span>
          <input type="checkbox" id="chkFlash" ${flashReduction ? 'checked' : ''}>
        </div>
        <div class="row">
          <span>${t('settings.colorblind_mode')}</span>
          <select id="selColorblind" class="btn" style="padding: 4px 8px;">
            <option value="none" ${colorblind === 'none' ? 'selected' : ''}>${t('settings.colorblind_none')}</option>
            <option value="deuteranopia" ${colorblind === 'deuteranopia' ? 'selected' : ''}>${t('settings.colorblind_deut')}</option>
            <option value="protanopia" ${colorblind === 'protanopia' ? 'selected' : ''}>${t('settings.colorblind_prot')}</option>
          </select>
        </div>
        <div class="row">
          <span>가상 패드 (모바일 조작)</span>
          <select id="selTouchControls" class="btn" style="padding: 4px 8px;">
            <option value="auto" ${touchControls === 'auto' ? 'selected' : ''}>자동 감지 (모바일)</option>
            <option value="on" ${touchControls === 'on' ? 'selected' : ''}>항상 켜기 (PC 테스트)</option>
            <option value="off" ${touchControls === 'off' ? 'selected' : ''}>끄기</option>
          </select>
        </div>
        <div class="row">
          <span>${t('settings.language')}</span>
          <select id="selLanguage" class="btn" style="padding: 4px 8px;">
            <option value="ko" ${lang === 'ko' ? 'selected' : ''}>한국어</option>
            <option value="en" ${lang === 'en' ? 'selected' : ''}>English</option>
          </select>
        </div>

        <div style="text-align: right; margin-top: 20px;">
          <button class="btn primary" id="btnSaveSettings">${t('menu.close')}</button>
        </div>
      </div>
    `);

    // 실시간 볼륨 이벤트 연결
    const slMaster = document.getElementById('slMaster');
    const slSfx = document.getElementById('slSfx');
    const slMusic = document.getElementById('slMusic');
    const slAmbience = document.getElementById('slAmbience');
    const slShake = document.getElementById('slShake');

    slMaster?.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      document.getElementById('txtMaster').textContent = `${v}%`;
      audioManager.setVolume('master', v / 100);
      s.masterVolume = v / 100;
    });
    slSfx?.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      document.getElementById('txtSfx').textContent = `${v}%`;
      audioManager.setVolume('sfx', v / 100);
      s.sfxVolume = v / 100;
    });
    slMusic?.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      document.getElementById('txtMusic').textContent = `${v}%`;
      audioManager.setVolume('music', v / 100);
      s.musicVolume = v / 100;
    });
    slAmbience?.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      document.getElementById('txtAmbience').textContent = `${v}%`;
      audioManager.setVolume('ambience', v / 100);
      s.ambienceVolume = v / 100;
    });
    slShake?.addEventListener('input', (e) => {
      const v = Number(e.target.value);
      document.getElementById('txtShake').textContent = `${v}%`;
      s.screenShake = v;
    });

    document.getElementById('btnSaveSettings')?.addEventListener('click', () => {
      s.flashReduction = document.getElementById('chkFlash')?.checked ?? false;
      s.colorblindMode = document.getElementById('selColorblind')?.value ?? 'none';
      s.touchControls = document.getElementById('selTouchControls')?.value ?? 'auto';
      const selectedLang = document.getElementById('selLanguage')?.value ?? 'ko';
      setLanguage(selectedLang);
      saveState(save);
      ui.clearPanel();
      if (onClose) onClose();
    });
  }

  // ==========================================================================
  // P4-02: 크레딧 및 법적 고지 모달
  // ==========================================================================
  showCreditsModal(onClose) {
    ui.setPanel(`
      <div class="panel center-modal" style="width: 580px; max-height: 520px; overflow-y: auto; text-align: left;">
        <h2>📜 크레딧 & 서드파티 라이선스 고지</h2>

        <h3>기획 및 제작</h3>
        <p class="muted">『강탈자들 (Revenant Run)』 제작팀 — Google Antigravity & Deepmind</p>

        <h3>그래픽 에셋 (CC0 / Public Domain)</h3>
        <ul class="muted" style="font-size: 13px;">
          <li><strong>0x72 DungeonTileset II v1.7</strong> (CC0) — 타일맵, 캐릭터, 무기</li>
          <li><strong>Kenney Roguelike & RPG Audio</strong> (CC0) — 소품, 아이콘, 효과음</li>
        </ul>

        <h3>오디오 에셋</h3>
        <ul class="muted" style="font-size: 13px;">
          <li><strong>Sonniss GDC Game Audio Bundle</strong> — 로열티 프리 환경음/SFX</li>
          <li><strong>Web Audio API Procedural Synthesizer</strong> — 텔레그래프 및 심장박동</li>
        </ul>

        <h3>폰트 라이선스 (SIL Open Font License 1.1)</h3>
        <ul class="muted" style="font-size: 13px;">
          <li><strong>Galmuri (quiple)</strong> — 인게임 HUD 및 데미지 숫자</li>
          <li><strong>Noto Sans KR & Noto Serif KR</strong> — Google Fonts (SIL OFL 1.1)</li>
        </ul>

        <div style="text-align: right; margin-top: 20px;">
          <button class="btn primary" id="btnCloseCredits">${t('menu.close')}</button>
        </div>
      </div>
    `);

    document.getElementById('btnCloseCredits')?.addEventListener('click', () => {
      ui.clearPanel();
      if (onClose) onClose();
    });
  }

  // ==========================================================================
  // P4-02: 런 결과 영수증 연출 (Run Receipt)
  // ==========================================================================
  showReceiptModal(result, onConfirm) {
    const isExtract = result.type === 'extract';
    const customsPct = Math.round((result.customsRate ?? 0.10) * 100);

    ui.setPanel(`
      <div class="panel receipt-paper center-modal" style="text-align: left;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #3A2F1E; padding-bottom: 8px;">
          <h2 style="margin: 0;">📜 ${t('receipt.title')}</h2>
          <span style="font-size: 12px; color: #7A694D;">NO. ${result.sessionId ?? 'RUN-001'}</span>
        </div>

        <div style="text-align: center; margin: 12px 0;">
          <div class="receipt-seal" style="${isExtract ? 'border-color:#3A8A5A; color:#3A8A5A;' : 'border-color:#A83A3A; color:#A83A3A;'}">
            ${isExtract ? '✅ ' + t('receipt.status_extract') : '💀 ' + t('receipt.status_death')}
          </div>
        </div>

        <div class="row">
          <span>${t('receipt.total_loot_val')}</span>
          <strong class="gold">${result.grossValue ?? 0} G</strong>
        </div>
        <div class="row">
          <span>${t('receipt.customs_fee', { rate: customsPct })}</span>
          <span style="color: #A83A3A;">-${result.customs ?? 0} G</span>
        </div>
        <div class="row" style="font-size: 17px; font-weight: bold; border-bottom: 2px solid #3A2F1E; padding: 10px 0;">
          <span>${t('receipt.net_payout')}</span>
          <span style="color: #2F6F3A;">${result.payout ?? 0} G</span>
        </div>

        <div class="row" style="margin-top: 10px;">
          <span>도달 층</span>
          <span>${result.floor ?? 1}층</span>
        </div>
        <div class="row">
          <span>획득 기억 파편 (XP)</span>
          <span class="gold">+${result.xpGained ?? 0} XP</span>
        </div>

        <p class="muted" style="margin: 16px 0; font-size: 13px; font-style: italic;">
          ${isExtract
            ? '"살아서 나왔군. 약탈품은 장부에 기록되었다. 구멍 밖으로 나온 것만 세상의 물건이다." — 브로카'
            : '"청구할 곳이 없으니 적을 데도 없다. 짐은 심연으로 소화되었다." — 브로카'}
        </p>

        <div style="text-align: center; margin-top: 18px;">
          <button class="btn primary" id="btnConfirmReceipt" style="width: 100%; padding: 10px 0; font-weight: bold;">
            ${t('receipt.confirm')}
          </button>
        </div>
      </div>
    `);

    document.getElementById('btnConfirmReceipt')?.addEventListener('click', () => {
      ui.clearPanel();
      if (onConfirm) onConfirm();
    });
  }

  // ==========================================================================
  // P4-03: 온보딩 연습 굴 (튜토리얼 시퀀스)
  // 행동 완료 시에만 다음 단계로 진행 (건너뛰기 지원)
  // ==========================================================================
  startTutorial(engine, onComplete) {
    const steps = [
      { id: 'move', title: '이동 훈련', text: t('tutorial.step1_move'), check: (e) => e?.player && (e.player.x !== e.player.spawnX || e.player.y !== e.player.spawnY) },
      { id: 'attack', title: '전투 훈련', text: t('tutorial.step2_attack'), check: (e) => e?.player && e.player.attackSwingT > 0 },
      { id: 'guard', title: '방어 훈련', text: t('tutorial.step3_guard'), check: (e) => e?.player && e.player.guarding },
      { id: 'roll', title: '회피 훈련', text: t('tutorial.step4_roll'), check: (e) => e?.player && e.player.rolling },
      { id: 'loot', title: '약탈 훈련', text: t('tutorial.step5_loot'), check: (e) => e?.chests && e.chests.some(c => c.opened) },
      { id: 'gaze', title: '시선 훈련', text: t('tutorial.step6_gaze'), check: (e) => e?.altars && e.altars.some(a => a.used) },
      { id: 'gate', title: '탈출 훈련', text: t('tutorial.step7_gate'), check: (e) => e?.player && e.player.charging && e.player.gateCharge > 2 },
    ];

    let currentStepIdx = 0;
    let bannerEl = null;
    let checkInterval = null;

    const cleanup = () => {
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
      if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeyDown);
      if (bannerEl && bannerEl.parentNode) bannerEl.parentNode.removeChild(bannerEl);
      bannerEl = null;
    };

    const updateBanner = () => {
      if (typeof document === 'undefined') return;
      if (currentStepIdx >= steps.length) {
        cleanup();
        ui.showNotify(`✨ ${t('tutorial.complete')}`, 160);
        if (onComplete) onComplete();
        return;
      }
      const step = steps[currentStepIdx];
      if (!bannerEl) {
        bannerEl = document.createElement('div');
        bannerEl.id = 'tutorial-banner';
        bannerEl.className = 'tutorial-banner';
        const root = document.getElementById('ui-root') || document.body;
        root?.appendChild(bannerEl);
      }
      bannerEl.innerHTML = `
        <div style="flex: 1; text-align: left;">
          <div class="step-tag">🎯 [${currentStepIdx + 1} / ${steps.length}] ${step.title}</div>
          <div class="step-text">${step.text}</div>
        </div>
        <button type="button" class="btn" id="btnSkipTutorial" style="margin-left: 16px; padding: 6px 12px; font-size: 13px;">
          ${t('tutorial.skip')}
        </button>
      `;
      document.getElementById('btnSkipTutorial')?.addEventListener('click', () => {
        cleanup();
        ui.showNotify('튜토리얼을 건너뛰었습니다.', 100);
        if (onComplete) onComplete();
      });
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        cleanup();
        ui.showNotify('튜토리얼을 건너뛰었습니다.', 100);
        if (onComplete) onComplete();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', onKeyDown);
    }

    updateBanner();

    checkInterval = setInterval(() => {
      if (currentStepIdx >= steps.length) {
        cleanup();
        return;
      }

      const step = steps[currentStepIdx];
      if (step.check(engine)) {
        currentStepIdx++;
        updateBanner();
      }
    }, 100);

    return cleanup;
  }
}

export const menuSystem = new MenuSystem();
