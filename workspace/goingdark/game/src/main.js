import { loadState } from './systems/save.js';
import { ensureAudioResumed } from './systems/audio.js';
import { audioManager } from './systems/audioManager.js';
import { HubScene } from './scenes/hub.js';
import { DungeonScene } from './scenes/dungeon.js';
import * as ui from './systems/ui.js';
import { FIXED_STEP } from './core/constants.js';
import { menuSystem } from './systems/menuSystem.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// 모바일 및 반응형 뷰포트 종횡비(16:9) 자동 스케일링
export function resizeApp() {
  const app = document.getElementById('app');
  if (!app || typeof window === 'undefined') return;
  const targetW = 1280;
  const targetH = 720;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const scale = Math.min(w / targetW, h / targetH);
  app.style.transform = `scale(${scale})`;
}

window.addEventListener('resize', resizeApp);
window.addEventListener('orientationchange', () => setTimeout(resizeApp, 100));
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', resizeApp);
} else {
  resizeApp();
}

let save = loadState();
let scene = null;
let speedMul = 1;

window.addEventListener('pointerdown', ensureAudioResumed, { once: true });
window.addEventListener('keydown', ensureAudioResumed, { once: true });

function goHub(firstVisit = false) {
  scene = new HubScene(canvas, ctx, save, {
    speedMul,
    firstVisit,
    onEnterDungeon: (mul) => {
      speedMul = mul;
      goDungeon();
    },
  });
}

function goDungeon() {
  scene = new DungeonScene(canvas, ctx, save, {
    speedMultiplier: speedMul,
    onEnd: (result) => showResult(result),
  });
}

function showResult(result) {
  if (result.success === false) {
    ui.setPanel(`
      <div class="panel center-modal" style="border: 2px solid #c94848;">
        <h2 style="color:#ff6b6b;">⚠️ 정산 저장 실패</h2>
        <p>런 결과를 로컬 저장소에 기록하지 못했습니다. 상태가 변경되지 않았습니다.</p>
        <button type="button" class="btn" style="margin-top:14px;" id="backToHubBtn">거점으로 귀환</button>
      </div>
    `);
    document.getElementById('backToHubBtn').onclick = () => {
      ui.clearPanel();
      goHub(false);
    };
    return;
  }

  // P4-02: 강탈자의 결산 영수증 모달 연출
  menuSystem.showReceiptModal(result, () => goHub(false));
}

function bootTitle() {
  menuSystem.showTitleScreen({
    onContinue: () => { ui.clearPanel(); goHub(false); },
    onNewGame: () => { ui.clearPanel(); goHub((save.stats?.runs ?? 0) === 0); },
    onTutorial: () => {
      ui.clearPanel();
      goDungeon();
      setTimeout(() => {
        if (scene && scene.engine) menuSystem.startTutorial(scene.engine);
      }, 300);
    },
    onSettings: () => { menuSystem.showSettingsModal(save, () => bootTitle()); },
    onCredits: () => { menuSystem.showCreditsModal(() => bootTitle()); },
  });
}

// 최초 진입: 에셋 프리로드 화면 후 타이틀 진입
async function boot() {
  ui.setPanel(`
    <div class="panel center-modal" style="width: 360px; text-align: center;">
      <h2>『강탈자들』 준비 중...</h2>
      <div style="background: #222; border: 1px solid #555; height: 16px; border-radius: 4px; overflow: hidden; margin: 16px 0;">
        <div id="loading-bar" style="background: #2b7a78; width: 0%; height: 100%; transition: width 0.1s;"></div>
      </div>
      <p id="loading-text" class="muted" style="font-size: 13px;">에셋 불러오는 중...</p>
    </div>
  `);

  try {
    await audioManager.preload((progress, item) => {
      const bar = document.getElementById('loading-bar');
      const text = document.getElementById('loading-text');
      if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
      if (text) text.textContent = `불러오는 중: ${item.key}`;
    });
  } catch (err) {
    console.warn('Preload encountered non-critical errors', err);
  }

  ui.clearPanel();
  bootTitle();
}

boot();

// P0-03: 고정 스텝 1/60초 누산기 루프
let lastT = performance.now();
let accumulator = 0;

function loop(t) {
  let frameTime = (t - lastT) / 1000;
  if (frameTime > 0.25) frameTime = 0.25; // 나선 방지
  lastT = t;
  accumulator += frameTime;

  try {
    while (accumulator >= FIXED_STEP) {
      if (scene && scene.update) {
        scene.update(FIXED_STEP);
      }
      accumulator -= FIXED_STEP;
    }
  } catch (err) {
    console.error('Render/Update loop error:', err);
    accumulator = 0; // 나선 폭발 방지
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
