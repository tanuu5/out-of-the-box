/** キーボード・マウス・ゲームパッド入力 */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  /** 正規化デバイス座標 */
  ndcX = 0;
  ndcY = 0;
  leftClick = false;
  rightDown = false;
  dragDX = 0;
  dragDY = 0;
  wheel = 0;
  private lastX = 0;
  private lastY = 0;
  private el: HTMLElement;
  padMove = { x: 0, y: 0 };
  padLook = { x: 0, y: 0 };
  private padPrev: boolean[] = [];
  usingPad = false;

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = this.norm(e);
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
      if (!this.down.has(k)) this.pressed.add(k);
      this.down.add(k);
      this.usingPad = false;
    });
    window.addEventListener('keyup', (e) => {
      const k = this.norm(e);
      this.down.delete(k);
      this.released.add(k);
    });
    window.addEventListener('blur', () => {
      this.down.clear();
      this.rightDown = false;
    });
    el.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      const r = el.getBoundingClientRect();
      this.ndcX = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.ndcY = -((e.clientY - r.top) / r.height) * 2 + 1;
      if (this.rightDown) {
        this.dragDX += e.clientX - this.lastX;
        this.dragDY += e.clientY - this.lastY;
      }
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    el.addEventListener('mousedown', (e) => {
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (e.button === 0) this.leftClick = true;
      if (e.button === 2 || e.button === 1) this.rightDown = true;
      this.usingPad = false;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2 || e.button === 1) this.rightDown = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
  }

  private norm(e: KeyboardEvent): string {
    if (e.code === 'Space') return 'Space';
    if (e.code.startsWith('Key')) return e.code.slice(3);
    if (e.code.startsWith('Digit')) return e.code.slice(5);
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') return 'Shift';
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') return 'Ctrl';
    return e.code || e.key;
  }

  isDown(k: string): boolean {
    return this.down.has(k);
  }

  wasPressed(k: string): boolean {
    return this.pressed.has(k);
  }

  anyPressed(...keys: string[]): boolean {
    return keys.some((k) => this.pressed.has(k));
  }

  /** WASD / 矢印 / 左スティック（x: 右, y: 前） */
  moveVector(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.isDown('W') || this.isDown('ArrowUp')) y += 1;
    if (this.isDown('S') || this.isDown('ArrowDown')) y -= 1;
    if (this.isDown('D') || this.isDown('ArrowRight')) x += 1;
    if (this.isDown('A') || this.isDown('ArrowLeft')) x -= 1;
    if (Math.abs(this.padMove.x) > 0.01 || Math.abs(this.padMove.y) > 0.01) {
      x += this.padMove.x;
      y += this.padMove.y;
    }
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return { x, y };
  }

  /** ゲームパッドのボタンを仮想キーとして扱う */
  pollGamepad(): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && Array.from(pads).find((p) => p && p.connected);
    if (!gp) {
      this.padMove.x = this.padMove.y = 0;
      this.padLook.x = this.padLook.y = 0;
      return;
    }
    const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
    this.padMove.x = dz(gp.axes[0] ?? 0);
    this.padMove.y = -dz(gp.axes[1] ?? 0);
    this.padLook.x = dz(gp.axes[2] ?? 0);
    this.padLook.y = dz(gp.axes[3] ?? 0);
    if (this.padMove.x || this.padMove.y) this.usingPad = true;
    const map: Record<number, string> = { 0: 'PadA', 1: 'PadB', 2: 'PadX', 3: 'PadY', 4: 'PadLB', 5: 'PadRB', 6: 'PadLT', 7: 'PadRT', 8: 'PadBack', 9: 'PadStart', 12: 'PadUp', 13: 'PadDown' };
    gp.buttons.forEach((b, i) => {
      const name = map[i];
      if (!name) return;
      const was = this.padPrev[i] ?? false;
      const now = b.pressed || b.value > 0.5;
      if (now && !was) {
        this.pressed.add(name);
        this.usingPad = true;
      }
      if (now) this.down.add(name);
      else if (was) {
        this.down.delete(name);
        this.released.add(name);
      }
      this.padPrev[i] = now;
    });
  }

  consumeClick(): boolean {
    const c = this.leftClick;
    this.leftClick = false;
    return c;
  }

  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.dragDX = 0;
    this.dragDY = 0;
    this.wheel = 0;
    this.leftClick = false;
  }

  get element(): HTMLElement {
    return this.el;
  }
}
