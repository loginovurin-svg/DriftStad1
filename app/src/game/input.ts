/**
 * input.ts — keyboard/mouse + touch input. **Control-mapping conventions are fixed** (the most
 * frequent playtest defect is a reversed direction mapping):
 *
 *   W / ArrowUp    = move forward (moveZ = +1)
 *   S / ArrowDown  = move backward (moveZ = -1)
 *   A / ArrowLeft  = move left (moveX = -1)
 *   D / ArrowRight = move right (moveX = +1)
 *
 *   In mouse-steering mode, a locked pointer's horizontal delta moves the steering wheel;
 *   in keyboard mode, a held mouse button controls camera orbit.
 *   Mouse moving up    => camera looks up (pitch increases)
 *   Touch left stick   = same directions as WASD; right-side drag = same as mouse
 *
 * When changing these conventions you must also update the direction assertions in scripts/verify-game.mjs.
 */

import { INPUT_CONFIG, type SteeringMode } from "./config";

const KEYMAP: Record<string, [axis: "moveX" | "moveZ", dir: 1 | -1]> = {
  KeyW: ["moveZ", 1], ArrowUp: ["moveZ", 1],
  KeyS: ["moveZ", -1], ArrowDown: ["moveZ", -1],
  KeyA: ["moveX", -1], ArrowLeft: ["moveX", -1],
  KeyD: ["moveX", 1], ArrowRight: ["moveX", 1],
};

export class Input {
  /** Normalized movement axes: moveX ∈ [-1,1] (left negative, right positive), moveZ ∈ [-1,1] (backward negative, forward positive). */
  moveX = 0;
  moveZ = 0;
  /** Camera delta for this frame (radians). Multiply by sensitivity and INVERT config when applying. */
  yawDelta = 0;
  pitchDelta = 0;
  /** Instantaneous actions (true on the frame the key is pressed; auto-cleared once consumed). */
  readonly actions = new Set<string>();
  private held = new Set<string>();
  private touchMoveId: number | null = null;
  private touchAimId: number | null = null;
  private touchMoveOrigin = { x: 0, y: 0 };
  private touchAimOrigin = { x: 0, y: 0 };
  private mouseSteerValue = 0;

  /** Listener teardown — collected at construction so dispose() can unwind every subscription. */
  private unsubscribe: Array<() => void> = [];

  constructor(private target: HTMLElement = document.body) {
    const on = <T extends Event>(
      el: Window | Document | HTMLElement,
      type: string,
      fn: (e: T) => void,
      opts?: AddEventListenerOptions,
    ) => {
      const handler = fn as EventListener;
      el.addEventListener(type, handler, opts);
      this.unsubscribe.push(() => el.removeEventListener(type, handler, opts));
    };

    on<KeyboardEvent>(window, "keydown", (e) => {
      if (e.repeat) return;
      if (isEditableTarget(e.target) && e.code !== "F2") return;
      this.held.add(e.code); // отслеживаем все клавиши: ручник (Space) читается как held
      this.actions.add(e.code); // e.g. "KeyE" / "Escape" / "Space" are consumed directly by code
      this.recomputeAxes();
    });
    on<KeyboardEvent>(window, "keyup", (e) => {
      this.held.delete(e.code);
      this.recomputeAxes();
    });
    // Focus loss must release everything: a keyup that happens while unfocused never arrives,
    // otherwise the character keeps walking by itself after Alt-Tab.
    on(window, "blur", () => this.resetAll());
    on(document, "visibilitychange", () => { if (document.hidden) this.resetAll(); });
    on<MouseEvent>(window, "mousemove", (e) => {
      if (INPUT_CONFIG.STEERING_MODE === "mouse" && document.pointerLockElement === this.target) {
        const direction = INPUT_CONFIG.INVERT_X ? -1 : 1;
        this.mouseSteerValue = clamp(
          this.mouseSteerValue + e.movementX * INPUT_CONFIG.MOUSE_STEER_GAIN * direction,
          -1,
          1,
        );
        this.moveX = this.mouseSteerValue;
        return;
      }
      if (document.pointerLockElement || e.buttons > 0) {
        const sx = INPUT_CONFIG.MOUSE_SENS_X * (INPUT_CONFIG.INVERT_X ? -1 : 1);
        const sy = INPUT_CONFIG.MOUSE_SENS_Y * (INPUT_CONFIG.INVERT_Y ? -1 : 1);
        // mouse right => camera right (yaw decreases in a right-handed system); mouse up => camera up (pitch increases)
        this.yawDelta -= e.movementX * sx;
        this.pitchDelta += -e.movementY * sy;
      }
    });
    on<CustomEvent<SteeringMode>>(window, "driftlab:steering-mode", (e) => {
      this.setSteeringMode(e.detail);
    });
    on<TouchEvent>(target, "touchstart", (e) => this.onTouch(e, true), { passive: true });
    on<TouchEvent>(target, "touchmove", (e) => this.onTouch(e, false), { passive: true });
    on<TouchEvent>(target, "touchend", (e) => this.onTouchEnd(e), { passive: true });
    on<TouchEvent>(target, "touchcancel", (e) => this.onTouchEnd(e), { passive: true });
  }

  /** Detach every listener and zero the axes — call it when the game is unmounted (see src/game/boot.ts). */
  dispose(): void {
    if (document.pointerLockElement === this.target) document.exitPointerLock();
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    this.actions.clear();
    this.resetAll();
  }

  /** Move the steering input between keyboard and locked-pointer modes. */
  setSteeringMode(mode: SteeringMode): void {
    INPUT_CONFIG.STEERING_MODE = mode;
    this.mouseSteerValue = 0;
    this.recomputeAxes();
  }

  /** Update the mouse spring return using the fixed simulation step (seconds). */
  update(dt: number): void {
    if (INPUT_CONFIG.STEERING_MODE !== "mouse" || document.pointerLockElement === this.target) return;
    const amount = INPUT_CONFIG.MOUSE_STEER_CENTER_RATE * dt;
    this.mouseSteerValue = Math.sign(this.mouseSteerValue)
      * Math.max(0, Math.abs(this.mouseSteerValue) - amount);
    this.moveX = this.mouseSteerValue;
  }

  private onTouch(e: TouchEvent, start: boolean): void {
    const w = window.innerWidth;
    for (const t of Array.from(e.changedTouches)) {
      if (start) {
        if (t.clientX < w / 2 && this.touchMoveId === null) {
          this.touchMoveId = t.identifier;
          this.touchMoveOrigin = { x: t.clientX, y: t.clientY };
        } else if (t.clientX >= w / 2 && this.touchAimId === null) {
          this.touchAimId = t.identifier;
          this.touchAimOrigin = { x: t.clientX, y: t.clientY };
        }
      } else if (t.identifier === this.touchMoveId) {
        // left stick: push up = forward (+moveZ), push right = right (+moveX), exactly matching WASD
        this.moveX = INPUT_CONFIG.STEERING_MODE === "keyboard"
          ? clamp((t.clientX - this.touchMoveOrigin.x) / 60, -1, 1)
          : 0;
        this.moveZ = clamp(-(t.clientY - this.touchMoveOrigin.y) / 60, -1, 1);
      } else if (t.identifier === this.touchAimId) {
        const sx = INPUT_CONFIG.MOUSE_SENS_X * (INPUT_CONFIG.INVERT_X ? -1 : 1);
        const sy = INPUT_CONFIG.MOUSE_SENS_Y * (INPUT_CONFIG.INVERT_Y ? -1 : 1);
        this.yawDelta -= (t.clientX - this.touchAimOrigin.x) * sx * 0.5;
        this.pitchDelta += -(t.clientY - this.touchAimOrigin.y) * sy * 0.5;
        this.touchAimOrigin = { x: t.clientX, y: t.clientY };
      }
    }
  }

  private onTouchEnd(e: TouchEvent): void {
    // Each lifted finger releases only its own stick — lifting the aim hand must not kill movement.
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.touchMoveId) {
        this.touchMoveId = null;
        this.recomputeAxes(); // fall back to whatever the keyboard still holds (usually nothing)
      } else if (t.identifier === this.touchAimId) {
        this.touchAimId = null;
      }
    }
  }

  private resetAll(): void {
    this.held.clear();
    this.touchMoveId = null;
    this.touchAimId = null;
    this.yawDelta = 0;
    this.pitchDelta = 0;
    this.mouseSteerValue = 0;
    this.recomputeAxes();
  }

  private recomputeAxes(): void {
    let x = INPUT_CONFIG.STEERING_MODE === "mouse" ? this.mouseSteerValue : 0, z = 0;
    for (const code of this.held) {
      const m = KEYMAP[code];
      if (m) {
        if (m[0] === "moveX" && INPUT_CONFIG.STEERING_MODE === "keyboard") x += m[1];
        else if (m[0] === "moveZ") z += m[1];
      }
    }
    this.moveX = clamp(x, -1, 1);
    this.moveZ = clamp(z, -1, 1);
  }

  /** Is this key currently held down (works for any code, not just the movement map). */
  isHeld(code: string): boolean {
    return this.held.has(code);
  }

  /** Consume the camera delta before each frame render (take and zero it). */
  consumeLook(): { yaw: number; pitch: number } {
    const r = { yaw: this.yawDelta, pitch: this.pitchDelta };
    this.yawDelta = 0;
    this.pitchDelta = 0;
    return r;
  }

  /** Consume an instantaneous action: was this key pressed during the current frame. */
  consumeAction(code: string): boolean {
    const has = this.actions.has(code);
    if (has) this.actions.delete(code);
    return has;
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.isContentEditable || target.matches("input, textarea, select, [contenteditable='true']"));
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
