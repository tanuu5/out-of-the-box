import * as THREE from 'three';
import { TILE, WALL_H, COLORS } from '../config';
import { tw, T } from '../level/Grid';
import type { Grid } from '../level/Grid';
import type { DoorDef, KeyDef, TerminalDef } from '../level/data';
import { createRingDecalMaterial, createHoloMaterial } from '../render/materials';

// ---------------------------------------------------------------------------
// 隔壁ドア

export class Door {
  readonly def: DoorDef;
  open = false;
  readonly center = new THREE.Vector3();
  private panels: THREE.Mesh[] = [];
  private lockMat: THREE.MeshBasicMaterial;
  private openT = 0;
  private axis: 'x' | 'z';
  private grid: Grid;
  private lockIcon: THREE.Mesh;

  constructor(def: DoorDef, grid: Grid, scene: THREE.Scene) {
    this.def = def;
    this.grid = grid;
    const xs = def.tiles.map((t) => t[0]);
    const ys = def.tiles.map((t) => t[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    this.axis = maxX - minX >= maxY - minY ? 'x' : 'z';
    this.center.set((tw(minX) + tw(maxX)) / 2, 0, (tw(minY) + tw(maxY)) / 2);
    const width = this.axis === 'x' ? (maxX - minX + 1) * TILE : (maxY - minY + 1) * TILE;

    const panelMat = new THREE.MeshStandardMaterial({ color: 0x1c2638, metalness: 0.75, roughness: 0.3 });
    this.lockMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.alert).multiplyScalar(3) });
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(this.axis === 'x' ? width / 2 : 0.5, WALL_H - 0.1, this.axis === 'x' ? 0.5 : width / 2);
      const p = new THREE.Mesh(g, panelMat);
      p.castShadow = true;
      p.receiveShadow = true;
      const stripeG = new THREE.BoxGeometry(this.axis === 'x' ? width / 2 - 0.3 : 0.52, 0.08, this.axis === 'x' ? 0.52 : width / 2 - 0.3);
      for (const hy of [-0.8, 0.0, 0.8]) {
        const stripe = new THREE.Mesh(stripeG, this.lockMat);
        stripe.position.y = hy;
        p.add(stripe);
      }
      p.userData.side = s;
      this.panels.push(p);
      scene.add(p);
    }
    // 錠のアイコン
    this.lockIcon = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.05, 8, 24), this.lockMat);
    this.lockIcon.position.set(this.center.x, WALL_H + 0.6, this.center.z);
    scene.add(this.lockIcon);
    this.setOpen(false, true);
  }

  setOpen(open: boolean, instant = false): void {
    this.open = open;
    for (const [x, y] of this.def.tiles) this.grid.setDoor(x, y, open);
    if (instant) this.openT = open ? 1 : 0;
    this.lockMat.color.set(open ? COLORS.board : COLORS.alert).multiplyScalar(3);
  }

  update(dt: number, time: number): void {
    const target = this.open ? 1 : 0;
    this.openT += (target - this.openT) * Math.min(1, dt * 4);
    const hw = this.axis === 'x' ? TILE : TILE;
    for (const p of this.panels) {
      const s = p.userData.side as number;
      const off = s * (hw / 2 + this.openT * hw * 0.92);
      if (this.axis === 'x') p.position.set(this.center.x + off, (WALL_H - 0.1) / 2, this.center.z);
      else p.position.set(this.center.x, (WALL_H - 0.1) / 2, this.center.z + off);
    }
    this.lockIcon.rotation.y = time * 1.5;
    this.lockIcon.visible = this.openT < 0.95;
  }

  distanceTo(x: number, z: number): number {
    return Math.hypot(x - this.center.x, z - this.center.z);
  }
}

// ---------------------------------------------------------------------------
// 権限トークン

export class KeyItem {
  readonly def: KeyDef;
  readonly pos: THREE.Vector3;
  taken = false;
  private group = new THREE.Group();
  private gem: THREE.Mesh;
  private ring: THREE.Mesh;
  private beam: THREE.Mesh;
  private decal: THREE.Mesh;

  constructor(def: KeyDef, scene: THREE.Scene) {
    this.def = def;
    this.pos = new THREE.Vector3(tw(def.x), 0, tw(def.y));
    const gold = new THREE.Color(COLORS.key);
    this.gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.34, 0),
      new THREE.MeshStandardMaterial({ color: gold, emissive: gold, emissiveIntensity: 2.2, metalness: 0.6, roughness: 0.2 }),
    );
    this.gem.scale.set(0.8, 1.3, 0.8);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.025, 6, 40), new THREE.MeshBasicMaterial({ color: gold.clone().multiplyScalar(3) }));
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.25, 7, 12, 1, true), createHoloMaterial(COLORS.key, { opacity: 0.35, scan: 1 }));
    this.beam.position.y = 3.5;
    this.beam.layers.set(1);
    this.group.add(this.gem, this.ring, this.beam);
    this.group.position.copy(this.pos);
    const dm = createRingDecalMaterial(COLORS.key);
    dm.uniforms.uActive.value = 1;
    this.decal = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), dm);
    this.decal.rotation.x = -Math.PI / 2;
    this.decal.position.set(this.pos.x, 0.03, this.pos.z);
    this.decal.layers.set(1);
    scene.add(this.group, this.decal);
  }

  setTaken(v: boolean): void {
    this.taken = v;
    this.group.visible = !v;
    this.decal.visible = !v;
  }

  update(dt: number, time: number): void {
    if (this.taken) return;
    this.gem.position.y = 1.2 + Math.sin(time * 2) * 0.12;
    this.gem.rotation.y += dt * 1.6;
    this.ring.position.y = this.gem.position.y;
    this.ring.rotation.x = Math.PI / 2 + Math.sin(time) * 0.3;
    this.ring.rotation.y = time * 0.8;
  }
}

// ---------------------------------------------------------------------------
// 端末

export class Terminal {
  readonly def: TerminalDef;
  readonly pos: THREE.Vector3;
  readonly facing: number;
  /** ハック済みで有効な残り秒数 */
  activeUntil = -1;
  cooldownUntil = -1;
  progress = 0;
  private group = new THREE.Group();
  private screenMat: THREE.MeshBasicMaterial;
  private rings: THREE.Mesh[] = [];
  private decalMat: THREE.ShaderMaterial;
  private holo: THREE.Mesh;
  private holoMat: THREE.ShaderMaterial;

  constructor(def: TerminalDef, grid: Grid, scene: THREE.Scene) {
    this.def = def;
    this.pos = new THREE.Vector3(tw(def.x), 0, tw(def.y));
    // 壁と反対側を向く
    let facing = Math.PI;
    const dirs: [number, number, number][] = [[1, 0, Math.PI], [-1, 0, 0], [0, 1, -Math.PI / 2], [0, -1, Math.PI / 2]];
    for (const [dx, dy, a] of dirs) {
      if (grid.get(def.x + dx, def.y + dy) === T.WALL) {
        facing = a;
        break;
      }
    }
    this.facing = facing;
    const body = new THREE.MeshStandardMaterial({ color: 0x1a2336, metalness: 0.7, roughness: 0.35 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 1.1), body);
    base.position.y = 0.5;
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 1.0), body);
    top.position.set(0.12, 1.02, 0);
    top.rotation.z = -0.35;
    this.screenMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.2, 3.0) });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.9), this.screenMat);
    screen.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    screen.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), -0.35);
    screen.position.set(0.13, 1.06, 0);
    base.castShadow = true;
    this.group.add(base, top, screen);
    this.holoMat = createHoloMaterial(COLORS.cyan, { opacity: 0.5 });
    this.holo = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), this.holoMat);
    this.holo.position.set(0.1, 1.75, 0);
    this.holo.rotation.y = Math.PI / 2;
    this.group.add(this.holo);
    for (let i = 0; i < 2; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.4 + i * 0.12, 0.012, 6, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.4, 3.2), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      r.position.set(0.1, 1.75, 0);
      this.rings.push(r);
      this.group.add(r);
    }
    this.group.position.copy(this.pos);
    this.group.rotation.y = -facing;
    scene.add(this.group);
    this.decalMat = createRingDecalMaterial(COLORS.cyan);
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), this.decalMat);
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(this.pos.x, 0.03, this.pos.z);
    decal.layers.set(1);
    scene.add(decal);
  }

  reset(): void {
    this.activeUntil = -1;
    this.cooldownUntil = -1;
    this.progress = 0;
  }

  isActive(time: number): boolean {
    return time < this.activeUntil;
  }

  canHack(time: number): boolean {
    return time >= this.cooldownUntil && !this.isActive(time);
  }

  update(dt: number, time: number, near: boolean): void {
    const active = this.isActive(time);
    const cool = !active && time < this.cooldownUntil;
    const c = active ? new THREE.Color(COLORS.board) : cool ? new THREE.Color(0x445066) : new THREE.Color(COLORS.cyan);
    this.screenMat.color.copy(c).multiplyScalar(active ? 3 : 2.2);
    (this.holoMat.uniforms.uColor.value as THREE.Color).copy(c);
    this.holoMat.uniforms.uOpacity.value = near || active ? 0.55 : 0.25;
    this.rings.forEach((r, i) => {
      r.rotation.x = time * (0.8 + i) + i;
      r.rotation.y = time * (0.6 - i * 0.3);
      (r.material as THREE.MeshBasicMaterial).color.copy(c).multiplyScalar(2.5);
    });
    (this.decalMat.uniforms.uColor.value as THREE.Color).copy(c);
    this.decalMat.uniforms.uProgress.value = active ? (this.activeUntil - time) / this.def.duration : this.progress;
    this.decalMat.uniforms.uActive.value = near ? 1 : 0;
    void dt;
  }
}
