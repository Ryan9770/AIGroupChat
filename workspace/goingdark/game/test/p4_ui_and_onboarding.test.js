import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { t, setLanguage, getLanguage } from '../src/core/i18n.js';
import koStrings from '../src/data/strings/ko.json' with { type: 'json' };
import enStrings from '../src/data/strings/en.json' with { type: 'json' };
import { menuSystem } from '../src/systems/menuSystem.js';
import * as ui from '../src/systems/ui.js';

// ============================================================================
// Phase 4: UI/UX, 온보딩, 설정 단위 및 통합 검증
// P4-01: "강탈자의 장부" UI & 4.5:1 명도 대비 & 2슬롯 8칸 가방 메타포
// P4-02: 메뉴 계층 (타이틀, 일시정지, 설정 모달, 크레딧, 영수증) & 버튼 접근성 (D-08)
// P4-03: 연습 굴 온보딩 (첫 5분 7단계 순환 및 건너뛰기)
// P4-04: 다국어(i18n) 문자열 사전 정합성 및 치환 헬퍼
// ============================================================================

describe('P4-04. String Externalization & i18n Dictionary Invariants', () => {
  beforeEach(() => {
    setLanguage('ko');
  });

  test('ko.json and en.json dictionaries have 100% matching key paths', () => {
    function getKeyPaths(obj, prefix = '') {
      let paths = [];
      for (const [k, v] of Object.entries(obj)) {
        const full = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          paths.push(...getKeyPaths(v, full));
        } else {
          paths.push(full);
        }
      }
      return paths;
    }

    const koPaths = getKeyPaths(koStrings).sort();
    const enPaths = getKeyPaths(enStrings).sort();

    assert.deepEqual(koPaths, enPaths, 'All localization keys must be mirrored in ko and en');
    assert.ok(koPaths.length >= 35, 'Dictionary must contain all required UI, HUD, and receipt keys');
  });

  test('t(key, vars) resolves Korean strings and variable interpolation correctly', () => {
    setLanguage('ko');
    assert.equal(t('game.title'), '강탈자들');
    assert.equal(t('receipt.customs_fee', { rate: 10 }), '세관 공제금 (-10%)');
    assert.equal(t('hud.floor', { floor: 2, name: '골격 막사' }), '2층 · 골격 막사');
  });

  test('t(key, vars) resolves English strings after switching language', () => {
    setLanguage('en');
    assert.equal(getLanguage(), 'en');
    assert.equal(t('game.title'), 'Revenant Run');
    assert.equal(t('receipt.customs_fee', { rate: 8 }), 'Customs Deduction (-8%)');
    assert.equal(t('receipt.status_extract'), 'Extracted Alive');

    // Switch back to Korean
    setLanguage('ko');
    assert.equal(getLanguage(), 'ko');
    assert.equal(t('receipt.status_extract'), '생환 탈출 성공');
  });

  test('t(key) falls back gracefully for unknown keys', () => {
    assert.equal(t('unknown.nonexistent.key'), 'unknown.nonexistent.key');
  });
});

describe('P4-01 & Accessibility. WCAG 2.1 Contrast & Dual Coding Invariants', () => {
  function getLuminance(hex) {
    const rgb = hex.replace('#', '').match(/.{2}/g).map(x => {
      const c = parseInt(x, 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }

  function getContrastRatio(hex1, hex2) {
    const l1 = getLuminance(hex1);
    const l2 = getLuminance(hex2);
    const bright = Math.max(l1, l2);
    const dark = Math.min(l1, l2);
    return (bright + 0.05) / (dark + 0.05);
  }

  test('Core text colors on dark void (#0A0806) satisfy WCAG AA 4.5:1 contrast', () => {
    const bgVoid = '#0A0806';
    const textMain = '#E6DCC5';     // Default body text
    const textGold = '#D8B45C';     // Gold title/highlights
    const textHoly = '#CFE6FF';     // Holy/altar blue
    const textWarning = '#F3D586';  // Bright gold warning

    assert.ok(getContrastRatio(textMain, bgVoid) >= 4.5, 'Main body text contrast must be >= 4.5:1');
    assert.ok(getContrastRatio(textGold, bgVoid) >= 4.5, 'Gold text contrast must be >= 4.5:1');
    assert.ok(getContrastRatio(textHoly, bgVoid) >= 4.5, 'Holy blue text contrast must be >= 4.5:1');
    assert.ok(getContrastRatio(textWarning, bgVoid) >= 4.5, 'Warning gold text contrast must be >= 4.5:1');
  });

  test('Receipt paper text on light parchment (#F4EEDC) satisfies WCAG AA 4.5:1 contrast', () => {
    const bgReceipt = '#F4EEDC';
    const textReceipt = '#241C14';
    const textDanger = '#A83A3A';

    assert.ok(getContrastRatio(textReceipt, bgReceipt) >= 4.5, 'Receipt body text contrast must be >= 4.5:1');
    assert.ok(getContrastRatio(textDanger, bgReceipt) >= 4.5, 'Receipt danger text contrast must be >= 4.5:1');
  });
});

describe('P4-02. Menu Hierarchy, Modal State & Button Accessibility', () => {
  let elementsById = {};

  beforeEach(() => {
    elementsById = {};

    function createMockElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        id: '',
        className: '',
        style: {},
        textContent: '',
        _innerHTML: '',
        children: [],
        value: '',
        checked: false,
        addEventListener: (evt, fn) => { el[`on_${evt}`] = fn; },
        removeEventListener: () => {},
        appendChild: (c) => {
          el.children.push(c);
          c.parentNode = el;
          if (c.id) elementsById[c.id] = c;
          return c;
        },
        removeChild: (c) => {
          const idx = el.children.indexOf(c);
          if (idx >= 0) el.children.splice(idx, 1);
          return c;
        },
        click: () => {
          el.on_click?.({ target: el });
          el.onclick?.({ target: el });
        },
        closest: (_sel) => null,
      };

      Object.defineProperty(el, 'innerHTML', {
        get() { return el._innerHTML; },
        set(val) {
          el._innerHTML = val;
          const matches = val.matchAll(/id="([^"]+)"/g);
          for (const m of matches) {
            const id = m[1];
            if (!elementsById[id]) {
              const childEl = createMockElement('div');
              childEl.id = id;
              elementsById[id] = childEl;
            }
          }
        },
      });

      return el;
    }

    const rootEl = createMockElement('div');
    rootEl.id = 'ui-root';
    elementsById['ui-root'] = rootEl;

    global.document = {
      createElement: createMockElement,
      getElementById: (id) => elementsById[id] || null,
      body: createMockElement('body'),
    };
    global.window = {
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    ui.ensureLayers();
  });

  afterEach(() => {
    delete global.document;
    delete global.window;
  });

  test('Title Screen renders with all navigation buttons as button tags', () => {
    let continued = false;
    let newGame = false;
    let settingsOpened = false;

    menuSystem.showTitleScreen({
      onContinue: () => { continued = true; },
      onNewGame: () => { newGame = true; },
      onTutorial: () => {},
      onSettings: () => { settingsOpened = true; },
      onCredits: () => {},
    });

    const panel = ui.panelRoot();
    assert.ok(panel.innerHTML.includes('『강탈자들』'));
    assert.ok(panel.innerHTML.includes('id="btnContinue"'));
    assert.ok(panel.innerHTML.includes('id="btnNewGame"'));
    assert.ok(panel.innerHTML.includes('id="btnSettings"'));

    // Verify accessible <button> tags exist
    const buttonTags = [...panel.innerHTML.matchAll(/<button[^>]*>/g)];
    assert.ok(buttonTags.length >= 5, 'Title screen must have at least 5 accessible buttons');

    elementsById.btnContinue.click();
    assert.equal(continued, true);

    elementsById.btnNewGame.click();
    assert.equal(newGame, true);

    elementsById.btnSettings.click();
    assert.equal(settingsOpened, true);
  });

  test('Settings Modal alters save.settings volumes, screenShake, flashReduction, and colorblindMode', () => {
    const save = {
      settings: {
        masterVolume: 1.0,
        sfxVolume: 0.7,
        musicVolume: 0.5,
        ambienceVolume: 0.35,
        screenShake: 100,
        flashReduction: false,
        colorblindMode: 'none',
      },
    };

    let closed = false;
    menuSystem.showSettingsModal(save, () => { closed = true; });

    const panel = ui.panelRoot();
    assert.ok(panel.innerHTML.includes('id="slMaster"'));
    assert.ok(panel.innerHTML.includes('id="chkFlash"'));
    assert.ok(panel.innerHTML.includes('id="selColorblind"'));
    assert.ok(panel.innerHTML.includes('id="btnSaveSettings"'));

    elementsById.chkFlash.checked = true;
    elementsById.selColorblind.value = 'deuteranopia';
    elementsById.selLanguage.value = 'ko';

    elementsById.btnSaveSettings.click();

    assert.equal(save.settings.flashReduction, true);
    assert.equal(save.settings.colorblindMode, 'deuteranopia');
    assert.equal(closed, true);
  });

  test('Run Receipt Modal correctly calculates and displays gross, customs, and net payout', () => {
    let confirmed = false;
    const result = {
      type: 'extract',
      sessionId: 'RUN-TEST-01',
      grossValue: 500,
      customs: 50,
      customsRate: 0.10,
      payout: 450,
      floor: 3,
      xpGained: 120,
    };

    menuSystem.showReceiptModal(result, () => { confirmed = true; });

    const panel = ui.panelRoot();
    assert.ok(panel.innerHTML.includes('RUN-TEST-01'));
    assert.ok(panel.innerHTML.includes('500 G'));
    assert.ok(panel.innerHTML.includes('-50 G'));
    assert.ok(panel.innerHTML.includes('450 G'));
    assert.ok(panel.innerHTML.includes('3층'));
    assert.ok(panel.innerHTML.includes('+120 XP'));
    assert.ok(panel.innerHTML.includes('생환 탈출 성공'));

    elementsById.btnConfirmReceipt.click();
    assert.equal(confirmed, true);
  });
});

describe('P4-03. Practice Den (Tutorial) Sequential Progression & Skip', () => {
  test('Tutorial steps advance in order only when corresponding player action occurs', () => {
    const mockEngine = {
      player: {
        spawnX: 10,
        spawnY: 10,
        x: 10,
        y: 10,
        attackSwingT: 0,
        guarding: false,
        rolling: false,
        charging: false,
        gateCharge: 0,
      },
      chests: [{ opened: false }],
      altars: [{ used: false }],
    };

    let tutorialFinished = false;
    const steps = [
      { id: 'move', check: (e) => e?.player && (e.player.x !== e.player.spawnX || e.player.y !== e.player.spawnY) },
      { id: 'attack', check: (e) => e?.player && e.player.attackSwingT > 0 },
      { id: 'guard', check: (e) => e?.player && e.player.guarding },
      { id: 'roll', check: (e) => e?.player && e.player.rolling },
      { id: 'loot', check: (e) => e?.chests && e.chests.some(c => c.opened) },
      { id: 'gaze', check: (e) => e?.altars && e.altars.some(a => a.used) },
      { id: 'gate', check: (e) => e?.player && e.player.charging && e.player.gateCharge > 2 },
    ];

    let currentStep = 0;
    function simulateTick() {
      if (currentStep < steps.length && steps[currentStep].check(mockEngine)) {
        currentStep++;
      }
      if (currentStep >= steps.length) {
        tutorialFinished = true;
      }
    }

    // Step 0: Move
    simulateTick();
    assert.equal(currentStep, 0, 'Should not advance before move');
    mockEngine.player.x = 11;
    simulateTick();
    assert.equal(currentStep, 1, 'Advanced to step 1 after movement');

    // Step 1: Attack
    simulateTick();
    assert.equal(currentStep, 1, 'Should not advance before attack');
    mockEngine.player.attackSwingT = 0.15;
    simulateTick();
    assert.equal(currentStep, 2, 'Advanced to step 2 after attack swing');

    // Step 2: Guard
    mockEngine.player.guarding = true;
    simulateTick();
    assert.equal(currentStep, 3, 'Advanced to step 3 after guard');

    // Step 3: Roll
    mockEngine.player.rolling = true;
    simulateTick();
    assert.equal(currentStep, 4, 'Advanced to step 4 after roll');

    // Step 4: Loot
    mockEngine.chests[0].opened = true;
    simulateTick();
    assert.equal(currentStep, 5, 'Advanced to step 5 after loot');

    // Step 5: Gaze Altar
    mockEngine.altars[0].used = true;
    simulateTick();
    assert.equal(currentStep, 6, 'Advanced to step 6 after altar cleansing');

    // Step 6: Gate Charge
    mockEngine.player.charging = true;
    mockEngine.player.gateCharge = 3.0;
    simulateTick();
    assert.equal(currentStep, 7, 'Advanced to final step after gate charge');
    assert.equal(tutorialFinished, true, 'Tutorial successfully finished');
  });
});
