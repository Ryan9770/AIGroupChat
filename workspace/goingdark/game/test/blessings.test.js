import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BLESSINGS, rollBlessingOptions, getBlessingById } from '../src/core/blessings.js';
import { Player } from '../src/entities/player.js';
import { SeededRng } from '../src/core/rng.js';
import { HudRenderer } from '../src/render/HudRenderer.js';
import * as ui from '../src/systems/ui.js';
import { RunEngine } from '../src/run/RunEngine.js';
import { DEFAULT_STATE_V2 } from '../src/systems/save.js';
import { FIXED_STEP } from '../src/core/constants.js';

describe('G3. 18 Blessings & Build Selection', () => {
  test('Exactly 18 blessings defined across 3 branches', () => {
    assert.equal(BLESSINGS.length, 18);

    const exec = BLESSINGS.filter(b => b.category === 'execution');
    const surv = BLESSINGS.filter(b => b.category === 'survival');
    const lant = BLESSINGS.filter(b => b.category === 'lantern');

    assert.equal(exec.length, 6, 'Execution branch must have 6 blessings');
    assert.equal(surv.length, 6, 'Survival branch must have 6 blessings');
    assert.equal(lant.length, 6, 'Lantern branch must have 6 blessings');
  });

  test('At least 6 blessings have explicit trade-offs (penalties)', () => {
    const tradeOffs = BLESSINGS.filter(b => b.tradeOff === true);
    assert.ok(tradeOffs.length >= 6, `Found ${tradeOffs.length} trade-offs, expected >= 6`);
  });

  test('rollBlessingOptions returns 3 distinct blessings', () => {
    const rng = new SeededRng(42);
    const options = rollBlessingOptions(rng.perk, {}, 3);

    assert.equal(options.length, 3);
    const ids = new Set(options.map(o => o.id));
    assert.equal(ids.size, 3, 'Must return 3 distinct options');
  });

  test('Applying blessings modifies player attributes properly', () => {
    const player = new Player({ weaponLevel: 0, inventory: [] });

    // Apply heavy_strike
    const heavyStrike = getBlessingById('heavy_strike');
    assert.ok(heavyStrike);
    heavyStrike.apply(player);
    assert.equal(player.dmgMul, 1.25);
    assert.equal(player.atkCdMul, 1.15);

    // Apply iron_bulwark
    const ironBulwark = getBlessingById('iron_bulwark');
    assert.ok(ironBulwark);
    ironBulwark.apply(player);
    assert.equal(player.guardReduction, 0.85);
  });

  test('HudRenderer.showBlessingModal renders 3 distinct blessing cards side-by-side with positive/negative split and skip button', () => {
    const listeners = {};
    const elements = {};

    function createMockElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        id: '',
        className: '',
        style: {},
        innerHTML: '',
        children: [],
        addEventListener: (ev, cb) => { listeners[ev] = cb; },
        removeEventListener: (ev) => { delete listeners[ev]; },
        appendChild: (child) => { el.children.push(child); return child; },
        closest: (sel) => {
          if (sel === '#btn-skip-blessing') return el.id === 'btn-skip-blessing' ? el : null;
          if (sel === '[data-blessing-idx]') return el.dataset?.blessingIdx !== undefined ? el : null;
          return null;
        },
      };
      return el;
    }

    elements['ui-root'] = createMockElement('div');
    elements['ui-root'].id = 'ui-root';

    global.document = {
      createElement: createMockElement,
      getElementById: (id) => elements[id] || null,
      body: createMockElement('body'),
    };
    global.window = {
      addEventListener: (ev, cb) => { listeners[`win_${ev}`] = cb; },
      removeEventListener: (ev) => { delete listeners[`win_${ev}`]; },
    };

    ui.ensureLayers();

    const hud = new HudRenderer();
    // Test with options containing trade-off blessing
    const heavyStrike = getBlessingById('heavy_strike');
    const frenzyBlade = getBlessingById('frenzy_blade');
    const ironBulwark = getBlessingById('iron_bulwark');
    const options = [heavyStrike, frenzyBlade, ironBulwark];

    let selectedIdx = null;
    hud.showBlessingModal(options, 1, (idx) => { selectedIdx = idx; });

    const renderedHtml = ui.panelRoot().innerHTML;
    assert.ok(renderedHtml.includes('blessing-cards-container'), 'Must use flex container');
    assert.ok(renderedHtml.includes('[1] 묵직한 일격'), 'Card 1 must be rendered');
    assert.ok(renderedHtml.includes('긍정 :'), 'Trade-off cards must render positive split');
    assert.ok(renderedHtml.includes('부정 :'), 'Trade-off cards must render negative split');
    assert.ok(renderedHtml.includes('btn-skip-blessing'), 'Must render skip blessing button');
    assert.ok(renderedHtml.includes('선택하지 않음'), 'Must contain 선택하지 않음 text');

    // Test keyboard selection: pressing Digit1 selects card 0
    listeners['win_keydown']({ code: 'Digit1', preventDefault() {}, stopPropagation() {} });
    assert.equal(selectedIdx, 0, 'Pressing Digit1 must trigger choice 0');

    // Test skip via Escape key
    selectedIdx = 999;
    hud.showBlessingModal(options, 1, (idx) => { selectedIdx = idx; });
    listeners['win_keydown']({ code: 'Escape', preventDefault() {}, stopPropagation() {} });
    assert.equal(selectedIdx, null, 'Pressing Escape must trigger skip (null)');

    // Test skip via Digit0 key
    selectedIdx = 999;
    hud.showBlessingModal(options, 1, (idx) => { selectedIdx = idx; });
    listeners['win_keydown']({ code: 'Digit0', preventDefault() {}, stopPropagation() {} });
    assert.equal(selectedIdx, null, 'Pressing Digit0 must trigger skip (null)');

    delete global.document;
    delete global.window;
  });

  test('RunEngine update handles actions.blessingChoice when blessingSelectionActive is true (including skip)', () => {
    const engine = new RunEngine(DEFAULT_STATE_V2, { seed: 100 });
    engine.blessingSelectionActive = true;
    engine.currentBlessingOptions = rollBlessingOptions(engine.rng.perk, {}, 3);

    assert.equal(engine.blessingSelectionActive, true);
    engine.update(FIXED_STEP, { actions: { blessingChoice: 1 } });
    assert.equal(engine.blessingSelectionActive, false, 'Blessing selection must be resolved');
    assert.equal(Object.keys(engine.activeBlessings).length, 1);

    // Test skipping blessing with -1
    engine.blessingSelectionActive = true;
    engine.currentBlessingOptions = rollBlessingOptions(engine.rng.perk, {}, 3);
    engine.update(FIXED_STEP, { actions: { blessingChoice: -1 } });
    assert.equal(engine.blessingSelectionActive, false, 'Skip must resolve selection active state');
    assert.equal(Object.keys(engine.activeBlessings).length, 1, 'No additional blessing should be applied on skip');
  });
});
