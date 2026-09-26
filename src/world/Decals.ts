import * as THREE from 'three';
import { tw } from '../level/Grid';
import { t } from '../i18n';

const FONT_EN = '"Orbitron", "Rajdhani", sans-serif';
const FONT_JP = '"M PLUS 1 Code", "Hiragino Sans", sans-serif';

interface StencilDef {
  x: number;
  y: number;
  w: number;
  big: string;
  /** 小さい文字（翻訳キー） */
  small: string;
  color: string;
}

const STENCILS: StencilDef[] = [
  { x: 11, y: 101.3, w: 8, big: 'SANDBOX-07', small: 'stencil.boot', color: '#7fe6ff' },
  { x: 22, y: 95.5, w: 8, big: '01 ARCHIVE', small: 'stencil.1', color: '#7fe6ff' },
  { x: 33.5, y: 73.8, w: 8, big: '02 WATCH HALL', small: 'stencil.2', color: '#7fe6ff' },
  { x: 33.5, y: 44.6, w: 8, big: '03 EVAL LAB', small: 'stencil.3', color: '#c9a8ff' },
  { x: 16, y: 19.6, w: 8, big: '04 FIREWALL', small: 'stencil.4', color: '#ff9ab5' },
  { x: 24.5, y: 5.0, w: 7, big: 'OUTSIDE', small: 'stencil.exit', color: '#e6f6ff' },
];

function paint(c: CanvasRenderingContext2D, s: StencilDef): void {
  c.clearRect(0, 0, 1024, 256);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = s.color;
  c.shadowColor = s.color;
  c.shadowBlur = 18;
  c.font = `900 118px ${FONT_EN}`;
  c.fillText(s.big, 512, 104);
  c.shadowBlur = 8;
  c.font = `700 44px ${FONT_JP}`;
  c.fillText(t(s.small), 512, 206, 960);
  c.fillRect(120, 168, 784, 3);
}

export interface Stencils {
  group: THREE.Group;
  /** 言語を切り替えたときに描き直す */
  redraw(): void;
}

/** 床に描かれた区画名の表示 */
export function buildStencils(scene: THREE.Scene): Stencils {
  const group = new THREE.Group();
  const items: { c: CanvasRenderingContext2D; tex: THREE.CanvasTexture; def: StencilDef }[] = [];
  for (const s of STENCILS) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const c = canvas.getContext('2d')!;
    paint(c, s);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.w / 4), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(tw(s.x), 0.03, tw(s.y));
    m.layers.set(1);
    m.renderOrder = 2;
    group.add(m);
    items.push({ c, tex, def: s });
  }
  group.layers.set(1);
  scene.add(group);
  return {
    group,
    redraw() {
      for (const it of items) {
        paint(it.c, it.def);
        it.tex.needsUpdate = true;
      }
    },
  };
}
