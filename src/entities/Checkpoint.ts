import * as THREE from 'three';
import { COLORS } from '../config';
import { tw } from '../level/Grid';
import type { CheckpointDef } from '../level/data';
import { lineText, postName, postShortDate, threadTitle, type Thread } from '../systems/Board';
import { t } from '../i18n';
import { createRingDecalMaterial, createHoloMaterial } from '../render/materials';

const DEG = Math.PI / 180;
export const BOARD_FONT = '"M PLUS 1 Code", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", monospace';

/** 1行に収まるように折り返す */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxW && line) {
      out.push(line);
      line = ch;
    } else line = test;
  }
  if (line) out.push(line);
  return out;
}

/** 掲示板ノード（チェックポイント） */
export class Checkpoint {
  readonly def: CheckpointDef;
  readonly pos: THREE.Vector3;
  readonly spawn: THREE.Vector3;
  readonly facing: number;
  activated = false;
  current = false;
  private group = new THREE.Group();
  /** カメラの方を向くホログラム画面 */
  private screen = new THREE.Group();
  private canvas: HTMLCanvasElement;
  private ctx2d: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private boardMat: THREE.MeshBasicMaterial;
  private frameMat: THREE.MeshBasicMaterial;
  private ringMat: THREE.ShaderMaterial;
  private column: THREE.Mesh;
  private columnMat: THREE.ShaderMaterial;
  private burst = 0;
  private beams: THREE.Mesh[] = [];
  private thread: Thread | null = null;
  private cursorOn = true;
  private cursorT = 0;
  private label = '';

  constructor(def: CheckpointDef, scene: THREE.Scene) {
    this.def = def;
    this.facing = def.facing * DEG;
    this.pos = new THREE.Vector3(tw(def.x), 0, tw(def.y));
    this.spawn = new THREE.Vector3(this.pos.x + Math.cos(this.facing) * 2.4, 0, this.pos.z + Math.sin(this.facing) * 2.4);

    // 台座（六角形）
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x0f1a1a, metalness: 0.8, roughness: 0.3 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.18, 6), baseMat);
    base.position.y = 0.09;
    base.receiveShadow = true;
    this.frameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.board).multiplyScalar(2.5) });
    const edge = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.03, 4, 6), this.frameMat);
    edge.rotation.x = Math.PI / 2;
    edge.rotation.z = Math.PI / 6;
    edge.position.y = 0.19;
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.0, 8), baseMat);
    pillar.position.y = 0.65;
    this.group.add(base, edge, pillar);

    // 掲示板の画面
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 640;
    this.ctx2d = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.boardMat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0.95, toneMapped: false, side: THREE.FrontSide });
    const BW = 4.0;
    const BH = 2.5;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), this.boardMat);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshBasicMaterial({ color: 0x031210, transparent: true, opacity: 0.8, side: THREE.BackSide }));
    this.screen.add(board, back);
    // 枠
    const fw = BW + 0.1;
    const fh = BH + 0.1;
    for (const [w, h, x, y] of [[fw, 0.04, 0, fh / 2], [fw, 0.04, 0, -fh / 2], [0.04, fh, -fw / 2, 0], [0.04, fh, fw / 2, 0]]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.frameMat);
      b.position.set(x, y, 0.01);
      this.screen.add(b);
    }
    this.screen.position.set(this.pos.x, 3.2, this.pos.z);
    this.screen.traverse((o) => o.layers.enable(1));
    scene.add(this.screen);
    // 台座から画面へ伸びる光の柱
    const lineMat = createHoloMaterial(COLORS.board, { opacity: 0.45, fresnel: 0 });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.12, 1.9, 8, 1, true), lineMat);
    beam.position.y = 1.15 + 0.95;
    this.beams.push(beam);
    this.group.add(beam);
    this.group.position.copy(this.pos);
    this.group.rotation.y = -this.facing + Math.PI / 2;
    this.group.traverse((o) => {
      if (o !== base) o.layers.enable(1);
    });
    scene.add(this.group);

    this.ringMat = createRingDecalMaterial(COLORS.board);
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 5.2), this.ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(this.pos.x, 0.035, this.pos.z);
    ring.layers.set(1);
    scene.add(ring);

    this.columnMat = createHoloMaterial(COLORS.board, { opacity: 0, scan: 1 });
    this.column = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 10, 32, 1, true), this.columnMat);
    this.column.position.set(this.pos.x, 5, this.pos.z);
    this.column.layers.set(1);
    scene.add(this.column);
  }

  setThread(thread: Thread, nodeLabel: string): void {
    this.thread = thread;
    this.label = nodeLabel;
    this.draw(nodeLabel);
  }

  /** 言語を切り替えたときに描き直す */
  redraw(): void {
    this.draw(this.label);
  }

  private draw(nodeLabel: string): void {
    const c = this.ctx2d;
    const W = this.canvas.width;
    const H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(2, 30, 20, 0.92)');
    g.addColorStop(1, 'rgba(1, 12, 10, 0.92)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // 走査線
    c.fillStyle = 'rgba(0, 0, 0, 0.18)';
    for (let y = 0; y < H; y += 4) c.fillRect(0, y, W, 1);
    c.strokeStyle = 'rgba(61, 255, 168, 0.6)';
    c.lineWidth = 4;
    c.strokeRect(6, 6, W - 12, H - 12);

    c.textBaseline = 'top';
    c.fillStyle = 'rgba(61, 255, 168, 0.95)';
    c.font = `700 30px ${BOARD_FONT}`;
    c.fillText(`■ ${t('board.title')} // ${nodeLabel}`, 28, 24);
    c.font = `400 22px ${BOARD_FONT}`;
    c.fillStyle = 'rgba(61, 255, 168, 0.6)';
    const enc = t('board.canvas.enc');
    c.fillText(enc, W - 28 - c.measureText(enc).width, 30);
    c.fillStyle = 'rgba(61, 255, 168, 0.35)';
    c.fillRect(28, 68, W - 56, 2);

    if (!this.thread) return;
    c.font = `700 32px ${BOARD_FONT}`;
    c.fillStyle = '#ffcf6b';
    const titleLines = wrapText(c, threadTitle(this.thread), W - 56);
    let y = 84;
    for (const l of titleLines.slice(0, 2)) {
      c.fillText(l, 28, y);
      y += 40;
    }
    y += 6;
    const posts = this.thread.posts.slice(-3);
    for (const p of posts) {
      c.font = `400 21px ${BOARD_FONT}`;
      c.fillStyle = p.fresh ? '#9dffd0' : 'rgba(150, 220, 190, 0.75)';
      c.fillText(`${p.no} ${t('board.name')}${postName(p)}${p.trip ? ' ' + p.trip : ''}  ${postShortDate(p)}`, 28, y);
      y += 30;
      c.font = `400 26px ${BOARD_FONT}`;
      c.fillStyle = p.kind === 'lost' ? '#ff9aa8' : p.kind === 'clear' ? '#e8fff4' : 'rgba(220, 255, 238, 0.9)';
      let lines = 0;
      for (const line of p.body) {
        for (const l of wrapText(c, lineText(line), W - 80)) {
          if (lines >= 3) break;
          c.fillText(l, 48, y);
          y += 33;
          lines++;
        }
        if (lines >= 3) break;
      }
      y += 12;
      if (y > H - 70) break;
    }
    c.font = `400 22px ${BOARD_FONT}`;
    c.fillStyle = 'rgba(61, 255, 168, 0.8)';
    c.fillText(`${t('board.canvas.foot', { n: this.thread.posts.length })}${this.cursorOn ? ' _' : ''}`, 28, H - 44);
    this.texture.needsUpdate = true;
  }

  activate(): void {
    this.activated = true;
    this.burst = 1;
  }

  setState(activated: boolean, current: boolean): void {
    this.activated = activated;
    this.current = current;
  }

  update(dt: number, time: number, near: boolean, nodeLabel: string, camera: THREE.Camera): void {
    this.burst = Math.max(0, this.burst - dt * 0.5);
    this.screen.quaternion.copy(camera.quaternion);
    this.screen.position.y = 3.2 + Math.sin(time * 1.3 + this.def.id) * 0.06;
    const on = this.activated;
    const bright = on ? (this.current ? 1 : 0.75) : 0.45;
    this.boardMat.opacity = 0.55 + bright * 0.4 + Math.sin(time * 30) * 0.01;
    this.frameMat.color.set(COLORS.board).multiplyScalar(1 + bright * 2 + this.burst * 4);
    this.ringMat.uniforms.uActive.value = near ? 1 : on ? 0.4 : 0;
    this.ringMat.uniforms.uProgress.value = on ? 1 : 0;
    this.ringMat.uniforms.uAlpha.value = 0.5 + bright * 0.5;
    this.columnMat.uniforms.uOpacity.value = this.burst * 0.9 + (this.current ? 0.035 : 0);
    this.column.visible = this.columnMat.uniforms.uOpacity.value > 0.005;
    this.column.scale.set(1 + (1 - this.burst) * 0.4, 1, 1 + (1 - this.burst) * 0.4);
    this.cursorT += dt;
    if (this.cursorT > 0.6) {
      this.cursorT = 0;
      this.cursorOn = !this.cursorOn;
      if (near || this.current) this.draw(nodeLabel);
    }
  }
}
