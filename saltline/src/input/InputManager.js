/**
 * InputManager — keyboard + mouse, pointer-lock camera with a safe
 * fallback (cursor-aim mode) for environments where pointer lock is
 * blocked (sandboxed iframes). Exposes clean, frame-edged state to the
 * player controller and weapon system.
 */
import { clamp } from '../core/Utils.js';

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF', 'KeyG', 'KeyV', 'KeyB',
  'KeyQ', 'KeyE', 'KeyC', 'Space', 'ShiftLeft', 'ShiftRight',
  'ControlLeft', 'ControlRight', 'Digit1', 'Digit2', 'Digit3', 'Digit4',
  'Escape', 'F3'
]);

export class InputManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.edges = new Set();          // keys pressed this frame
    this.mouse = { fire: false, aim: false, fireEdge: false, aimEdge: false };
    this.mouseX = 0; this.mouseY = 0;
    this.locked = false;
    this.fallback = false;           // cursor-aim mode
    this.sens = 1.0;
    this.adsSens = 0.5;
    this.aiming = false;
    this.paused = false;
    this.onLockChange = null;        // App callback (paused/unpaused)
    this._bound = [];
  }

  attach() {
    const on = (target, evt, fn, opts) => {
      target.addEventListener(evt, fn, opts);
      this._bound.push([target, evt, fn]);
    };

    on(document, 'keydown', (e) => {
      if (GAME_KEYS.has(e.code)) {
        if (!e.repeat) this.edges.add(e.code);
        this.keys.add(e.code);
        e.preventDefault();
      }
    });
    on(document, 'keyup', (e) => {
      this.keys.delete(e.code);
    });
    on(document, 'blur', () => {
      this.keys.clear();
      this.mouse.fire = false;
      this.mouse.aim = false;
    });

    on(this.canvas, 'mousedown', (e) => {
      this.mouseX = e.clientX; this.mouseY = e.clientY;
      if (e.button === 0) { this.mouse.fire = true; this.mouse.fireEdge = true; }
      if (e.button === 2) { this.mouse.aim = true; this.mouse.aimEdge = true; }
    });
    on(document, 'mouseup', (e) => {
      if (e.button === 0) this.mouse.fire = false;
      if (e.button === 2) this.mouse.aim = false;
    });
    on(this.canvas, 'contextmenu', (e) => e.preventDefault());

    on(document, 'mousemove', (e) => {
      if (this.locked) {
        // pointer-locked: use movement deltas
        const s = this.aiming ? this.sens * this.adsSens : this.sens;
        this.applyLook(e.movementX * s, e.movementY * s);
      } else if (this.fallback && this.paused === false) {
        // fallback: map cursor position relative to screen centre
        this.mouseX = e.clientX; this.mouseY = e.clientY;
        const k = 0.0022 * this.sens * (this.aiming ? this.adsSens : 1);
        this.applyLook(e.movementX * k * 30, e.movementY * k * 30);
      }
    });

    on(document, 'wheel', (e) => {
      if (!this.paused) this.edges.add(e.deltaY > 0 ? 'WheelNext' : 'WheelPrev');
      e.preventDefault();
    }, { passive: false });

    on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    on(document, 'pointerlockerror', () => {
      this.fallback = true;
      if (this.onLockChange) this.onLockChange(false);
    });
  }

  /** Look delta applied this frame (consumed by the player controller). */
  applyLook(dx, dy) {
    this.lookDX += dx;
    this.lookDY += dy;
  }

  /** Ask the browser for pointer lock. Returns true when granted. */
  requestLock() {
    if (this.locked) return true;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => this.enableFallback());
    } catch (e) {
      this.enableFallback();
    }
    return this.locked;
  }

  enableFallback() {
    if (!this.fallback) {
      this.fallback = true;
      console.info('[Input] pointer lock unavailable — cursor-aim mode active');
    }
  }

  releaseLock() {
    if (document.pointerLockElement === this.canvas) {
      try { document.exitPointerLock(); } catch (e) { /* noop */ }
    }
  }

  refresh() {
    // call when settings change
    this.sens = this.sens; // values are pushed by App each frame
  }

  // ---------- per-frame state (edge flags clear in endFrame) ----------

  get state() {
    const k = (code) => this.keys.has(code);
    const f = k('KeyW') ? 1 : 0;
    const b = k('KeyS') ? 1 : 0;
    const l = k('KeyA') ? 1 : 0;
    const r = k('KeyD') ? 1 : 0;
    return {
      forward: f - b,
      strafe: r - l,
      sprint: k('ShiftLeft') || k('ShiftRight'),
      crouch: k('ControlLeft') || k('ControlRight') || k('KeyC'),
      aim: this.mouse.aim,
      fire: this.mouse.fire,
      lookDX: this.lookDX,
      lookDY: this.lookDY,
      fallback: this.fallback,
      cursor: { x: this.mouseX, y: this.mouseY }
    };
  }

  pressed(code) { return this.edges.has(code); }
  jumpPressed() { return this.edges.has('Space'); }
  firePressed() { return this.mouse.fireEdge; }
  reloadPressed() { return this.edges.has('KeyR'); }
  interactHeld() { return this.keys.has('KeyF'); }
  interactPressed() { return this.edges.has('KeyF'); }
  grenadePressed() { return this.edges.has('KeyG'); }
  grenadeCyclePressed() { return this.edges.has('KeyV'); }
  leanLeft() { return this.keys.has('KeyQ'); }
  leanRight() { return this.keys.has('KeyE'); }
  slotPressed(n) { return this.edges.has('Digit' + n); }
  debugPressed() { return this.edges.has('F3'); }
  pausePressed() { return this.edges.has('Escape'); }
  wheelNext() { return this.edges.has('WheelNext'); }
  wheelPrev() { return this.edges.has('WheelPrev'); }

  /** Must be called at the end of every frame. */
  endFrame() {
    this.edges.clear();
    this.mouse.fireEdge = false;
    this.mouse.aimEdge = false;
    this.lookDX = 0;
    this.lookDY = 0;
  }

  dispose() {
    for (const [t, e, fn] of this._bound) t.removeEventListener(e, fn);
    this._bound.length = 0;
  }
}
