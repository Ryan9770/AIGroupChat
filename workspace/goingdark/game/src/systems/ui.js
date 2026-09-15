// 얇은 DOM 헬퍼 — HUD, 대사창, 알림, 모달 패널을 #ui-root 위에 그린다.
const isBrowser = typeof document !== 'undefined';
let hudEl = null;
let dialogueEl = null;
let dialogueTimer = null;
let notifyLayer = null;
let panelLayer = null;
let saveModalOpen = false;

export function ensureLayers() {
  if (typeof document === 'undefined') return;
  const currentRoot = document.getElementById('ui-root') || document.body;
  if (!currentRoot) return;
  if (!hudEl) {
    hudEl = document.createElement('div');
    hudEl.id = 'hud-layer';
    currentRoot.appendChild(hudEl);
  }
  if (!dialogueEl) {
    dialogueEl = document.createElement('div');
    dialogueEl.className = 'dialogue-box';
    dialogueEl.style.display = 'none';
    currentRoot.appendChild(dialogueEl);
  }
  if (!notifyLayer) {
    notifyLayer = document.createElement('div');
    notifyLayer.id = 'notify-layer';
    currentRoot.appendChild(notifyLayer);
  }
  if (!panelLayer) {
    panelLayer = document.createElement('div');
    panelLayer.id = 'panel-layer';
    panelLayer.className = 'interactive';
    currentRoot.appendChild(panelLayer);
  }
}
if (typeof document !== 'undefined') {
  ensureLayers();
}

export function setHUD(html) {
  if (!hudEl) ensureLayers();
  if (hudEl) hudEl.innerHTML = html;
}
export function clearHUD() {
  if (!hudEl) ensureLayers();
  if (hudEl) hudEl.innerHTML = '';
}

export function showDialogue(speaker, text, duration = 4200) {
  if (!dialogueEl) return;
  dialogueEl.innerHTML = `<span class="speaker">${speaker}</span>${text}`;
  dialogueEl.style.display = 'block';
  clearTimeout(dialogueTimer);
  dialogueTimer = setTimeout(() => { dialogueEl.style.display = 'none'; }, duration);
}

export function showNotify(text, y = 60) {
  if (!notifyLayer) return;
  const div = document.createElement('div');
  div.className = 'notify';
  div.style.top = `${y}px`;
  div.textContent = text;
  notifyLayer.appendChild(div);
  setTimeout(() => div.remove(), 2200);
}

export function setPanel(html) {
  if (!panelLayer) ensureLayers();
  if (!panelLayer) return;
  panelLayer.innerHTML = html;
  panelLayer.style.display = html ? 'block' : 'none';
}
export function clearPanel() {
  if (!panelLayer) ensureLayers();
  if (!panelLayer) return;
  panelLayer.innerHTML = '';
  panelLayer.style.display = 'none';
}
export function panelRoot() {
  if (!panelLayer) ensureLayers();
  return panelLayer;
}

export function isSaveFailureModalOpen() {
  return saveModalOpen;
}

export function showSaveFailureModal({ draft, onRetry, onExport, onDismiss }) {
  saveModalOpen = true;
  if (!isBrowser) return;

  const modalHtml = `
    <div class="panel center-modal" id="save-error-modal" style="border: 2px solid #c94848; z-index: 10000;">
      <h2 style="color: #ff6b6b;">⚠️ 저장 실패 (Save Failed)</h2>
      <p style="margin: 10px 0; line-height: 1.4;">
        브라우저 저장소(localStorage)에 변경사항을 기록하지 못했습니다.<br>
        (저장소 용량 초과 또는 브라우저 보안/시크릿 모드 제한)
      </p>
      <div class="row" style="margin-top: 12px; gap: 8px; justify-content: center;">
        <button class="btn" id="saveRetryBtn" style="background: #2b7a78; color: #fff;">재시도</button>
        <button class="btn" id="saveExportBtn" style="background: #b8860b; color: #fff;">세이브 JSON 내보내기</button>
        <button class="btn" id="saveDismissBtn" style="background: #555; color: #ccc;">닫기</button>
      </div>
    </div>
  `;

  setPanel(modalHtml);

  const retryBtn = document.getElementById('saveRetryBtn');
  const exportBtn = document.getElementById('saveExportBtn');
  const dismissBtn = document.getElementById('saveDismissBtn');

  if (retryBtn) {
    retryBtn.onclick = () => {
      saveModalOpen = false;
      clearPanel();
      if (onRetry) onRetry();
    };
  }

  if (exportBtn) {
    exportBtn.onclick = () => {
      if (onExport) {
        onExport();
      } else {
        const jsonStr = JSON.stringify(draft, null, 2);
        try {
          navigator.clipboard.writeText(jsonStr);
          showNotify('세이브 JSON이 클립보드에 복사되었습니다.', 40);
        } catch {
          const blob = new Blob([jsonStr], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `revenant_run_backup_${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(url);
        }
      }
    };
  }

  if (dismissBtn) {
    dismissBtn.onclick = () => {
      saveModalOpen = false;
      clearPanel();
      if (onDismiss) onDismiss();
    };
  }
}

export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export function gazeColor(gaze) {
  if (gaze <= 30) return '#6fbf6f';
  if (gaze <= 60) return '#d8b45c';
  if (gaze <= 90) return '#c9702f';
  return '#c94848';
}
