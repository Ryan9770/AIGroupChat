// ============================================================================
// 입력 컨트롤러 (InputController)
// 키보드, 마우스 이벤트 수신 및 정규화된 입력 상태 제공
// P1-02: 던전 씬으로부터 입력 제어 분리
// ============================================================================

export class InputController {
  constructor(canvas = null) {
    this.canvas = canvas;
    this.keys = new Set();
    this.moveX = 0;
    this.moveY = 0;
    this.sprint = false;
    this.guardDown = false;
    this.mouseDown = false;
    this.mouseY = 0;

    // 모바일 터치 입력 상태
    this.touchMoveX = 0;
    this.touchMoveY = 0;
    this.touchSprint = false;
    this.isTouchMoving = false;

    // 1회성 액션 트리거 버퍼
    this.actions = {
      roll: false,
      lamp: false,
      interact: false,
      attack: false,
      tabInv: false,
      gate: false,
      consumable: null, // 'holyWater' | 'potion' | 'bandage' | 'lampOil'
      blessingChoice: null, // 0 | 1 | 2
    };

    this._bound = false;
    this._bindEvents();
  }

  _bindEvents() {
    if (typeof window === 'undefined') return;

    this._onKeyDown = (e) => {
      this.keys.add(e.code);

      // 숫자키 축복 선택 또는 소모품
      if (e.code === 'Digit1') { this.actions.blessingChoice = 0; this.actions.consumable = 'holyWater'; }
      if (e.code === 'Digit2') { this.actions.blessingChoice = 1; this.actions.consumable = 'potion'; }
      if (e.code === 'Digit3') { this.actions.blessingChoice = 2; this.actions.consumable = 'bandage'; }
      if (e.code === 'Digit4') { this.actions.consumable = 'lampOil'; }
      if (e.code === 'Digit0') { this.actions.blessingChoice = -1; }

      if (e.code === 'Tab') {
        e.preventDefault();
        this.actions.tabInv = true;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        this.actions.roll = true;
      }
      if (e.code === 'KeyQ') this.actions.lamp = true;
      if (e.code === 'KeyE') this.actions.interact = true;

      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.sprint = true;
      this._updateMoveVec();
    };

    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.sprint = false;
      this._updateMoveVec();
    };

    this._onMouseMove = (e) => {
      if (!this.canvas || !this.canvas.getBoundingClientRect) return;
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width ? (this.canvas.width / rect.width) : 1;
      const scaleY = this.canvas.height ? (this.canvas.height / rect.height) : 1;
      this.mouseX = (e.clientX - rect.left) * scaleX;
      this.mouseY = (e.clientY - rect.top) * scaleY;
    };

    this._onMouseDown = (e) => {
      if (e.button === 0) {
        this.mouseDown = true;
        this.actions.attack = true;
      }
      if (e.button === 2) {
        if (e.preventDefault) e.preventDefault();
        this.guardDown = true;
      }
    };

    this._onMouseUp = (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.guardDown = false;
    };

    this._onContextMenu = (e) => {
      e.preventDefault();
    };

    this._onTouchPos = (touch) => {
      if (!this.canvas || !this.canvas.getBoundingClientRect || !touch) return;
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width ? (this.canvas.width / rect.width) : 1;
      const scaleY = this.canvas.height ? (this.canvas.height / rect.height) : 1;
      this.mouseX = (touch.clientX - rect.left) * scaleX;
      this.mouseY = (touch.clientY - rect.top) * scaleY;
    };

    this._onTouchStart = (e) => {
      if (e.changedTouches && e.changedTouches[0]) {
        this._onTouchPos(e.changedTouches[0]);
      }
    };

    this._onTouchMove = (e) => {
      if (e.changedTouches && e.changedTouches[0]) {
        this._onTouchPos(e.changedTouches[0]);
      }
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('contextmenu', this._onContextMenu);

    if (this.canvas && this.canvas.addEventListener) {
      this.canvas.addEventListener('mousemove', this._onMouseMove);
      this.canvas.addEventListener('mousedown', this._onMouseDown);
      this.canvas.addEventListener('mouseup', this._onMouseUp);
      this.canvas.addEventListener('contextmenu', this._onContextMenu);
      this.canvas.addEventListener('touchstart', this._onTouchStart, { passive: true });
      this.canvas.addEventListener('touchmove', this._onTouchMove, { passive: true });
    }

    this._bound = true;
  }

  setTouchMove(x, y, sprint = false) {
    this.touchMoveX = x;
    this.touchMoveY = y;
    this.touchSprint = sprint;
    this.isTouchMoving = (x !== 0 || y !== 0);
    this._updateMoveVec();
  }

  triggerAction(actionName, value = true) {
    if (actionName === 'guard') {
      this.guardDown = Boolean(value);
    } else if (actionName === 'gate') {
      if (value) {
        this.keys.add('KeyF');
        this.actions.gate = true;
      } else {
        this.keys.delete('KeyF');
        this.actions.gate = false;
      }
    } else if (actionName === 'pause') {
      this.keys.add('Escape');
    } else if (actionName in this.actions) {
      this.actions[actionName] = value;
    }
  }

  _updateMoveVec() {
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW')) y -= 1;
    if (this.keys.has('KeyS')) y += 1;
    if (this.keys.has('KeyA')) x -= 1;
    if (this.keys.has('KeyD')) x += 1;

    if (x === 0 && y === 0 && (this.touchMoveX !== 0 || this.touchMoveY !== 0)) {
      this.moveX = this.touchMoveX;
      this.moveY = this.touchMoveY;
    } else {
      this.moveX = x;
      this.moveY = y;
    }

    const keySprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    this.sprint = keySprint || Boolean(this.touchSprint);
  }

  /**
   * 프레임별 입력 스냅샷 추출 및 1회성 트리거 플래그 초기화
   */
  poll() {
    const snapshot = {
      moveX: this.moveX,
      moveY: this.moveY,
      sprint: this.sprint,
      guardDown: this.guardDown,
      mouseDown: this.mouseDown,
      mouseX: this.mouseX,
      mouseY: this.mouseY,
      keys: new Set(this.keys),
      actions: { ...this.actions },
    };

    // 1회성 액션 버퍼 소비 초기화
    this.actions.roll = false;
    this.actions.lamp = false;
    this.actions.interact = false;
    this.actions.attack = false;
    this.actions.tabInv = false;
    this.actions.gate = false;
    this.actions.consumable = null;
    this.actions.blessingChoice = null;

    if (this.keys.has('Escape')) {
      this.keys.delete('Escape');
    }

    return snapshot;
  }

  destroy() {
    if (!this._bound || typeof window === 'undefined') return;

    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('contextmenu', this._onContextMenu);

    if (this.canvas && this.canvas.removeEventListener) {
      this.canvas.removeEventListener('mousemove', this._onMouseMove);
      this.canvas.removeEventListener('mousedown', this._onMouseDown);
      this.canvas.removeEventListener('mouseup', this._onMouseUp);
      this.canvas.removeEventListener('contextmenu', this._onContextMenu);
      this.canvas.removeEventListener('touchstart', this._onTouchStart);
      this.canvas.removeEventListener('touchmove', this._onTouchMove);
    }
    this._bound = false;
  }
}
