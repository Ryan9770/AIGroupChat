// ============================================================================
// 터치 컨트롤 시스템 (TouchControls)
// 모바일 가상 조이스틱 (WASD/대시), 온스크린 액션 버튼 (공격/가드/구르기/등불/조사/귀환),
// 소모품 퀵 슬롯 및 유틸리티(인벤토리, 일시정지, 전체화면) 모바일 최적화 컨트롤러
// ============================================================================

export class TouchControls {
  constructor(inputController, opts = {}) {
    this.input = inputController;
    this.opts = opts;
    this.container = null;
    this.joystickPointerId = null;
    this.joystickOrigin = { x: 0, y: 0 };
    this.maxJoystickRadius = 52;

    // 모드 설정 ('auto' | 'on' | 'off')
    this.mode = opts.mode ?? 'auto';
    this.isEnabled = this._checkEnabled();

    this._boundHandlers = [];

    if (this.isEnabled) {
      this._createDOM();
      this._bindEvents();
    }
  }

  _checkEnabled() {
    if (this.mode === 'on') return true;
    if (this.mode === 'off') return false;
    if (typeof window === 'undefined') return false;
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  }

  _vibrate(ms = 15) {
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(ms);
      }
    } catch {}
  }

  _createDOM() {
    if (typeof document === 'undefined') return;
    const uiRoot = document.getElementById('ui-root') || document.body;
    if (!uiRoot) return;

    // 기존 요소가 있으면 먼저 제거
    const old = document.getElementById('touch-controls-root');
    if (old) old.remove();

    this.container = document.createElement('div');
    this.container.id = 'touch-controls-root';
    this.container.className = 'touch-controls-root';
    this.container.innerHTML = `
      <!-- 좌측 하단 가상 조이스틱 영역 -->
      <div id="touch-joystick-zone" class="touch-joystick-zone">
        <div id="touch-joystick-base" class="touch-joystick-base">
          <div id="touch-joystick-knob" class="touch-joystick-knob"></div>
          <div class="touch-joystick-hint">이동 · 전력질주</div>
        </div>
      </div>

      <!-- 상단 유틸리티 바 (장부, 일시정지, 전체화면) -->
      <div class="touch-top-bar">
        <button type="button" id="btn-touch-fullscreen" class="touch-btn-util" title="전체화면">⛶ 화면</button>
        <button type="button" id="btn-touch-inv" class="touch-btn-util" title="장부 (Tab)">📜 장부</button>
        <button type="button" id="btn-touch-pause" class="touch-btn-util" title="일시정지 (ESC)">⏸ 정지</button>
      </div>

      <!-- 우측 소모품 퀵 바 -->
      <div class="touch-consumables-bar">
        <button type="button" class="touch-btn-item" data-item="holyWater" title="1 성수병 (시선-30)">💧 성수</button>
        <button type="button" class="touch-btn-item" data-item="potion" title="2 치유 물약 (HP+40)">🧪 물약</button>
        <button type="button" class="touch-btn-item" data-item="bandage" title="3 붕대 (지속 회복)">🩹 붕대</button>
        <button type="button" class="touch-btn-item" data-item="lampOil" title="4 등불 기름">🪔 기름</button>
      </div>

      <!-- 우측 하단 액션 버튼 클러스터 -->
      <div class="touch-actions-cluster">
        <!-- 등불 Q (상단) -->
        <button type="button" id="btn-touch-lamp" class="touch-action-btn touch-btn-sub touch-btn-lamp" title="등불 (Q)">
          <span class="icon">💡</span>
          <span class="lbl">등불</span>
        </button>

        <!-- 상호작용 E (상우측) -->
        <button type="button" id="btn-touch-interact" class="touch-action-btn touch-btn-sub touch-btn-interact" title="조사/상호작용 (E)">
          <span class="icon">🖐</span>
          <span class="lbl">조사</span>
        </button>

        <!-- 게이트 귀환 F (우측) -->
        <button type="button" id="btn-touch-gate" class="touch-action-btn touch-btn-sub touch-btn-gate" title="게이트 귀환 (F)">
          <span class="icon">🌀</span>
          <span class="lbl">귀환</span>
        </button>

        <!-- 가드 방어 (상좌측) -->
        <button type="button" id="btn-touch-guard" class="touch-action-btn touch-btn-sub touch-btn-guard" title="가드 (우클릭)">
          <span class="icon">🛡</span>
          <span class="lbl">가드</span>
        </button>

        <!-- 구르기 회피 (하좌측) -->
        <button type="button" id="btn-touch-roll" class="touch-action-btn touch-btn-sub touch-btn-roll" title="구르기 (Space)">
          <span class="icon">💨</span>
          <span class="lbl">구르기</span>
        </button>

        <!-- 기본 공격 (중앙 메인) -->
        <button type="button" id="btn-touch-attack" class="touch-action-btn touch-btn-main touch-btn-attack" title="공격 (좌클릭)">
          <span class="icon">⚔</span>
          <span class="lbl">공격</span>
        </button>
      </div>
    `;

    uiRoot.appendChild(this.container);
  }

  _bindEvents() {
    if (!this.container) return;

    // 1. 가상 조이스틱
    const joyZone = this.container.querySelector('#touch-joystick-zone');
    const joyBase = this.container.querySelector('#touch-joystick-base');
    const joyKnob = this.container.querySelector('#touch-joystick-knob');

    if (joyZone && joyBase && joyKnob) {
      const onJoyDown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.joystickPointerId = e.pointerId;
        try { joyZone.setPointerCapture(e.pointerId); } catch {}

        const rect = joyBase.getBoundingClientRect();
        this.joystickOrigin = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
        this._updateJoystick(e.clientX, e.clientY, joyKnob);
      };

      const onJoyMove = (e) => {
        if (e.pointerId !== this.joystickPointerId) return;
        e.preventDefault();
        e.stopPropagation();
        this._updateJoystick(e.clientX, e.clientY, joyKnob);
      };

      const onJoyUp = (e) => {
        if (e.pointerId !== this.joystickPointerId) return;
        e.preventDefault();
        e.stopPropagation();
        this.joystickPointerId = null;
        try { joyZone.releasePointerCapture(e.pointerId); } catch {}
        joyKnob.style.transform = 'translate(0px, 0px)';
        this.input.setTouchMove(0, 0, false);
      };

      joyZone.addEventListener('pointerdown', onJoyDown);
      joyZone.addEventListener('pointermove', onJoyMove);
      joyZone.addEventListener('pointerup', onJoyUp);
      joyZone.addEventListener('pointercancel', onJoyUp);
    }

    // 2. 공격 버튼 (⚔)
    const btnAttack = this.container.querySelector('#btn-touch-attack');
    if (btnAttack) {
      btnAttack.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._vibrate(15);
        this.input.triggerAction('attack');
      });
    }

    // 3. 구르기 버튼 (💨)
    const btnRoll = this.container.querySelector('#btn-touch-roll');
    if (btnRoll) {
      btnRoll.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._vibrate(15);
        this.input.triggerAction('roll');
      });
    }

    // 4. 가드 버튼 (🛡, 누르고 있는 동안 가드 유지)
    const btnGuard = this.container.querySelector('#btn-touch-guard');
    if (btnGuard) {
      btnGuard.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._vibrate(15);
        btnGuard.classList.add('active');
        this.input.triggerAction('guard', true);
      });
      const endGuard = (e) => {
        e.preventDefault();
        btnGuard.classList.remove('active');
        this.input.triggerAction('guard', false);
      };
      btnGuard.addEventListener('pointerup', endGuard);
      btnGuard.addEventListener('pointercancel', endGuard);
    }

    // 5. 상호작용 / 조사 버튼 (🖐)
    const btnInteract = this.container.querySelector('#btn-touch-interact');
    if (btnInteract) {
      btnInteract.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._vibrate(15);
        this.input.triggerAction('interact');
      });
    }

    // 6. 등불 스킬 버튼 (💡)
    const btnLamp = this.container.querySelector('#btn-touch-lamp');
    if (btnLamp) {
      btnLamp.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._vibrate(15);
        this.input.triggerAction('lamp');
      });
    }

    // 7. 게이트 귀환 버튼 (🌀, 누르고 있는 동안 게이트 조율)
    const btnGate = this.container.querySelector('#btn-touch-gate');
    if (btnGate) {
      btnGate.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._vibrate(20);
        btnGate.classList.add('active');
        this.input.triggerAction('gate', true);
      });
      const endGate = (e) => {
        e.preventDefault();
        btnGate.classList.remove('active');
        this.input.triggerAction('gate', false);
      };
      btnGate.addEventListener('pointerup', endGate);
      btnGate.addEventListener('pointercancel', endGate);
    }

    // 8. 소모품 버튼들 (💧 성수, 🧪 물약, 🩹 붕대, 🪔 기름)
    const itemBtns = this.container.querySelectorAll('[data-item]');
    itemBtns.forEach(btn => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._vibrate(10);
        const itemId = btn.dataset.item;
        this.input.triggerAction('consumable', itemId);
      });
    });

    // 9. 상단 유틸리티 버튼들 (장부, 일시정지, 전체화면)
    const btnInv = this.container.querySelector('#btn-touch-inv');
    if (btnInv) {
      btnInv.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._vibrate(10);
        if (this.opts.onToggleInventory) {
          this.opts.onToggleInventory();
        } else {
          this.input.triggerAction('tabInv');
        }
      });
    }

    const btnPause = this.container.querySelector('#btn-touch-pause');
    if (btnPause) {
      btnPause.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._vibrate(15);
        if (this.opts.onPause) {
          this.opts.onPause();
        } else {
          this.input.triggerAction('pause');
        }
      });
    }

    const btnFullscreen = this.container.querySelector('#btn-touch-fullscreen');
    if (btnFullscreen) {
      btnFullscreen.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._vibrate(10);
        this._toggleFullscreen();
      });
    }
  }

  _updateJoystick(clientX, clientY, knobEl) {
    const dx = clientX - this.joystickOrigin.x;
    const dy = clientY - this.joystickOrigin.y;
    const dist = Math.hypot(dx, dy);
    const maxR = this.maxJoystickRadius;

    let clampedX = dx;
    let clampedY = dy;
    if (dist > maxR) {
      clampedX = (dx / dist) * maxR;
      clampedY = (dy / dist) * maxR;
    }

    knobEl.style.transform = `translate(${clampedX}px, ${clampedY}px)`;

    const normX = dist > 5 ? (clampedX / maxR) : 0;
    const normY = dist > 5 ? (clampedY / maxR) : 0;
    const isSprint = (dist >= maxR * 0.82);

    this.input.setTouchMove(normX, normY, isSprint);
  }

  _toggleFullscreen() {
    if (typeof document === 'undefined') return;
    try {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen();
        } else if (document.documentElement.webkitRequestFullscreen) {
          document.documentElement.webkitRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      }
    } catch (err) {
      console.warn('Fullscreen toggle failed', err);
    }
  }

  destroy() {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }
}
