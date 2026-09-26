import * as THREE from 'three';
import type { Grid } from '../level/Grid';
import { createConeMaterial } from '../render/materials';
import { COLORS } from '../config';

const tmpColor = new THREE.Color();
const cCalm = new THREE.Color(COLORS.calm);
const cSus = new THREE.Color(COLORS.suspicious);
const cAlert = new THREE.Color(COLORS.alert);

/** 床に投影される視界の扇形。壁で遮られた形をレイキャストで作る */
export class VisionCone {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private readonly positions: Float32Array;
  private readonly rays: number;
  private readonly geo: THREE.BufferGeometry;

  constructor(rays = 56) {
    this.rays = rays;
    const count = rays + 2;
    this.positions = new Float32Array(count * 3);
    this.geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(this.positions, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', attr);
    // 上から見て反時計回り（面が上を向く）
    const idx: number[] = [];
    for (let i = 0; i < rays; i++) idx.push(0, i + 2, i + 1);
    this.geo.setIndex(idx);
    this.material = createConeMaterial();
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.layers.set(1);
  }

  update(grid: Grid, ox: number, oz: number, angle: number, half: number, range: number, skipOrigin: boolean, y = 0.04): void {
    const p = this.positions;
    p[0] = ox;
    p[1] = y;
    p[2] = oz;
    const blocks = (x: number, yy: number) => grid.blocksTall(x, yy);
    for (let i = 0; i <= this.rays; i++) {
      const a = angle - half + (2 * half * i) / this.rays;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const d = grid.raycast(ox, oz, dx, dz, range, blocks, skipOrigin);
      const k = (i + 1) * 3;
      p[k] = ox + dx * d;
      p[k + 1] = y;
      p[k + 2] = oz + dz * d;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    const u = this.material.uniforms;
    u.uOrigin.value.set(ox, oz);
    u.uDir.value.set(Math.cos(angle), Math.sin(angle));
    u.uHalf.value = half;
    u.uRange.value = range;
  }

  setLevel(level: number, alpha = 1): void {
    const u = this.material.uniforms;
    if (level < 0.5) tmpColor.copy(cCalm).lerp(cSus, Math.min(1, level * 2.2));
    else tmpColor.copy(cSus).lerp(cAlert, (level - 0.5) * 2);
    (u.uColor.value as THREE.Color).copy(tmpColor);
    u.uLevel.value = level;
    u.uAlpha.value = alpha;
  }
}

export function stateColor(level: number, out: THREE.Color): THREE.Color {
  if (level < 0.5) return out.copy(cCalm).lerp(cSus, Math.min(1, level * 2.2));
  return out.copy(cSus).lerp(cAlert, (level - 0.5) * 2);
}
